import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  componentVersions,
  componentDeliveries,
  componentEvaluations,
  componentAssetPreviews,
  capabilityAvailabilityDecisions,
  components,
  capabilities,
  capabilityVersions,
  conversationEvents,
  courses,
  diagnosticObservations,
  evidenceUnits,
  fileAssets,
  governanceEvents,
  idempotencyKeys,
  learnerAttempts,
  libraryItems,
  learningEpisodes,
  learningOutcomes,
  learningTasks,
  retryAttempts,
  scheduleItems,
  sourceRecords,
  subjects,
  teacherReviews,
  publicationDecisions,
  workflowRuns,
  capabilityResolutions,
  capabilitySupplyRelations,
  activityPlanProposals,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import { ComponentContent, ComponentContract, ComponentHumanRubric, humanRubricPasses } from "@/domain/component";
import { authorizeEvidenceUnitInstitution, authorizePersistedEvidence, evidenceAlignsToCourse } from "@/domain/evidence";
import { parseReviewDecision, requireEligibleReviewDecision, requireVerifiedReviewProvenance } from "@/domain/review";
import { requireWritableGeneralEpisode } from "@/application/task-scope";
import {
  DomainInvariantError,
  requireCourseAccess,
  requireHumanCommand,
  requireReviewBeforeOutcome,
  requireRole,
} from "@/domain/invariants";
import { assertExecutionActive } from "@/application/execution-control";
import { CallableCapabilityResolutionContract } from "@/domain/capability-resolution";
import { SourceWebComponentAssetContract, SourceWebComponentAssetPackage, WebComponentAssetContract, WebComponentAssetPackage, webComponentAssetHash } from "@/domain/web-component-asset";
import { resolveCapabilityForSupplyRelation } from "@/application/capability-resolution";
import { planActivityForResolution } from "@/application/activity-planning";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function deterministicCommandResultId(commandType: string, requestHash: string): string {
  const digest = createHash("sha256").update(`${commandType}:${requestHash}`).digest("hex");
  const raw = digest.slice(0, 32).split("");
  raw[12] = "5";
  raw[16] = ((Number.parseInt(raw[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = raw.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export function commandRequestHash(actor: Pick<Actor, "userId">, commandType: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify({ actorUserId: actor.userId, commandType, input: canonical(input) })).digest("hex");
}

function assertReplay(existing: { commandType: string; requestHash: string; resultId: string } | undefined, commandType: string, requestHash: string): string {
  if (!existing) throw new DomainInvariantError("Idempotency reservation disappeared", "IDEMPOTENCY_INTEGRITY");
  if (existing.commandType !== commandType || existing.requestHash !== requestHash) {
    throw new DomainInvariantError("Idempotency key was reused with a different command or request", "IDEMPOTENCY_MISMATCH");
  }
  return existing.resultId;
}

function isObservationReviewConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const databaseError = current as { code?: string; constraint?: string; constraint_name?: string; cause?: unknown };
    if (
      databaseError.code === "23505"
      && (databaseError.constraint === "reviews_observation_uq" || databaseError.constraint_name === "reviews_observation_uq")
    ) return true;
    current = databaseError.cause;
  }
  return false;
}

async function insertCanonicalTeacherReview(
  insert: () => Promise<unknown>,
): Promise<void> {
  try {
    await insert();
  } catch (error) {
    if (isObservationReviewConflict(error)) {
      throw new DomainInvariantError("Observation already has a canonical TeacherReview", "REVIEW_CONFLICT");
    }
    throw error;
  }
}

function actorProvenance(actor: Actor) {
  return {
    userId: actor.userId,
    institutionId: actor.institutionId,
    roles: actor.roles,
    authMethod: actor.authMethod,
    sessionId: actor.sessionId,
    authenticatedAt: new Date().toISOString(),
  };
}

async function taskScope(taskId: string) {
  const [task] = await getDb().select().from(learningTasks).where(eq(learningTasks.id, taskId)).limit(1);
  if (!task) throw new DomainInvariantError("Learning Task not found", "TASK_NOT_FOUND");
  return task;
}

export async function resolveRetryAuthority(actor: Actor, input: { observationId: string; reviewId: string }) {
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  const [lineage] = await getDb().select({
    observation: diagnosticObservations,
    attempt: learnerAttempts,
    task: learningTasks,
  }).from(diagnosticObservations)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .where(eq(diagnosticObservations.id, input.observationId))
    .limit(1);
  if (!lineage) throw new DomainInvariantError("Observation not found", "OBSERVATION_NOT_FOUND");
  requireCourseAccess(actor, lineage.task.institutionId, lineage.task.courseId);
  const [review] = await getDb().select().from(teacherReviews).where(and(
    eq(teacherReviews.id, input.reviewId),
    eq(teacherReviews.observationId, lineage.observation.id),
  )).limit(1);
  if (!review) throw new DomainInvariantError("Retry requires a matching TeacherReview", "REVIEW_REQUIRED");
  const [currentReview] = await getDb().select().from(teacherReviews)
    .where(eq(teacherReviews.observationId, lineage.observation.id))
    .orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id))
    .limit(1);
  if (currentReview?.id !== review.id) throw new DomainInvariantError("Retry requires the current human Review", "STALE_REVIEW");
  requireVerifiedReviewProvenance(review, lineage.task.institutionId);
  requireEligibleReviewDecision(review.decision, "Retry");
  return {
    observation: lineage.observation,
    originalAttempt: lineage.attempt,
    task: lineage.task,
    review,
    taskId: lineage.task.id,
    episodeId: lineage.attempt.episodeId,
    learnerId: lineage.task.learnerId,
  };
}

export async function createTask(actor: Actor, input: { courseId: string; title: string; goal: string; idempotencyKey: string }) {
  requireRole(actor, ["LEARNER", "ADMIN"]);
  requireCourseAccess(actor, actor.institutionId, input.courseId);
  const taskId = randomUUID();
  const episodeId = randomUUID();
  const commandType = "CREATE_TASK";
  const requestHash = commandRequestHash(actor, commandType, { courseId: input.courseId, title: input.title, goal: input.goal });
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({
      institutionId: actor.institutionId,
      key: input.idempotencyKey,
      commandType,
      requestHash,
      resultId: taskId,
    }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      return { taskId: assertReplay(existing, commandType, requestHash), replayed: true };
    }
    await tx.insert(learningTasks).values({ id: taskId, institutionId: actor.institutionId, courseId: input.courseId, learnerId: actor.userId, title: input.title, goal: input.goal });
    await tx.insert(learningEpisodes).values({ id: episodeId, taskId, sequence: 1 });
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "LEARNING_TASK", entityId: taskId, action: "CREATED", payload: { episodeId, goal: input.goal } });
    return { taskId, episodeId, replayed: false };
  });
}

export async function closeTask(actor: Actor, taskId: string) {
  const task = await taskScope(taskId);
  requireCourseAccess(actor, task.institutionId, task.courseId);
  if (actor.roles.includes("LEARNER") && task.learnerId !== actor.userId) throw new DomainInvariantError("Learner cannot close another learner's Task", "TENANT_ISOLATION");
  if (task.status === "CLOSED") return;
  const [activeFollowup] = await getDb().select({ id: retryAttempts.id }).from(retryAttempts).where(and(
    eq(retryAttempts.taskId, taskId),
    sql`${retryAttempts.idempotencyKey} IS NOT NULL`,
    inArray(retryAttempts.status, ["ASSIGNED", "IN_PROGRESS", "WAITING_FOR_REVIEW", "FAILED_RECOVERABLE"]),
  )).limit(1);
  if (activeFollowup) {
    throw new DomainInvariantError("Cancel or finish the governed follow-up before closing this Task", "FOLLOWUP_ACTIVE");
  }
  await getDb().update(learningTasks).set({ status: "CLOSED", closedAt: new Date(), updatedAt: new Date() }).where(eq(learningTasks.id, taskId));
}

export async function appendConversationEvent(actor: Actor, input: { taskId: string; episodeId: string; kind: string; content: string; actorType?: string; sourceRefs?: Array<Record<string, string>>; evidenceRefs?: Array<Record<string, string>>; idempotencyKey: string }) {
  await requireWritableGeneralEpisode(actor, {
    taskId: input.taskId,
    episodeId: input.episodeId,
    learnerOriginated: input.actorType === "LEARNER" || actor.roles.includes("LEARNER"),
  });
  if (input.idempotencyKey.trim().length < 8) throw new DomainInvariantError("Conversation Event requires a stable command identity", "IDEMPOTENCY_KEY_REQUIRED");
  assertExecutionActive();
  const eventId = randomUUID();
  const commandType = "APPEND_CONVERSATION_EVENT";
  const { idempotencyKey, ...request } = input;
  void idempotencyKey;
  const requestHash = commandRequestHash(actor, commandType, {
    ...request,
    actorType: input.actorType ?? actor.roles[0],
    sourceRefs: input.sourceRefs ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
  });
  return getDb().transaction(async (tx) => {
    assertExecutionActive();
    const reserved = await tx.insert(idempotencyKeys).values({
      institutionId: actor.institutionId,
      key: input.idempotencyKey,
      commandType,
      requestHash,
      resultId: eventId,
    }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(
        eq(idempotencyKeys.institutionId, actor.institutionId),
        eq(idempotencyKeys.commandType, commandType),
        eq(idempotencyKeys.key, input.idempotencyKey),
      )).limit(1);
      const existingId = assertReplay(existing, commandType, requestHash);
      const [event] = await tx.select().from(conversationEvents).where(eq(conversationEvents.id, existingId)).limit(1);
      if (!event) throw new DomainInvariantError("Conversation Event replay target is missing", "IDEMPOTENCY_INTEGRITY");
      return { ...event, replayed: true };
    }
    assertExecutionActive();
    const [event] = await tx.insert(conversationEvents).values({
      id: eventId,
      taskId: input.taskId,
      episodeId: input.episodeId,
      actorUserId: actor.userId,
      actorType: input.actorType ?? actor.roles[0],
      kind: input.kind,
      content: input.content,
      sourceRefs: input.sourceRefs ?? [],
      evidenceRefs: input.evidenceRefs ?? [],
    }).returning();
    await tx.update(learningTasks).set({ updatedAt: new Date() }).where(eq(learningTasks.id, input.taskId));
    return { ...event, replayed: false };
  });
}

export async function captureAttempt(actor: Actor, input: {
  taskId: string;
  episodeId: string;
  capabilityId?: string;
  fileAssetId?: string;
  prompt: string;
  response: string;
  structuredInput: Record<string, unknown>;
  sourceRefs?: Array<Record<string, string>>;
  idempotencyKey?: string;
}) {
  assertExecutionActive();
  requireRole(actor, ["LEARNER", "ADMIN"]);
  const { task } = await requireWritableGeneralEpisode(actor, { taskId: input.taskId, episodeId: input.episodeId, learnerOriginated: true });
  if (input.fileAssetId) {
    const [asset] = await getDb().select().from(fileAssets).where(and(
      eq(fileAssets.id, input.fileAssetId),
      eq(fileAssets.taskId, task.id),
      eq(fileAssets.institutionId, task.institutionId),
      eq(fileAssets.courseId, task.courseId),
      eq(fileAssets.ownerUserId, task.learnerId),
      eq(fileAssets.purpose, "LEARNER_ATTEMPT"),
    )).limit(1);
    if (!asset) throw new DomainInvariantError("Attempt file does not belong to this Task, course, institution, and learner", "ATTEMPT_FILE_LINEAGE");
  }
  const attemptId = randomUUID();
  const commandType = "CAPTURE_ATTEMPT";
  const { idempotencyKey, ...request } = input;
  void idempotencyKey;
  const requestHash = commandRequestHash(actor, commandType, request);
  return getDb().transaction(async (tx) => {
    if (input.idempotencyKey) {
      const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: attemptId }).onConflictDoNothing().returning();
      if (!reserved.length) {
        const [existingKey] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
        const resultId = assertReplay(existingKey, commandType, requestHash);
        const [existingAttempt] = await tx.select().from(learnerAttempts).where(eq(learnerAttempts.id, resultId));
        if (!existingAttempt) throw new DomainInvariantError("Idempotency record has no Attempt", "IDEMPOTENCY_INTEGRITY");
        return existingAttempt;
      }
    }
    const attemptInput = request;
    return (await tx.insert(learnerAttempts).values({ id: attemptId, ...attemptInput, learnerId: task.learnerId, sourceRefs: input.sourceRefs ?? [] }).returning())[0];
  });
}

export async function persistDiagnosticObservation(input: {
  observationId?: string;
  attemptId: string;
  capabilityVersionId: string;
  result: {
    status: string;
    failureCode: string | null;
    firstInvalidStep: string | null;
    summary: string;
    [key: string]: unknown;
  };
  capabilityId: string;
}) {
  assertExecutionActive();
  const [attempt] = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.id, input.attemptId)).limit(1);
  if (!attempt) throw new DomainInvariantError("Diagnosis requires a real LearnerAttempt", "ATTEMPT_REQUIRED");
  const [existing] = await getDb().select().from(diagnosticObservations).where(and(
    eq(diagnosticObservations.attemptId, input.attemptId),
    eq(diagnosticObservations.capabilityVersionId, input.capabilityVersionId),
  )).orderBy(desc(diagnosticObservations.createdAt)).limit(1);
  if (existing) {
    if (input.observationId && existing.id !== input.observationId) {
      throw new DomainInvariantError("Diagnosis replay identity conflicts with persisted Product State", "DIAGNOSIS_REPLAY_CONFLICT");
    }
    return existing;
  }
  const [observation] = await getDb().insert(diagnosticObservations).values({
    ...(input.observationId ? { id: input.observationId } : {}),
    attemptId: attempt.id,
    capabilityVersionId: input.capabilityVersionId,
    status: input.result.status === "CORRECT" ? "READY_FOR_REVIEW" : "NEEDS_REVIEW",
    failureCode: input.result.failureCode,
    firstInvalidStep: input.result.firstInvalidStep,
    summary: input.result.summary,
    structuredResult: input.result,
    inputLineage: { attemptId: attempt.id, capabilityId: input.capabilityId, structuredInput: attempt.structuredInput },
    outputLineage: { capabilityVersionId: input.capabilityVersionId, deterministic: true },
  }).returning();
  return observation;
}

export async function persistUnavailableObservation(input: { attemptId: string; reason: string }) {
  assertExecutionActive();
  const [attempt] = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.id, input.attemptId)).limit(1);
  if (!attempt) throw new DomainInvariantError("Observation requires a real LearnerAttempt", "ATTEMPT_REQUIRED");
  const [existing] = await getDb().select().from(diagnosticObservations).where(and(
    eq(diagnosticObservations.attemptId, attempt.id),
    eq(diagnosticObservations.observationSource, "CAPABILITY_UNAVAILABLE"),
  )).limit(1);
  if (existing) return existing;
  const [observation] = await getDb().insert(diagnosticObservations).values({
    attemptId: attempt.id,
    capabilityVersionId: null,
    observationSource: "CAPABILITY_UNAVAILABLE",
    status: "REVIEW_REQUIRED",
    failureCode: null,
    firstInvalidStep: null,
    summary: "Automated Diagnosis is unavailable; an authorized teacher must inspect the LearnerAttempt directly.",
    structuredResult: { serviceStatus: "UNAVAILABLE", reason: input.reason, diagnosticClaim: false },
    inputLineage: { attemptId: attempt.id },
    outputLineage: { capabilityExecuted: false },
  }).returning();
  return observation;
}

export async function createTeacherReview(actor: Actor, input: {
  observationId: string;
  decision: unknown;
  correction?: string;
  supplement?: string;
  teachingSupport: string;
  idempotencyKey: string;
}, options: { deterministicResultId?: boolean; requestContext?: Record<string, unknown> } = {}) {
  assertExecutionActive();
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  const decision = parseReviewDecision(input);
  const observationId = input.observationId;
  const rows = await getDb().select({ task: learningTasks }).from(learnerAttempts)
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .innerJoin(diagnosticObservations, eq(diagnosticObservations.attemptId, learnerAttempts.id))
    .where(eq(diagnosticObservations.id, observationId)).limit(1);
  const task = rows[0]?.task;
  if (!task) throw new DomainInvariantError("Diagnostic Observation not found", "OBSERVATION_NOT_FOUND");
  requireCourseAccess(actor, task.institutionId, task.courseId);
  const commandType = "TEACHER_REVIEW";
  const requestHash = commandRequestHash(actor, commandType, {
    ...input,
    ...decision,
    idempotencyKey: undefined,
    requestContext: options.requestContext,
  });
  const reviewId = options.deterministicResultId
    ? deterministicCommandResultId(commandType, requestHash)
    : randomUUID();
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: reviewId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      return { reviewId: assertReplay(existing, commandType, requestHash), replayed: true };
    }
    const { idempotencyKey: _idempotencyKey, decision: _decision, correction: _correction, supplement: _supplement, ...reviewInput } = input;
    void _idempotencyKey;
    void _decision;
    void _correction;
    void _supplement;
    await insertCanonicalTeacherReview(() => tx.insert(teacherReviews).values({ id: reviewId, ...reviewInput, ...decision, idempotencyKey: input.idempotencyKey, teacherId: actor.userId, actorProvenance: actorProvenance(actor) }));
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "TEACHER_REVIEW", entityId: reviewId, action: decision.decision, payload: { observationId, correction: decision.correction, supplement: decision.supplement } });
    return { reviewId, replayed: false };
  });
}

export async function createRetry(actor: Actor, input: { observationId: string; reviewId: string; activityType: "RETRY"; prompt: string; scheduledFor?: Date; idempotencyKey: string }) {
  assertExecutionActive();
  const authority = await resolveRetryAuthority(actor, input);
  const retryId = randomUUID();
  const commandType = "CREATE_RETRY";
  const requestHash = commandRequestHash(actor, commandType, { ...input, idempotencyKey: undefined, scheduledFor: input.scheduledFor?.toISOString() });
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: retryId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      const [retry] = await tx.select().from(retryAttempts).where(eq(retryAttempts.id, assertReplay(existing, commandType, requestHash))).limit(1);
      if (!retry) throw new DomainInvariantError("Idempotency record has no Retry", "IDEMPOTENCY_INTEGRITY");
      return retry;
    }
    const [retry] = await tx.insert(retryAttempts).values({
      id: retryId,
      originalAttemptId: authority.originalAttempt.id,
      reviewedObservationId: authority.observation.id,
      teacherReviewId: authority.review.id,
      activityType: "RETRY",
      prompt: input.prompt,
      scheduledFor: input.scheduledFor,
    }).returning();
    return retry;
  });
}

export async function linkRetryResult(actor: Actor, input: { retryId: string; resultAttemptId: string; resultObservationId: string; resultReviewId: string }) {
  assertExecutionActive();
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  const [lineage] = await getDb().select({ retry: retryAttempts, originalAttempt: learnerAttempts, task: learningTasks })
    .from(retryAttempts)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, retryAttempts.originalAttemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .where(eq(retryAttempts.id, input.retryId))
    .limit(1);
  if (!lineage) throw new DomainInvariantError("Retry not found", "RETRY_NOT_FOUND");
  requireCourseAccess(actor, lineage.task.institutionId, lineage.task.courseId);
  const [assignmentObservation] = await getDb().select().from(diagnosticObservations).where(and(
    eq(diagnosticObservations.id, lineage.retry.reviewedObservationId),
    eq(diagnosticObservations.attemptId, lineage.originalAttempt.id),
  )).limit(1);
  const [assignmentReview] = await getDb().select().from(teacherReviews).where(and(
    eq(teacherReviews.id, lineage.retry.teacherReviewId),
    eq(teacherReviews.observationId, lineage.retry.reviewedObservationId),
  )).limit(1);
  if (!assignmentObservation || !assignmentReview) throw new DomainInvariantError("Retry assignment lineage is invalid", "RETRY_LINEAGE_INVALID");
  requireVerifiedReviewProvenance(assignmentReview, lineage.task.institutionId);
  requireEligibleReviewDecision(assignmentReview.decision, "Retry result");
  const [currentAssignmentReview] = await getDb().select().from(teacherReviews)
    .where(eq(teacherReviews.observationId, lineage.retry.reviewedObservationId))
    .orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
  if (currentAssignmentReview?.id !== assignmentReview.id) throw new DomainInvariantError("Retry assignment Review is stale", "STALE_REVIEW");
  const [resultLineage] = await getDb().select({ attempt: learnerAttempts, task: learningTasks })
    .from(learnerAttempts)
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .where(eq(learnerAttempts.id, input.resultAttemptId)).limit(1);
  if (
    !resultLineage
    || resultLineage.task.id !== lineage.task.id
    || resultLineage.attempt.episodeId !== lineage.originalAttempt.episodeId
    || resultLineage.attempt.learnerId !== lineage.originalAttempt.learnerId
    || resultLineage.task.learnerId !== lineage.task.learnerId
    || resultLineage.task.courseId !== lineage.task.courseId
    || resultLineage.task.institutionId !== lineage.task.institutionId
  ) throw new DomainInvariantError("Retry result Task, Episode, learner, course or institution lineage is invalid", "RETRY_LINEAGE_INVALID");
  const [observation] = await getDb().select().from(diagnosticObservations).where(and(eq(diagnosticObservations.id, input.resultObservationId), eq(diagnosticObservations.attemptId, resultLineage.attempt.id))).limit(1);
  const [review] = await getDb().select().from(teacherReviews).where(and(eq(teacherReviews.id, input.resultReviewId), eq(teacherReviews.observationId, input.resultObservationId))).limit(1);
  if (!observation || !review || review.teacherId !== actor.userId) throw new DomainInvariantError("Retry result, Observation and Review lineage must match", "RETRY_LINEAGE_INVALID");
  requireVerifiedReviewProvenance(review, lineage.task.institutionId);
  const [currentReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, observation.id)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
  if (currentReview?.id !== review.id) throw new DomainInvariantError("Retry result requires its current human Review", "STALE_REVIEW");
  const decision = parseReviewDecision(review).decision;
  const [result] = await getDb().update(retryAttempts).set({
    resultAttemptId: input.resultAttemptId,
    resultObservationId: input.resultObservationId,
    resultReviewId: input.resultReviewId,
    status: decision === "ESCALATE" ? "ESCALATED" : "REVIEWED",
  }).where(and(eq(retryAttempts.id, input.retryId), eq(retryAttempts.status, "ASSIGNED"))).returning();
  if (!result) throw new DomainInvariantError("Retry result was already linked", "RETRY_RESULT_CONFLICT");
  return result;
}

type RetryResultReviewBase = {
  retryId: string;
  resultAttemptId: string;
  resultObservationId: string;
  teachingSupport: string;
  reviewIdempotencyKey: string;
};

type GovernedOutcomeInput = {
  outcomeStatus: "IMPROVED" | "MASTERED" | "NEEDS_SUPPORT";
  outcomeNarrative: string;
  outcomeIdempotencyKey: string;
};

export type RetryResultReviewCommand = RetryResultReviewBase & (
  | { decision: "ESCALATE" }
  | ({ decision: "ACCEPT" } & GovernedOutcomeInput)
  | ({ decision: "CORRECT"; correction: string } & GovernedOutcomeInput)
  | ({ decision: "SUPPLEMENT"; supplement: string } & GovernedOutcomeInput)
);

export async function reviewRetryResult(actor: Actor, input: RetryResultReviewCommand) {
  assertExecutionActive();
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  const decision = parseReviewDecision(input);
  const outcomeInput = input.decision === "ESCALATE" ? null : {
    status: input.outcomeStatus,
    narrative: input.outcomeNarrative,
    idempotencyKey: input.outcomeIdempotencyKey,
  };
  const reviewId = randomUUID();
  const reviewCommandType = "RETRY_RESULT_REVIEW";
  const reviewRequestHash = commandRequestHash(actor, reviewCommandType, {
    retryId: input.retryId,
    resultAttemptId: input.resultAttemptId,
    resultObservationId: input.resultObservationId,
    decision,
    teachingSupport: input.teachingSupport,
  });

  return getDb().transaction(async (tx) => {
    const [lineage] = await tx.select({ retry: retryAttempts, originalAttempt: learnerAttempts, task: learningTasks })
      .from(retryAttempts)
      .innerJoin(learnerAttempts, eq(learnerAttempts.id, retryAttempts.originalAttemptId))
      .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
      .where(eq(retryAttempts.id, input.retryId))
      .limit(1);
    if (!lineage) throw new DomainInvariantError("Retry not found", "RETRY_NOT_FOUND");
    requireCourseAccess(actor, lineage.task.institutionId, lineage.task.courseId);

    const [assignmentObservation] = await tx.select().from(diagnosticObservations).where(and(
      eq(diagnosticObservations.id, lineage.retry.reviewedObservationId),
      eq(diagnosticObservations.attemptId, lineage.originalAttempt.id),
    )).limit(1);
    const [assignmentReview] = await tx.select().from(teacherReviews).where(and(
      eq(teacherReviews.id, lineage.retry.teacherReviewId),
      eq(teacherReviews.observationId, lineage.retry.reviewedObservationId),
    )).limit(1);
    if (!assignmentObservation || !assignmentReview) throw new DomainInvariantError("Retry assignment lineage is invalid", "RETRY_LINEAGE_INVALID");
    requireVerifiedReviewProvenance(assignmentReview, lineage.task.institutionId);
    requireEligibleReviewDecision(assignmentReview.decision, "Retry result");
    const [currentAssignmentReview] = await tx.select().from(teacherReviews)
      .where(eq(teacherReviews.observationId, lineage.retry.reviewedObservationId))
      .orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
    if (currentAssignmentReview?.id !== assignmentReview.id) throw new DomainInvariantError("Retry assignment Review is stale", "STALE_REVIEW");

    const [resultLineage] = await tx.select({ attempt: learnerAttempts, task: learningTasks })
      .from(learnerAttempts)
      .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
      .where(eq(learnerAttempts.id, input.resultAttemptId)).limit(1);
    if (
      !resultLineage
      || resultLineage.task.id !== lineage.task.id
      || resultLineage.attempt.episodeId !== lineage.originalAttempt.episodeId
      || resultLineage.attempt.learnerId !== lineage.originalAttempt.learnerId
      || resultLineage.task.learnerId !== lineage.task.learnerId
      || resultLineage.task.courseId !== lineage.task.courseId
      || resultLineage.task.institutionId !== lineage.task.institutionId
    ) throw new DomainInvariantError("Retry result Task, Episode, learner, course or institution lineage is invalid", "RETRY_LINEAGE_INVALID");
    const [resultObservation] = await tx.select().from(diagnosticObservations).where(and(
      eq(diagnosticObservations.id, input.resultObservationId),
      eq(diagnosticObservations.attemptId, input.resultAttemptId),
    )).limit(1);
    if (!resultObservation) throw new DomainInvariantError("Retry result Observation lineage is invalid", "RETRY_LINEAGE_INVALID");

    const reservedReview = await tx.insert(idempotencyKeys).values({
      institutionId: actor.institutionId,
      key: input.reviewIdempotencyKey,
      commandType: reviewCommandType,
      requestHash: reviewRequestHash,
      resultId: reviewId,
    }).onConflictDoNothing().returning();
    if (!reservedReview.length) {
      const [existingReviewKey] = await tx.select().from(idempotencyKeys).where(and(
        eq(idempotencyKeys.institutionId, actor.institutionId),
        eq(idempotencyKeys.commandType, reviewCommandType),
        eq(idempotencyKeys.key, input.reviewIdempotencyKey),
      ));
      const existingReviewId = assertReplay(existingReviewKey, reviewCommandType, reviewRequestHash);
      const [existingRetry] = await tx.select().from(retryAttempts).where(and(eq(retryAttempts.id, input.retryId), eq(retryAttempts.resultReviewId, existingReviewId))).limit(1);
      if (!existingRetry) throw new DomainInvariantError("Idempotent retry Review has no linked Retry", "IDEMPOTENCY_INTEGRITY");
      if (!outcomeInput) return { reviewId: existingReviewId, outcomeId: undefined, status: "ESCALATED" as const, replayed: true };
      const outcomeCommandType = "LEARNING_OUTCOME";
      const outcomeRequestHash = commandRequestHash(actor, outcomeCommandType, { retryId: input.retryId, status: outcomeInput.status, narrative: outcomeInput.narrative, resultReviewId: existingReviewId });
      const [existingOutcomeKey] = await tx.select().from(idempotencyKeys).where(and(
        eq(idempotencyKeys.institutionId, actor.institutionId),
        eq(idempotencyKeys.commandType, outcomeCommandType),
        eq(idempotencyKeys.key, outcomeInput.idempotencyKey),
      ));
      return { reviewId: existingReviewId, outcomeId: assertReplay(existingOutcomeKey, outcomeCommandType, outcomeRequestHash), status: "COMPLETED" as const, replayed: true };
    }
    if (lineage.retry.status !== "ASSIGNED" || lineage.retry.resultAttemptId || lineage.retry.resultObservationId || lineage.retry.resultReviewId) {
      throw new DomainInvariantError("Retry result was already linked", "RETRY_RESULT_CONFLICT");
    }

    let outcomeId: string | undefined;
    if (outcomeInput) {
      outcomeId = randomUUID();
      const outcomeCommandType = "LEARNING_OUTCOME";
      const outcomeRequestHash = commandRequestHash(actor, outcomeCommandType, { retryId: input.retryId, status: outcomeInput.status, narrative: outcomeInput.narrative, resultReviewId: reviewId });
      const reservedOutcome = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: outcomeInput.idempotencyKey, commandType: outcomeCommandType, requestHash: outcomeRequestHash, resultId: outcomeId }).onConflictDoNothing().returning();
      if (!reservedOutcome.length) {
        const [existingOutcomeKey] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, outcomeCommandType), eq(idempotencyKeys.key, outcomeInput.idempotencyKey)));
        assertReplay(existingOutcomeKey, outcomeCommandType, outcomeRequestHash);
        throw new DomainInvariantError("Outcome idempotency key is already bound to another transition", "IDEMPOTENCY_INTEGRITY");
      }
    }

    await insertCanonicalTeacherReview(() => tx.insert(teacherReviews).values({
      id: reviewId,
      observationId: resultObservation.id,
      teacherId: actor.userId,
      decision: decision.decision,
      correction: decision.correction,
      supplement: decision.supplement,
      teachingSupport: input.teachingSupport,
      actorProvenance: actorProvenance(actor),
      idempotencyKey: input.reviewIdempotencyKey,
    }));
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "TEACHER_REVIEW", entityId: reviewId, action: decision.decision, payload: { observationId: resultObservation.id, correction: decision.correction, supplement: decision.supplement } });
    const [linkedRetry] = await tx.update(retryAttempts).set({
      resultAttemptId: resultLineage.attempt.id,
      resultObservationId: resultObservation.id,
      resultReviewId: reviewId,
      status: decision.decision === "ESCALATE" ? "ESCALATED" : "REVIEWED",
    }).where(and(eq(retryAttempts.id, input.retryId), eq(retryAttempts.status, "ASSIGNED"))).returning();
    if (!linkedRetry) throw new DomainInvariantError("Retry result was concurrently linked", "RETRY_RESULT_CONFLICT");

    if (!outcomeInput || !outcomeId) return { reviewId, outcomeId: undefined, status: "ESCALATED" as const, replayed: false };
    const evidenceRefs: Array<Record<string, string>> = [
      { kind: "ATTEMPT", learnerAttemptId: resultLineage.attempt.id },
      { kind: "DIAGNOSIS", diagnosticObservationId: resultObservation.id },
      { kind: "REVIEW", teacherReviewId: reviewId },
    ];
    await tx.insert(learningOutcomes).values({
      id: outcomeId,
      taskId: lineage.task.id,
      retryId: lineage.retry.id,
      resultReviewId: reviewId,
      teacherId: actor.userId,
      outcomeType: "RETRY",
      status: outcomeInput.status,
      evidenceRefs,
      narrative: outcomeInput.narrative,
      actorProvenance: actorProvenance(actor),
      idempotencyKey: outcomeInput.idempotencyKey,
    });
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "LEARNING_OUTCOME", entityId: outcomeId, action: "RECORDED", payload: { retryId: lineage.retry.id, status: outcomeInput.status } });
    return { reviewId, outcomeId, status: "COMPLETED" as const, replayed: false };
  });
}

export async function addLibraryItem(actor: Actor, input: { courseId: string; evidenceUnitId: string; title: string; reason: string; idempotencyKey: string }) {
  assertExecutionActive();
  requireRole(actor, ["LEARNER", "ADMIN"]);
  requireCourseAccess(actor, actor.institutionId, input.courseId);
  const [scope] = await getDb().select({ course: courses, subject: subjects, evidence: evidenceUnits, source: sourceRecords })
    .from(courses)
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .innerJoin(evidenceUnits, eq(evidenceUnits.id, input.evidenceUnitId))
    .innerJoin(sourceRecords, eq(sourceRecords.id, evidenceUnits.sourceId))
    .where(eq(courses.id, input.courseId))
    .limit(1);
  if (!scope || scope.course.institutionId !== actor.institutionId || !scope.source.active) {
    throw new DomainInvariantError("Evidence is not available for this course", "EVIDENCE_COURSE_DENIED");
  }
  authorizePersistedEvidence(actor, scope.source, "LEARNING");
  authorizeEvidenceUnitInstitution(actor, scope.evidence.institutionId);
  if (!evidenceAlignsToCourse(scope.evidence.metadata, scope.course.id, scope.subject.referencePackKey)) {
    throw new DomainInvariantError("Evidence has no explicit course or Reference Pack alignment", "EVIDENCE_COURSE_DENIED");
  }
  const learnerId = actor.userId;
  const itemId = randomUUID();
  const commandType = "ADD_LIBRARY_ITEM";
  const requestHash = commandRequestHash(actor, commandType, { learnerId, courseId: input.courseId, evidenceUnitId: input.evidenceUnitId, title: input.title, reason: input.reason });
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: itemId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existingKey] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      const resultId = assertReplay(existingKey, commandType, requestHash);
      const [existingItem] = await tx.select().from(libraryItems).where(eq(libraryItems.id, resultId));
      if (!existingItem) throw new DomainInvariantError("Idempotency record has no Library item", "IDEMPOTENCY_INTEGRITY");
      if (existingItem.learnerId !== actor.userId) throw new DomainInvariantError("Library replay belongs to another learner", "IDEMPOTENCY_SCOPE_MISMATCH");
      return { ...existingItem, replayed: true };
    }
    const [item] = await tx.insert(libraryItems).values({ id: itemId, learnerId, courseId: input.courseId, evidenceUnitId: input.evidenceUnitId, title: input.title, reason: input.reason }).returning();
    return { ...item, replayed: false };
  });
}

export async function scheduleStudyReview(actor: Actor, input: { taskId: string; dueAt: Date; idempotencyKey: string }) {
  assertExecutionActive();
  requireRole(actor, ["LEARNER", "ADMIN"]);
  const task = await taskScope(input.taskId);
  requireCourseAccess(actor, task.institutionId, task.courseId);
  if (task.learnerId !== actor.userId && !actor.roles.includes("ADMIN")) throw new DomainInvariantError("Learner cannot schedule another learner's Task", "TENANT_ISOLATION");
  const itemId = randomUUID();
  const commandType = "SCHEDULE_STUDY_REVIEW";
  const requestHash = commandRequestHash(actor, commandType, { taskId: input.taskId, activityType: "STUDY_REVIEW", dueAt: input.dueAt.toISOString() });
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: itemId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existingKey] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      const resultId = assertReplay(existingKey, commandType, requestHash);
      const [existingItem] = await tx.select().from(scheduleItems).where(eq(scheduleItems.id, resultId));
      if (!existingItem) throw new DomainInvariantError("Idempotency record has no Study Review item", "IDEMPOTENCY_INTEGRITY");
      return { ...existingItem, replayed: true };
    }
    const [item] = await tx.insert(scheduleItems).values({ id: itemId, learnerId: task.learnerId, taskId: input.taskId, activityType: "STUDY_REVIEW", dueAt: input.dueAt }).returning();
    return { ...item, replayed: false };
  });
}

export async function createOutcome(actor: Actor, input: { retryId: string; status: string; narrative: string; idempotencyKey: string }) {
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  const [retry] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, input.retryId)).limit(1);
  if (!retry) throw new DomainInvariantError("Retry not found", "RETRY_NOT_FOUND");
  if (retry.activityType !== "RETRY") throw new DomainInvariantError("Only RETRY Outcomes are available in Checkpoint A", "ACTIVITY_TYPE_UNAVAILABLE");
  if (!retry.resultAttemptId || !retry.resultObservationId) throw new DomainInvariantError("Outcome requires a real retry Attempt and Observation", "RETRY_RESULT_REQUIRED");
  requireReviewBeforeOutcome(retry.resultReviewId);
  const [resultObservation] = await getDb().select().from(diagnosticObservations).where(and(eq(diagnosticObservations.id, retry.resultObservationId), eq(diagnosticObservations.attemptId, retry.resultAttemptId))).limit(1);
  if (!resultObservation) throw new DomainInvariantError("Retry Observation does not match the result Attempt", "RETRY_LINEAGE_INVALID");
  const [currentReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, resultObservation.id)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
  if (!currentReview || currentReview.id !== retry.resultReviewId) throw new DomainInvariantError("Outcome requires the current human Review of the retry Observation", "STALE_REVIEW");
  requireEligibleReviewDecision(currentReview.decision, "LearningOutcome");
  const [attempt] = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.id, retry.originalAttemptId)).limit(1);
  const task = await taskScope(attempt.taskId);
  requireCourseAccess(actor, task.institutionId, task.courseId);
  requireVerifiedReviewProvenance(currentReview, task.institutionId);
  const [resultAttempt] = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.id, retry.resultAttemptId)).limit(1);
  if (!resultAttempt || resultAttempt.taskId !== task.id || resultAttempt.episodeId !== attempt.episodeId || resultAttempt.learnerId !== attempt.learnerId) {
    throw new DomainInvariantError("Outcome retry lineage is invalid", "RETRY_LINEAGE_INVALID");
  }
  const [assignmentReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.id, retry.teacherReviewId)).limit(1);
  if (!assignmentReview || assignmentReview.observationId !== retry.reviewedObservationId) throw new DomainInvariantError("Outcome assignment Review lineage is invalid", "RETRY_LINEAGE_INVALID");
  requireVerifiedReviewProvenance(assignmentReview, task.institutionId);
  requireEligibleReviewDecision(assignmentReview.decision, "LearningOutcome");
  const outcomeId = randomUUID();
  const commandType = "LEARNING_OUTCOME";
  const requestHash = commandRequestHash(actor, commandType, { retryId: input.retryId, status: input.status, narrative: input.narrative, resultReviewId: currentReview.id });
  const evidenceRefs: Array<Record<string, string>> = [
    { kind: "ATTEMPT", learnerAttemptId: retry.resultAttemptId },
    { kind: "DIAGNOSIS", diagnosticObservationId: resultObservation.id },
    { kind: "REVIEW", teacherReviewId: currentReview.id },
  ];
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: outcomeId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      return { outcomeId: assertReplay(existing, commandType, requestHash), replayed: true };
    }
    const { idempotencyKey: _idempotencyKey, retryId: _retryId, ...outcomeInput } = input;
    void _idempotencyKey;
    void _retryId;
    await tx.insert(learningOutcomes).values({ id: outcomeId, taskId: task.id, retryId: retry.id, resultReviewId: currentReview.id, teacherId: actor.userId, outcomeType: "RETRY", evidenceRefs, idempotencyKey: input.idempotencyKey, actorProvenance: actorProvenance(actor), ...outcomeInput });
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "LEARNING_OUTCOME", entityId: outcomeId, action: "RECORDED", payload: { retryId: retry.id, status: input.status } });
    return { outcomeId, replayed: false };
  });
}

export async function createComponentCandidate(actor: Actor, input: {
  observationId: string;
  key: string;
  title: string;
  purpose: string;
  content: Record<string, unknown>;
  idempotencyKey: string;
}) {
  requireRole(actor, ["TEACHER", "EXPERT", "ADMIN"]);
  const rows = await getDb().select({ observation: diagnosticObservations, attempt: learnerAttempts, task: learningTasks, course: courses, subject: subjects, capability: capabilities }).from(diagnosticObservations)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .innerJoin(courses, eq(courses.id, learningTasks.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .leftJoin(capabilities, eq(capabilities.id, learnerAttempts.capabilityId))
    .where(and(
      eq(diagnosticObservations.id, input.observationId),
      eq(learningTasks.institutionId, actor.institutionId),
      inArray(learningTasks.courseId, actor.courseIds),
    )).limit(1);
  const lineage = rows[0];
  if (!lineage) throw new DomainInvariantError("Candidate Observation was not found in the actor's authorized scope", "OBSERVATION_NOT_FOUND");
  requireCourseAccess(actor, lineage.task.institutionId, lineage.task.courseId);
  const capability = lineage.capability;
  if (
    lineage.observation.supersededById
    || lineage.observation.observationSource !== "CAPABILITY"
    || !lineage.observation.failureCode
    || !lineage.attempt.capabilityId
    || !capability
  ) {
    throw new DomainInvariantError("Component Draft requires a real capability failure signal; unavailable or null-code observations are ineligible", "COMPONENT_SIGNAL_INELIGIBLE");
  }
  if (capability.activeVersionId !== lineage.observation.capabilityVersionId || capability.referencePackKey !== lineage.subject.referencePackKey) {
    throw new DomainInvariantError("Component signal does not bind the active persisted Capability and Reference Pack", "COMPONENT_BINDING_INVALID");
  }
  const [review] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, input.observationId)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
  if (!review) throw new DomainInvariantError("Component candidate requires a current human TeacherReview", "REVIEW_REQUIRED");
  requireVerifiedReviewProvenance(review, lineage.task.institutionId);
  requireEligibleReviewDecision(review.decision, "Component candidate");
  const content = ComponentContent.parse(input.content);
  const contract = ComponentContract.parse({
    title: input.title,
    purpose: input.purpose,
    capabilityId: capability.id,
    capabilityKey: capability.key,
    referencePackKey: lineage.subject.referencePackKey,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    evidenceRequirements: ["DiagnosticObservation", "TeacherReview"],
    evidencePolicy: content.evidenceRefs.length > 0 ? "REQUIRED" : "NOT_REQUIRED_DETERMINISTIC_SCAFFOLD",
    humanReviewRequired: true,
  });
  const componentId = randomUUID();
  const versionId = randomUUID();
  const contentHash = createHash("sha256").update(JSON.stringify({ contract, content })).digest("hex");
  const commandType = "COMPONENT_CANDIDATE";
  const requestHash = commandRequestHash(actor, commandType, { ...input, idempotencyKey: undefined, reviewId: review.id });
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: componentId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      return { componentId: assertReplay(existing, commandType, requestHash), replayed: true };
    }
    await tx.execute(sql`SELECT set_config('foundry.governance_command', 'component_candidate', true)`);
    await tx.insert(components).values({
      id: componentId,
      institutionId: actor.institutionId,
      courseId: lineage.task.courseId,
      capabilityId: capability.id,
      referencePackKey: lineage.subject.referencePackKey,
      failureCode: lineage.observation.failureCode,
      key: input.key,
      title: input.title,
      sourceSignal: { observationId: input.observationId, reviewId: review.id, attemptId: lineage.attempt.id, capabilityVersionId: lineage.observation.capabilityVersionId, failureCode: lineage.observation.failureCode },
      createdBy: actor.userId,
    });
    await tx.insert(componentVersions).values({ id: versionId, componentId, version: "0.1.0", contract, content, sourceObservationIds: [input.observationId], sourceReviewIds: [review.id], validation: { status: "PENDING_SYSTEM_EVALUATION" }, status: "DRAFT", contentHash, createdBy: actor.userId });
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "COMPONENT", entityId: componentId, action: "CANDIDATE_CREATED", payload: { versionId, observationId: input.observationId, reviewId: review.id, attemptId: lineage.attempt.id, capabilityId: capability.id, failureCode: lineage.observation.failureCode } });
    return { componentId, versionId, replayed: false };
  });
}

function nextComponentVersion(versions: string[]): string {
  const greatestMinor = versions.reduce((greatest, version) => {
    const match = /^0\.(\d+)\.0$/.exec(version);
    return match ? Math.max(greatest, Number(match[1])) : greatest;
  }, 0);
  return `0.${greatestMinor + 1}.0`;
}

export async function updateComponentVersion(actor: Actor, input: { componentId: string; componentVersionId: string; title: string; purpose: string; content: Record<string, unknown>; idempotencyKey: string }) {
  requireRole(actor, ["EXPERT", "ADMIN"]);
  const [row] = await getDb().select({ component: components, version: componentVersions }).from(components)
    .innerJoin(componentVersions, eq(componentVersions.componentId, components.id))
    .where(and(eq(components.id, input.componentId), eq(componentVersions.id, input.componentVersionId), eq(components.institutionId, actor.institutionId)))
    .limit(1);
  if (!row) throw new DomainInvariantError("Component version is outside the active institution", "TENANT_ISOLATION");
  const content = ComponentContent.parse(input.content);
  const commandType = "UPDATE_COMPONENT_VERSION";
  const successorId = randomUUID();
  return getDb().transaction(async (tx) => {
    const [lockedComponent] = await tx.select().from(components).where(and(eq(components.id, row.component.id), eq(components.institutionId, actor.institutionId))).for("update").limit(1);
    const [current] = await tx.select().from(componentVersions).where(and(eq(componentVersions.id, row.version.id), eq(componentVersions.componentId, row.component.id))).for("update").limit(1);
    if (!lockedComponent || !current) throw new DomainInvariantError("Component version disappeared or changed lineage", "COMPONENT_VERSION_LINEAGE");
    const contract = ComponentContract.parse({
      ...current.contract,
      title: input.title,
      purpose: input.purpose,
      evidencePolicy: content.evidenceRefs.length > 0 ? "REQUIRED" : "NOT_REQUIRED_DETERMINISTIC_SCAFFOLD",
    });
    if (contract.capabilityId !== lockedComponent.capabilityId || contract.referencePackKey !== lockedComponent.referencePackKey) {
      throw new DomainInvariantError("A successor cannot change the governed Capability or Reference Pack binding", "COMPONENT_BINDING_INVALID");
    }
    const contentHash = createHash("sha256").update(JSON.stringify({ contract, content })).digest("hex");
    const requestHash = commandRequestHash(actor, commandType, { componentId: input.componentId, componentVersionId: input.componentVersionId, contract, content });
    const resultId = current.status === "DRAFT" ? current.id : successorId;
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      return { componentVersionId: assertReplay(existing, commandType, requestHash), replayed: true };
    }
    if (current.status === "DRAFT") {
      const [updated] = await tx.update(componentVersions).set({ contract, content, contentHash, validation: { status: "PENDING_SYSTEM_EVALUATION" }, evalResult: null })
        .where(and(eq(componentVersions.id, current.id), eq(componentVersions.status, "DRAFT"))).returning();
      if (!updated) throw new DomainInvariantError("Draft changed during update", "COMPONENT_VERSION_CONFLICT");
      if (!lockedComponent.activeVersionId) await tx.update(components).set({ title: contract.title }).where(eq(components.id, lockedComponent.id));
      await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "COMPONENT_VERSION", entityId: current.id, action: "DRAFT_UPDATED", payload: { componentId: row.component.id, contentHash } });
      return { componentVersionId: current.id, replayed: false, createdSuccessor: false };
    }
    const versionRows = await tx.select({ version: componentVersions.version }).from(componentVersions).where(eq(componentVersions.componentId, row.component.id));
    const successorVersion = nextComponentVersion(versionRows.map((item) => item.version));
    await tx.execute(sql`SELECT set_config('foundry.governance_command', 'component_successor', true)`);
    await tx.insert(componentVersions).values({
      id: successorId,
      componentId: row.component.id,
      version: successorVersion,
      successorOfVersionId: current.id,
      contract,
      content,
      sourceObservationIds: current.sourceObservationIds,
      sourceReviewIds: current.sourceReviewIds,
      validation: { status: "PENDING_SYSTEM_EVALUATION" },
      status: "DRAFT",
      contentHash,
      createdBy: actor.userId,
    });
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "COMPONENT_VERSION", entityId: successorId, action: "SUCCESSOR_CREATED", payload: { componentId: row.component.id, successorOfVersionId: current.id, version: successorVersion, contentHash } });
    return { componentVersionId: successorId, replayed: false, createdSuccessor: true };
  });
}

export type PublicationDependencies = {
  resolveCapability: typeof resolveCapabilityForSupplyRelation;
  planActivity: typeof planActivityForResolution;
  beforeReplan?: () => void | Promise<void>;
};

const publicationDependencies: PublicationDependencies = {
  resolveCapability: resolveCapabilityForSupplyRelation,
  planActivity: planActivityForResolution,
};

export async function decidePublication(actor: Actor, input: {
  componentVersionId: string;
  evaluationId: string;
  workflowThreadId: string;
  action: "APPROVE" | "REJECT";
  rationale: string;
  rubric: Record<string, unknown>;
  idempotencyKey: string;
}, dependencies: PublicationDependencies = publicationDependencies) {
  assertExecutionActive();
  requireHumanCommand(actor, ["EXPERT", "ADMIN"]);
  const rationale = input.rationale.trim();
  if (rationale.length < 5) throw new DomainInvariantError("Publication rationale must contain at least five characters", "PUBLICATION_RATIONALE_REQUIRED");
  const rubric = ComponentHumanRubric.parse(input.rubric);
  if (input.action === "APPROVE" && !humanRubricPasses(rubric)) {
    throw new DomainInvariantError("APPROVE requires PASS attestations for domain correctness, pedagogy, safety, and reuse readiness", "HUMAN_RUBRIC_BLOCKED");
  }
  const commandType = "COMPONENT_PUBLICATION_DECISION";
  const requestHash = commandRequestHash(actor, commandType, { ...input, rubric, idempotencyKey: undefined });
  const decisionId = deterministicCommandResultId(commandType, requestHash);
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: decisionId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      const existingDecisionId = assertReplay(existing, commandType, requestHash);
      const [existingDecision] = await tx.select({ decision: publicationDecisions, component: components }).from(publicationDecisions)
        .innerJoin(componentVersions, eq(componentVersions.id, publicationDecisions.componentVersionId))
        .innerJoin(components, eq(components.id, componentVersions.componentId))
        .where(eq(publicationDecisions.id, existingDecisionId)).limit(1);
      if (!existingDecision) throw new DomainInvariantError("Publication replay target is missing", "IDEMPOTENCY_INTEGRITY");
      requireCourseAccess(actor, existingDecision.component.institutionId, existingDecision.component.courseId);
      let capabilityResolutionId: string | null = null;
      let activityPlanProposalId: string | null = null;
      let capabilitySupplyRelationId: string | null = null;
      if (existingDecision.decision.action === "APPROVE" && existingDecision.component.assetType === "WEB_COMPONENT_ASSET") {
        if (!existingDecision.component.registeredCapabilityId || !existingDecision.component.registeredCapabilityVersionId || !existingDecision.component.sourceCapabilityResolutionId) {
          throw new DomainInvariantError("Publication replay is missing its exact Registry binding", "IDEMPOTENCY_INTEGRITY");
        }
        const [relation] = await tx.select().from(capabilitySupplyRelations).where(eq(capabilitySupplyRelations.registeredCapabilityVersionId, existingDecision.component.registeredCapabilityVersionId)).limit(1);
        capabilitySupplyRelationId = relation?.id ?? null;
        const [source] = relation ? await tx.select().from(capabilityResolutions).where(eq(capabilityResolutions.id, relation.sourceCapabilityResolutionId)).limit(1) : [];
        const [replan] = source ? await tx.select({ resolution: capabilityResolutions, plan: activityPlanProposals })
          .from(capabilityResolutions)
          .innerJoin(activityPlanProposals, eq(activityPlanProposals.capabilityResolutionId, capabilityResolutions.id))
          .where(and(
            eq(capabilityResolutions.taskId, source.taskId),
            eq(capabilityResolutions.episodeId, source.episodeId),
            eq(capabilityResolutions.selectedCapabilityId, existingDecision.component.registeredCapabilityId),
            eq(capabilityResolutions.selectedCapabilityVersionId, existingDecision.component.registeredCapabilityVersionId),
            eq(capabilityResolutions.decision, "EXISTING"),
            eq(activityPlanProposals.state, "READY"),
            eq(activityPlanProposals.selectedCapabilityVersionId, existingDecision.component.registeredCapabilityVersionId),
          )).orderBy(desc(capabilityResolutions.createdAt), desc(capabilityResolutions.id)).limit(1) : [];
        if (!replan) throw new DomainInvariantError("Publication replay is missing durable exact re-resolution and READY planning", "IDEMPOTENCY_INTEGRITY");
        capabilityResolutionId = replan.resolution.id;
        activityPlanProposalId = replan.plan.id;
      }
      return { decisionId: existingDecisionId, componentId: existingDecision.component.id, componentVersionId: existingDecision.decision.componentVersionId, registeredCapabilityId: existingDecision.component.registeredCapabilityId, registeredCapabilityVersionId: existingDecision.component.registeredCapabilityVersionId, capabilitySupplyRelationId, capabilityResolutionId, activityPlanProposalId, action: existingDecision.decision.action as "APPROVE" | "REJECT", replayed: true };
    }
    const [lockedVersion] = await tx.select({ id: componentVersions.id, componentId: componentVersions.componentId })
      .from(componentVersions).where(eq(componentVersions.id, input.componentVersionId)).for("update").limit(1);
    if (lockedVersion) {
      await tx.select({ id: components.id }).from(components)
        .where(eq(components.id, lockedVersion.componentId)).for("update").limit(1);
    }
    const [binding] = await tx.select({ version: componentVersions, component: components, evaluation: componentEvaluations })
      .from(componentVersions)
      .innerJoin(components, eq(components.id, componentVersions.componentId))
      .innerJoin(componentEvaluations, and(eq(componentEvaluations.id, input.evaluationId), eq(componentEvaluations.componentVersionId, componentVersions.id)))
      .where(and(eq(componentVersions.id, input.componentVersionId), eq(components.institutionId, actor.institutionId)))
      .limit(1);
    if (!binding) {
      const [versionProbe] = await tx.select({ id: componentVersions.id, componentId: componentVersions.componentId })
        .from(componentVersions).where(eq(componentVersions.id, input.componentVersionId)).limit(1);
      const [evaluationProbe] = await tx.select({ id: componentEvaluations.id, componentVersionId: componentEvaluations.componentVersionId })
        .from(componentEvaluations).where(eq(componentEvaluations.id, input.evaluationId)).limit(1);
      const reason = !versionProbe
        ? "VERSION_NOT_AUTHORIZED"
        : !evaluationProbe
          ? "EVALUATION_NOT_AUTHORIZED"
          : evaluationProbe.componentVersionId !== versionProbe.id
            ? "EVALUATION_VERSION_MISMATCH"
            : "COMPONENT_SCOPE_MISMATCH";
      throw new DomainInvariantError(`Publication evaluation is outside the active institution or version lineage (${reason})`, "TENANT_ISOLATION");
    }
    requireCourseAccess(actor, binding.component.institutionId, binding.component.courseId);
    const [workflow] = await tx.select().from(workflowRuns).where(and(
      eq(workflowRuns.threadId, input.workflowThreadId),
      eq(workflowRuns.institutionId, actor.institutionId),
      eq(workflowRuns.workflowKind, "COMPONENT_LIFECYCLE"),
      eq(workflowRuns.status, "RESUMING"),
      eq(workflowRuns.interruptType, "EXPERT_PUBLICATION_REVIEW_REQUIRED"),
    )).for("update").limit(1);
    const productLinks = workflow?.productLinks ?? {};
    if (!workflow
      || productLinks.componentId !== binding.component.id
      || productLinks.componentVersionId !== binding.version.id
      || productLinks.evaluationId !== binding.evaluation.id
      || workflow.interruptVersion < 1) {
      throw new DomainInvariantError("Publication decision does not match the current expert workflow interrupt and evaluated version", "PUBLICATION_WORKFLOW_MISMATCH");
    }
    if (binding.version.status !== "DRAFT") throw new DomainInvariantError("Component version already has a terminal publication decision", "PUBLICATION_CONFLICT");
    if (binding.evaluation.contentHash !== binding.version.contentHash) throw new DomainInvariantError("Publication evaluation is stale for this Component content", "COMPONENT_EVALUATION_STALE");
    const webAsset = binding.component.assetType === "WEB_COMPONENT_ASSET";
    let webSource: { resolution: typeof capabilityResolutions.$inferSelect; plan: typeof activityPlanProposals.$inferSelect; observation: typeof diagnosticObservations.$inferSelect; attempt: typeof learnerAttempts.$inferSelect; task: typeof learningTasks.$inferSelect; sourceCapability: typeof capabilities.$inferSelect; sourceVersion: typeof capabilityVersions.$inferSelect; sourceContract: CallableCapabilityResolutionContract; sourceComponent: typeof components.$inferSelect; sourceComponentVersion: typeof componentVersions.$inferSelect } | null = null;
    if (webAsset) {
      const sourceResolutionId = binding.component.sourceCapabilityResolutionId;
      const sourcePlanId = binding.component.sourceActivityPlanProposalId;
      if (!sourceResolutionId || !sourcePlanId) throw new DomainInvariantError("Web ComponentAsset source gap lineage is incomplete", "COMPONENT_EVALUATION_STALE");
      await tx.execute(sql`SELECT foundry_product.lock_cap07_publication_source(${binding.component.id}::uuid,${binding.version.id}::uuid,${binding.evaluation.id}::uuid)`);
      const [sourceLineage] = await tx.select({ resolution: capabilityResolutions, plan: activityPlanProposals, observation: diagnosticObservations, attempt: learnerAttempts, task: learningTasks })
        .from(capabilityResolutions)
        .innerJoin(activityPlanProposals, eq(activityPlanProposals.id, sourcePlanId))
        .innerJoin(diagnosticObservations, eq(diagnosticObservations.id, capabilityResolutions.diagnosticObservationId))
        .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
        .innerJoin(learningTasks, eq(learningTasks.id, capabilityResolutions.taskId))
        .where(and(eq(capabilityResolutions.id, sourceResolutionId), eq(capabilityResolutions.institutionId, actor.institutionId), isNull(diagnosticObservations.supersededById)))
        .limit(1);
      const [latestResolution] = sourceLineage ? await tx.select({ id: capabilityResolutions.id }).from(capabilityResolutions)
        .where(and(eq(capabilityResolutions.taskId, sourceLineage.task.id), eq(capabilityResolutions.episodeId, sourceLineage.resolution.episodeId)))
        .orderBy(desc(capabilityResolutions.createdAt), desc(capabilityResolutions.id)).limit(1) : [];
      const [latestPlan] = sourceLineage ? await tx.select({ id: activityPlanProposals.id }).from(activityPlanProposals)
        .where(and(eq(activityPlanProposals.taskId, sourceLineage.task.id), eq(activityPlanProposals.episodeId, sourceLineage.resolution.episodeId)))
        .orderBy(desc(activityPlanProposals.createdAt), desc(activityPlanProposals.id)).limit(1) : [];
      const [sourceRegistry] = binding.component.adaptedFromCapabilityId && binding.component.adaptedFromCapabilityVersionId && binding.component.adaptedFromComponentVersionId
        ? await tx.select({ capability: capabilities, version: capabilityVersions, component: components, componentVersion: componentVersions }).from(capabilityVersions)
          .innerJoin(capabilities, eq(capabilities.id, capabilityVersions.capabilityId))
          .innerJoin(componentVersions, eq(componentVersions.id, binding.component.adaptedFromComponentVersionId))
          .innerJoin(components, eq(components.id, componentVersions.componentId))
          .where(and(eq(capabilities.id, binding.component.adaptedFromCapabilityId), eq(capabilityVersions.id, binding.component.adaptedFromCapabilityVersionId))).limit(1)
        : [];
      const sourceEnvelope = sourceRegistry?.version.contract && typeof sourceRegistry.version.contract === "object"
        ? (sourceRegistry.version.contract as Record<string, unknown>).resolution ?? sourceRegistry.version.contract
        : sourceRegistry?.version.contract;
      const parsedSourceContract = CallableCapabilityResolutionContract.safeParse(sourceEnvelope);
      const gapSignal = sourceLineage?.resolution.gapSignal as Record<string, unknown> | null;
      const exactSourceCandidate = Array.isArray(sourceLineage?.resolution.candidateSet) && sourceRegistry
        ? sourceLineage.resolution.candidateSet.some((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)
          && candidate.capabilityId === sourceRegistry.capability.id && candidate.versionId === sourceRegistry.version.id
          && candidate.contentHash === sourceRegistry.version.contentHash && candidate.matchMode === "ADAPT" && candidate.eligibility === "ELIGIBLE"
          && Array.isArray(candidate.exclusionReasons) && candidate.exclusionReasons.length === 0)
        : false;
      if (!sourceLineage || !sourceRegistry || !parsedSourceContract.success) {
        throw new DomainInvariantError("Web ComponentAsset gap or check lineage is stale (MISSING_SOURCE_LINEAGE)", "COMPONENT_EVALUATION_STALE");
      }
      const staleReasons = [
        sourceLineage.resolution.decision !== "ADAPT" || binding.component.supplyStrategy !== "ADAPT" ? "SUPPLY_STRATEGY" : null,
        !sourceLineage.resolution.noMatch || !sourceLineage.resolution.teacherEscalation ? "GAP_AUTHORITY" : null,
        gapSignal?.kind !== "ADAPTATION_REQUIRED" || gapSignal.relatedCapabilityVersionId !== sourceRegistry.version.id ? "GAP_SOURCE_VERSION" : null,
        sourceLineage.plan.capabilityResolutionId !== sourceLineage.resolution.id || sourceLineage.plan.state !== "BLOCKED" || sourceLineage.plan.selectedCapabilityVersionId ? "BLOCKED_PLAN" : null,
        latestResolution?.id !== sourceLineage.resolution.id || latestPlan?.id !== sourceLineage.plan.id ? "SOURCE_FRESHNESS" : null,
        sourceRegistry.capability.activeVersionId !== sourceRegistry.version.id || sourceRegistry.version.status !== "ACTIVE" ? "SOURCE_CAPABILITY_ACTIVE_VERSION" : null,
        sourceRegistry.version.contentHash !== binding.component.adaptedFromContentHash ? "SOURCE_CAPABILITY_HASH" : null,
        !parsedSourceContract.data.verified || !parsedSourceContract.data.adaptation.reviewed ? "SOURCE_REVIEW" : null,
        !exactSourceCandidate ? "SOURCE_CANDIDATE" : null,
        sourceRegistry.version.componentAssetVersionId !== sourceRegistry.componentVersion.id ? "SOURCE_COMPONENT_BINDING" : null,
        sourceRegistry.component.activeVersionId !== sourceRegistry.componentVersion.id || sourceRegistry.componentVersion.status !== "PUBLISHED" ? "SOURCE_COMPONENT_ACTIVE_VERSION" : null,
        sourceRegistry.componentVersion.contentHash !== binding.component.adaptedFromComponentContentHash ? "SOURCE_COMPONENT_HASH" : null,
        !SourceWebComponentAssetContract.safeParse(sourceRegistry.componentVersion.contract).success ? "SOURCE_COMPONENT_CONTRACT" : null,
        !SourceWebComponentAssetPackage.safeParse(sourceRegistry.componentVersion.content).success ? "SOURCE_COMPONENT_PACKAGE" : null,
        webComponentAssetHash(sourceRegistry.componentVersion.contract, sourceRegistry.componentVersion.content) !== sourceRegistry.componentVersion.contentHash ? "SOURCE_COMPONENT_HASH_RECOMPUTE" : null,
        binding.evaluation.sourceObservationIds.length !== 1 || binding.evaluation.sourceObservationIds[0] !== sourceLineage.observation.id ? "EVALUATION_OBSERVATION" : null,
        binding.evaluation.sourceReviewIds.length !== 0 ? "EVALUATION_REVIEW" : null,
        binding.evaluation.sourceAttemptIds.length !== 1 || binding.evaluation.sourceAttemptIds[0] !== sourceLineage.attempt.id ? "EVALUATION_ATTEMPT" : null,
      ].filter((reason): reason is string => Boolean(reason));
      if (staleReasons.length) {
        throw new DomainInvariantError(`Web ComponentAsset gap or check lineage is stale (${staleReasons.join(",")})`, "COMPONENT_EVALUATION_STALE");
      }
      webSource = { ...sourceLineage, sourceCapability: sourceRegistry.capability, sourceVersion: sourceRegistry.version, sourceContract: parsedSourceContract.data, sourceComponent: sourceRegistry.component, sourceComponentVersion: sourceRegistry.componentVersion };
      if (input.action === "APPROVE") {
        const [preview] = await tx.select().from(componentAssetPreviews).where(and(
          eq(componentAssetPreviews.componentVersionId, binding.version.id),
          eq(componentAssetPreviews.componentEvaluationId, binding.evaluation.id),
          eq(componentAssetPreviews.contentHash, binding.version.contentHash),
          eq(componentAssetPreviews.status, "SUCCEEDED"),
        )).orderBy(desc(componentAssetPreviews.createdAt)).limit(1);
        if (!preview) throw new DomainInvariantError("Authorized confirmation requires a successful exact-version learner preview", "COMPONENT_PREVIEW_REQUIRED");
      }
    } else {
      const currentSignals = await tx.select({ observation: diagnosticObservations, attempt: learnerAttempts, task: learningTasks, review: teacherReviews })
        .from(diagnosticObservations)
        .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
        .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
        .innerJoin(teacherReviews, eq(teacherReviews.observationId, diagnosticObservations.id))
        .where(and(
          inArray(diagnosticObservations.id, binding.evaluation.sourceObservationIds),
          inArray(teacherReviews.id, binding.evaluation.sourceReviewIds),
          isNull(diagnosticObservations.supersededById),
          eq(learningTasks.institutionId, actor.institutionId),
          eq(learningTasks.courseId, binding.evaluation.courseId),
        ));
      const currentObservationIds = new Set(currentSignals.map(({ observation }) => observation.id));
      const currentReviewIds = new Set(currentSignals.map(({ review }) => review.id));
      const currentAttemptIds = new Set(currentSignals.map(({ attempt }) => attempt.id));
      const evaluationLineageCurrent = currentObservationIds.size === binding.evaluation.sourceObservationIds.length
        && currentReviewIds.size === binding.evaluation.sourceReviewIds.length
        && currentAttemptIds.size === binding.evaluation.sourceAttemptIds.length
        && binding.evaluation.sourceObservationIds.every((id) => currentObservationIds.has(id))
        && binding.evaluation.sourceReviewIds.every((id) => currentReviewIds.has(id))
        && binding.evaluation.sourceAttemptIds.every((id) => currentAttemptIds.has(id))
        && currentSignals.every(({ review }) => requireEligibleReviewDecision(review.decision, "Component publication") && (requireVerifiedReviewProvenance(review, actor.institutionId), true));
      if (!evaluationLineageCurrent) throw new DomainInvariantError("Publication evaluation source Reviews or Observations are no longer current", "COMPONENT_EVALUATION_STALE");
    }
    if (input.action === "APPROVE" && binding.evaluation.systemStatus !== "PASSED") throw new DomainInvariantError("System evaluation gates block publication", "COMPONENT_SYSTEM_GATES_BLOCKED");
    await tx.execute(sql`SELECT set_config('foundry.governance_command', 'component_publication', true)`);
    await tx.insert(publicationDecisions).values({
      id: decisionId,
      componentVersionId: binding.version.id,
      evaluationId: binding.evaluation.id,
      previousActiveVersionId: binding.component.activeVersionId,
      expertId: actor.userId,
      action: input.action,
      rationale,
      humanRubric: rubric,
      workflowThreadId: input.workflowThreadId,
      actorProvenance: actorProvenance(actor),
      idempotencyKey: input.idempotencyKey,
    });
    const [terminalVersion] = await tx.update(componentVersions).set({ status: input.action === "APPROVE" ? "PUBLISHED" : "REJECTED" }).where(and(eq(componentVersions.id, binding.version.id), eq(componentVersions.status, "DRAFT"))).returning();
    if (!terminalVersion) throw new DomainInvariantError("Component version already received a terminal decision", "PUBLICATION_CONFLICT");
    let registeredCapabilityId: string | null = null;
    let registeredCapabilityVersionId: string | null = null;
    let capabilityResolutionId: string | null = null;
    let activityPlanProposalId: string | null = null;
    let capabilitySupplyRelationId: string | null = null;
    if (input.action === "APPROVE" && webAsset && webSource) {
      const contract = WebComponentAssetContract.parse(binding.version.contract);
      const componentPackage = WebComponentAssetPackage.parse(binding.version.content);
      registeredCapabilityId = deterministicCommandResultId("CAP07_REGISTERED_CAPABILITY", requestHash);
      registeredCapabilityVersionId = deterministicCommandResultId("CAP07_REGISTERED_CAPABILITY_VERSION", requestHash);
      const resolutionContract = CallableCapabilityResolutionContract.parse({
        contractType: "CALLABLE_LEARNING_CAPABILITY",
        verified: true,
        learningProblem: webSource.sourceContract.learningProblem,
        exactMatchSignals: [webSource.sourceCapability.key, webSource.sourceCapability.name, webSource.sourceContract.learningProblem],
        eligibility: { learnerLevels: ["COURSE_AUTHORIZED_UNSPECIFIED"], taskTypes: ["CAPABILITY_GAP_REMEDIATION"], curricula: [contract.referencePackKey], languages: [componentPackage.language], accessibility: ["keyboard", "screen-reader", "text"], prerequisites: [], contraindications: [] },
        availability: { status: "AVAILABLE", institutionIds: [actor.institutionId], courseIds: [binding.component.courseId], rights: "NOT_REQUIRED", dependencies: [], provider: null },
        parameterization: { supported: false, signals: [], recommendation: {} },
        composition: { supported: false, contributes: [] },
        adaptation: { reviewed: true, signals: [webSource.sourceCapability.key, webSource.sourceContract.learningProblem] },
        runtime: {
          kind: contract.runtimeKind,
          input: { type: "object", required: ["selectedChoiceId"], properties: { selectedChoiceId: { type: "string" } } },
          parameters: { componentAssetVersionId: binding.version.id, templateKey: contract.templateKey },
          state: { mode: "STATELESS_ONE_SHOT" },
          output: { type: "object", required: ["componentCompleted", "correct", "feedback", "events"] },
          events: componentPackage.eventContract,
        },
      });
      const capabilityContract = {
        resolution: resolutionContract,
        componentAsset: { componentId: binding.component.id, versionId: binding.version.id, version: binding.version.version, contentHash: binding.version.contentHash, contract, package: componentPackage },
      };
      const restrictedReusableValues = [
        webSource.resolution.id,
        webSource.plan.id,
        webSource.observation.id,
        webSource.observation.summary,
        webSource.attempt.id,
        webSource.attempt.prompt,
        webSource.attempt.response,
        webSource.attempt.learnerId,
        webSource.task.id,
        webSource.task.title,
        webSource.task.goal,
      ].filter((value) => value.trim().length >= 8).map((value) => value.toLocaleLowerCase("en-US"));
      const serializedCapabilityContract = JSON.stringify(capabilityContract).toLocaleLowerCase("en-US");
      if (restrictedReusableValues.some((value) => serializedCapabilityContract.includes(value))) {
        throw new DomainInvariantError("Final assembled Registry contract contains restricted learner or gap lineage", "CAPABILITY_REGISTRY_DEIDENTIFICATION_FAILED");
      }
      const capabilityContentHash = createHash("sha256").update(JSON.stringify(canonical(capabilityContract))).digest("hex");
      await tx.insert(capabilities).values({ id: registeredCapabilityId, institutionId: actor.institutionId, courseId: binding.component.courseId, key: `cap07.${actor.institutionId.slice(0, 8)}.${binding.component.id}`, name: contract.title, referencePackKey: contract.referencePackKey, kind: "WEB_COMPONENT_ASSET", activeVersionId: null });
      await tx.insert(capabilityVersions).values({ id: registeredCapabilityVersionId, capabilityId: registeredCapabilityId, institutionId: actor.institutionId, courseId: binding.component.courseId, componentAssetVersionId: binding.version.id, version: binding.version.version, contract: capabilityContract, implementationKey: contract.implementationKey, status: "ACTIVE", contentHash: capabilityContentHash });
      await tx.update(components).set({ capabilityId: registeredCapabilityId, registeredCapabilityId, registeredCapabilityVersionId, activeVersionId: binding.version.id, status: "PUBLISHED", title: contract.title }).where(eq(components.id, binding.component.id));
      await tx.insert(capabilityAvailabilityDecisions).values({
        institutionId: actor.institutionId,
        courseId: binding.component.courseId,
        capabilityId: registeredCapabilityId,
        capabilityVersionId: registeredCapabilityVersionId,
        componentVersionId: binding.version.id,
        confirmationDecisionId: decisionId,
        availabilityStatus: "AVAILABLE",
        availabilityScope: { kind: "INSTITUTION_COURSE_PRIVATE", institutionId: actor.institutionId, courseId: binding.component.courseId, crossTenantReuse: false },
        confirmedBy: actor.userId,
        actorProvenance: actorProvenance(actor),
        rationale,
      });
      await tx.update(capabilities).set({ activeVersionId: registeredCapabilityVersionId }).where(eq(capabilities.id, registeredCapabilityId));
      capabilitySupplyRelationId = deterministicCommandResultId("CAP07_CAPABILITY_SUPPLY_RELATION", requestHash);
      await tx.insert(capabilitySupplyRelations).values({
        id: capabilitySupplyRelationId,
        institutionId: actor.institutionId,
        courseId: binding.component.courseId,
        sourceCapabilityResolutionId: webSource.resolution.id,
        sourceActivityPlanProposalId: webSource.plan.id,
        sourceDiagnosticObservationId: webSource.observation.id,
        sourceAttemptId: webSource.attempt.id,
        componentId: binding.component.id,
        componentVersionId: binding.version.id,
        registeredCapabilityId,
        registeredCapabilityVersionId,
        confirmationDecisionId: decisionId,
        createdBy: actor.userId,
      });
      await dependencies.beforeReplan?.();
      const resolution = await dependencies.resolveCapability(actor, { supplyRelationId: capabilitySupplyRelationId });
      if (resolution.decision !== "EXISTING" || resolution.selectedCapabilityId !== registeredCapabilityId || resolution.selectedCapabilityVersionId !== registeredCapabilityVersionId) {
        throw new DomainInvariantError("Registered exact version did not become the deterministic CAP-02 selection", "CAPABILITY_RERESOLUTION_MISMATCH");
      }
      const plan = await dependencies.planActivity(actor, { taskId: resolution.taskId, episodeId: resolution.episodeId, capabilityResolutionId: resolution.id });
      if (plan.state !== "READY" || plan.selectedCapabilityId !== registeredCapabilityId || plan.selectedCapabilityVersionId !== registeredCapabilityVersionId) {
        throw new DomainInvariantError("Registered exact version did not produce a READY CAP-03 plan", "CAPABILITY_REPLAN_MISMATCH");
      }
      capabilityResolutionId = resolution.id;
      activityPlanProposalId = plan.id;
    } else if (input.action === "APPROVE") {
      const contract = ComponentContract.parse(binding.version.contract);
      await tx.update(components).set({ activeVersionId: binding.version.id, status: "PUBLISHED", title: contract.title }).where(eq(components.id, binding.component.id));
    } else if (!binding.component.activeVersionId) {
      await tx.update(components).set({ status: "REJECTED" }).where(eq(components.id, binding.component.id));
    }
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "PUBLICATION_DECISION", entityId: decisionId, action: input.action, payload: { componentId: binding.component.id, componentVersionId: binding.version.id, evaluationId: binding.evaluation.id, workflowThreadId: input.workflowThreadId, humanRubric: rubric } });
    return { decisionId, componentId: binding.component.id, componentVersionId: binding.version.id, registeredCapabilityId, registeredCapabilityVersionId, capabilitySupplyRelationId, capabilityResolutionId, activityPlanProposalId, action: input.action, replayed: false };
  });
}

export async function rollbackComponent(actor: Actor, input: { componentId: string; targetVersionId: string; expectedActiveVersionId: string; rationale: string; idempotencyKey: string }) {
  requireHumanCommand(actor, ["EXPERT", "ADMIN"]);
  const rationale = input.rationale.trim();
  if (rationale.length < 5) throw new DomainInvariantError("Rollback rationale must contain at least five characters", "ROLLBACK_RATIONALE_REQUIRED");
  const decisionId = randomUUID();
  const commandType = "COMPONENT_ROLLBACK";
  const requestHash = commandRequestHash(actor, commandType, { ...input, idempotencyKey: undefined });
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: decisionId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      return { decisionId: assertReplay(existing, commandType, requestHash), replayed: true };
    }
    const [component] = await tx.select().from(components).where(and(eq(components.id, input.componentId), eq(components.institutionId, actor.institutionId))).for("update").limit(1);
    if (!component) throw new DomainInvariantError("Rollback target is outside the active institution", "TENANT_ISOLATION");
    if (component.activeVersionId !== input.expectedActiveVersionId) throw new DomainInvariantError("Component active version changed before rollback", "ROLLBACK_CONFLICT");
    if (component.activeVersionId === input.targetVersionId) throw new DomainInvariantError("Rollback target is already active", "ROLLBACK_NO_CHANGE");
    const [target] = await tx.select().from(componentVersions).where(and(eq(componentVersions.id, input.targetVersionId), eq(componentVersions.componentId, component.id), eq(componentVersions.status, "PUBLISHED"))).limit(1);
    if (!target) throw new DomainInvariantError("Rollback requires an already-published version from this Component", "ROLLBACK_TARGET_INVALID");
    await tx.execute(sql`SELECT set_config('foundry.governance_command', 'component_rollback', true)`);
    await tx.insert(publicationDecisions).values({ id: decisionId, componentVersionId: target.id, previousActiveVersionId: component.activeVersionId, expertId: actor.userId, action: "ROLLBACK", rationale, actorProvenance: actorProvenance(actor), idempotencyKey: input.idempotencyKey });
    const targetContract = ComponentContract.parse(target.contract);
    const [updatedComponent] = await tx.update(components).set({ activeVersionId: target.id, status: "PUBLISHED", title: targetContract.title }).where(and(eq(components.id, component.id), eq(components.activeVersionId, input.expectedActiveVersionId))).returning();
    if (!updatedComponent) throw new DomainInvariantError("Component active version changed before rollback", "ROLLBACK_CONFLICT");
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "PUBLICATION_DECISION", entityId: decisionId, action: "ROLLBACK", payload: { componentId: component.id, previousActiveVersionId: component.activeVersionId, targetVersionId: target.id } });
    return { decisionId, componentId: component.id, activeVersionId: target.id, replayed: false };
  });
}

export async function deliverActiveComponentSupport(actor: Actor, input: { observationId: string; idempotencyKey: string }) {
  assertExecutionActive();
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  const [lineage] = await getDb().select({ observation: diagnosticObservations, attempt: learnerAttempts, task: learningTasks, subject: subjects, review: teacherReviews })
    .from(diagnosticObservations)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .innerJoin(courses, eq(courses.id, learningTasks.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .innerJoin(teacherReviews, eq(teacherReviews.observationId, diagnosticObservations.id))
    .where(and(eq(diagnosticObservations.id, input.observationId), isNull(diagnosticObservations.supersededById)))
    .orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id))
    .limit(1);
  if (!lineage) throw new DomainInvariantError("Component delivery requires a reviewed Observation", "OBSERVATION_NOT_FOUND");
  requireCourseAccess(actor, lineage.task.institutionId, lineage.task.courseId);
  requireVerifiedReviewProvenance(lineage.review, lineage.task.institutionId);
  requireEligibleReviewDecision(lineage.review.decision, "Component delivery");
  if (lineage.observation.observationSource !== "CAPABILITY" || !lineage.observation.failureCode || !lineage.attempt.capabilityId) {
    throw new DomainInvariantError("No governed capability failure signal is available for Component delivery", "COMPONENT_SIGNAL_INELIGIBLE");
  }
  const capabilityId = lineage.attempt.capabilityId;
  const failureCode = lineage.observation.failureCode;
  const deliveryId = randomUUID();
  const commandType = "DELIVER_COMPONENT_SUPPORT";
  const requestHash = commandRequestHash(actor, commandType, { observationId: input.observationId });
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: deliveryId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      return { deliveryId: assertReplay(existing, commandType, requestHash), replayed: true };
    }
    const [lockedObservation] = await tx.select().from(diagnosticObservations).where(eq(diagnosticObservations.id, lineage.observation.id)).for("update").limit(1);
    if (!lockedObservation || lockedObservation.supersededById) throw new DomainInvariantError("Component delivery source Observation was superseded", "COMPONENT_SIGNAL_SUPERSEDED");
    const [currentReview] = await tx.select().from(teacherReviews).where(eq(teacherReviews.observationId, lockedObservation.id)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
    if (!currentReview || currentReview.id !== lineage.review.id) throw new DomainInvariantError("Component delivery requires the current human Review leaf", "STALE_REVIEW");
    requireVerifiedReviewProvenance(currentReview, lineage.task.institutionId);
    requireEligibleReviewDecision(currentReview.decision, "Component delivery");
    const [component] = await tx.select().from(components).where(and(
      eq(components.institutionId, actor.institutionId),
      eq(components.courseId, lineage.task.courseId),
      eq(components.capabilityId, capabilityId),
      eq(components.failureCode, failureCode),
      eq(components.referencePackKey, lineage.subject.referencePackKey),
      eq(components.status, "PUBLISHED"),
    )).for("update").limit(1);
    if (!component?.activeVersionId) throw new DomainInvariantError("No active published Component matches this reviewed signal", "COMPONENT_SUPPORT_UNAVAILABLE");
    const [version] = await tx.select().from(componentVersions).where(and(eq(componentVersions.id, component.activeVersionId), eq(componentVersions.componentId, component.id), eq(componentVersions.status, "PUBLISHED"))).limit(1);
    if (!version) throw new DomainInvariantError("Component active version is not a published version", "COMPONENT_ACTIVE_VERSION_INVALID");
    const content = ComponentContent.parse(version.content);
    const contract = ComponentContract.parse(version.contract);
    await tx.insert(componentDeliveries).values({
      id: deliveryId,
      institutionId: actor.institutionId,
      courseId: lineage.task.courseId,
      taskId: lineage.task.id,
      episodeId: lineage.attempt.episodeId,
      componentId: component.id,
      componentVersionId: version.id,
      observationId: lineage.observation.id,
      reviewId: currentReview.id,
      deliveredBy: actor.userId,
      audience: "LEARNER",
      supportSnapshot: { title: contract.title, purpose: contract.purpose, version: version.version, ...content },
      idempotencyKey: input.idempotencyKey,
    });
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "COMPONENT_DELIVERY", entityId: deliveryId, action: "SUPPORT_DELIVERED", payload: { taskId: lineage.task.id, observationId: lineage.observation.id, reviewId: currentReview.id, componentId: component.id, componentVersionId: version.id } });
    return { deliveryId, componentId: component.id, componentVersionId: version.id, version: version.version, replayed: false };
  });
}

export async function latestReview(observationId: string) {
  return (await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, observationId)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1))[0] ?? null;
}
