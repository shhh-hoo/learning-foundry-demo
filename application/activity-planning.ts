import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, withTenantDatabase } from "@/db/client";
import {
  activityPlanProposals,
  capabilities,
  capabilityResolutions,
  capabilityVersions,
  contextCompilations,
  contextItems,
  diagnosticObservations,
  learnerAttempts,
} from "@/db/schema";
import { requireTaskEpisodeScope } from "@/application/task-scope";
import { assertExecutionActive } from "@/application/execution-control";
import { requireEpisodeDiagnosisLineage } from "@/application/governed-followup-lineage";
import { CallableCapabilityResolutionContract } from "@/domain/capability-resolution";
import {
  ACTIVITY_PLANNING_POLICY_VERSION,
  activityPlanProposalId,
  activityPlanningHash,
  buildActivityPlanProposal,
  stableActivityPlanningJson,
  type ActivityTeacherConstraint,
  type CapabilityResolutionDecision,
} from "@/domain/activity-planning";
import { DomainInvariantError } from "@/domain/invariants";
import type { Actor } from "@/domain/model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEACHER_CONSTRAINT_KINDS = new Set(["TEACHER_CONSTRAINT", "CAPABILITY_REQUIREMENT", "CAPABILITY_EXCLUSION", "TEACHER_ASSIGNMENT", "TEACHER_CORRECTION", "GOVERNED_FOLLOWUP"]);

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function exactTeacherConstraints(selectedItems: Array<Record<string, unknown>>): ActivityTeacherConstraint[] {
  return selectedItems.flatMap((item) => {
    const kind = typeof item.kind === "string" ? item.kind : "";
    if (!TEACHER_CONSTRAINT_KINDS.has(kind)) return [];
    return [{
      contextItemId: String(item.id ?? ""),
      kind,
      payload: item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
        ? item.payload as Record<string, unknown>
        : {},
      ruleVersion: typeof item.ruleVersion === "string" ? item.ruleVersion : undefined,
      reviewStatus: typeof item.reviewStatus === "string" ? item.reviewStatus : undefined,
    }];
  });
}

async function planInTenant(actor: Actor, input: {
  taskId: string;
  episodeId: string;
  capabilityResolutionId: string;
}) {
  assertExecutionActive();
  const learnerOriginated = actor.roles.includes("LEARNER") && !actor.roles.some((role) => role === "TEACHER" || role === "ADMIN");
  const scope = await requireTaskEpisodeScope(actor, {
    taskId: input.taskId,
    episodeId: input.episodeId,
    learnerOriginated,
  });

  const [lineage] = await getDb().select({
    resolution: capabilityResolutions,
    context: contextCompilations,
    observation: diagnosticObservations,
    attempt: learnerAttempts,
  }).from(capabilityResolutions)
    .innerJoin(contextCompilations, eq(contextCompilations.id, capabilityResolutions.contextCompilationId))
    .innerJoin(diagnosticObservations, eq(diagnosticObservations.id, capabilityResolutions.diagnosticObservationId))
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .where(and(
      eq(capabilityResolutions.id, input.capabilityResolutionId),
      eq(capabilityResolutions.taskId, scope.task.id),
      eq(capabilityResolutions.episodeId, scope.episode.id),
    ))
    .limit(1);
  if (!lineage || lineage.resolution.institutionId !== actor.institutionId || lineage.resolution.courseId !== scope.course.id) {
    throw new DomainInvariantError("Activity Planning requires the exact authorized CAP-02 resolution", "ACTIVITY_PLAN_RESOLUTION_SCOPE_DENIED");
  }
  if (lineage.context.consumer !== "CAPABILITY_RESOLUTION"
    || lineage.context.taskId !== scope.task.id || lineage.context.episodeId !== scope.episode.id
    || lineage.observation.supersededById
    || lineage.attempt.taskId !== scope.task.id) {
    throw new DomainInvariantError("Activity Planning input lineage is stale or inconsistent", "ACTIVITY_PLAN_INPUT_NOT_CURRENT");
  }
  const currentObservations = await getDb().select({ id: diagnosticObservations.id }).from(diagnosticObservations)
    .where(and(eq(diagnosticObservations.attemptId, lineage.attempt.id), isNull(diagnosticObservations.supersededById)));
  if (currentObservations.length !== 1 || currentObservations[0]?.id !== lineage.observation.id) {
    throw new DomainInvariantError("Activity Planning requires one current Diagnosis Proposal", "ACTIVITY_PLAN_DIAGNOSIS_CONFLICT");
  }
  await requireEpisodeDiagnosisLineage({
    taskId: scope.task.id,
    episodeId: scope.episode.id,
    observation: lineage.observation,
    attempt: lineage.attempt,
  });

  const [existing] = await getDb().select().from(activityPlanProposals)
    .where(eq(activityPlanProposals.capabilityResolutionId, lineage.resolution.id)).limit(1);
  if (existing) return { ...existing, replayed: true };

  const selectedItems = asRecords(lineage.context.selectedItems);
  const teacherConstraints = exactTeacherConstraints(selectedItems);
  const staleInputReasons: string[] = [];
  const latestResolutions = await getDb().select({ id: capabilityResolutions.id }).from(capabilityResolutions)
    .where(and(eq(capabilityResolutions.taskId, scope.task.id), eq(capabilityResolutions.episodeId, scope.episode.id)))
    .orderBy(desc(capabilityResolutions.createdAt), desc(capabilityResolutions.id)).limit(1);
  if (latestResolutions[0]?.id !== lineage.resolution.id) staleInputReasons.push("CAPABILITY_RESOLUTION_SUPERSEDED");

  const canonicalSelectedIds = selectedItems.flatMap((item) => typeof item.id === "string" && UUID.test(item.id) ? [item.id] : []);
  if (canonicalSelectedIds.length) {
    const currentItems = await getDb().select().from(contextItems).where(inArray(contextItems.id, canonicalSelectedIds));
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    for (const snapshotItem of selectedItems) {
      if (typeof snapshotItem.id !== "string" || !UUID.test(snapshotItem.id)) continue;
      const current = currentById.get(snapshotItem.id);
      if (!current || !new Set(["ACTIVE", "PROMOTED"]).has(current.state) || current.invalidatedAt || current.successorId) {
        staleInputReasons.push(`CONTEXT_ITEM_NOT_CURRENT:${snapshotItem.id}`);
      } else if (stableActivityPlanningJson(current.payload) !== stableActivityPlanningJson(snapshotItem.payload ?? {})) {
        staleInputReasons.push(`CONTEXT_ITEM_CHANGED:${snapshotItem.id}`);
      }
    }
  }

  let selectedVersion: Parameters<typeof buildActivityPlanProposal>[0]["selectedVersion"] = null;
  let selectedCandidateEligible = false;
  if (lineage.resolution.selectedCapabilityId && lineage.resolution.selectedCapabilityVersionId) {
    const [registry] = await getDb().select({ capability: capabilities, version: capabilityVersions })
      .from(capabilityVersions)
      .innerJoin(capabilities, eq(capabilities.id, capabilityVersions.capabilityId))
      .where(and(
        eq(capabilities.id, lineage.resolution.selectedCapabilityId),
        eq(capabilityVersions.id, lineage.resolution.selectedCapabilityVersionId),
      )).limit(1);
    if (registry) {
      const envelope = registry.version.contract && typeof registry.version.contract === "object"
        ? (registry.version.contract as Record<string, unknown>).resolution ?? registry.version.contract
        : registry.version.contract;
      const parsed = CallableCapabilityResolutionContract.safeParse(envelope);
      if (parsed.success) {
        selectedVersion = {
          capabilityId: registry.capability.id,
          versionId: registry.version.id,
          version: registry.version.version,
          contentHash: registry.version.contentHash,
          active: registry.capability.activeVersionId === registry.version.id && registry.version.status === "ACTIVE",
          runtime: parsed.data.runtime,
        };
      }
    }
    selectedCandidateEligible = asRecords(lineage.resolution.candidateSet).some((candidate) => (
      candidate.versionId === lineage.resolution.selectedCapabilityVersionId
      && candidate.capabilityId === lineage.resolution.selectedCapabilityId
      && candidate.eligibility === "ELIGIBLE"
      && Array.isArray(candidate.exclusionReasons) && candidate.exclusionReasons.length === 0
    ));
  }

  const plannerInput = {
    taskGoal: scope.task.goal,
    taskId: scope.task.id,
    episodeId: scope.episode.id,
    contextCompilationId: lineage.context.id,
    contextSnapshotHash: lineage.context.snapshotHash,
    diagnosticObservationId: lineage.observation.id,
    diagnosisStatus: lineage.observation.status,
    diagnosisSummary: lineage.observation.summary,
    diagnosisFailureCode: lineage.observation.failureCode,
    capabilityResolutionId: lineage.resolution.id,
    resolutionDecision: lineage.resolution.decision as CapabilityResolutionDecision,
    resolutionRationale: lineage.resolution.selectionRationale,
    teacherEscalation: lineage.resolution.teacherEscalation,
    noMatch: lineage.resolution.noMatch,
    selectedCapabilityId: lineage.resolution.selectedCapabilityId,
    selectedCapabilityVersionId: lineage.resolution.selectedCapabilityVersionId,
    selectedVersion,
    selectedCandidateEligible,
    teacherConstraints,
    staleInputReasons,
  };
  const proposal = buildActivityPlanProposal(plannerInput);
  const inputHash = activityPlanningHash({
    policyVersion: ACTIVITY_PLANNING_POLICY_VERSION,
    resolution: lineage.resolution,
    context: lineage.context,
    diagnosis: lineage.observation,
    selectedVersion,
    teacherConstraints,
    staleInputReasons,
    proposal,
  });
  const proposalId = activityPlanProposalId(inputHash);
  const row = {
    id: proposalId,
    institutionId: actor.institutionId,
    courseId: scope.course.id,
    taskId: scope.task.id,
    episodeId: scope.episode.id,
    contextCompilationId: lineage.context.id,
    diagnosticObservationId: lineage.observation.id,
    capabilityResolutionId: lineage.resolution.id,
    policyVersion: proposal.policyVersion,
    inputHash,
    state: proposal.state,
    resolutionDecision: lineage.resolution.decision,
    selectedCapabilityId: proposal.state === "READY" ? lineage.resolution.selectedCapabilityId : null,
    selectedCapabilityVersionId: proposal.state === "READY" ? lineage.resolution.selectedCapabilityVersionId : null,
    selectedVersionContentHash: proposal.state === "READY" ? selectedVersion?.contentHash ?? null : null,
    rationale: proposal.rationale,
    stages: proposal.stages as unknown as Array<Record<string, unknown>>,
    teacherConstraints: proposal.teacherConstraints as unknown as Array<Record<string, unknown>>,
    teacherIntervention: proposal.teacherIntervention,
    retryIntent: proposal.retryIntent,
    runtimeHandoff: proposal.runtimeHandoff,
    blockReasons: proposal.blockReasons,
    createdBy: actor.userId,
  };
  const inserted = await getDb().insert(activityPlanProposals).values(row).onConflictDoNothing().returning({ id: activityPlanProposals.id });
  const [persisted] = await getDb().select().from(activityPlanProposals)
    .where(eq(activityPlanProposals.capabilityResolutionId, lineage.resolution.id)).limit(1);
  if (!persisted || persisted.id !== proposalId || persisted.inputHash !== inputHash
    || persisted.state !== proposal.state
    || stableActivityPlanningJson(persisted.stages) !== stableActivityPlanningJson(row.stages)
    || stableActivityPlanningJson(persisted.runtimeHandoff) !== stableActivityPlanningJson(row.runtimeHandoff)) {
    throw new DomainInvariantError("Activity Planning replay conflicts with persisted Product State", "ACTIVITY_PLAN_REPLAY_CONFLICT");
  }
  return { ...persisted, replayed: inserted.length === 0 };
}

/** Persists an ActivityPlanProposal only; it never launches or simulates an asset. */
export function planActivityForResolution(actor: Actor, input: {
  taskId: string;
  episodeId: string;
  capabilityResolutionId: string;
}) {
  return withTenantDatabase(actor, () => planInTenant(actor, input));
}
