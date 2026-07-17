import type {
  ConversationEvent,
  DiagnosticObservation,
  LearningEpisode,
  LearningOutcome,
  LearningTask,
  LearnerAttempt,
  ObservationCorrection,
  RetryAttempt,
  TeacherReview,
} from "../domain/learning";

export const PRODUCT_STATE_SCHEMA_VERSION = "1.0.0" as const;

export type ProductStateEventType =
  | "LEARNING_TASK_CREATED"
  | "LEARNING_EPISODE_STARTED"
  | "CONVERSATION_EVENT_APPENDED"
  | "LEARNER_ATTEMPT_SUBMITTED"
  | "DIAGNOSTIC_OBSERVATION_RECORDED"
  | "TEACHER_REVIEW_RECORDED"
  | "RETRY_PLANNED"
  | "RETRY_SUBMITTED"
  | "RETRY_RESULT_RECORDED"
  | "LEARNING_OUTCOME_RECORDED"
  | "LEGACY_SNAPSHOT_IMPORTED";

export interface ProductStateActor {
  readonly actorId: string;
  readonly role: "LEARNER" | "TEACHER" | "FOUNDRY" | "SYSTEM";
}

export interface ProductStateDecisionRecord {
  readonly schemaVersion: typeof PRODUCT_STATE_SCHEMA_VERSION;
  readonly id: string;
  readonly eventType: ProductStateEventType;
  readonly actor: ProductStateActor;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ProductStateOutboxMessage {
  readonly schemaVersion: typeof PRODUCT_STATE_SCHEMA_VERSION;
  readonly id: string;
  readonly eventType: ProductStateEventType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type ProductStateMutation =
  | { readonly kind: "CREATE_TASK"; readonly task: LearningTask }
  | { readonly kind: "START_EPISODE"; readonly episode: LearningEpisode }
  | { readonly kind: "APPEND_CONVERSATION_EVENT"; readonly event: ConversationEvent }
  | { readonly kind: "SUBMIT_ATTEMPT"; readonly attempt: LearnerAttempt }
  | { readonly kind: "RECORD_OBSERVATION"; readonly observation: DiagnosticObservation }
  | {
      readonly kind: "RECORD_REVIEW";
      readonly review: TeacherReview;
      readonly correction?: ObservationCorrection;
    }
  | { readonly kind: "PLAN_RETRY"; readonly retry: RetryAttempt }
  | {
      readonly kind: "SUBMIT_RETRY";
      readonly retryAttemptId: string;
      readonly attempt: LearnerAttempt;
    }
  | {
      readonly kind: "RECORD_RETRY_RESULT";
      readonly retryAttemptId: string;
      readonly observation: DiagnosticObservation;
    }
  | { readonly kind: "RECORD_OUTCOME"; readonly outcome: LearningOutcome };

export interface ProductStateWrite {
  readonly mutation: ProductStateMutation;
  readonly decision: ProductStateDecisionRecord;
  readonly outbox: ProductStateOutboxMessage;
}

export interface LearningLoopView {
  readonly task: LearningTask;
  readonly episodes: readonly LearningEpisode[];
  readonly conversationEvents: readonly ConversationEvent[];
  readonly attempts: readonly LearnerAttempt[];
  readonly observations: readonly DiagnosticObservation[];
  readonly reviews: readonly TeacherReview[];
  readonly retries: readonly RetryAttempt[];
  readonly outcomes: readonly LearningOutcome[];
}

export interface ProductStateHealth {
  readonly ready: boolean;
  readonly schemaVersion: string | null;
  readonly readOnly: boolean;
}

export interface LegacyImportReceipt {
  readonly schemaVersion: typeof PRODUCT_STATE_SCHEMA_VERSION;
  readonly id: string;
  readonly sourceSystem: "LEGACY_SHOWCASE";
  readonly sourceKey: string;
  readonly sourceHash: string;
  readonly importedAt: string;
  readonly importedBy: string;
  readonly taskId: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface LegacyProductStateBundle {
  readonly task: LearningTask;
  readonly episode: LearningEpisode;
  readonly conversationEvents: readonly ConversationEvent[];
  readonly receipt: LegacyImportReceipt;
  readonly decision: ProductStateDecisionRecord;
  readonly outbox: ProductStateOutboxMessage;
}

export interface ProductStateImportDecision {
  readonly schemaVersion: typeof PRODUCT_STATE_SCHEMA_VERSION;
  readonly id: string;
  readonly environment: string;
  readonly decision: "IMPORT_COMPLETED" | "NO_IMPORT_REQUIRED";
  readonly decidedAt: string;
  readonly decidedBy: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface ProductStateCutoverAcceptance {
  readonly schemaVersion: typeof PRODUCT_STATE_SCHEMA_VERSION;
  readonly id: string;
  readonly environment: string;
  readonly mode: "POSTGRES_CANONICAL";
  readonly acceptedAt: string;
  readonly acceptedBy: string;
  readonly migrationVersion: string;
  readonly databaseReady: true;
  readonly importerDecisionId: string;
  readonly dualWrite: false;
  readonly notes: string;
}

/**
 * Async persistence port for the canonical learning bounded context.
 * Implementations atomically persist the mutation, append-only decision and
 * outbox message. They do not own application permissions or lifecycle policy.
 */
export interface ProductStateRepository {
  apply(write: ProductStateWrite): Promise<void>;
  getTask(taskId: string): Promise<LearningTask | null>;
  getEpisode(episodeId: string): Promise<LearningEpisode | null>;
  getAttempt(attemptId: string): Promise<LearnerAttempt | null>;
  getObservation(observationId: string): Promise<DiagnosticObservation | null>;
  getReview(reviewId: string): Promise<TeacherReview | null>;
  getRetry(retryAttemptId: string): Promise<RetryAttempt | null>;
  getOutcomeForRetry(retryAttemptId: string): Promise<LearningOutcome | null>;
  nextConversationEventSequence(episodeId: string): Promise<number>;
  getLearningLoop(taskId: string): Promise<LearningLoopView | null>;
  health(): Promise<ProductStateHealth>;
}

export interface ProductStateAdministrationRepository {
  getLegacyImportReceipt(sourceSystem: "LEGACY_SHOWCASE", sourceKey: string): Promise<LegacyImportReceipt | null>;
  importLegacyBundle(bundle: LegacyProductStateBundle): Promise<void>;
  recordImportDecision(decision: ProductStateImportDecision): Promise<void>;
  getImportDecision(environment: string): Promise<ProductStateImportDecision | null>;
  recordCutoverAcceptance(acceptance: ProductStateCutoverAcceptance): Promise<void>;
  getCutoverAcceptance(environment: string): Promise<ProductStateCutoverAcceptance | null>;
}

export type CanonicalProductStateRepository = ProductStateRepository & ProductStateAdministrationRepository;
