import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, getSql, withTenantDatabase } from "@/db/client";
import {
  activityPlanProposals,
  capabilities,
  capabilityVersions,
  contextItems,
  courseEnrollments,
  diagnosticObservations,
  governanceEvents,
  idempotencyKeys,
  institutionMemberships,
  learnerAttempts,
  learningEpisodes,
  learningTasks,
  retentionReviews,
  retryAttempts,
  runtimeDeliveries,
  teacherReviews,
  transferActivities,
  workflowRuns,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import {
  GovernedFollowupStart,
  GovernedFollowupReview,
  InterveningExposure,
  RetentionDeclaration,
  TransferDeclaration,
  transferChangedDimensions,
  type GovernedFollowupType,
} from "@/domain/governed-followup";
import { DomainInvariantError, requireCourseAccess, requireHumanCommand, requireRole } from "@/domain/invariants";
import { requireEligibleReviewDecision, requireVerifiedReviewProvenance } from "@/domain/review";
import { commandRequestHash, createTeacherReview, persistDiagnosticObservation } from "@/application/commands";
import { resolveCapabilityForDiagnosis } from "@/application/capability-resolution";
import { planActivityForResolution } from "@/application/activity-planning";
import { resolveLearnerCapabilityInput } from "@/application/capabilities";
import { executeAssetStageResult, type AssetRuntimeDependencies } from "@/application/asset-runtime";
import { requireGovernedFollowupScope } from "@/application/task-scope";
import { assetRuntimeId } from "@/domain/asset-runtime";

type GovernedActivity = typeof retryAttempts.$inferSelect;
type GovernedFollowupStatus = GovernedActivity["status"];

export type GovernedFollowupPlanningDependencies = {
  resolveCapability: typeof resolveCapabilityForDiagnosis;
  planActivity: typeof planActivityForResolution;
};

const governedPlanningDependencies: GovernedFollowupPlanningDependencies = {
  resolveCapability: resolveCapabilityForDiagnosis,
  planActivity: planActivityForResolution,
};

function actorProvenance(actor: Actor, authenticatedAt: Date) {
  return {
    userId: actor.userId,
    institutionId: actor.institutionId,
    roles: actor.roles,
    authMethod: actor.authMethod,
    sessionId: actor.sessionId,
    authenticatedAt: authenticatedAt.toISOString(),
  };
}

function activityRecordIsGoverned(activity: GovernedActivity): activity is GovernedActivity & {
  institutionId: string;
  courseId: string;
  taskId: string;
  sourceEpisodeId: string;
  targetEpisodeId: string;
  learnerId: string;
  contextItemId: string;
  actorUserId: string;
  actorProvenance: NonNullable<GovernedActivity["actorProvenance"]>;
  idempotencyKey: string;
  sourceLineage: NonNullable<GovernedActivity["sourceLineage"]>;
} {
  return Boolean(activity.institutionId && activity.courseId && activity.taskId && activity.sourceEpisodeId
    && activity.targetEpisodeId && activity.learnerId && activity.contextItemId && activity.actorUserId
    && activity.actorProvenance && activity.idempotencyKey && activity.sourceLineage);
}

function requireGovernedActivity(activity: GovernedActivity | undefined): asserts activity is GovernedActivity & {
  institutionId: string;
  courseId: string;
  taskId: string;
  sourceEpisodeId: string;
  targetEpisodeId: string;
  learnerId: string;
  contextItemId: string;
  actorUserId: string;
  actorProvenance: NonNullable<GovernedActivity["actorProvenance"]>;
  idempotencyKey: string;
  sourceLineage: NonNullable<GovernedActivity["sourceLineage"]>;
} {
  if (!activity || !activityRecordIsGoverned(activity)) {
    throw new DomainInvariantError("Governed follow-up Product State is missing exact lineage", "FOLLOWUP_LINEAGE_INVALID");
  }
}

function failureFact(actor: Actor, reason: string, code: string, recordedAt: Date, externalWorkMayStillFinish: boolean, detail: Record<string, unknown> = {}) {
  return {
    actorUserId: actor.userId,
    recordedAt: recordedAt.toISOString(),
    reason,
    code,
    externalWorkMayStillFinish,
    ...detail,
  };
}

async function invalidateFollowupContextAndEpisode(
  activity: GovernedActivity,
  input: {
    episodeStatus: "FAILED" | "CANCELLED" | "COMPLETED" | "ESCALATED";
    reason: string;
    recordedAt: Date;
    recoveryState: Record<string, unknown>;
  },
): Promise<void> {
  requireGovernedActivity(activity);
  await getDb().update(contextItems).set({
    state: "INVALIDATED",
    invalidatedAt: input.recordedAt,
    invalidationReason: input.reason,
  }).where(and(
    eq(contextItems.id, activity.contextItemId),
    eq(contextItems.state, "ACTIVE"),
    isNull(contextItems.invalidatedAt),
    isNull(contextItems.successorId),
  ));
  await getDb().update(learningEpisodes).set({
    status: input.episodeStatus,
    waitingReason: null,
    recoveryState: input.recoveryState,
    endedAt: input.recordedAt,
  }).where(eq(learningEpisodes.id, activity.targetEpisodeId));
}

async function finalizeFollowupFailure(
  actor: Actor,
  activity: GovernedActivity,
  input: {
    status: "FAILED_FINAL" | "CANCELLED";
    reason: string;
    code: string;
    runtimeRequestHash?: string;
    runtimeIdempotencyKey?: string;
    delivery?: typeof runtimeDeliveries.$inferSelect;
  },
): Promise<GovernedActivity> {
  requireGovernedActivity(activity);
  if (new Set(["FAILED_FINAL", "CANCELLED"]).has(activity.status)) return activity;
  const recordedAt = new Date();
  const deliveryChanges = input.delivery ? {
    activityPlanId: input.delivery.activityPlanId,
    runtimeDeliveryId: input.delivery.id,
  } : {};
  const terminal = input.status === "CANCELLED"
    ? await appendStatusTransition(actor, activity, "CANCELLED", input.reason, {
      ...deliveryChanges,
      cancellationState: {
        actorUserId: actor.userId,
        recordedAt: recordedAt.toISOString(),
        reason: input.reason,
        code: input.code,
        externalWorkMayStillFinish: false,
        runtimeDeliveryId: input.delivery?.id,
      },
    }, false, {
      runtimeRequestHash: input.runtimeRequestHash,
      runtimeIdempotencyKey: input.runtimeIdempotencyKey,
      runtimeStatus: input.delivery?.status ?? "NOT_CREATED",
    })
    : await appendStatusTransition(actor, activity, "FAILED_FINAL", input.reason, {
      ...deliveryChanges,
      failureState: failureFact(actor, input.reason, input.code, recordedAt, false, {
        runtimeStatus: input.delivery?.status ?? "NOT_CREATED",
        runtimeDeliveryId: input.delivery?.id,
      }),
    }, false, {
      runtimeRequestHash: input.runtimeRequestHash,
      runtimeIdempotencyKey: input.runtimeIdempotencyKey,
      runtimeStatus: input.delivery?.status ?? "NOT_CREATED",
    });
  await invalidateFollowupContextAndEpisode(terminal, {
    episodeStatus: input.status === "CANCELLED" ? "CANCELLED" : "FAILED",
    reason: input.reason,
    recordedAt,
    recoveryState: {
      status: input.status,
      code: input.code,
      externalWorkMayStillFinish: false,
      runtimeDeliveryId: input.delivery?.id,
    },
  });
  return terminal;
}

async function appendStatusTransition(
  actor: Actor,
  activity: GovernedActivity,
  toStatus: GovernedFollowupStatus,
  reason: string,
  changes: Partial<typeof retryAttempts.$inferInsert> = {},
  externalWorkMayStillFinish = false,
  transitionDetail: Record<string, unknown> = {},
): Promise<GovernedActivity> {
  requireGovernedActivity(activity);
  const terminalFact = (changes.cancellationState ?? changes.failureState) as Record<string, unknown> | undefined;
  const terminalRecordedAt = typeof terminalFact?.recordedAt === "string" ? new Date(terminalFact.recordedAt) : null;
  const recordedAt = terminalRecordedAt && !Number.isNaN(terminalRecordedAt.getTime()) ? terminalRecordedAt : new Date();
  const eventId = randomUUID();
  await getDb().insert(governanceEvents).values({
    id: eventId,
    institutionId: actor.institutionId,
    actorUserId: actor.userId,
    entityType: "GOVERNED_FOLLOWUP",
    entityId: activity.id,
    action: "STATUS_TRANSITION",
    previousEventId: activity.latestTransitionEventId,
    payload: {
      activityType: activity.activityType,
      fromStatus: activity.status,
      toStatus,
      reason,
      actorUserId: actor.userId,
      recordedAt: recordedAt.toISOString(),
      externalWorkMayStillFinish,
      ...transitionDetail,
      educationalEffectivenessClaim: false,
      masteryClaim: false,
    },
  });
  const expectedEvent = activity.latestTransitionEventId
    ? eq(retryAttempts.latestTransitionEventId, activity.latestTransitionEventId)
    : isNull(retryAttempts.latestTransitionEventId);
  const [updated] = await getDb().update(retryAttempts).set({
    ...changes,
    status: toStatus,
    latestTransitionEventId: eventId,
    updatedAt: recordedAt,
  }).where(and(
    eq(retryAttempts.id, activity.id),
    eq(retryAttempts.status, activity.status),
    expectedEvent,
  )).returning();
  if (!updated) throw new DomainInvariantError("Follow-up status transition conflicted", "FOLLOWUP_STATE_CONFLICT");
  return updated;
}

async function bindAssignmentEvent(actor: Actor, activity: GovernedActivity, assignedAt: Date): Promise<GovernedActivity> {
  requireGovernedActivity(activity);
  const eventId = randomUUID();
  await getDb().insert(governanceEvents).values({
    id: eventId,
    institutionId: actor.institutionId,
    actorUserId: actor.userId,
    entityType: "GOVERNED_FOLLOWUP",
    entityId: activity.id,
    action: "ASSIGNED",
    payload: {
      activityType: activity.activityType,
      fromStatus: null,
      toStatus: "ASSIGNED",
      reason: "Authenticated course teacher assigned a governed follow-up",
      actorUserId: actor.userId,
      recordedAt: assignedAt.toISOString(),
      externalWorkMayStillFinish: false,
      sourceLineage: activity.sourceLineage,
      targetEpisodeId: activity.targetEpisodeId,
      educationalEffectivenessClaim: false,
      masteryClaim: false,
    },
  });
  const [bound] = await getDb().update(retryAttempts).set({ latestTransitionEventId: eventId, updatedAt: assignedAt })
    .where(and(eq(retryAttempts.id, activity.id), eq(retryAttempts.status, "ASSIGNED"), isNull(retryAttempts.latestTransitionEventId)))
    .returning();
  if (!bound) throw new DomainInvariantError("Follow-up assignment event linkage conflicted", "FOLLOWUP_STATE_CONFLICT");
  return bound;
}

export async function requireCurrentTeacherCourseAuthority(actor: Actor, courseId: string): Promise<void> {
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  requireCourseAccess(actor, actor.institutionId, courseId);
  if (actor.roles.includes("ADMIN") && !actor.roles.includes("TEACHER")) {
    throw new DomainInvariantError("Formal learning follow-up requires current course TEACHER authority", "HUMAN_AUTHORITY_REQUIRED");
  }
  const [authority] = await getDb().select({ membership: institutionMemberships, enrollment: courseEnrollments })
    .from(institutionMemberships)
    .innerJoin(courseEnrollments, and(
      eq(courseEnrollments.userId, institutionMemberships.userId),
      eq(courseEnrollments.institutionId, institutionMemberships.institutionId),
    ))
    .where(and(
      eq(institutionMemberships.userId, actor.userId),
      eq(institutionMemberships.institutionId, actor.institutionId),
      eq(institutionMemberships.role, "TEACHER"),
      eq(courseEnrollments.courseId, courseId),
      eq(courseEnrollments.role, "TEACHER"),
    )).limit(1);
  if (!authority) throw new DomainInvariantError("Teacher course authority is no longer current", "TEACHER_COURSE_AUTHORITY_REVOKED");
}

async function loadSourceAuthority(actor: Actor, input: { observationId: string; reviewId: string }) {
  const [lineage] = await getDb().select({
    observation: diagnosticObservations,
    attempt: learnerAttempts,
    task: learningTasks,
    sourceEpisode: learningEpisodes,
    review: teacherReviews,
    capability: capabilities,
    version: capabilityVersions,
  }).from(diagnosticObservations)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .innerJoin(learningEpisodes, and(
      eq(learningEpisodes.id, learnerAttempts.episodeId),
      eq(learningEpisodes.taskId, learningTasks.id),
    ))
    .innerJoin(teacherReviews, and(
      eq(teacherReviews.id, input.reviewId),
      eq(teacherReviews.observationId, diagnosticObservations.id),
    ))
    .innerJoin(capabilityVersions, eq(capabilityVersions.id, diagnosticObservations.capabilityVersionId))
    .innerJoin(capabilities, and(
      eq(capabilities.id, capabilityVersions.capabilityId),
      eq(capabilities.id, learnerAttempts.capabilityId),
    ))
    .where(eq(diagnosticObservations.id, input.observationId))
    .limit(1);
  if (!lineage) throw new DomainInvariantError("Follow-up requires an exact reviewed Capability Diagnosis lineage", "FOLLOWUP_SOURCE_NOT_FOUND");
  await requireCurrentTeacherCourseAuthority(actor, lineage.task.courseId);
  if (lineage.task.institutionId !== actor.institutionId || lineage.task.status !== "OPEN") {
    throw new DomainInvariantError("Follow-up source Task is outside the active open scope", "FOLLOWUP_TASK_INELIGIBLE");
  }
  if (lineage.observation.supersededById) throw new DomainInvariantError("Follow-up requires the current Diagnosis Proposal", "DIAGNOSIS_NOT_CURRENT");
  const [currentReview] = await getDb().select().from(teacherReviews)
    .where(eq(teacherReviews.observationId, lineage.observation.id))
    .orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
  if (currentReview?.id !== lineage.review.id) throw new DomainInvariantError("Follow-up requires the current TeacherReview", "STALE_REVIEW");
  requireVerifiedReviewProvenance(lineage.review, lineage.task.institutionId);
  requireEligibleReviewDecision(lineage.review.decision, "Retry / Transfer / Retention assignment");
  if (lineage.version.status !== "ACTIVE" || lineage.capability.activeVersionId !== lineage.version.id) {
    throw new DomainInvariantError("Follow-up source CapabilityVersion is no longer active", "FOLLOWUP_CAPABILITY_UNAVAILABLE");
  }
  return lineage;
}

export async function resolveGovernedFollowupAuthority(actor: Actor, rawInput: unknown) {
  const assignment = GovernedFollowupStart.parse(rawInput);
  const source = await loadSourceAuthority(actor, assignment);
  return {
    assignment,
    taskId: source.task.id,
    sourceEpisodeId: source.sourceEpisode.id,
    learnerId: source.task.learnerId,
  };
}

async function loadAssignmentReplay(
  actor: Actor,
  key: string,
  requestHash: string,
): Promise<GovernedActivity | undefined> {
  const [reservation] = await getDb().select().from(idempotencyKeys).where(and(
    eq(idempotencyKeys.institutionId, actor.institutionId),
    eq(idempotencyKeys.commandType, "CREATE_GOVERNED_FOLLOWUP"),
    eq(idempotencyKeys.key, key),
  )).limit(1);
  if (!reservation) return undefined;
  if (reservation.requestHash !== requestHash) {
    throw new DomainInvariantError("Follow-up idempotency key was reused with another request", "IDEMPOTENCY_MISMATCH");
  }
  const [activity] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, reservation.resultId)).limit(1);
  requireGovernedActivity(activity);
  if (activity.institutionId !== actor.institutionId || activity.actorUserId !== actor.userId
    || activity.idempotencyKey !== key) {
    throw new DomainInvariantError("Follow-up idempotency reservation has invalid Product State lineage", "IDEMPOTENCY_INTEGRITY");
  }
  return activity;
}

export async function findGovernedActivityForTargetEpisode(taskId: string, episodeId: string): Promise<GovernedActivity | null> {
  const [activity] = await getDb().select().from(retryAttempts).where(and(
    eq(retryAttempts.taskId, taskId),
    eq(retryAttempts.targetEpisodeId, episodeId),
  )).limit(1);
  return activity ?? null;
}

async function ensurePlan(
  actor: Actor,
  activity: GovernedActivity,
  dependencies: GovernedFollowupPlanningDependencies = governedPlanningDependencies,
): Promise<GovernedActivity> {
  requireGovernedActivity(activity);
  if (new Set(["FAILED_FINAL", "CANCELLED"]).has(activity.status)) return activity;
  if (activity.activityPlanProposalId) {
    const [linked] = await getDb().select().from(activityPlanProposals)
      .where(eq(activityPlanProposals.id, activity.activityPlanProposalId)).limit(1);
    if (!linked) throw new DomainInvariantError("Linked ActivityPlanProposal is missing", "FOLLOWUP_PLAN_INTEGRITY");
    if (linked.state === "READY" && linked.selectedCapabilityVersionId) return activity;
    return finalizeFollowupFailure(actor, activity, {
      status: "FAILED_FINAL",
      reason: "The canonical planner did not produce an executable follow-up plan",
      code: linked.state === "ESCALATED" ? "FOLLOWUP_PLAN_ESCALATED" : "FOLLOWUP_PLAN_BLOCKED",
    });
  }
  let proposal: typeof activityPlanProposals.$inferSelect;
  try {
    const resolution = await dependencies.resolveCapability(actor, {
      taskId: activity.taskId,
      episodeId: activity.targetEpisodeId,
      diagnosticObservationId: activity.reviewedObservationId,
    });
    proposal = await dependencies.planActivity(actor, {
      taskId: activity.taskId,
      episodeId: activity.targetEpisodeId,
      capabilityResolutionId: resolution.id,
    });
  } catch (error) {
    const code = error instanceof DomainInvariantError ? error.code : "FOLLOWUP_PLAN_FAILED";
    const reason = error instanceof Error ? error.message : String(error);
    return finalizeFollowupFailure(actor, activity, {
      status: code === "EXECUTION_ABORTED" ? "CANCELLED" : "FAILED_FINAL",
      reason,
      code,
    });
  }
  if (proposal.state !== "READY" || !proposal.selectedCapabilityVersionId) {
    const code = proposal.state === "ESCALATED" ? "FOLLOWUP_PLAN_ESCALATED" : "FOLLOWUP_PLAN_BLOCKED";
    const reason = proposal.state === "ESCALATED"
      ? "The canonical planner escalated this follow-up"
      : "The canonical planner could not produce an executable plan";
    const linked = await getDb().update(retryAttempts).set({
      activityPlanProposalId: proposal.id,
      updatedAt: new Date(),
    }).where(and(eq(retryAttempts.id, activity.id), eq(retryAttempts.status, "ASSIGNED"))).returning();
    if (!linked[0]) throw new DomainInvariantError("Follow-up ActivityPlanProposal linkage conflicted", "FOLLOWUP_PLAN_CONFLICT");
    return finalizeFollowupFailure(actor, linked[0], { status: "FAILED_FINAL", reason, code });
  }
  const [planned] = await getDb().update(retryAttempts).set({ activityPlanProposalId: proposal.id, updatedAt: new Date() })
    .where(and(
      eq(retryAttempts.id, activity.id),
      eq(retryAttempts.status, "ASSIGNED"),
      eq(retryAttempts.targetEpisodeId, activity.targetEpisodeId),
    )).returning();
  if (!planned) throw new DomainInvariantError("Follow-up ActivityPlanProposal linkage conflicted", "FOLLOWUP_PLAN_CONFLICT");
  return planned;
}

export async function createGovernedFollowup(
  actor: Actor,
  rawInput: unknown,
  planningDependencies: GovernedFollowupPlanningDependencies = governedPlanningDependencies,
): Promise<GovernedActivity> {
  const input = GovernedFollowupStart.parse(rawInput);
  return withTenantDatabase(actor, async () => {
    const source = await loadSourceAuthority(actor, input);
    const requestHash = commandRequestHash(actor, "CREATE_GOVERNED_FOLLOWUP", input);
    const fastReplay = await loadAssignmentReplay(actor, input.assignmentIdempotencyKey, requestHash);
    if (fastReplay) return ensurePlan(actor, fastReplay, planningDependencies);

    const activityId = randomUUID();
    const targetEpisodeId = randomUUID();
    const contextItemId = randomUUID();
    const extensionId = randomUUID();
    const sql = getSql();
    await sql`SELECT id FROM foundry_product.learning_tasks WHERE id=${source.task.id} FOR UPDATE`;
    const lockedReplay = await loadAssignmentReplay(actor, input.assignmentIdempotencyKey, requestHash);
    if (lockedReplay) return ensurePlan(actor, lockedReplay, planningDependencies);
    const [existingSuccessor] = await getDb().select({ id: learningEpisodes.id }).from(learningEpisodes)
      .where(eq(learningEpisodes.predecessorEpisodeId, source.sourceEpisode.id)).limit(1);
    if (existingSuccessor) throw new DomainInvariantError("The source Episode already has a governed successor", "FOLLOWUP_SUCCESSOR_CONFLICT");
    const [latestEpisode] = await getDb().select({ sequence: learningEpisodes.sequence }).from(learningEpisodes)
      .where(eq(learningEpisodes.taskId, source.task.id)).orderBy(desc(learningEpisodes.sequence)).limit(1);
    const assignedAt = new Date();

    const canonicalSourceSignature = {
      context: source.task.title.trim().slice(0, 120),
      representation: source.attempt.modality ?? (source.attempt.fileAssetId ? "MULTIMODAL" : "TEXT"),
      itemFamily: source.capability.key,
      problemStructure: source.version.implementationKey,
    };
    const transfer = input.activityType === "TRANSFER" ? TransferDeclaration.parse({
      source: canonicalSourceSignature,
      target: input.transfer.target,
      materialDifferenceRationale: input.transfer.materialDifferenceRationale,
      evidenceLimit: "TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN",
    }) : null;
    const retention = input.activityType === "RETENTION" ? RetentionDeclaration.parse(input.retention) : null;
    if (retention) {
      const earliest = assignedAt.getTime() + retention.declaredDelaySeconds * 1_000;
      if (new Date(retention.scheduledFor).getTime() < earliest) {
        throw new DomainInvariantError("Retention schedule must be at or after assignment time plus the declared delay", "RETENTION_SCHEDULE_TOO_EARLY");
      }
    }

    const sourceLineage = {
      taskId: source.task.id,
      sourceEpisodeId: source.sourceEpisode.id,
      learnerAttemptId: source.attempt.id,
      attemptContentHash: source.attempt.contentHash,
      attemptSourceRefs: source.attempt.sourceRefs,
      attemptActivityPlanId: source.attempt.activityPlanId,
      attemptRuntimeDeliveryId: source.attempt.runtimeDeliveryId,
      diagnosticObservationId: source.observation.id,
      diagnosisInputLineage: source.observation.inputLineage,
      diagnosisOutputLineage: source.observation.outputLineage,
      teacherReviewId: source.review.id,
      capabilityId: source.capability.id,
      capabilityVersionId: source.version.id,
      capabilityVersionContentHash: source.version.contentHash,
      canonicalTransferSourceSignature: canonicalSourceSignature,
    };
    const contextPayload = {
      formalFollowup: true,
      followupId: activityId,
      followupType: input.activityType,
      governingTeacherReviewId: source.review.id,
      requiredCapabilityKey: source.capability.key,
      sourceLineage,
      transfer,
      retention,
      requiresTeacherReviewAfterRuntime: true,
      effectivenessClaim: false,
      masteryClaim: false,
    };

    const [reservation] = await getDb().insert(idempotencyKeys).values({
      institutionId: actor.institutionId,
      key: input.assignmentIdempotencyKey,
      commandType: "CREATE_GOVERNED_FOLLOWUP",
      requestHash,
      resultId: activityId,
    }).onConflictDoNothing().returning({ resultId: idempotencyKeys.resultId });
    if (!reservation) {
      const replay = await loadAssignmentReplay(actor, input.assignmentIdempotencyKey, requestHash);
      if (!replay) throw new DomainInvariantError("Follow-up idempotency reservation conflicted without a replayable result", "IDEMPOTENCY_INTEGRITY");
      return ensurePlan(actor, replay, planningDependencies);
    }
    await getDb().insert(learningEpisodes).values({
      id: targetEpisodeId,
      taskId: source.task.id,
      sequence: (latestEpisode?.sequence ?? 0) + 1,
      status: "ACTIVE",
      purpose: input.activityType,
      predecessorEpisodeId: source.sourceEpisode.id,
      waitingReason: input.activityType === "RETENTION" ? "WAITING_FOR_RETENTION_SCHEDULE" : "WAITING_FOR_LEARNER_ATTEMPT",
      recoveryState: { status: "PENDING", externalWorkMayStillFinish: false, checkpointOwned: true },
    });
    await getDb().insert(contextItems).values({
      id: contextItemId,
      institutionId: actor.institutionId,
      learnerProfileId: source.task.learnerProfileId,
      courseId: source.task.courseId,
      taskId: source.task.id,
      episodeId: targetEpisodeId,
      kind: "GOVERNED_FOLLOWUP",
      scope: "EPISODE",
      state: "ACTIVE",
      payload: contextPayload,
      provenance: { authority: "TEACHER_REVIEW", activityId, teacherReviewId: source.review.id, actorUserId: actor.userId },
      ruleVersion: "cap06-governed-followup-v1",
      reviewStatus: "HUMAN_AUTHORIZED",
      actorUserId: actor.userId,
      validFrom: assignedAt,
    });
    const [activity] = await getDb().insert(retryAttempts).values({
      id: activityId,
      originalAttemptId: source.attempt.id,
      reviewedObservationId: source.observation.id,
      teacherReviewId: source.review.id,
      activityType: input.activityType,
      prompt: input.prompt,
      status: "ASSIGNED",
      institutionId: actor.institutionId,
      courseId: source.task.courseId,
      taskId: source.task.id,
      sourceEpisodeId: source.sourceEpisode.id,
      targetEpisodeId,
      learnerId: source.task.learnerId,
      contextItemId,
      scheduledFor: retention ? new Date(retention.scheduledFor) : assignedAt,
      assignedAt,
      sourceLineage,
      actorUserId: actor.userId,
      actorProvenance: actorProvenance(actor, assignedAt),
      idempotencyKey: input.assignmentIdempotencyKey,
      cancellationState: null,
      failureState: null,
      createdAt: assignedAt,
      updatedAt: assignedAt,
    }).returning();
    if (transfer) await getDb().insert(transferActivities).values({
      id: extensionId,
      activityId,
      targetConcept: transfer.target.itemFamily,
      evidenceUnitId: null,
      contractVersion: "CAP06_V1",
      declaration: transfer,
      changedDimensions: transferChangedDimensions(transfer),
    });
    if (retention) await getDb().insert(retentionReviews).values({
      id: extensionId,
      activityId,
      dueAt: new Date(retention.scheduledFor),
      evidenceUnitId: null,
      contractVersion: "CAP06_V1",
      declaredDelaySeconds: retention.declaredDelaySeconds,
      interveningExposure: retention.interveningExposure,
      contentEquivalence: retention.contentEquivalence,
      assistancePolicy: retention.assistancePolicy,
      createdAt: assignedAt,
    });
    if (source.sourceEpisode.status === "ACTIVE") {
      await getDb().update(learningEpisodes).set({ status: "COMPLETED", endedAt: assignedAt })
        .where(and(eq(learningEpisodes.id, source.sourceEpisode.id), eq(learningEpisodes.status, "ACTIVE")));
    }
    const assigned = await bindAssignmentEvent(actor, activity, assignedAt);
    return ensurePlan(actor, assigned, planningDependencies);
  });
}

async function requireRuntimeRequestReplay(activity: GovernedActivity, runtimeRequestHash: string): Promise<void> {
  requireGovernedActivity(activity);
  if (!activity.latestTransitionEventId) {
    throw new DomainInvariantError("Follow-up runtime replay lacks its transition fact", "FOLLOWUP_REPLAY_INTEGRITY");
  }
  const [transition] = await getDb().select().from(governanceEvents)
    .where(eq(governanceEvents.id, activity.latestTransitionEventId)).limit(1);
  if (!transition || transition.entityId !== activity.id
    || transition.payload.runtimeRequestHash !== runtimeRequestHash) {
    throw new DomainInvariantError("Follow-up runtime replay changed the original request", "FOLLOWUP_RECOVERY_IDEMPOTENCY_MISMATCH");
  }
}

async function loadPersistedFollowupResult(activity: GovernedActivity) {
  requireGovernedActivity(activity);
  if (!activity.activityPlanId || !activity.runtimeDeliveryId || !activity.resultAttemptId || !activity.resultObservationId) {
    throw new DomainInvariantError("Follow-up runtime replay lacks exact persisted result lineage", "FOLLOWUP_REPLAY_INTEGRITY");
  }
  const [[delivery], [attempt], [observation]] = await Promise.all([
    getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.id, activity.runtimeDeliveryId)).limit(1),
    getDb().select().from(learnerAttempts).where(eq(learnerAttempts.id, activity.resultAttemptId)).limit(1),
    getDb().select().from(diagnosticObservations).where(eq(diagnosticObservations.id, activity.resultObservationId)).limit(1),
  ]);
  if (!delivery || !attempt || !observation || delivery.status !== "SUCCEEDED"
    || delivery.activityPlanId !== activity.activityPlanId
    || attempt.runtimeDeliveryId !== delivery.id || attempt.episodeId !== activity.targetEpisodeId
    || observation.attemptId !== attempt.id) {
    throw new DomainInvariantError("Follow-up runtime replay conflicts with persisted Product State", "FOLLOWUP_REPLAY_INTEGRITY");
  }
  return { delivery, attempt, observation };
}

export async function executeGovernedFollowup(actor: Actor, input: {
  activityId: string;
  response: string;
  capabilityPublicKey: string;
  fields: Record<string, string>;
  idempotencyKey: string;
}, runtimeDependencies?: AssetRuntimeDependencies) {
  requireRole(actor, ["LEARNER"]);
  const runtimeRequestHash = commandRequestHash(actor, "EXECUTE_GOVERNED_FOLLOWUP", input);
  const activity = await withTenantDatabase(actor, async () => {
    const [row] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, input.activityId)).limit(1);
    requireGovernedActivity(row);
    if (row.learnerId !== actor.userId) {
      throw new DomainInvariantError("Only the Task learner may submit this governed follow-up", "WORKFLOW_OWNERSHIP");
    }
    if (new Set(["WAITING_FOR_REVIEW", "FAILED_FINAL", "CANCELLED"]).has(row.status)) {
      await requireRuntimeRequestReplay(row, runtimeRequestHash);
      return row;
    }
    await requireGovernedFollowupScope(actor, {
      activityId: row.id,
      taskId: row.taskId,
      episodeId: row.targetEpisodeId,
      learnerOriginated: true,
      requireActiveRuntime: true,
    });
    if (!new Set(["ASSIGNED", "IN_PROGRESS", "FAILED_RECOVERABLE"]).has(row.status)) {
      throw new DomainInvariantError("Follow-up is not waiting for a learner Attempt", "FOLLOWUP_STATE_CONFLICT");
    }
    if (!row.activityPlanProposalId) throw new DomainInvariantError("Follow-up has no READY ActivityPlanProposal", "FOLLOWUP_PLAN_NOT_READY");
    if (row.scheduledFor && row.scheduledFor.getTime() > Date.now()) {
      throw new DomainInvariantError("This Retention activity is not available before its declared schedule", "RETENTION_NOT_DUE");
    }
    return row;
  });
  requireGovernedActivity(activity);
  if (activity.status === "WAITING_FOR_REVIEW") {
    const persisted = await withTenantDatabase(actor, () => loadPersistedFollowupResult(activity));
    return { status: "WAITING_FOR_REVIEW" as const, activity, ...persisted };
  }
  if (activity.status === "FAILED_FINAL" || activity.status === "CANCELLED") {
    return { status: activity.status as "FAILED_FINAL" | "CANCELLED", activity };
  }
  const resolvedInput = await withTenantDatabase(actor, () => resolveLearnerCapabilityInput({
    actor,
    taskId: activity.taskId,
    episodeId: activity.targetEpisodeId,
    publicKey: input.capabilityPublicKey,
    fields: input.fields,
  }));
  const [proposal] = await withTenantDatabase(actor, () => getDb().select().from(activityPlanProposals)
    .where(eq(activityPlanProposals.id, activity.activityPlanProposalId!)).limit(1));
  if (!proposal || proposal.selectedCapabilityId !== resolvedInput.capabilityId) {
    throw new DomainInvariantError("Learner input does not match the exact planned Capability", "FOLLOWUP_CAPABILITY_MISMATCH");
  }
  const runningActivity = await withTenantDatabase(actor, async () => {
    const [current] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, activity.id)).limit(1);
    requireGovernedActivity(current);
    if (new Set(["WAITING_FOR_REVIEW", "FAILED_FINAL", "CANCELLED"]).has(current.status)) {
      await requireRuntimeRequestReplay(current, runtimeRequestHash);
      return current;
    }
    if (current.status === "IN_PROGRESS") {
      await requireRuntimeRequestReplay(current, runtimeRequestHash);
      const [delivery] = await getDb().select().from(runtimeDeliveries).where(and(
        eq(runtimeDeliveries.taskId, current.taskId),
        eq(runtimeDeliveries.episodeId, current.targetEpisodeId),
        eq(runtimeDeliveries.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (delivery && !new Set(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]).has(delivery.status)
        && Date.now() <= delivery.startedAt.getTime() + delivery.deadlineMs) {
        throw new DomainInvariantError("The governed follow-up runtime is still in progress", "FOLLOWUP_RUNTIME_IN_PROGRESS");
      }
      return current;
    }
    return appendStatusTransition(
      actor,
      current,
      "IN_PROGRESS",
      current.status === "FAILED_RECOVERABLE"
        ? "Learner restarted a recoverable governed follow-up runtime"
        : "Learner began the governed follow-up runtime",
      {},
      false,
      { runtimeIdempotencyKey: input.idempotencyKey, runtimeRequestHash },
    );
  });
  requireGovernedActivity(runningActivity);
  if (runningActivity.status === "WAITING_FOR_REVIEW") {
    const persisted = await withTenantDatabase(actor, () => loadPersistedFollowupResult(runningActivity));
    return { status: "WAITING_FOR_REVIEW" as const, activity: runningActivity, ...persisted };
  }
  if (runningActivity.status === "FAILED_FINAL" || runningActivity.status === "CANCELLED") {
    return { status: runningActivity.status as "FAILED_FINAL" | "CANCELLED", activity: runningActivity };
  }
  let runtime: Awaited<ReturnType<typeof executeAssetStageResult>>;
  try {
    runtime = await executeAssetStageResult(actor, {
      taskId: runningActivity.taskId,
      episodeId: runningActivity.targetEpisodeId,
      activityPlanProposalId: runningActivity.activityPlanProposalId!,
      prompt: runningActivity.prompt,
      response: input.response,
      structuredInput: resolvedInput.structuredInput,
      modality: "STRUCTURED",
      idempotencyKey: input.idempotencyKey,
      deadlineMs: 30_000,
    }, runtimeDependencies);
  } catch (error) {
    if (!(error instanceof DomainInvariantError)) throw error;
    const terminal = await withTenantDatabase(actor, async () => {
      const [current] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, runningActivity.id)).limit(1);
      requireGovernedActivity(current);
      return finalizeFollowupFailure(actor, current, {
        status: error.code === "EXECUTION_ABORTED" ? "CANCELLED" : "FAILED_FINAL",
        reason: error.message,
        code: error.code,
        runtimeRequestHash,
        runtimeIdempotencyKey: input.idempotencyKey,
      });
    });
    return { status: terminal.status as "FAILED_FINAL" | "CANCELLED", activity: terminal };
  }
  if (runtime.delivery.status !== "SUCCEEDED") {
    const normalized = runtime.delivery.normalizedError as { code?: string; message?: string } | null;
    const terminal = await withTenantDatabase(actor, async () => {
      const [current] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, runningActivity.id)).limit(1);
      requireGovernedActivity(current);
      return finalizeFollowupFailure(actor, current, {
        status: runtime.delivery.status === "CANCELLED" ? "CANCELLED" : "FAILED_FINAL",
        reason: normalized?.message ?? `Asset Runtime ended in ${runtime.delivery.status}`,
        code: normalized?.code ?? `ASSET_RUNTIME_${runtime.delivery.status}`,
        runtimeRequestHash,
        runtimeIdempotencyKey: input.idempotencyKey,
        delivery: runtime.delivery,
      });
    });
    return { status: terminal.status as "FAILED_FINAL" | "CANCELLED", activity: terminal, delivery: runtime.delivery, attempt: runtime.attempt };
  }
  const output = runtime.delivery.normalizedOutput as Record<string, unknown> | null;
  if (!output || typeof output.status !== "string" || !("summary" in output)) {
    const terminal = await withTenantDatabase(actor, async () => {
      const [current] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, runningActivity.id)).limit(1);
      requireGovernedActivity(current);
      return finalizeFollowupFailure(actor, current, {
        status: "FAILED_FINAL",
        reason: "Runtime succeeded without a DiagnosticObservationProposal contract",
        code: "FOLLOWUP_DIAGNOSIS_UNAVAILABLE",
        runtimeRequestHash,
        runtimeIdempotencyKey: input.idempotencyKey,
        delivery: runtime.delivery,
      });
    });
    return { status: "FAILED_FINAL" as const, activity: terminal, delivery: runtime.delivery, attempt: runtime.attempt };
  }
  const observation = await withTenantDatabase(actor, () => persistDiagnosticObservation({
    observationId: assetRuntimeId("diagnostic-observation", runtime.attempt.id),
    attemptId: runtime.attempt.id,
    capabilityVersionId: runtime.delivery.capabilityVersionId,
    capabilityId: runtime.delivery.capabilityId,
    result: output as { status: string; failureCode: string | null; firstInvalidStep: string | null; summary: string; [key: string]: unknown },
  }));
  return withTenantDatabase(actor, async () => {
    const [current] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, runningActivity.id)).limit(1);
    requireGovernedActivity(current);
    const linked = await appendStatusTransition(actor, current, "WAITING_FOR_REVIEW", "Canonical runtime completed and created a new Diagnosis Proposal for human review", {
      activityPlanId: runtime.delivery.activityPlanId,
      runtimeDeliveryId: runtime.delivery.id,
      resultAttemptId: runtime.attempt.id,
      resultObservationId: observation.id,
    }, false, { runtimeIdempotencyKey: input.idempotencyKey, runtimeRequestHash });
    await getDb().update(learningEpisodes).set({
      status: "WAITING_FOR_REVIEW",
      waitingReason: "WAITING_FOR_TEACHER_REVIEW",
      recoveryState: { status: "CHECKPOINTED", externalWorkMayStillFinish: false, runtimeDeliveryId: runtime.delivery.id },
    }).where(eq(learningEpisodes.id, runningActivity.targetEpisodeId));
    return { status: "WAITING_FOR_REVIEW" as const, activity: linked, delivery: runtime.delivery, attempt: runtime.attempt, observation };
  });
}

export async function reviewGovernedFollowupResult(actor: Actor, input: {
  activityId: string;
  decision: unknown;
  correction?: string;
  supplement?: string;
  teachingSupport: string;
  reviewIdempotencyKey: string;
  retentionExposure?: unknown;
  transferContractConfirmed?: unknown;
}) {
  const reviewBase = {
    decision: input.decision,
    teachingSupport: input.teachingSupport,
    reviewIdempotencyKey: input.reviewIdempotencyKey,
    retentionExposure: input.retentionExposure,
    transferContractConfirmed: input.transferContractConfirmed,
  };
  const decision = GovernedFollowupReview.parse(input.decision === "CORRECT"
    ? { ...reviewBase, correction: input.correction }
    : input.decision === "SUPPLEMENT"
      ? { ...reviewBase, supplement: input.supplement }
      : reviewBase);
  return withTenantDatabase(actor, async () => {
    const [row] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, input.activityId)).limit(1);
    requireGovernedActivity(row);
    await requireGovernedFollowupScope(actor, {
      activityId: row.id,
      taskId: row.taskId,
      episodeId: row.targetEpisodeId,
    });
    await requireCurrentTeacherCourseAuthority(actor, row.courseId);
    const confirmedRetentionExposure = row.activityType === "RETENTION"
      ? InterveningExposure.parse(decision.retentionExposure)
      : undefined;
    if (row.activityType !== "RETENTION" && decision.retentionExposure) {
      throw new DomainInvariantError("Actual intervening exposure applies only to Retention", "RETENTION_EXPOSURE_NOT_APPLICABLE");
    }
    const transferContractConfirmed = row.activityType === "TRANSFER"
      ? decision.transferContractConfirmed === true
      : undefined;
    if (row.activityType === "TRANSFER" && !transferContractConfirmed) {
      throw new DomainInvariantError("Transfer result Review requires confirmation of the immutable target contract", "TRANSFER_CONTRACT_CONFIRMATION_REQUIRED");
    }
    if (row.activityType !== "TRANSFER" && decision.transferContractConfirmed !== undefined) {
      throw new DomainInvariantError("Transfer contract confirmation applies only to Transfer", "TRANSFER_CONTRACT_CONFIRMATION_NOT_APPLICABLE");
    }
    const reviewCommand = {
      observationId: row.resultObservationId!,
      decision: decision.decision,
      correction: "correction" in decision ? decision.correction : undefined,
      supplement: "supplement" in decision ? decision.supplement : undefined,
      teachingSupport: decision.teachingSupport,
      idempotencyKey: decision.reviewIdempotencyKey,
    };
    const reviewOptions = {
      deterministicResultId: true,
      requestContext: {
        governedFollowupActivityId: row.id,
        activityType: row.activityType,
        confirmedRetentionExposure,
        transferContractConfirmed,
      },
    };
    if (new Set(["REVIEWED", "ESCALATED"]).has(row.status) && row.resultObservationId && row.resultReviewId) {
      const replay = await createTeacherReview(actor, reviewCommand, reviewOptions);
      if (replay.reviewId !== row.resultReviewId) {
        throw new DomainInvariantError("Follow-up result Review replay conflicts with Product State", "FOLLOWUP_REVIEW_REPLAY_CONFLICT");
      }
      if (row.activityType === "RETENTION") {
        const [retention] = await getDb().select().from(retentionReviews).where(eq(retentionReviews.activityId, row.id)).limit(1);
        const actual = retention?.completedInterveningExposure;
        if (!retention?.completedAt || !retention.exposureConfirmedAt || retention.exposureConfirmedBy !== actor.userId
          || actual?.kind !== confirmedRetentionExposure?.kind || actual?.detail !== confirmedRetentionExposure?.detail) {
          throw new DomainInvariantError("Retention replay conflicts with the confirmed intervening exposure", "RETENTION_EXPOSURE_REPLAY_CONFLICT");
        }
      }
      return { activity: row, reviewId: replay.reviewId, outcomeId: undefined };
    }
    if (row.status !== "WAITING_FOR_REVIEW" || !row.resultObservationId || !row.resultAttemptId || !row.runtimeDeliveryId || !row.activityPlanId) {
      throw new DomainInvariantError("Follow-up result is not ready for TeacherReview", "FOLLOWUP_REVIEW_NOT_READY");
    }
    const activity = row;
    const review = await createTeacherReview(actor, reviewCommand, reviewOptions);
    const [storedReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.id, review.reviewId)).limit(1);
    if (!storedReview || storedReview.observationId !== activity.resultObservationId) {
      throw new DomainInvariantError("Result TeacherReview lineage is invalid", "FOLLOWUP_REVIEW_LINEAGE_INVALID");
    }
    const status = storedReview.decision === "ESCALATE" ? "ESCALATED" : "REVIEWED";
    const [current] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, activity.id)).limit(1);
    requireGovernedActivity(current);
    const linked = await appendStatusTransition(actor, current, status, status === "ESCALATED"
      ? "Authorized teacher escalated the new follow-up Diagnosis Proposal"
      : "Authorized teacher reviewed the new follow-up Diagnosis Proposal", {
      resultReviewId: storedReview.id,
    }, false, row.activityType === "TRANSFER" ? {
      transferContractConfirmed: true,
      transferEvidenceLimit: "TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN",
    } : {});
    const reviewedAt = new Date();
    if (activity.activityType === "RETENTION") {
      const [completedRetention] = await getDb().update(retentionReviews).set({
        completedAt: reviewedAt,
        completedInterveningExposure: confirmedRetentionExposure,
        exposureConfirmedAt: reviewedAt,
        exposureConfirmedBy: actor.userId,
      }).where(and(
        eq(retentionReviews.activityId, activity.id),
        isNull(retentionReviews.completedAt),
      )).returning({ id: retentionReviews.id });
      if (!completedRetention) {
        throw new DomainInvariantError("Retention exposure confirmation conflicted", "RETENTION_EXPOSURE_CONFLICT");
      }
    }
    await invalidateFollowupContextAndEpisode(linked, {
      episodeStatus: status === "ESCALATED" ? "ESCALATED" : "COMPLETED",
      reason: status === "ESCALATED"
        ? "Governed follow-up ended with an authorized teacher escalation"
        : "Governed follow-up ended with an authorized teacher review",
      recordedAt: reviewedAt,
      recoveryState: { status: "COMPLETED", externalWorkMayStillFinish: false, resultReviewId: storedReview.id },
    });
    return { activity: linked, reviewId: storedReview.id, outcomeId: undefined };
  });
}

export async function cancelGovernedFollowup(actor: Actor, activityId: string, reason: string) {
  const cancellationReason = reason.trim();
  if (cancellationReason.length < 5 || cancellationReason.length > 1_000) {
    throw new DomainInvariantError("Cancellation requires a bounded reason", "FOLLOWUP_CANCELLATION_REASON_REQUIRED");
  }
  return withTenantDatabase(actor, async () => {
    const [activity] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, activityId)).limit(1);
    requireGovernedActivity(activity);
    const scope = await requireGovernedFollowupScope(actor, {
      activityId: activity.id,
      taskId: activity.taskId,
      episodeId: activity.targetEpisodeId,
      learnerOriginated: actor.roles.includes("LEARNER"),
      allowClosedTerminal: true,
    });
    if (actor.roles.includes("TEACHER")) await requireCurrentTeacherCourseAuthority(actor, scope.task.courseId);
    else {
      requireRole(actor, ["LEARNER"]);
      if (actor.userId !== activity.learnerId) {
        throw new DomainInvariantError("Only the Task learner may cancel this governed follow-up", "WORKFLOW_OWNERSHIP");
      }
    }
    if (activity.status === "CANCELLED") {
      const persistedReason = typeof activity.cancellationState?.reason === "string" ? activity.cancellationState.reason : undefined;
      if (persistedReason !== cancellationReason) {
        throw new DomainInvariantError("Cancellation replay changed the immutable reason", "FOLLOWUP_CANCELLATION_IDEMPOTENCY_MISMATCH");
      }
      return activity;
    }
    if (!new Set(["ASSIGNED", "FAILED_RECOVERABLE"]).has(activity.status) || activity.runtimeDeliveryId) {
      throw new DomainInvariantError("Only a waiting follow-up with no RuntimeDelivery can be cancelled here", "FOLLOWUP_CANCEL_CONFLICT");
    }
    const cancelledAt = new Date();
    const cancelled = await appendStatusTransition(actor, activity, "CANCELLED", cancellationReason, {
      cancellationState: {
        actorUserId: actor.userId,
        recordedAt: cancelledAt.toISOString(),
        reason: cancellationReason,
        code: "CANCELLED_BEFORE_RUNTIME",
        externalWorkMayStillFinish: false,
      },
    });
    await invalidateFollowupContextAndEpisode(cancelled, {
      episodeStatus: "CANCELLED",
      reason: cancellationReason,
      recordedAt: cancelledAt,
      recoveryState: { status: "CANCELLED", externalWorkMayStillFinish: false },
    });
    await getDb().update(workflowRuns).set({
      status: "CANCELLED",
      interruptType: null,
      failure: `Governed follow-up cancelled: ${cancellationReason}`,
      completedAt: cancelledAt,
      productLinks: sql`${workflowRuns.productLinks} || jsonb_build_object(
        'activityStatus','CANCELLED',
        'failureCode','CANCELLED_BEFORE_RUNTIME',
        'failureReason',${cancellationReason}::text
      )`,
    }).where(and(
      eq(workflowRuns.institutionId, actor.institutionId),
      eq(workflowRuns.status, "INTERRUPTED"),
      sql`${workflowRuns.productLinks}->>'activityId'=${activity.id}`,
    ));
    return cancelled;
  });
}

export function governedFollowupInterruptType(activityType: GovernedFollowupType): "LEARNER_FOLLOWUP_REQUIRED" {
  void activityType;
  return "LEARNER_FOLLOWUP_REQUIRED";
}
