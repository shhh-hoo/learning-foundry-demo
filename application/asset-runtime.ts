import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, withTenantDatabase } from "@/db/client";
import {
  activityPlanProposals,
  activityPlans,
  capabilities,
  capabilityResolutions,
  capabilityVersions,
  contextCompilations,
  contextItems,
  diagnosticObservations,
  learnerAttempts,
  learningEvents,
  runtimeDeliveries,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import { DomainInvariantError, requireRole } from "@/domain/invariants";
import { requireTaskEpisodeScope } from "@/application/task-scope";
import {
  assertExecutionActive,
  runWithExecutionControl,
  type ExecutionControl,
} from "@/application/execution-control";
import { CallableCapabilityResolutionContract } from "@/domain/capability-resolution";
import {
  ASSET_RUNTIME_POLICY_VERSION,
  AssetRuntimeRequest,
  AssetRuntimeStage,
  assetRuntimeHash,
  assetRuntimeId,
  normalizeRuntimeError,
  stableAssetRuntimeJson,
  terminalStatusForError,
  type AssetRuntimeTerminalStatus,
  type NormalizedRuntimeError,
} from "@/domain/asset-runtime";
import { getAssetRuntimeAdapter, type AssetRuntimeAdapter } from "@/reference-packs/capability-runtime";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]);

type RuntimeLineage = {
  actor: Actor;
  request: AssetRuntimeRequest;
  scope: Awaited<ReturnType<typeof requireTaskEpisodeScope>>;
  proposal: typeof activityPlanProposals.$inferSelect;
  resolution: typeof capabilityResolutions.$inferSelect;
  context: typeof contextCompilations.$inferSelect;
  observation: typeof diagnosticObservations.$inferSelect;
  sourceAttempt: typeof learnerAttempts.$inferSelect;
  capability: typeof capabilities.$inferSelect;
  version: typeof capabilityVersions.$inferSelect;
  stage: AssetRuntimeStage;
  runtimeContract: CallableCapabilityResolutionContract["runtime"];
  runtimeContractHash: string;
  activityPlanHash: string;
  requestHash: string;
  activityPlanId: string;
  deliveryId: string;
  attemptId: string;
  evidenceProvenance: Record<string, unknown>;
};

type PreparedDelivery = RuntimeLineage & {
  delivery: typeof runtimeDeliveries.$inferSelect;
  attempt: typeof learnerAttempts.$inferSelect;
  replayed: boolean;
};

export type AssetRuntimeDependencies = {
  getAdapter: (implementationKey: string, runtimeKind: string) => AssetRuntimeAdapter | null;
  afterDeliveryStarted?: (delivery: PreparedDelivery) => Promise<void> | void;
};

const defaultDependencies: AssetRuntimeDependencies = { getAdapter: getAssetRuntimeAdapter };

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function runtimeEnvelope(contract: Record<string, unknown>): unknown {
  return contract.resolution ?? contract;
}

function assertAvailability(contract: CallableCapabilityResolutionContract, actor: Actor, courseId: string): void {
  const available = contract.availability;
  if (!contract.verified || available.status !== "AVAILABLE") {
    throw new DomainInvariantError("The exact CapabilityVersion is no longer available", "ASSET_RUNTIME_VERSION_UNAVAILABLE");
  }
  if (available.institutionIds.length && !available.institutionIds.includes(actor.institutionId)) {
    throw new DomainInvariantError("The exact CapabilityVersion is outside the active institution", "TENANT_ISOLATION");
  }
  if (available.courseIds.length && !available.courseIds.includes(courseId)) {
    throw new DomainInvariantError("The exact CapabilityVersion is outside the Task course", "ASSET_RUNTIME_COURSE_DENIED");
  }
  if (!new Set(["AVAILABLE", "NOT_REQUIRED"]).has(available.rights)) {
    throw new DomainInvariantError("Capability runtime rights are unavailable", "ASSET_RUNTIME_RIGHTS_BLOCKED");
  }
  if (available.dependencies.some((dependency) => !new Set(["AVAILABLE", "NOT_REQUIRED"]).has(dependency.status))) {
    throw new DomainInvariantError("A declared Capability runtime dependency is unavailable", "ASSET_RUNTIME_DEPENDENCY_UNAVAILABLE");
  }
  if (available.provider && !new Set(["AVAILABLE", "NOT_REQUIRED"]).has(available.provider.status)) {
    throw new DomainInvariantError("The declared Capability runtime provider is unavailable", "ASSET_RUNTIME_PROVIDER_UNAVAILABLE");
  }
}

async function assertContextCurrent(context: typeof contextCompilations.$inferSelect): Promise<void> {
  const selected = records(context.selectedItems);
  const ids = selected.flatMap((item) => typeof item.id === "string" && UUID.test(item.id) ? [item.id] : []);
  if (!ids.length) return;
  const current = await getDb().select().from(contextItems).where(inArray(contextItems.id, ids));
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const snapshot of selected) {
    if (typeof snapshot.id !== "string" || !UUID.test(snapshot.id)) continue;
    const item = byId.get(snapshot.id);
    if (!item || !new Set(["ACTIVE", "PROMOTED"]).has(item.state) || item.invalidatedAt || item.successorId) {
      throw new DomainInvariantError("Asset Runtime Context is stale or superseded", "ASSET_RUNTIME_CONTEXT_STALE");
    }
    if (stableAssetRuntimeJson(item.payload) !== stableAssetRuntimeJson(snapshot.payload ?? {})) {
      throw new DomainInvariantError("Asset Runtime Context changed after planning", "ASSET_RUNTIME_CONTEXT_CHANGED");
    }
  }
}

function exactCandidateContract(
  resolution: typeof capabilityResolutions.$inferSelect,
  capabilityId: string,
  versionId: string,
): unknown {
  return records(resolution.candidateSet).find((candidate) => (
    candidate.capabilityId === capabilityId
    && candidate.versionId === versionId
    && candidate.eligibility === "ELIGIBLE"
    && Array.isArray(candidate.exclusionReasons)
    && candidate.exclusionReasons.length === 0
  ))?.contract;
}

async function loadRuntimeLineage(actor: Actor, request: AssetRuntimeRequest): Promise<RuntimeLineage> {
  assertExecutionActive();
  requireRole(actor, ["LEARNER", "ADMIN"]);
  const scope = await requireTaskEpisodeScope(actor, {
    taskId: request.taskId,
    episodeId: request.episodeId,
    learnerOriginated: true,
  });
  const [lineage] = await getDb().select({
    proposal: activityPlanProposals,
    resolution: capabilityResolutions,
    context: contextCompilations,
    observation: diagnosticObservations,
    sourceAttempt: learnerAttempts,
    capability: capabilities,
    version: capabilityVersions,
  }).from(activityPlanProposals)
    .innerJoin(capabilityResolutions, eq(capabilityResolutions.id, activityPlanProposals.capabilityResolutionId))
    .innerJoin(contextCompilations, eq(contextCompilations.id, activityPlanProposals.contextCompilationId))
    .innerJoin(diagnosticObservations, eq(diagnosticObservations.id, activityPlanProposals.diagnosticObservationId))
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .innerJoin(capabilities, eq(capabilities.id, activityPlanProposals.selectedCapabilityId))
    .innerJoin(capabilityVersions, eq(capabilityVersions.id, activityPlanProposals.selectedCapabilityVersionId))
    .where(and(
      eq(activityPlanProposals.id, request.activityPlanProposalId),
      eq(activityPlanProposals.taskId, scope.task.id),
      eq(activityPlanProposals.episodeId, scope.episode.id),
    )).limit(1);
  if (!lineage || lineage.proposal.institutionId !== actor.institutionId || lineage.proposal.courseId !== scope.course.id) {
    throw new DomainInvariantError("Asset Runtime requires the exact authorized ActivityPlan", "ASSET_RUNTIME_PLAN_SCOPE_DENIED");
  }
  if (lineage.proposal.state !== "READY" || lineage.proposal.resolutionDecision !== "EXISTING") {
    throw new DomainInvariantError("Only a READY exact-version ActivityPlan may execute", "ASSET_RUNTIME_PLAN_NOT_READY");
  }
  const handoff = lineage.proposal.runtimeHandoff as Record<string, unknown>;
  if (handoff.executable !== true || handoff.capabilityVersionId !== lineage.proposal.selectedCapabilityVersionId) {
    throw new DomainInvariantError("ActivityPlan runtime handoff is not executable", "ASSET_RUNTIME_HANDOFF_INVALID");
  }
  const teacherIntervention = lineage.proposal.teacherIntervention as Record<string, unknown>;
  if (teacherIntervention.requiredBeforeRuntime === true) {
    throw new DomainInvariantError("ActivityPlan requires Teacher intervention before runtime", "ASSET_RUNTIME_TEACHER_GATE");
  }
  const [latestPlan] = await getDb().select({ id: activityPlanProposals.id }).from(activityPlanProposals)
    .where(and(eq(activityPlanProposals.taskId, scope.task.id), eq(activityPlanProposals.episodeId, scope.episode.id)))
    .orderBy(desc(activityPlanProposals.createdAt), desc(activityPlanProposals.id)).limit(1);
  const [latestResolution] = await getDb().select({ id: capabilityResolutions.id }).from(capabilityResolutions)
    .where(and(eq(capabilityResolutions.taskId, scope.task.id), eq(capabilityResolutions.episodeId, scope.episode.id)))
    .orderBy(desc(capabilityResolutions.createdAt), desc(capabilityResolutions.id)).limit(1);
  if (latestPlan?.id !== lineage.proposal.id || latestResolution?.id !== lineage.resolution.id) {
    throw new DomainInvariantError("ActivityPlan was superseded by newer orchestration state", "ASSET_RUNTIME_PLAN_STALE");
  }
  if (lineage.resolution.id !== lineage.proposal.capabilityResolutionId
    || lineage.resolution.contextCompilationId !== lineage.context.id
    || lineage.resolution.diagnosticObservationId !== lineage.observation.id
    || lineage.context.consumer !== "CAPABILITY_RESOLUTION"
    || lineage.context.taskId !== scope.task.id
    || lineage.context.episodeId !== scope.episode.id
    || lineage.observation.supersededById
    || lineage.sourceAttempt.taskId !== scope.task.id
    || lineage.sourceAttempt.episodeId !== scope.episode.id) {
    throw new DomainInvariantError("ActivityPlan lineage is stale or inconsistent", "ASSET_RUNTIME_LINEAGE_STALE");
  }
  const currentObservations = await getDb().select({ id: diagnosticObservations.id }).from(diagnosticObservations)
    .where(and(eq(diagnosticObservations.attemptId, lineage.sourceAttempt.id), isNull(diagnosticObservations.supersededById)));
  if (currentObservations.length !== 1 || currentObservations[0]?.id !== lineage.observation.id) {
    throw new DomainInvariantError("ActivityPlan Diagnosis Proposal is no longer current", "ASSET_RUNTIME_DIAGNOSIS_STALE");
  }
  await assertContextCurrent(lineage.context);

  if (!lineage.proposal.selectedCapabilityId || !lineage.proposal.selectedCapabilityVersionId
    || lineage.resolution.selectedCapabilityId !== lineage.proposal.selectedCapabilityId
    || lineage.resolution.selectedCapabilityVersionId !== lineage.proposal.selectedCapabilityVersionId
    || lineage.capability.id !== lineage.proposal.selectedCapabilityId
    || lineage.version.id !== lineage.proposal.selectedCapabilityVersionId
    || lineage.version.capabilityId !== lineage.capability.id
    || lineage.version.status !== "ACTIVE"
    || lineage.capability.activeVersionId !== lineage.version.id
    || lineage.proposal.selectedVersionContentHash !== lineage.version.contentHash) {
    throw new DomainInvariantError("ActivityPlan exact CapabilityVersion is inactive or changed", "ASSET_RUNTIME_VERSION_STALE");
  }
  const parsedContract = CallableCapabilityResolutionContract.safeParse(runtimeEnvelope(lineage.version.contract));
  if (!parsedContract.success) {
    throw new DomainInvariantError("Exact CapabilityVersion has no callable runtime contract", "ASSET_RUNTIME_CONTRACT_INVALID");
  }
  assertAvailability(parsedContract.data, actor, scope.course.id);
  const candidateContract = exactCandidateContract(lineage.resolution, lineage.capability.id, lineage.version.id);
  if (stableAssetRuntimeJson(candidateContract) !== stableAssetRuntimeJson(lineage.version.contract)) {
    throw new DomainInvariantError("Capability runtime contract changed after resolution", "ASSET_RUNTIME_CONTRACT_CHANGED");
  }
  if (!Array.isArray(lineage.proposal.stages) || lineage.proposal.stages.length !== 1) {
    throw new DomainInvariantError("Asset Runtime requires exactly one planned stage", "ASSET_RUNTIME_STAGE_INVALID");
  }
  const stage = AssetRuntimeStage.parse(lineage.proposal.stages[0]);
  const runtime = parsedContract.data.runtime;
  const expectedEvents = [...new Set(runtime.events)].sort((left, right) => left.localeCompare(right));
  if (stage.capabilityId !== lineage.capability.id
    || stage.capabilityVersionId !== lineage.version.id
    || stage.capabilityVersion !== lineage.version.version
    || stage.capabilityVersionContentHash !== lineage.version.contentHash
    || stage.inputs.taskId !== scope.task.id
    || stage.inputs.episodeId !== scope.episode.id
    || stage.inputs.contextCompilationId !== lineage.context.id
    || stage.inputs.contextSnapshotHash !== lineage.context.snapshotHash
    || stage.inputs.diagnosticObservationId !== lineage.observation.id
    || stableAssetRuntimeJson(stage.inputs.inputContract) !== stableAssetRuntimeJson(runtime.input)
    || stableAssetRuntimeJson(stage.parameters) !== stableAssetRuntimeJson(runtime.parameters)
    || stableAssetRuntimeJson(stage.expected.output) !== stableAssetRuntimeJson(runtime.output)
    || stableAssetRuntimeJson(stage.expected.events) !== stableAssetRuntimeJson(expectedEvents)) {
    throw new DomainInvariantError("Planned stage no longer matches the exact Registry runtime contract", "ASSET_RUNTIME_STAGE_CHANGED");
  }

  const runtimeContractHash = assetRuntimeHash({
    versionContentHash: lineage.version.contentHash,
    implementationKey: lineage.version.implementationKey,
    contract: lineage.version.contract,
  });
  const evidenceProvenance = {
    taskId: scope.task.id,
    episodeId: scope.episode.id,
    sourceAttemptId: lineage.sourceAttempt.id,
    diagnosticObservationId: lineage.observation.id,
    contextCompilationId: lineage.context.id,
    contextSnapshotHash: lineage.context.snapshotHash,
    capabilityResolutionId: lineage.resolution.id,
    activityPlanProposalId: lineage.proposal.id,
    capabilityId: lineage.capability.id,
    capabilityVersionId: lineage.version.id,
    capabilityVersionContentHash: lineage.version.contentHash,
    runtimeContractHash,
  };
  const activityPlanHash = assetRuntimeHash({
    policyVersion: ASSET_RUNTIME_POLICY_VERSION,
    proposal: lineage.proposal,
    stage,
    runtimeContract: runtime,
    runtimeContractHash,
  });
  const requestHash = assetRuntimeHash({
    policyVersion: ASSET_RUNTIME_POLICY_VERSION,
    actorUserId: actor.userId,
    institutionId: actor.institutionId,
    activityPlanHash,
    taskId: request.taskId,
    episodeId: request.episodeId,
    prompt: request.prompt,
    response: request.response,
    structuredInput: request.structuredInput,
    modality: request.modality,
    deadlineMs: request.deadlineMs,
  });
  return {
    actor,
    request,
    scope,
    ...lineage,
    stage,
    runtimeContract: runtime,
    runtimeContractHash,
    activityPlanHash,
    requestHash,
    activityPlanId: assetRuntimeId("activity-plan", activityPlanHash),
    deliveryId: assetRuntimeId("runtime-delivery", requestHash),
    attemptId: assetRuntimeId("learner-attempt", requestHash),
    evidenceProvenance,
  };
}

function evidenceRefs(lineage: Pick<RuntimeLineage, "proposal" | "resolution" | "context" | "observation" | "sourceAttempt">) {
  return [
    { kind: "SOURCE_ATTEMPT", id: lineage.sourceAttempt.id },
    { kind: "DIAGNOSIS_PROPOSAL", id: lineage.observation.id },
    { kind: "CONTEXT_COMPILATION", id: lineage.context.id },
    { kind: "CAPABILITY_RESOLUTION", id: lineage.resolution.id },
    { kind: "ACTIVITY_PLAN_PROPOSAL", id: lineage.proposal.id },
  ];
}

async function prepareDelivery(actor: Actor, request: AssetRuntimeRequest): Promise<PreparedDelivery> {
  return withTenantDatabase(actor, async () => {
    const lineage = await loadRuntimeLineage(actor, request);
    const [existingByKey] = await getDb().select().from(runtimeDeliveries).where(and(
      eq(runtimeDeliveries.institutionId, actor.institutionId),
      eq(runtimeDeliveries.idempotencyKey, request.idempotencyKey),
    )).limit(1);
    const [existingByPlan] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.activityPlanId, lineage.activityPlanId)).limit(1);
    const existing = existingByKey ?? existingByPlan;
    if (existing) {
      if (existing.id !== lineage.deliveryId || existing.requestHash !== lineage.requestHash
        || existing.activityPlanId !== lineage.activityPlanId || existing.idempotencyKey !== request.idempotencyKey) {
        throw new DomainInvariantError("Asset Runtime replay identity conflicts with persisted Product State", "ASSET_RUNTIME_REPLAY_CONFLICT");
      }
      const [plan] = await getDb().select().from(activityPlans).where(eq(activityPlans.id, existing.activityPlanId)).limit(1);
      const [attempt] = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, existing.id)).limit(1);
      if (!plan || plan.inputHash !== lineage.activityPlanHash || !attempt || attempt.id !== lineage.attemptId) {
        throw new DomainInvariantError("Asset Runtime replay lineage is incomplete", "ASSET_RUNTIME_REPLAY_INTEGRITY");
      }
      if (existing.status === "PENDING") {
        const [running] = await getDb().update(runtimeDeliveries).set({ status: "RUNNING" })
          .where(and(eq(runtimeDeliveries.id, existing.id), eq(runtimeDeliveries.status, "PENDING"))).returning();
        return { ...lineage, delivery: running ?? existing, attempt, replayed: true };
      }
      return { ...lineage, delivery: existing, attempt, replayed: true };
    }

    await getDb().insert(activityPlans).values({
      id: lineage.activityPlanId,
      institutionId: actor.institutionId,
      courseId: lineage.scope.course.id,
      taskId: lineage.scope.task.id,
      episodeId: lineage.scope.episode.id,
      activityPlanProposalId: lineage.proposal.id,
      contextCompilationId: lineage.context.id,
      diagnosticObservationId: lineage.observation.id,
      capabilityResolutionId: lineage.resolution.id,
      capabilityId: lineage.capability.id,
      capabilityVersionId: lineage.version.id,
      capabilityVersionContentHash: lineage.version.contentHash,
      runtimeContractHash: lineage.runtimeContractHash,
      implementationKey: lineage.version.implementationKey,
      runtimeKind: lineage.runtimeContract.kind,
      stageOrder: lineage.stage.order,
      stageSnapshot: lineage.stage,
      runtimeContract: lineage.runtimeContract,
      evidenceProvenance: lineage.evidenceProvenance,
      inputHash: lineage.activityPlanHash,
      createdBy: actor.userId,
    });
    const [delivery] = await getDb().insert(runtimeDeliveries).values({
      id: lineage.deliveryId,
      institutionId: actor.institutionId,
      courseId: lineage.scope.course.id,
      taskId: lineage.scope.task.id,
      episodeId: lineage.scope.episode.id,
      learnerId: lineage.scope.task.learnerId,
      activityPlanId: lineage.activityPlanId,
      capabilityId: lineage.capability.id,
      capabilityVersionId: lineage.version.id,
      capabilityVersionContentHash: lineage.version.contentHash,
      runtimeContractHash: lineage.runtimeContractHash,
      implementationKey: lineage.version.implementationKey,
      runtimeKind: lineage.runtimeContract.kind,
      requestHash: lineage.requestHash,
      idempotencyKey: request.idempotencyKey,
      status: "PENDING",
      deadlineMs: request.deadlineMs,
    }).returning();
    const attemptContentHash = assetRuntimeHash({ prompt: request.prompt, response: request.response, structuredInput: request.structuredInput });
    const [attempt] = await getDb().insert(learnerAttempts).values({
      id: lineage.attemptId,
      taskId: lineage.scope.task.id,
      episodeId: lineage.scope.episode.id,
      learnerId: lineage.scope.task.learnerId,
      capabilityId: lineage.capability.id,
      capabilityVersionId: lineage.version.id,
      activityPlanId: lineage.activityPlanId,
      runtimeDeliveryId: lineage.deliveryId,
      prompt: request.prompt,
      response: request.response,
      structuredInput: {
        assetRuntimeInput: request.structuredInput,
        runtimeLineage: lineage.evidenceProvenance,
      },
      sourceRefs: [],
      modality: request.modality,
      contentHash: attemptContentHash,
      assistanceProvenance: {
        ...lineage.evidenceProvenance,
        plannedParameters: lineage.stage.parameters,
        supportExposure: [],
        priorAttemptIds: [lineage.sourceAttempt.id],
        recoveryState: "INITIAL_SUBMISSION",
      },
    }).returning();
    const refs = evidenceRefs(lineage);
    await getDb().insert(learningEvents).values([
      {
        id: assetRuntimeId("learning-event:start", lineage.deliveryId),
        institutionId: actor.institutionId,
        courseId: lineage.scope.course.id,
        taskId: lineage.scope.task.id,
        episodeId: lineage.scope.episode.id,
        activityPlanId: lineage.activityPlanId,
        runtimeDeliveryId: lineage.deliveryId,
        sequence: 1,
        eventKey: "DELIVERY_STARTED",
        eventType: "DELIVERY_STARTED",
        actorType: "SYSTEM",
        actorUserId: null,
        payload: { status: "RUNNING", capabilityVersionId: lineage.version.id, runtimeContractHash: lineage.runtimeContractHash },
        evidenceRefs: refs,
      },
      {
        id: assetRuntimeId("learning-event:input", lineage.deliveryId),
        institutionId: actor.institutionId,
        courseId: lineage.scope.course.id,
        taskId: lineage.scope.task.id,
        episodeId: lineage.scope.episode.id,
        activityPlanId: lineage.activityPlanId,
        runtimeDeliveryId: lineage.deliveryId,
        sequence: 2,
        eventKey: "LEARNER_INTERACTION_SUBMITTED",
        eventType: "LEARNER_INTERACTION_SUBMITTED",
        actorType: "LEARNER",
        actorUserId: lineage.scope.task.learnerId,
        payload: { modality: request.modality, contentHash: attemptContentHash },
        evidenceRefs: refs,
      },
      {
        id: assetRuntimeId("learning-event:attempt", lineage.deliveryId),
        institutionId: actor.institutionId,
        courseId: lineage.scope.course.id,
        taskId: lineage.scope.task.id,
        episodeId: lineage.scope.episode.id,
        activityPlanId: lineage.activityPlanId,
        runtimeDeliveryId: lineage.deliveryId,
        sequence: 3,
        eventKey: "LEARNER_ATTEMPT_CAPTURED",
        eventType: "LEARNER_ATTEMPT_CAPTURED",
        actorType: "SYSTEM",
        actorUserId: null,
        payload: { attemptId: attempt.id, contentHash: attemptContentHash },
        evidenceRefs: refs,
      },
    ]);
    const [running] = await getDb().update(runtimeDeliveries).set({ status: "RUNNING" })
      .where(and(eq(runtimeDeliveries.id, delivery.id), eq(runtimeDeliveries.status, "PENDING"))).returning();
    if (!running) throw new DomainInvariantError("RuntimeDelivery did not enter RUNNING state", "ASSET_RUNTIME_STATE_CONFLICT");
    return { ...lineage, delivery: running, attempt, replayed: false };
  });
}

async function finalizeDelivery(
  prepared: PreparedDelivery,
  terminal: { status: "SUCCEEDED"; output: Record<string, unknown> } | { status: Exclude<AssetRuntimeTerminalStatus, "SUCCEEDED">; error: NormalizedRuntimeError },
) {
  return withTenantDatabase(prepared.actor, async () => {
    const [current] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.id, prepared.delivery.id)).limit(1);
    if (!current) throw new DomainInvariantError("RuntimeDelivery disappeared before finalization", "ASSET_RUNTIME_REPLAY_INTEGRITY");
    if (TERMINAL.has(current.status)) return current;
    if (current.status !== "RUNNING") throw new DomainInvariantError("RuntimeDelivery is not finalizable", "ASSET_RUNTIME_STATE_CONFLICT");
    const finishedAt = new Date();
    const outputHash = terminal.status === "SUCCEEDED" ? assetRuntimeHash(terminal.output) : null;
    const [updated] = await getDb().update(runtimeDeliveries).set({
      status: terminal.status,
      normalizedOutput: terminal.status === "SUCCEEDED" ? terminal.output : null,
      normalizedError: terminal.status === "SUCCEEDED" ? null : terminal.error,
      outputHash,
      finishedAt,
    }).where(and(eq(runtimeDeliveries.id, current.id), eq(runtimeDeliveries.status, "RUNNING"))).returning();
    if (!updated) {
      const [winner] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.id, current.id)).limit(1);
      if (winner && TERMINAL.has(winner.status)) return winner;
      throw new DomainInvariantError("RuntimeDelivery terminal transition conflicted", "ASSET_RUNTIME_STATE_CONFLICT");
    }
    const refs = evidenceRefs(prepared);
    const resultType = terminal.status === "SUCCEEDED" ? "CAPABILITY_RESULT" : terminal.status === "CANCELLED" ? "RUNTIME_CANCELLED" : terminal.status === "TIMED_OUT" ? "RUNTIME_TIMED_OUT" : "RUNTIME_FAILED";
    await getDb().insert(learningEvents).values([
      {
        id: assetRuntimeId("learning-event:result", prepared.delivery.id),
        institutionId: prepared.actor.institutionId,
        courseId: prepared.scope.course.id,
        taskId: prepared.scope.task.id,
        episodeId: prepared.scope.episode.id,
        activityPlanId: prepared.activityPlanId,
        runtimeDeliveryId: prepared.delivery.id,
        sequence: 4,
        eventKey: "CAPABILITY_TERMINAL_RESULT",
        eventType: resultType,
        actorType: "SYSTEM",
        actorUserId: null,
        payload: terminal.status === "SUCCEEDED" ? { status: terminal.status, outputHash } : { status: terminal.status, error: terminal.error },
        evidenceRefs: refs,
      },
      {
        id: assetRuntimeId("learning-event:terminal", prepared.delivery.id),
        institutionId: prepared.actor.institutionId,
        courseId: prepared.scope.course.id,
        taskId: prepared.scope.task.id,
        episodeId: prepared.scope.episode.id,
        activityPlanId: prepared.activityPlanId,
        runtimeDeliveryId: prepared.delivery.id,
        sequence: 5,
        eventKey: "DELIVERY_TERMINAL",
        eventType: `DELIVERY_${terminal.status}`,
        actorType: "SYSTEM",
        actorUserId: null,
        payload: { status: terminal.status, attemptId: prepared.attempt.id },
        evidenceRefs: refs,
      },
    ]).onConflictDoNothing();
    return updated;
  });
}

function throwTerminal(delivery: typeof runtimeDeliveries.$inferSelect): never {
  const normalized = delivery.normalizedError as NormalizedRuntimeError | null;
  throw new DomainInvariantError(
    normalized?.message ?? `Asset Runtime ended in ${delivery.status}`,
    normalized?.code ?? `ASSET_RUNTIME_${delivery.status}`,
  );
}

export async function executeAssetStage(
  actor: Actor,
  rawRequest: AssetRuntimeRequest,
  dependencies: AssetRuntimeDependencies = defaultDependencies,
) {
  const request = AssetRuntimeRequest.parse(rawRequest);
  return runWithExecutionControl({ deadlineMs: request.deadlineMs }, async (control: ExecutionControl) => {
    const prepared = await prepareDelivery(actor, request);
    if (prepared.delivery.status === "SUCCEEDED") {
      return { delivery: prepared.delivery, attempt: prepared.attempt, replayed: true };
    }
    if (TERMINAL.has(prepared.delivery.status)) throwTerminal(prepared.delivery);
    await dependencies.afterDeliveryStarted?.(prepared);
    try {
      assertExecutionActive(control);
      const adapter = dependencies.getAdapter(prepared.version.implementationKey, prepared.runtimeContract.kind);
      if (!adapter || !adapter.replaySafe) {
        throw new DomainInvariantError("No registered executable adapter matches the exact Registry runtime contract", "ASSET_RUNTIME_ADAPTER_UNAVAILABLE");
      }
      const output = await adapter.execute(request.structuredInput, control);
      assertExecutionActive(control);
      const delivery = await finalizeDelivery(prepared, { status: "SUCCEEDED", output });
      return { delivery, attempt: prepared.attempt, replayed: prepared.replayed };
    } catch (error) {
      const normalized = normalizeRuntimeError(error);
      const status = terminalStatusForError(normalized) as Exclude<AssetRuntimeTerminalStatus, "SUCCEEDED">;
      const delivery = await finalizeDelivery(prepared, { status, error: normalized });
      throwTerminal(delivery);
    }
  });
}
