import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type JSONValue, type Sql } from "postgres";
import * as schema from "@/db/schema";
import {
  activityPlanProposals,
  capabilities,
  capabilityResolutions,
  capabilityVersions,
  componentEvaluations,
  componentVersions,
  components,
  diagnosticObservations,
  learnerAttempts,
  learningTasks,
} from "@/db/schema";
import { RUNTIME_DATABASE_ROLES, withRuntimeDatabaseRole } from "@/db/database-config";
import { ActorSchema, Role, type Actor } from "@/domain/model";
import { DomainInvariantError, requireCourseAccess, requireRole } from "@/domain/invariants";
import {
  executeHashBoundWebComponentAsset,
  SourceWebComponentAssetContract,
  SourceWebComponentAssetPackage,
  WebComponentAssetContract,
  WebComponentAssetPackage,
  webComponentAssetHash,
} from "@/domain/web-component-asset";
import type { ComponentExecutorEnvironment } from "@/component-executor/config";
import { resolveComponentExecutorServiceConfig } from "@/component-executor/config";
import type { EvaluateDraftCommand, ExecutorActorClaim, PreviewDraftCommand } from "@/component-executor/protocol";

type Database = PostgresJsDatabase<typeof schema>;
type ComponentSystemCheck = {
  id: string;
  status: "PASSED" | "BLOCKED" | "NOT_REQUIRED";
  detail: string;
  evidence?: Record<string, unknown>;
};

function evaluationIdFromInputHash(inputHash: string): string {
  const raw = createHash("sha256").update(`COMPONENT_EVALUATION:${inputHash}`).digest("hex").slice(0, 32).split("");
  raw[12] = "5";
  raw[16] = ((Number.parseInt(raw[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = raw.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function check(id: string, passed: boolean, detail: string, evidence?: Record<string, unknown>): ComponentSystemCheck {
  return { id, status: passed ? "PASSED" : "BLOCKED", detail, ...(evidence ? { evidence } : {}) };
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function excludesRestrictedLearnerData(payload: unknown, restricted: string[]): boolean {
  const serialized = JSON.stringify(payload).toLocaleLowerCase("en-US");
  return restricted.filter((value) => value.trim().length >= 8)
    .every((value) => !serialized.includes(value.trim().toLocaleLowerCase("en-US")));
}

async function setActorSettings(sql: Sql, actor: Actor | ExecutorActorClaim, roles: string[], courseIds: string[], purpose?: "WEB_COMPONENT_EVALUATION" | "WEB_COMPONENT_PREVIEW") {
  await sql`
    SELECT
      set_config('foundry.institution_id', ${actor.institutionId}, true),
      set_config('foundry.user_id', ${actor.userId}, true),
      set_config('foundry.session_id', ${actor.sessionId}, true),
      set_config('foundry.auth_method', ${actor.authMethod}, true),
      set_config('foundry.roles', ${roles.join(",")}, true),
      set_config('foundry.course_ids', ${courseIds.join(",")}, true),
      set_config('foundry.executor_purpose', ${purpose ?? ""}, true)
  `;
}

async function canonicalActor(transaction: Sql, claim: ExecutorActorClaim): Promise<Actor> {
  await setActorSettings(transaction, claim, [], []);
  const memberships = await transaction<Array<{ role: string }>>`
    SELECT role FROM foundry_product.institution_memberships
    WHERE institution_id=${claim.institutionId}::uuid AND user_id=${claim.userId}::uuid
    ORDER BY role
  `;
  const enrollments = await transaction<Array<{ course_id: string; role: string }>>`
    SELECT course_id,role FROM foundry_product.course_enrollments
    WHERE institution_id=${claim.institutionId}::uuid AND user_id=${claim.userId}::uuid
    ORDER BY course_id,role
  `;
  if (memberships.length === 0) throw new DomainInvariantError("Component Executor actor has no current institution membership", "TENANT_ISOLATION");
  const roles = [...new Set([...memberships, ...enrollments].map((row) => Role.parse(row.role)))];
  const courseIds = [...new Set(enrollments.map((row) => row.course_id))];
  const actor = ActorSchema.parse({ ...claim, roles, courseIds });
  await setActorSettings(transaction, actor, actor.roles, actor.courseIds);
  return actor;
}

async function computeEvaluation(db: Database, actor: Actor, command: EvaluateDraftCommand) {
  requireRole(actor, ["EXPERT", "ADMIN"]);
  const [row] = await db.select({ component: components, version: componentVersions, resolution: capabilityResolutions, plan: activityPlanProposals, observation: diagnosticObservations, attempt: learnerAttempts, task: learningTasks })
    .from(componentVersions)
    .innerJoin(components, eq(components.id, componentVersions.componentId))
    .innerJoin(capabilityResolutions, eq(capabilityResolutions.id, components.sourceCapabilityResolutionId))
    .innerJoin(activityPlanProposals, eq(activityPlanProposals.id, components.sourceActivityPlanProposalId))
    .innerJoin(diagnosticObservations, eq(diagnosticObservations.id, capabilityResolutions.diagnosticObservationId))
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, capabilityResolutions.taskId))
    .where(and(eq(componentVersions.id, command.componentVersionId), eq(components.institutionId, actor.institutionId), eq(components.assetType, "WEB_COMPONENT_ASSET"))).limit(1);
  if (!row) throw new DomainInvariantError("Web ComponentAssetVersion is outside the active institution", "TENANT_ISOLATION");
  requireCourseAccess(actor, row.component.institutionId, row.component.courseId);
  if (row.version.status !== "DRAFT") throw new DomainInvariantError("Only a Draft Web ComponentAssetVersion can be checked", "VERSION_IMMUTABLE");
  if (row.version.contentHash !== command.expectedContentHash) throw new DomainInvariantError("Web ComponentAssetVersion hash changed before trusted evaluation", "COMPONENT_EVALUATION_CONFLICT");

  const parsedContract = WebComponentAssetContract.safeParse(row.version.contract);
  const parsedPackage = WebComponentAssetPackage.safeParse(row.version.content);
  const exactHash = parsedContract.success && parsedPackage.success ? webComponentAssetHash(parsedContract.data, parsedPackage.data) : null;
  const candidates = records(row.resolution.candidateSet);
  const priorModesAbsent = !candidates.some((candidate) => candidate.eligibility === "ELIGIBLE" && new Set(["EXACT", "PARAMETERIZE", "COMPOSE"]).has(String(candidate.matchMode)));
  const sourceCandidate = candidates.find((candidate) => candidate.versionId === row.component.adaptedFromCapabilityVersionId);
  const [source] = row.component.adaptedFromCapabilityId && row.component.adaptedFromCapabilityVersionId && row.component.adaptedFromComponentVersionId
    ? await db.select({ capability: capabilities, version: capabilityVersions, component: components, componentVersion: componentVersions }).from(capabilityVersions)
      .innerJoin(capabilities, eq(capabilities.id, capabilityVersions.capabilityId))
      .innerJoin(componentVersions, eq(componentVersions.id, row.component.adaptedFromComponentVersionId))
      .innerJoin(components, eq(components.id, componentVersions.componentId))
      .where(and(eq(capabilities.id, row.component.adaptedFromCapabilityId), eq(capabilityVersions.id, row.component.adaptedFromCapabilityVersionId))).limit(1)
    : [];
  const strategyValid = row.resolution.decision === "ADAPT" && row.component.supplyStrategy === "ADAPT" && priorModesAbsent;
  const exactAdaptationSource = Boolean(source
    && source.capability.activeVersionId === source.version.id
    && source.version.status === "ACTIVE"
    && source.version.contentHash === row.component.adaptedFromContentHash
    && source.version.componentAssetVersionId === source.componentVersion.id
    && source.component.activeVersionId === source.componentVersion.id
    && source.componentVersion.status === "PUBLISHED"
    && source.componentVersion.contentHash === row.component.adaptedFromComponentContentHash
    && sourceCandidate?.capabilityId === source.capability.id
    && sourceCandidate?.eligibility === "ELIGIBLE"
    && sourceCandidate?.matchMode === "ADAPT"
    && Array.isArray(sourceCandidate.exclusionReasons)
    && sourceCandidate.exclusionReasons.length === 0
    && parsedContract.success
    && parsedContract.data.adaptationSource.capabilityVersionId === source.version.id
    && parsedContract.data.adaptationSource.capabilityVersionContentHash === source.version.contentHash
    && parsedContract.data.adaptationSource.componentAssetVersionId === source.componentVersion.id
    && parsedContract.data.adaptationSource.componentAssetVersionContentHash === source.componentVersion.contentHash
    && parsedPackage.success
    && parsedPackage.data.packageRole === "ADAPTED"
    && parsedPackage.data.adaptation.source.componentVersionId === source.componentVersion.id
    && parsedPackage.data.adaptation.source.contentHash === source.componentVersion.contentHash
    && JSON.stringify(parsedPackage.data.adaptation.source.contract) === JSON.stringify(SourceWebComponentAssetContract.parse(source.componentVersion.contract))
    && JSON.stringify(parsedPackage.data.adaptation.source.package) === JSON.stringify(SourceWebComponentAssetPackage.parse(source.componentVersion.content)));
  const deidentified = parsedContract.success && parsedPackage.success
    && parsedContract.data.dataClassification === "DEIDENTIFIED_INSTRUCTIONAL"
    && excludesRestrictedLearnerData({ contract: parsedContract.data, package: parsedPackage.data }, [
      row.task.id,
      row.task.title,
      row.task.goal,
      row.observation.id,
      row.observation.summary,
      row.attempt.id,
      row.attempt.prompt,
      row.attempt.response,
      row.attempt.learnerId,
      row.resolution.id,
      row.plan.id,
    ]);

  let fixtureExecution: Record<string, unknown> = { status: "BLOCKED" };
  let fixturePassed = false;
  if (parsedPackage.success) {
    try {
      const execution = executeHashBoundWebComponentAsset({
        componentVersionId: row.version.id,
        contentHash: row.version.contentHash,
        contract: parsedContract.success ? parsedContract.data : row.version.contract,
        componentPackage: parsedPackage.data,
        learnerInput: { selectedChoiceId: parsedPackage.data.correctChoiceId },
        previewOnly: false,
      });
      const output = execution.runtimeOutput;
      fixturePassed = output.componentCompleted === true && output.correct === true && output.events.length === 3;
      fixtureExecution = { status: fixturePassed ? "EXECUTED_PASSED" : "EXECUTED_FAILED", input: execution.learnerInput, output, executorVersion: execution.executorVersion, executorReceiptHash: execution.executorReceiptHash };
    } catch (error) {
      fixtureExecution = { status: "FAILED", reason: error instanceof Error ? error.message : String(error) };
    }
  }
  const systemChecks: ComponentSystemCheck[] = [
    check("real-cap02-gap-lineage", row.resolution.noMatch && row.resolution.teacherEscalation && Boolean(row.resolution.gapSignal), "The proposal preserves one unresolved persisted CAP-02 gap."),
    check("supply-priority", strategyValid, "Reuse, parameterize and compose were considered before this bounded ADAPT proposal.", { decision: row.resolution.decision, priorModesAbsent }),
    check("exact-reviewed-adaptation-source", exactAdaptationSource, "The transformed interaction embeds and executes the active eligible reviewed source ComponentAssetVersion package and exact hash."),
    check("restricted-learner-data-deidentified", deidentified, "Reusable contract and package contain only de-identified Registry instructional content; learner/gap prose remains in protected lineage.", { classification: parsedContract.success ? parsedContract.data.dataClassification : "INVALID", protectedFieldCount: 11 }),
    check("web-component-contract", parsedContract.success && parsedPackage.success, "The exact version is a complete declarative Web ComponentAsset package."),
    check("arbitrary-code-prohibited", parsedContract.success && !parsedContract.data.arbitraryCodeAllowed && parsedPackage.success && parsedPackage.data.externalDependencies.length === 0, "The package contains no script, URL, external dependency or arbitrary-code surface."),
    check("exact-content-hash", exactHash === row.version.contentHash, "The checked package and contract match the immutable version content hash."),
    check("runtime-fixture", fixturePassed, "The trusted Web adapter executed the exact package and emitted the declared event contract."),
    check("accessibility-and-events", parsedPackage.success && parsedPackage.data.accessibility.keyboardOperable && parsedPackage.data.accessibility.visibleLabels && parsedPackage.data.accessibility.statusAnnouncement && parsedPackage.data.accessibility.reducedMotionSafe && parsedPackage.data.eventContract.length === 3, "Keyboard, labels, status announcement, reduced motion and exact events are declared."),
    check("stateless-one-shot-behavior", parsedPackage.success && parsedPackage.data.interactionMode === "STATELESS_ONE_SHOT" && !("stateContract" in (row.version.content as Record<string, unknown>)), "The exact asset is a one-shot stateless interaction and makes no reset or resume claim."),
    { id: "rights-provider-dependencies", status: "NOT_REQUIRED", detail: "Foundry's internal declarative template uses no external content, provider or dependency; no external-rights claim is made.", evidence: { rights: "NOT_REQUIRED", provider: null, dependencies: [] } },
  ];
  const systemStatus = systemChecks.some((item) => item.status === "BLOCKED") ? "BLOCKED" : "PASSED";
  const providerChecks = { status: "UNAVAILABLE", detail: "No automated domain, pedagogy or safety provider score ran. Exact learner preview and authenticated expert confirmation remain separate gates." };
  const evidenceChecks = [{ status: "NOT_REQUIRED", policy: "FOUNDRY_INTERNAL_TEMPLATE", detail: "No external Evidence or source-content claim." }];
  const inputHash = createHash("sha256").update(JSON.stringify({ contentHash: row.version.contentHash, sourceResolutionId: row.resolution.id, sourcePlanId: row.plan.id, systemChecks, fixtureExecution })).digest("hex");
  return {
    actor,
    componentId: row.component.id,
    componentVersionId: row.version.id,
    contentHash: row.version.contentHash,
    evaluationId: evaluationIdFromInputHash(inputHash),
    inputHash,
    systemStatus,
    systemChecks,
    fixtureExecution,
    evidenceChecks,
    providerChecks,
  };
}

export function createComponentExecutorService(environment: ComponentExecutorEnvironment = process.env) {
  const config = resolveComponentExecutorServiceConfig(environment);
  const productSql = postgres(withRuntimeDatabaseRole(config.productDatabaseUrl, RUNTIME_DATABASE_ROLES.product), { max: 5, prepare: false });
  const executorSql = postgres(withRuntimeDatabaseRole(config.executorDatabaseUrl, RUNTIME_DATABASE_ROLES.componentExecutor), { max: 3, prepare: false });

  async function withProductActor<T>(claim: ExecutorActorClaim, operation: (db: Database, actor: Actor) => Promise<T>): Promise<T> {
    const result = await productSql.begin(async (transaction) => {
      const transactionSql = transaction as unknown as Sql;
      const actor = await canonicalActor(transactionSql, claim);
      Object.defineProperty(transactionSql, "options", { value: productSql.options, configurable: true });
      return operation(drizzle(transactionSql, { schema }), actor);
    });
    return result as unknown as T;
  }

  async function appendEvaluation(evidence: Awaited<ReturnType<typeof computeEvaluation>>) {
    const rows = await executorSql.begin(async (transaction) => {
      const scoped = transaction as unknown as Sql;
      await setActorSettings(scoped, evidence.actor, evidence.actor.roles, evidence.actor.courseIds, "WEB_COMPONENT_EVALUATION");
      return scoped<Array<{ evaluation_id: string; replayed: boolean }>>`
        SELECT * FROM foundry_product.record_web_component_evaluation(
          ${evidence.evaluationId}::uuid,
          ${evidence.componentVersionId}::uuid,
          ${evidence.inputHash},
          ${evidence.systemStatus},
          ${scoped.json(evidence.systemChecks as unknown as JSONValue)},
          ${scoped.json(evidence.fixtureExecution as unknown as JSONValue)},
          ${scoped.json(evidence.evidenceChecks as unknown as JSONValue)},
          ${scoped.json(evidence.providerChecks as unknown as JSONValue)}
        )
      `;
    });
    const [recorded] = rows as unknown as Array<{ evaluation_id: string; replayed: boolean }>;
    if (!recorded) throw new DomainInvariantError("Trusted evaluation append returned no canonical record", "COMPONENT_EVALUATION_INTEGRITY");
    return { evaluationId: recorded.evaluation_id, replayed: recorded.replayed };
  }

  async function evaluate(command: EvaluateDraftCommand) {
    const evidence = await withProductActor(command.actor, (db, actor) => computeEvaluation(db, actor, command));
    return appendEvaluation(evidence);
  }

  async function preview(command: PreviewDraftCommand) {
    return withProductActor(command.actor, async (db, actor) => {
      requireRole(actor, ["TEACHER", "EXPERT", "ADMIN"]);
      const [row] = await db.select({ component: components, version: componentVersions })
        .from(componentVersions)
        .innerJoin(components, eq(components.id, componentVersions.componentId))
        .where(and(eq(components.id, command.componentId), eq(componentVersions.id, command.componentVersionId), eq(components.institutionId, actor.institutionId), eq(components.assetType, "WEB_COMPONENT_ASSET"))).limit(1);
      if (!row) throw new DomainInvariantError("Web ComponentAssetVersion is outside the active institution", "TENANT_ISOLATION");
      requireCourseAccess(actor, row.component.institutionId, row.component.courseId);
      if (row.version.status !== "DRAFT") throw new DomainInvariantError("Preview is restricted to the exact Draft awaiting confirmation", "VERSION_IMMUTABLE");
      if (row.version.contentHash !== command.expectedContentHash) throw new DomainInvariantError("Web ComponentAssetVersion hash changed before trusted preview", "COMPONENT_PREVIEW_CONFLICT");
      const [evaluation] = await db.select().from(componentEvaluations).where(and(eq(componentEvaluations.componentVersionId, row.version.id), eq(componentEvaluations.contentHash, row.version.contentHash), eq(componentEvaluations.systemStatus, "PASSED"))).orderBy(desc(componentEvaluations.createdAt)).limit(1);
      if (!evaluation) throw new DomainInvariantError("Exact-version checks must pass before learner preview", "COMPONENT_PREVIEW_CHECKS_REQUIRED");
      const execution = executeHashBoundWebComponentAsset({
        componentVersionId: row.version.id,
        contentHash: row.version.contentHash,
        contract: WebComponentAssetContract.parse(row.version.contract),
        componentPackage: WebComponentAssetPackage.parse(row.version.content),
        learnerInput: { selectedChoiceId: command.selectedChoiceId },
        previewOnly: true,
      });
      const previewRequestHash = `sha256:${createHash("sha256").update(JSON.stringify({
        actorUserId: actor.userId,
        componentId: row.component.id,
        componentVersionId: row.version.id,
        evaluationId: evaluation.id,
        contentHash: row.version.contentHash,
        learnerInput: execution.learnerInput,
        executorReceiptHash: execution.executorReceiptHash,
      })).digest("hex")}`;
      const rows = await executorSql.begin(async (transaction) => {
        const scoped = transaction as unknown as Sql;
        await setActorSettings(scoped, actor, actor.roles, actor.courseIds, "WEB_COMPONENT_PREVIEW");
        return scoped<Array<{ preview_id: string; replayed: boolean }>>`
          SELECT * FROM foundry_product.record_component_asset_preview(
            ${randomUUID()}::uuid,
            ${row.component.id}::uuid,
            ${row.version.id}::uuid,
            ${evaluation.id}::uuid,
            ${previewRequestHash},
            ${scoped.json(execution.learnerInput as unknown as JSONValue)},
            ${scoped.json(execution.runtimeOutput as unknown as JSONValue)},
            ${scoped.json(execution.eventTrace as unknown as JSONValue)},
            ${execution.executorVersion},
            ${execution.executorReceiptHash},
            ${command.idempotencyKey}
          )
        `;
      });
      const [recorded] = rows as unknown as Array<{ preview_id: string; replayed: boolean }>;
      if (!recorded) throw new DomainInvariantError("Trusted preview append returned no canonical record", "COMPONENT_PREVIEW_INTEGRITY");
      return { previewId: recorded.preview_id, replayed: recorded.replayed };
    });
  }

  return {
    evaluate,
    preview,
    close: async () => {
      await Promise.all([productSql.end(), executorSql.end()]);
    },
  };
}
