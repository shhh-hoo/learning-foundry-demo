import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  componentVersions,
  components,
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
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import { ComponentContract } from "@/domain/component";
import { authorizeEvidenceUnitInstitution, authorizePersistedEvidence, evidenceAlignsToCourse } from "@/domain/evidence";
import { parseReviewDecision, requireEligibleReviewDecision } from "@/domain/review";
import { requireTaskEpisodeScope } from "@/application/task-scope";
import {
  DomainInvariantError,
  requireCourseAccess,
  requireHumanCommand,
  requireReviewBeforeOutcome,
  requireRole,
} from "@/domain/invariants";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
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

function requireVerifiedReviewProvenance(
  review: typeof teacherReviews.$inferSelect,
  institutionId: string,
): void {
  const provenance = review.actorProvenance;
  if (
    !provenance
    || provenance.userId !== review.teacherId
    || provenance.institutionId !== institutionId
    || !provenance.authMethod
    || !provenance.sessionId
    || provenance.authMethod.startsWith("migrated-")
  ) {
    throw new DomainInvariantError("Review lacks verified authenticated human provenance", "REVIEW_PROVENANCE_INVALID");
  }
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
  await getDb().update(learningTasks).set({ status: "CLOSED", closedAt: new Date(), updatedAt: new Date() }).where(eq(learningTasks.id, taskId));
}

export async function appendConversationEvent(actor: Actor, input: { taskId: string; episodeId: string; kind: string; content: string; actorType?: string; sourceRefs?: Array<Record<string, string>>; evidenceRefs?: Array<Record<string, string>> }) {
  await requireTaskEpisodeScope(actor, {
    taskId: input.taskId,
    episodeId: input.episodeId,
    learnerOriginated: input.actorType === "LEARNER" || actor.roles.includes("LEARNER"),
  });
  const [event] = await getDb().insert(conversationEvents).values({
    taskId: input.taskId,
    episodeId: input.episodeId,
    actorUserId: actor.userId,
    actorType: input.actorType ?? actor.roles[0],
    kind: input.kind,
    content: input.content,
    sourceRefs: input.sourceRefs ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
  }).returning();
  await getDb().update(learningTasks).set({ updatedAt: new Date() }).where(eq(learningTasks.id, input.taskId));
  return event;
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
  requireRole(actor, ["LEARNER", "ADMIN"]);
  const { task } = await requireTaskEpisodeScope(actor, { taskId: input.taskId, episodeId: input.episodeId, learnerOriginated: true });
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
  const [attempt] = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.id, input.attemptId)).limit(1);
  if (!attempt) throw new DomainInvariantError("Diagnosis requires a real LearnerAttempt", "ATTEMPT_REQUIRED");
  const [existing] = await getDb().select().from(diagnosticObservations).where(and(
    eq(diagnosticObservations.attemptId, input.attemptId),
    eq(diagnosticObservations.capabilityVersionId, input.capabilityVersionId),
  )).orderBy(desc(diagnosticObservations.createdAt)).limit(1);
  if (existing) return existing;
  const [observation] = await getDb().insert(diagnosticObservations).values({
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
}) {
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  const decision = parseReviewDecision(input);
  const observationId = input.observationId;
  const reviewId = randomUUID();
  const rows = await getDb().select({ task: learningTasks }).from(learnerAttempts)
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .innerJoin(diagnosticObservations, eq(diagnosticObservations.attemptId, learnerAttempts.id))
    .where(eq(diagnosticObservations.id, observationId)).limit(1);
  const task = rows[0]?.task;
  if (!task) throw new DomainInvariantError("Diagnostic Observation not found", "OBSERVATION_NOT_FOUND");
  requireCourseAccess(actor, task.institutionId, task.courseId);
  const commandType = "TEACHER_REVIEW";
  const requestHash = commandRequestHash(actor, commandType, { ...input, ...decision, idempotencyKey: undefined });
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

export async function decidePublication(actor: Actor, input: { componentVersionId: string; action: "APPROVE" | "REJECT"; rationale: string; idempotencyKey: string }) {
  requireHumanCommand(actor, ["EXPERT", "ADMIN"]);
  const [row] = await getDb().select({ version: componentVersions, component: components }).from(componentVersions).innerJoin(components, eq(components.id, componentVersions.componentId)).where(eq(componentVersions.id, input.componentVersionId)).limit(1);
  if (!row || row.component.institutionId !== actor.institutionId) throw new DomainInvariantError("Component version not found in institution", "TENANT_ISOLATION");
  void input;
  throw new DomainInvariantError("Component publication is unavailable until a real evaluator executes the required capability, domain, pedagogy, safety and reuse checks", "COMPONENT_EVALUATOR_UNAVAILABLE");
}

export async function createComponentCandidate(actor: Actor, input: {
  observationId: string;
  key: string;
  title: string;
  purpose: string;
  capabilityKey: string;
  referencePackKey: string;
  content: Record<string, unknown>;
  idempotencyKey: string;
}) {
  requireRole(actor, ["TEACHER", "EXPERT", "ADMIN"]);
  const rows = await getDb().select({ task: learningTasks }).from(diagnosticObservations)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .where(eq(diagnosticObservations.id, input.observationId)).limit(1);
  const task = rows[0]?.task;
  if (!task) throw new DomainInvariantError("Candidate requires a governed Observation", "OBSERVATION_NOT_FOUND");
  requireCourseAccess(actor, task.institutionId, task.courseId);
  const [review] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, input.observationId)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
  if (!review) throw new DomainInvariantError("Component candidate requires a current human TeacherReview", "REVIEW_REQUIRED");
  requireVerifiedReviewProvenance(review, task.institutionId);
  requireEligibleReviewDecision(review.decision, "Component candidate");
  const contract = ComponentContract.parse({
    title: input.title,
    purpose: input.purpose,
    capabilityKey: input.capabilityKey,
    referencePackKey: input.referencePackKey,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    evidenceRequirements: ["DiagnosticObservation", "TeacherReview"],
    humanReviewRequired: true,
  });
  const componentId = randomUUID();
  const versionId = randomUUID();
  const contentHash = createHash("sha256").update(JSON.stringify({ contract, content: input.content })).digest("hex");
  const commandType = "COMPONENT_CANDIDATE";
  const requestHash = commandRequestHash(actor, commandType, { ...input, idempotencyKey: undefined, reviewId: review.id });
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: componentId }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      return { componentId: assertReplay(existing, commandType, requestHash), replayed: true };
    }
    await tx.insert(components).values({ id: componentId, institutionId: actor.institutionId, key: input.key, title: input.title, sourceSignal: { observationId: input.observationId }, createdBy: actor.userId });
    await tx.insert(componentVersions).values({ id: versionId, componentId, version: "0.1.0", contract, content: input.content, validation: { core: "PENDING", referencePack: "PENDING" }, status: "DRAFT", contentHash, createdBy: actor.userId });
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "COMPONENT", entityId: componentId, action: "CANDIDATE_CREATED", payload: { versionId, observationId: input.observationId } });
    return { componentId, versionId, replayed: false };
  });
}

export async function updateComponentVersion(actor: Actor, input: { componentId: string; componentVersionId: string; contract: Record<string, unknown>; content: Record<string, unknown>; idempotencyKey: string }) {
  requireRole(actor, ["TEACHER", "EXPERT", "ADMIN"]);
  const [row] = await getDb().select({ component: components, version: componentVersions }).from(components)
    .innerJoin(componentVersions, eq(componentVersions.componentId, components.id))
    .where(and(eq(components.id, input.componentId), eq(componentVersions.id, input.componentVersionId), eq(components.institutionId, actor.institutionId)))
    .limit(1);
  if (!row) throw new DomainInvariantError("Component version is outside the active institution", "TENANT_ISOLATION");
  if (row.version.status === "PUBLISHED") throw new DomainInvariantError("Published versions are immutable; create a new version", "VERSION_IMMUTABLE");
  const contract = ComponentContract.parse(input.contract);
  const contentHash = createHash("sha256").update(JSON.stringify({ contract, content: input.content })).digest("hex");
  const commandType = "UPDATE_COMPONENT_VERSION";
  const requestHash = commandRequestHash(actor, commandType, { componentId: input.componentId, componentVersionId: input.componentVersionId, contract, content: input.content });
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: row.version.id }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.institutionId, actor.institutionId), eq(idempotencyKeys.commandType, commandType), eq(idempotencyKeys.key, input.idempotencyKey)));
      return { componentVersionId: assertReplay(existing, commandType, requestHash), replayed: true };
    }
    await tx.update(componentVersions).set({ contract, content: input.content, contentHash, validation: { status: "PENDING" }, evalResult: null, status: "DRAFT" }).where(and(eq(componentVersions.id, row.version.id), eq(componentVersions.componentId, row.component.id)));
    await tx.insert(governanceEvents).values({ institutionId: actor.institutionId, actorUserId: actor.userId, entityType: "COMPONENT_VERSION", entityId: row.version.id, action: "DRAFT_UPDATED", payload: { componentId: row.component.id, contentHash } });
    return { componentVersionId: row.version.id, replayed: false };
  });
}

export async function rollbackComponent(actor: Actor, input: { componentId: string; targetVersionId: string; rationale: string; idempotencyKey: string }) {
  requireHumanCommand(actor, ["EXPERT", "ADMIN"]);
  const [component] = await getDb().select().from(components).where(and(eq(components.id, input.componentId), eq(components.institutionId, actor.institutionId))).limit(1);
  if (!component) throw new DomainInvariantError("Rollback target is outside the active institution", "TENANT_ISOLATION");
  void input;
  throw new DomainInvariantError("Component rollback is unavailable because no version can be published without a real evaluator", "COMPONENT_EVALUATOR_UNAVAILABLE");
}

export async function latestReview(observationId: string) {
  return (await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, observationId)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1))[0] ?? null;
}
