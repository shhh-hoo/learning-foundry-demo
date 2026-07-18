import type {
  ConversationEvent,
  DerivedRepresentation,
  DiagnosticObservation,
  LearningEpisode,
  LearningOutcome,
  LearningTask,
  LearnerAttempt,
  ObservationCorrection,
  RetryAttempt,
  TeacherReview,
} from "../core/domain/learning";
import type { ArtifactReference, EvidenceReference, SourceReference } from "../core/domain/evidence";
import type { VersionedIdentity } from "../core/domain/capability";
import {
  PRODUCT_STATE_SCHEMA_VERSION,
  type ConversationEventWrite,
  type LearningLoopView,
  type ProductStateActor,
  type ProductStateEventType,
  type ProductStateMutation,
  type ProductStateRepository,
  type ProductStateWrite,
} from "../core/ports/product-state-repository";

interface Clock {
  now(): string;
}

type TaskInput = Pick<LearningTask, "goal" | "materialRefs"> & { readonly taskId: string; readonly learnerId?: string };
type EpisodeInput = { readonly episodeId: string; readonly taskId: string };
type ConversationEventInput = Omit<ConversationEvent, "id" | "sequence" | "occurredAt" | "actor"> & {
  readonly eventId: string;
};
type AttemptInput = Omit<LearnerAttempt, "id" | "submittedAt" | "status"> & { readonly attemptId: string };
type ObservationInput = Omit<DiagnosticObservation, "id" | "createdAt" | "corrections"> & {
  readonly observationId: string;
};
type ReviewInput = Omit<TeacherReview, "id" | "reviewerId" | "reviewedAt"> & {
  readonly reviewId: string;
  readonly correction?: { readonly correctionId: string; readonly reason: string };
};
type RetryInput = Omit<RetryAttempt, "id" | "attemptId" | "status" | "createdAt"> & {
  readonly retryAttemptId: string;
};
type RetrySubmissionInput = {
  readonly retryAttemptId: string;
  readonly attemptId: string;
  readonly artifactRefs: readonly ArtifactReference[];
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly capability?: VersionedIdentity;
};
type RetryResultInput = {
  readonly retryAttemptId: string;
  readonly observationId: string;
  readonly sourceRefs: readonly SourceReference[];
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly provenance: DiagnosticObservation["provenance"];
  readonly diagnosisPayload: DerivedRepresentation<unknown>;
  readonly supersedesObservationId?: string;
};
type OutcomeInput = Pick<LearningOutcome, "outcomeType" | "result" | "evidenceRefs"> & {
  readonly outcomeId: string;
  readonly retryAttemptId: string;
};

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`INVALID_PRODUCT_STATE_INPUT: ${label} is required.`);
  return normalized;
}

function requireRole(actor: ProductStateActor, role: ProductStateActor["role"]): void {
  if (actor.role !== role) throw new Error(`${role} permission required.`);
  required(actor.actorId, "actorId");
}

function requireActiveTask(task: LearningTask | null): asserts task is LearningTask {
  if (!task || task.status !== "ACTIVE") throw new Error("ACTIVE_TASK_REQUIRED");
}

function requireTaskAccess(actor: ProductStateActor, task: LearningTask): void {
  if (actor.role === "LEARNER" && actor.actorId !== task.learnerId) throw new Error("TASK_ACCESS_DENIED");
}

function requireActiveEpisode(episode: LearningEpisode | null, taskId: string): asserts episode is LearningEpisode {
  if (!episode || episode.taskId !== taskId || episode.status !== "ACTIVE") {
    throw new Error("ACTIVE_EPISODE_REQUIRED");
  }
}

function writeFor(
  actor: ProductStateActor,
  eventType: ProductStateEventType,
  aggregateType: string,
  aggregateId: string,
  occurredAt: string,
  mutation: ProductStateMutation,
  details: Readonly<Record<string, unknown>> = {},
): ProductStateWrite {
  const suffix = `${eventType.toLowerCase()}:${aggregateId}`;
  return {
    mutation,
    decision: {
      schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
      id: `decision:${suffix}`,
      eventType,
      actor,
      aggregateType,
      aggregateId,
      occurredAt,
      details,
    },
    outbox: {
      schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
      id: `outbox:${suffix}`,
      eventType,
      aggregateType,
      aggregateId,
      occurredAt,
      payload: { aggregateId, ...details },
    },
  };
}

function conversationEventWriteFor(
  actor: ProductStateActor,
  event: Omit<ConversationEvent, "sequence">,
  occurredAt: string,
): ConversationEventWrite {
  const eventType = "CONVERSATION_EVENT_APPENDED" as const;
  const suffix = `${eventType.toLowerCase()}:${event.id}`;
  const details = { taskId: event.taskId, episodeId: event.episodeId };
  return {
    event,
    decision: {
      schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
      id: `decision:${suffix}`,
      eventType,
      actor,
      aggregateType: "CONVERSATION_EVENT",
      aggregateId: event.id,
      occurredAt,
      details,
    },
    outbox: {
      schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
      id: `outbox:${suffix}`,
      eventType,
      aggregateType: "CONVERSATION_EVENT",
      aggregateId: event.id,
      occurredAt,
      payload: { aggregateId: event.id, ...details },
    },
  };
}

export class ProductStateService {
  constructor(
    private readonly repository: ProductStateRepository,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {}

  async createTask(actor: ProductStateActor, input: TaskInput): Promise<LearningTask> {
    if (actor.role !== "LEARNER" && actor.role !== "TEACHER") throw new Error("LEARNER or TEACHER permission required.");
    const now = this.clock.now();
    const task: LearningTask = {
      id: required(input.taskId, "taskId"),
      learnerId: actor.role === "LEARNER"
        ? actor.actorId
        : required(input.learnerId ?? "", "learnerId"),
      status: "ACTIVE",
      goal: required(input.goal, "goal"),
      createdAt: now,
      updatedAt: now,
      materialRefs: structuredClone(input.materialRefs),
    };
    await this.repository.apply(writeFor(actor, "LEARNING_TASK_CREATED", "LEARNING_TASK", task.id, now, {
      kind: "CREATE_TASK",
      task,
    }));
    return task;
  }

  async startEpisode(actor: ProductStateActor, input: EpisodeInput): Promise<LearningEpisode> {
    if (actor.role !== "LEARNER" && actor.role !== "TEACHER") throw new Error("LEARNER or TEACHER permission required.");
    const task = await this.repository.getTask(input.taskId);
    requireActiveTask(task);
    requireTaskAccess(actor, task);
    const now = this.clock.now();
    const episode: LearningEpisode = {
      id: required(input.episodeId, "episodeId"),
      taskId: required(input.taskId, "taskId"),
      status: "ACTIVE",
      startedAt: now,
    };
    await this.repository.apply(writeFor(actor, "LEARNING_EPISODE_STARTED", "LEARNING_EPISODE", episode.id, now, {
      kind: "START_EPISODE",
      episode,
    }, { taskId: episode.taskId }));
    return episode;
  }

  async appendConversationEvent(actor: ProductStateActor, input: ConversationEventInput): Promise<ConversationEvent> {
    const task = await this.repository.getTask(input.taskId);
    requireActiveTask(task);
    requireTaskAccess(actor, task);
    requireActiveEpisode(await this.repository.getEpisode(input.episodeId), input.taskId);
    const now = this.clock.now();
    const event: Omit<ConversationEvent, "sequence"> = {
      id: required(input.eventId, "eventId"),
      taskId: required(input.taskId, "taskId"),
      episodeId: required(input.episodeId, "episodeId"),
      occurredAt: now,
      actor: actor.role,
      kind: required(input.kind, "kind"),
      payload: structuredClone(input.payload),
      artifactRefs: structuredClone(input.artifactRefs),
      sourceRefs: structuredClone(input.sourceRefs),
      evidenceRefs: structuredClone(input.evidenceRefs),
    };
    return this.repository.appendConversationEvent(conversationEventWriteFor(actor, event, now));
  }

  async submitAttempt(actor: ProductStateActor, input: AttemptInput): Promise<LearnerAttempt> {
    requireRole(actor, "LEARNER");
    const task = await this.repository.getTask(input.taskId);
    requireActiveTask(task);
    requireTaskAccess(actor, task);
    requireActiveEpisode(await this.repository.getEpisode(input.episodeId), input.taskId);
    const supersedesAttemptId = input.supersedesAttemptId
      ? required(input.supersedesAttemptId, "supersedesAttemptId")
      : undefined;
    if (supersedesAttemptId) {
      const superseded = await this.repository.getAttempt(supersedesAttemptId);
      if (!superseded
        || superseded.status !== "SUBMITTED"
        || superseded.taskId !== input.taskId
        || superseded.episodeId !== input.episodeId) {
        throw new Error("SUPERSEDED_ATTEMPT_MUST_BE_CURRENT_AND_IN_SAME_LEARNING_SCOPE");
      }
    }
    const now = this.clock.now();
    const attempt: LearnerAttempt = {
      id: required(input.attemptId, "attemptId"),
      taskId: required(input.taskId, "taskId"),
      episodeId: required(input.episodeId, "episodeId"),
      submittedAt: now,
      status: "SUBMITTED",
      artifactRefs: structuredClone(input.artifactRefs),
      evidenceRefs: structuredClone(input.evidenceRefs),
      ...(input.capability ? { capability: structuredClone(input.capability) } : {}),
      ...(supersedesAttemptId ? { supersedesAttemptId } : {}),
    };
    await this.repository.apply(writeFor(actor, "LEARNER_ATTEMPT_SUBMITTED", "LEARNER_ATTEMPT", attempt.id, now, {
      kind: "SUBMIT_ATTEMPT",
      attempt,
    }, { taskId: attempt.taskId, episodeId: attempt.episodeId }));
    return attempt;
  }

  async recordObservation(actor: ProductStateActor, input: ObservationInput): Promise<DiagnosticObservation> {
    requireRole(actor, "FOUNDRY");
    const attempt = await this.repository.getAttempt(input.attemptId);
    if (!attempt || attempt.status !== "SUBMITTED") throw new Error("SUBMITTED_ATTEMPT_REQUIRED");
    if (!input.diagnosisPayload.derivation.sourceRecordIds.includes(attempt.id)) {
      throw new Error("OBSERVATION_LINEAGE_REQUIRED");
    }
    const currentObservation = await this.repository.getCurrentObservationForAttempt(attempt.id);
    if (currentObservation && input.supersedesObservationId !== currentObservation.id) {
      throw new Error("CURRENT_OBSERVATION_SUPERSESSION_REQUIRED");
    }
    if (!currentObservation && input.supersedesObservationId) {
      throw new Error("OBSERVATION_SUPERSESSION_TARGET_NOT_CURRENT");
    }
    if (currentObservation && await this.repository.getCurrentReviewForObservation(currentObservation.id)) {
      throw new Error("REVIEWED_OBSERVATION_CANNOT_BE_SUPERSEDED");
    }
    const now = this.clock.now();
    const observation: DiagnosticObservation = {
      id: required(input.observationId, "observationId"),
      attemptId: attempt.id,
      ...(input.supersedesObservationId ? { supersedesObservationId: input.supersedesObservationId } : {}),
      createdAt: now,
      sourceRefs: structuredClone(input.sourceRefs),
      evidenceRefs: structuredClone(input.evidenceRefs),
      provenance: structuredClone(input.provenance),
      diagnosisPayload: structuredClone(input.diagnosisPayload),
      corrections: [],
    };
    await this.repository.apply(writeFor(actor, "DIAGNOSTIC_OBSERVATION_RECORDED", "DIAGNOSTIC_OBSERVATION", observation.id, now, {
      kind: "RECORD_OBSERVATION",
      observation,
    }, { attemptId: attempt.id }));
    return observation;
  }

  async reviewObservation(actor: ProductStateActor, input: ReviewInput): Promise<TeacherReview> {
    requireRole(actor, "TEACHER");
    const observation = await this.repository.getObservation(input.observationId);
    if (!observation) throw new Error("CURRENT_OBSERVATION_REQUIRED");
    const currentObservation = await this.repository.getCurrentObservationForAttempt(observation.attemptId);
    if (!currentObservation || currentObservation.id !== observation.id) throw new Error("CURRENT_OBSERVATION_REQUIRED");
    const currentReview = await this.repository.getCurrentReviewForObservation(observation.id);
    if (currentReview && input.supersedesReviewId !== currentReview.id) {
      throw new Error("CURRENT_TEACHER_REVIEW_SUPERSESSION_REQUIRED");
    }
    if (!currentReview && input.supersedesReviewId) {
      throw new Error("TEACHER_REVIEW_SUPERSESSION_TARGET_NOT_CURRENT");
    }
    if (input.decision === "CORRECT" && !input.correction) throw new Error("CORRECTION_REQUIRED");
    if (input.decision !== "CORRECT" && input.correction) throw new Error("CORRECTION_NOT_ALLOWED");
    const now = this.clock.now();
    const review: TeacherReview = {
      id: required(input.reviewId, "reviewId"),
      observationId: observation.id,
      reviewerId: actor.actorId,
      reviewedAt: now,
      decision: input.decision,
      rationale: required(input.rationale, "rationale"),
      evidenceRefs: structuredClone(input.evidenceRefs),
      ...(currentReview ? { supersedesReviewId: currentReview.id } : {}),
    };
    const correction: ObservationCorrection | undefined = input.correction ? {
      id: required(input.correction.correctionId, "correctionId"),
      observationId: observation.id,
      createdAt: now,
      actorId: actor.actorId,
      reason: required(input.correction.reason, "correction.reason"),
      ...(observation.corrections.at(-1) ? { supersedesCorrectionId: observation.corrections.at(-1)!.id } : {}),
    } : undefined;
    await this.repository.apply(writeFor(actor, "TEACHER_REVIEW_RECORDED", "TEACHER_REVIEW", review.id, now, {
      kind: "RECORD_REVIEW",
      review,
      ...(correction ? { correction } : {}),
    }, { observationId: observation.id, decision: review.decision }));
    return review;
  }

  async planRetry(actor: ProductStateActor, input: RetryInput): Promise<RetryAttempt> {
    requireRole(actor, "TEACHER");
    const review = await this.repository.getReview(input.reviewId);
    if (!review || review.decision === "ESCALATE") throw new Error("ACTIONABLE_TEACHER_REVIEW_REQUIRED");
    const currentReview = await this.repository.getCurrentReviewForObservation(review.observationId);
    if (!currentReview || currentReview.id !== review.id) throw new Error("CURRENT_ACTIONABLE_TEACHER_REVIEW_REQUIRED");
    const observation = await this.repository.getObservation(review.observationId);
    if (!observation || observation.attemptId !== input.originalAttemptId) throw new Error("REVIEW_ATTEMPT_LINK_REQUIRED");
    const originalAttempt = await this.repository.getAttempt(input.originalAttemptId);
    if (!originalAttempt
      || originalAttempt.status !== "SUBMITTED"
      || originalAttempt.taskId !== input.taskId
      || originalAttempt.episodeId !== input.episodeId) {
      throw new Error("ORIGINAL_ATTEMPT_LINK_REQUIRED");
    }
    const now = this.clock.now();
    const retry: RetryAttempt = {
      id: required(input.retryAttemptId, "retryAttemptId"),
      taskId: originalAttempt.taskId,
      episodeId: originalAttempt.episodeId,
      originalAttemptId: originalAttempt.id,
      reviewId: review.id,
      status: "PLANNED",
      createdAt: now,
    };
    await this.repository.apply(writeFor(actor, "RETRY_PLANNED", "RETRY_ATTEMPT", retry.id, now, {
      kind: "PLAN_RETRY",
      retry,
    }, { originalAttemptId: retry.originalAttemptId, reviewId: retry.reviewId }));
    return retry;
  }

  async submitRetry(actor: ProductStateActor, input: RetrySubmissionInput): Promise<LearnerAttempt> {
    requireRole(actor, "LEARNER");
    const retry = await this.repository.getRetry(input.retryAttemptId);
    if (!retry || retry.status !== "PLANNED") throw new Error("PLANNED_RETRY_REQUIRED");
    const task = await this.repository.getTask(retry.taskId);
    requireActiveTask(task);
    requireTaskAccess(actor, task);
    requireActiveEpisode(await this.repository.getEpisode(retry.episodeId), retry.taskId);
    const now = this.clock.now();
    const attempt: LearnerAttempt = {
      id: required(input.attemptId, "attemptId"),
      taskId: retry.taskId,
      episodeId: retry.episodeId,
      submittedAt: now,
      status: "SUBMITTED",
      artifactRefs: structuredClone(input.artifactRefs),
      evidenceRefs: structuredClone(input.evidenceRefs),
      ...(input.capability ? { capability: structuredClone(input.capability) } : {}),
      supersedesAttemptId: retry.originalAttemptId,
    };
    await this.repository.apply(writeFor(actor, "RETRY_SUBMITTED", "RETRY_ATTEMPT", retry.id, now, {
      kind: "SUBMIT_RETRY",
      retryAttemptId: retry.id,
      attempt,
    }, { attemptId: attempt.id, originalAttemptId: retry.originalAttemptId }));
    return attempt;
  }

  async recordRetryResult(actor: ProductStateActor, input: RetryResultInput): Promise<DiagnosticObservation> {
    requireRole(actor, "FOUNDRY");
    const retry = await this.repository.getRetry(input.retryAttemptId);
    if (!retry || retry.status !== "SUBMITTED" || !retry.attemptId) throw new Error("SUBMITTED_RETRY_REQUIRED");
    if (!input.diagnosisPayload.derivation.sourceRecordIds.includes(retry.attemptId)) {
      throw new Error("RETRY_RESULT_LINEAGE_REQUIRED");
    }
    const currentObservation = await this.repository.getCurrentObservationForAttempt(retry.attemptId);
    if (currentObservation && input.supersedesObservationId !== currentObservation.id) {
      throw new Error("CURRENT_OBSERVATION_SUPERSESSION_REQUIRED");
    }
    if (!currentObservation && input.supersedesObservationId) {
      throw new Error("OBSERVATION_SUPERSESSION_TARGET_NOT_CURRENT");
    }
    if (currentObservation && await this.repository.getCurrentReviewForObservation(currentObservation.id)) {
      throw new Error("REVIEWED_OBSERVATION_CANNOT_BE_SUPERSEDED");
    }
    const now = this.clock.now();
    const observation: DiagnosticObservation = {
      id: required(input.observationId, "observationId"),
      attemptId: retry.attemptId,
      ...(input.supersedesObservationId ? { supersedesObservationId: input.supersedesObservationId } : {}),
      createdAt: now,
      sourceRefs: structuredClone(input.sourceRefs),
      evidenceRefs: structuredClone(input.evidenceRefs),
      provenance: structuredClone(input.provenance),
      diagnosisPayload: structuredClone(input.diagnosisPayload),
      corrections: [],
    };
    await this.repository.apply(writeFor(actor, "RETRY_RESULT_RECORDED", "RETRY_ATTEMPT", retry.id, now, {
      kind: "RECORD_RETRY_RESULT",
      retryAttemptId: retry.id,
      observation,
    }, { attemptId: retry.attemptId, observationId: observation.id }));
    return observation;
  }

  async recordOutcome(actor: ProductStateActor, input: OutcomeInput): Promise<LearningOutcome> {
    requireRole(actor, "TEACHER");
    const retry = await this.repository.getRetry(input.retryAttemptId);
    if (!retry || retry.status !== "COMPLETED") throw new Error("COMPLETED_RETRY_REQUIRED");
    if (await this.repository.getOutcomeForRetry(retry.id)) throw new Error("OUTCOME_ALREADY_RECORDED");
    const now = this.clock.now();
    const outcome: LearningOutcome = {
      id: required(input.outcomeId, "outcomeId"),
      taskId: retry.taskId,
      episodeId: retry.episodeId,
      originalAttemptId: retry.originalAttemptId,
      retryAttemptId: retry.id,
      recordedAt: now,
      outcomeType: input.outcomeType,
      result: input.result,
      evidenceRefs: structuredClone(input.evidenceRefs),
      recordedBy: actor.actorId,
    };
    await this.repository.apply(writeFor(actor, "LEARNING_OUTCOME_RECORDED", "LEARNING_OUTCOME", outcome.id, now, {
      kind: "RECORD_OUTCOME",
      outcome,
    }, { retryAttemptId: retry.id, result: outcome.result }));
    return outcome;
  }

  async getLearningLoop(actor: ProductStateActor, taskId: string): Promise<LearningLoopView> {
    const loop = await this.repository.getLearningLoop(required(taskId, "taskId"));
    if (!loop) throw new Error("LEARNING_TASK_NOT_FOUND");
    requireTaskAccess(actor, loop.task);
    return loop;
  }
}
