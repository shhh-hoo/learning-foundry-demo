import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "@/domain/model";
import { getDb, withTenantDatabase } from "@/db/client";
import {
  activityPlanProposals,
  capabilities,
  capabilityResolutions,
  capabilityVersions,
  componentAssetPreviews,
  componentEvaluations,
  componentVersions,
  components,
  courses,
  diagnosticObservations,
  governanceEvents,
  idempotencyKeys,
  learnerAttempts,
  learningTasks,
  subjects,
} from "@/db/schema";
import { assertExecutionActive } from "@/application/execution-control";
import { requestWebComponentEvaluation, requestWebComponentPreview } from "@/application/component-executor-client";
import { DomainInvariantError, requireCourseAccess, requireRole } from "@/domain/invariants";
import { CallableCapabilityResolutionContract } from "@/domain/capability-resolution";
import {
  adaptCapabilityToWebComponentAsset,
  SourceWebComponentAssetContract,
  SourceWebComponentAssetPackage,
  WebComponentAssetContract,
  WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
  WEB_COMPONENT_ASSET_RUNTIME_KIND,
  webComponentAssetHash,
} from "@/domain/web-component-asset";

export const WEB_COMPONENT_EVALUATOR_KEY = "foundry-web-component-asset-gates";
export const WEB_COMPONENT_EVALUATOR_VERSION = "cap-07.1";

function requestHash(actor: Actor, commandType: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify({ actorUserId: actor.userId, commandType, input })).digest("hex");
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

const AdaptationGap = z.object({
  kind: z.literal("ADAPTATION_REQUIRED"),
  reason: z.string().trim().min(1),
  relatedCapabilityVersionId: z.string().uuid(),
}).strict();

function resolutionEnvelope(value: unknown): unknown {
  return value && typeof value === "object" && !Array.isArray(value) && "resolution" in value
    ? (value as Record<string, unknown>).resolution
    : value;
}

async function loadGapLineage(actor: Actor, capabilityResolutionId: string) {
  const [lineage] = await getDb().select({
    resolution: capabilityResolutions,
    plan: activityPlanProposals,
    task: learningTasks,
    course: courses,
    subject: subjects,
    observation: diagnosticObservations,
    attempt: learnerAttempts,
  }).from(capabilityResolutions)
    .innerJoin(activityPlanProposals, eq(activityPlanProposals.capabilityResolutionId, capabilityResolutions.id))
    .innerJoin(learningTasks, eq(learningTasks.id, capabilityResolutions.taskId))
    .innerJoin(courses, eq(courses.id, capabilityResolutions.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .innerJoin(diagnosticObservations, eq(diagnosticObservations.id, capabilityResolutions.diagnosticObservationId))
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .where(and(
      eq(capabilityResolutions.id, capabilityResolutionId),
      eq(capabilityResolutions.institutionId, actor.institutionId),
    )).limit(1);
  if (!lineage) throw new DomainInvariantError("Capability supply requires a persisted CAP-02 gap and its CAP-03 blocked plan", "CAPABILITY_GAP_NOT_FOUND");
  requireCourseAccess(actor, lineage.task.institutionId, lineage.task.courseId);
  const [latestResolution] = await getDb().select({ id: capabilityResolutions.id }).from(capabilityResolutions)
    .where(and(eq(capabilityResolutions.taskId, lineage.task.id), eq(capabilityResolutions.episodeId, lineage.resolution.episodeId)))
    .orderBy(desc(capabilityResolutions.createdAt), desc(capabilityResolutions.id)).limit(1);
  const [latestPlan] = await getDb().select({ id: activityPlanProposals.id }).from(activityPlanProposals)
    .where(and(eq(activityPlanProposals.taskId, lineage.task.id), eq(activityPlanProposals.episodeId, lineage.resolution.episodeId)))
    .orderBy(desc(activityPlanProposals.createdAt), desc(activityPlanProposals.id)).limit(1);
  if (latestResolution?.id !== lineage.resolution.id || latestPlan?.id !== lineage.plan.id) {
    throw new DomainInvariantError("Capability supply source was superseded by newer orchestration state", "CAPABILITY_GAP_STALE");
  }
  if (lineage.resolution.decision !== "ADAPT"
    || !lineage.resolution.noMatch || !lineage.resolution.teacherEscalation || !lineage.resolution.gapSignal
    || lineage.plan.state !== "BLOCKED"
    || lineage.plan.selectedCapabilityVersionId) {
    throw new DomainInvariantError("This bounded supply slice requires a real unresolved ADAPT decision; GENERATE and generation-forbidden NO_MATCH remain outside it", "CAPABILITY_GAP_INELIGIBLE");
  }
  const gap = AdaptationGap.parse(lineage.resolution.gapSignal);
  const candidate = records(lineage.resolution.candidateSet).find((item) => (
    item.versionId === gap.relatedCapabilityVersionId
    && item.matchMode === "ADAPT"
    && item.eligibility === "ELIGIBLE"
    && Array.isArray(item.exclusionReasons)
    && item.exclusionReasons.length === 0
  ));
  if (!candidate) throw new DomainInvariantError("ADAPT requires the exact eligible reviewed source CapabilityVersion recorded by CAP-02", "CAPABILITY_ADAPTATION_SOURCE_INELIGIBLE");
  const [source] = await getDb().select({ capability: capabilities, version: capabilityVersions, component: components, componentVersion: componentVersions })
    .from(capabilityVersions)
    .innerJoin(capabilities, eq(capabilities.id, capabilityVersions.capabilityId))
    .innerJoin(componentVersions, eq(componentVersions.id, capabilityVersions.componentAssetVersionId))
    .innerJoin(components, eq(components.id, componentVersions.componentId))
    .where(eq(capabilityVersions.id, gap.relatedCapabilityVersionId)).limit(1);
  const sourceContract = CallableCapabilityResolutionContract.safeParse(resolutionEnvelope(source?.version.contract));
  const sourceComponentContract = SourceWebComponentAssetContract.safeParse(source?.componentVersion.contract);
  const sourceComponentPackage = SourceWebComponentAssetPackage.safeParse(source?.componentVersion.content);
  if (!source || source.capability.activeVersionId !== source.version.id || source.version.status !== "ACTIVE"
    || source.capability.referencePackKey !== lineage.subject.referencePackKey
    || source.capability.institutionId !== actor.institutionId || source.capability.courseId !== lineage.task.courseId
    || source.component.institutionId !== actor.institutionId || source.component.courseId !== lineage.task.courseId
    || source.component.assetType !== "WEB_COMPONENT_ASSET" || source.component.activeVersionId !== source.componentVersion.id
    || source.componentVersion.status !== "PUBLISHED"
    || candidate.capabilityId !== source.capability.id || candidate.contentHash !== source.version.contentHash
    || !sourceContract.success || !sourceContract.data.verified || !sourceContract.data.adaptation.reviewed
    || !sourceComponentContract.success || !sourceComponentPackage.success
    || webComponentAssetHash(sourceComponentContract.data, sourceComponentPackage.data) !== source.componentVersion.contentHash) {
    throw new DomainInvariantError("The reviewed adaptation source is inactive, changed or not exact", "CAPABILITY_ADAPTATION_SOURCE_STALE");
  }
  return {
    ...lineage,
    gap,
    sourceCapability: source.capability,
    sourceVersion: source.version,
    sourceContract: sourceContract.data,
    sourceComponent: source.component,
    sourceComponentVersion: source.componentVersion,
    sourceComponentContract: sourceComponentContract.data,
    sourceComponentPackage: sourceComponentPackage.data,
  };
}

export function createWebComponentAssetProposal(actor: Actor, input: { capabilityResolutionId: string; idempotencyKey: string }) {
  return withTenantDatabase(actor, async () => {
    assertExecutionActive();
    requireRole(actor, ["TEACHER", "EXPERT", "ADMIN"]);
    const lineage = await loadGapLineage(actor, input.capabilityResolutionId);
    const componentId = randomUUID();
    const versionId = randomUUID();
    const strategy = "ADAPT" as const;
    const componentPackage = adaptCapabilityToWebComponentAsset({
      capabilityId: lineage.sourceCapability.id,
      capabilityVersionId: lineage.sourceVersion.id,
      capabilityVersion: lineage.sourceVersion.version,
      capabilityVersionContentHash: lineage.sourceVersion.contentHash,
      capabilityKey: lineage.sourceCapability.key,
      capabilityName: lineage.sourceCapability.name,
      componentAssetVersionId: lineage.sourceComponentVersion.id,
      componentAssetVersionContentHash: lineage.sourceComponentVersion.contentHash,
      componentAssetContract: lineage.sourceComponentContract,
      componentAssetPackage: lineage.sourceComponentPackage,
    });
    const contract = WebComponentAssetContract.parse({
      contractType: "WEB_COMPONENT_ASSET",
      contractVersion: "cap-07.1",
      title: componentPackage.title,
      purpose: componentPackage.purpose,
      referencePackKey: lineage.subject.referencePackKey,
      supplyStrategy: strategy,
      dataClassification: "DEIDENTIFIED_INSTRUCTIONAL",
      adaptationSource: {
        capabilityId: lineage.sourceCapability.id,
        capabilityVersionId: lineage.sourceVersion.id,
        capabilityVersion: lineage.sourceVersion.version,
        capabilityVersionContentHash: lineage.sourceVersion.contentHash,
        capabilityKey: lineage.sourceCapability.key,
        componentAssetVersionId: lineage.sourceComponentVersion.id,
        componentAssetVersionContentHash: lineage.sourceComponentVersion.contentHash,
        transformation: "SOURCE_BEHAVIOR_WITH_DIAGNOSTIC_SCAFFOLD",
      },
      templateKey: componentPackage.templateKey,
      implementationKey: WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
      runtimeKind: WEB_COMPONENT_ASSET_RUNTIME_KIND,
      arbitraryCodeAllowed: false,
      learnerPreviewRequired: true,
      humanConfirmationRequired: true,
      availabilityScope: "INSTITUTION_COURSE_PRIVATE",
      explicitNonClaims: ["PREVIEW_IS_NOT_LEARNER_DELIVERY", "RUNTIME_COMPLETION_IS_NOT_DIAGNOSIS", "RUNTIME_COMPLETION_IS_NOT_LEARNING_OUTCOME"],
    });
    const contentHash = webComponentAssetHash(contract, componentPackage);
    const commandType = "COMPONENT_CANDIDATE";
    const commandHash = requestHash(actor, commandType, { capabilityResolutionId: lineage.resolution.id, strategy, contract, componentPackage });
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`cap07-proposal:${lineage.resolution.id}`},0))`);
      const [canonical] = await tx.select({ component: components, version: componentVersions }).from(components)
        .leftJoin(componentVersions, eq(componentVersions.componentId, components.id))
        .where(eq(components.sourceCapabilityResolutionId, lineage.resolution.id)).limit(1);
      if (canonical) {
        const [reservedCanonical] = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash: commandHash, resultId: canonical.component.id }).onConflictDoNothing().returning();
        if (!reservedCanonical) {
          const [key] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey))).limit(1);
          if (!key || key.requestHash !== commandHash || key.resultId !== canonical.component.id) throw new DomainInvariantError("Capability supply idempotency key was reused with different input", "IDEMPOTENCY_MISMATCH");
        }
        return { componentId: canonical.component.id, versionId: canonical.version?.id, strategy: canonical.component.supplyStrategy, replayed: true };
      }
      const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash: commandHash, resultId: componentId }).onConflictDoNothing().returning();
      if (!reserved.length) {
        const [key] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey))).limit(1);
        if (!key || key.requestHash !== commandHash) throw new DomainInvariantError("Capability supply idempotency key was reused with different input", "IDEMPOTENCY_MISMATCH");
        const [component] = await tx.select().from(components).where(eq(components.id, key.resultId)).limit(1);
        if (!component) throw new DomainInvariantError("Capability supply replay target is missing", "IDEMPOTENCY_INTEGRITY");
        const [version] = await tx.select().from(componentVersions).where(eq(componentVersions.componentId, component.id)).limit(1);
        return { componentId: component.id, versionId: version?.id, strategy: component.supplyStrategy, replayed: true };
      }
      await tx.execute(sql`SELECT set_config('foundry.governance_command', 'component_candidate', true)`);
      await tx.insert(components).values({
        id: componentId,
        institutionId: actor.institutionId,
        courseId: lineage.task.courseId,
        capabilityId: null,
        assetType: "WEB_COMPONENT_ASSET",
        sourceCapabilityResolutionId: lineage.resolution.id,
        sourceActivityPlanProposalId: lineage.plan.id,
        supplyStrategy: strategy,
        adaptedFromCapabilityId: lineage.sourceCapability.id,
        adaptedFromCapabilityVersionId: lineage.sourceVersion.id,
        adaptedFromContentHash: lineage.sourceVersion.contentHash,
        adaptedFromComponentVersionId: lineage.sourceComponentVersion.id,
        adaptedFromComponentContentHash: lineage.sourceComponentVersion.contentHash,
        referencePackKey: lineage.subject.referencePackKey,
        failureCode: lineage.observation.failureCode,
        key: `gap-${lineage.resolution.id.slice(0, 12)}`,
        title: contract.title,
        sourceSignal: {
          kind: "CAPABILITY_RESOLUTION_GAP",
          capabilityResolutionId: lineage.resolution.id,
          activityPlanProposalId: lineage.plan.id,
          diagnosticObservationId: lineage.observation.id,
          sourceAttemptId: lineage.attempt.id,
          decision: lineage.resolution.decision,
          gapSignal: lineage.resolution.gapSignal,
          adaptedFromCapabilityId: lineage.sourceCapability.id,
          adaptedFromCapabilityVersionId: lineage.sourceVersion.id,
          adaptedFromContentHash: lineage.sourceVersion.contentHash,
          adaptedFromComponentVersionId: lineage.sourceComponentVersion.id,
          adaptedFromComponentContentHash: lineage.sourceComponentVersion.contentHash,
        },
        createdBy: actor.userId,
      });
      await tx.insert(componentVersions).values({
        id: versionId,
        componentId,
        version: "1.0.0",
        contract,
        content: componentPackage,
        sourceObservationIds: [lineage.observation.id],
        sourceReviewIds: [],
        validation: { status: "PENDING_CAPABILITY_CHECKS", explicitNonClaims: contract.explicitNonClaims },
        status: "DRAFT",
        contentHash,
        createdBy: actor.userId,
      });
      await tx.insert(governanceEvents).values({
        institutionId: actor.institutionId,
        actorUserId: actor.userId,
        entityType: "COMPONENT",
        entityId: componentId,
        action: "WEB_COMPONENT_ASSET_PROPOSED",
        payload: { versionId, sourceCapabilityResolutionId: lineage.resolution.id, sourceActivityPlanProposalId: lineage.plan.id, strategy, adaptedFromCapabilityVersionId: lineage.sourceVersion.id, adaptedFromContentHash: lineage.sourceVersion.contentHash, adaptedFromComponentVersionId: lineage.sourceComponentVersion.id, adaptedFromComponentContentHash: lineage.sourceComponentVersion.contentHash, contentHash, arbitraryCodeAllowed: false },
      });
      return { componentId, versionId, strategy, replayed: false };
    });
  });
}

export async function runWebComponentEvaluation(actor: Actor, componentVersionId: string) {
  assertExecutionActive();
  requireRole(actor, ["EXPERT", "ADMIN"]);
  const [row] = await getDb().select({ component: components, version: componentVersions })
    .from(componentVersions)
    .innerJoin(components, eq(components.id, componentVersions.componentId))
    .where(and(
      eq(componentVersions.id, componentVersionId),
      eq(components.institutionId, actor.institutionId),
      eq(components.assetType, "WEB_COMPONENT_ASSET"),
    )).limit(1);
  if (!row) throw new DomainInvariantError("Web ComponentAssetVersion is outside the active institution", "TENANT_ISOLATION");
  requireCourseAccess(actor, row.component.institutionId, row.component.courseId);
  if (row.version.status !== "DRAFT") throw new DomainInvariantError("Only a Draft Web ComponentAssetVersion can be checked", "VERSION_IMMUTABLE");

  const recorded = await requestWebComponentEvaluation(actor, {
    componentVersionId: row.version.id,
    expectedContentHash: row.version.contentHash,
  });
  const result = await getDb().transaction(async (tx) => {
    const [evaluation] = await tx.select().from(componentEvaluations).where(and(
      eq(componentEvaluations.id, recorded.evaluationId),
      eq(componentEvaluations.componentVersionId, row.version.id),
      eq(componentEvaluations.contentHash, row.version.contentHash),
    )).limit(1);
    if (!evaluation) throw new DomainInvariantError("Trusted Web ComponentAsset evaluation record is missing", "COMPONENT_EVALUATION_INTEGRITY");
    const [reconciledVersion] = await tx.update(componentVersions).set({
      validation: {
        kind: "WEB_COMPONENT_ASSET_CHECKS",
        evaluatorVersion: WEB_COMPONENT_EVALUATOR_VERSION,
        systemStatus: evaluation.systemStatus,
        systemChecks: evaluation.systemChecks,
      },
      evalResult: {
        evaluationId: evaluation.id,
        systemStatus: evaluation.systemStatus,
        providerChecks: evaluation.providerChecks,
        previewStatus: "PENDING_EXACT_PREVIEW",
        humanConfirmationStatus: "PENDING",
      },
    }).where(and(
      eq(componentVersions.id, row.version.id),
      eq(componentVersions.status, "DRAFT"),
      eq(componentVersions.contentHash, row.version.contentHash),
    )).returning();
    if (!reconciledVersion) throw new DomainInvariantError("Web ComponentAssetVersion changed while reconciling trusted evaluation evidence", "COMPONENT_EVALUATION_CONFLICT");
    await tx.insert(governanceEvents).values({
      id: evaluation.id,
      institutionId: actor.institutionId,
      actorUserId: actor.userId,
      entityType: "COMPONENT_EVALUATION",
      entityId: evaluation.id,
      action: "WEB_COMPONENT_ASSET_CHECKS_RECORDED",
      payload: {
        componentId: row.component.id,
        componentVersionId: row.version.id,
        sourceCapabilityResolutionId: row.component.sourceCapabilityResolutionId,
        systemStatus: evaluation.systemStatus,
        contentHash: row.version.contentHash,
      },
    }).onConflictDoNothing();
    return { evaluation, replayed: recorded.replayed };
  });
  return {
    ...result,
    systemStatus: result.evaluation.systemStatus,
    systemChecks: result.evaluation.systemChecks,
    providerChecks: result.evaluation.providerChecks,
    fixtureExecution: result.evaluation.fixtureExecution,
    evidenceChecks: result.evaluation.evidenceChecks,
  };
}

export function previewWebComponentAsset(actor: Actor, input: { componentId: string; componentVersionId: string; selectedChoiceId: string; idempotencyKey: string }) {
  return withTenantDatabase(actor, async () => {
    assertExecutionActive();
    requireRole(actor, ["TEACHER", "EXPERT", "ADMIN"]);
    const [row] = await getDb().select({ component: components, version: componentVersions })
      .from(componentVersions)
      .innerJoin(components, eq(components.id, componentVersions.componentId))
      .where(and(
        eq(components.id, input.componentId),
        eq(componentVersions.id, input.componentVersionId),
        eq(components.institutionId, actor.institutionId),
        eq(components.assetType, "WEB_COMPONENT_ASSET"),
      )).limit(1);
    if (!row) throw new DomainInvariantError("Web ComponentAssetVersion is outside the active institution", "TENANT_ISOLATION");
    requireCourseAccess(actor, row.component.institutionId, row.component.courseId);
    if (row.version.status !== "DRAFT") throw new DomainInvariantError("Preview is restricted to the exact Draft awaiting confirmation", "VERSION_IMMUTABLE");

    const recorded = await requestWebComponentPreview(actor, {
      componentId: row.component.id,
      componentVersionId: row.version.id,
      expectedContentHash: row.version.contentHash,
      selectedChoiceId: input.selectedChoiceId,
      idempotencyKey: input.idempotencyKey,
    });
    const [preview] = await getDb().select().from(componentAssetPreviews).where(and(
      eq(componentAssetPreviews.id, recorded.previewId),
      eq(componentAssetPreviews.componentVersionId, row.version.id),
      eq(componentAssetPreviews.contentHash, row.version.contentHash),
    )).limit(1);
    if (!preview) throw new DomainInvariantError("Trusted exact preview command record is missing", "COMPONENT_PREVIEW_INTEGRITY");
    return { preview, replayed: recorded.replayed };
  });
}
