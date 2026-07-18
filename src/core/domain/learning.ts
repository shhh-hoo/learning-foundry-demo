import type {
  ArtifactReference,
  EvidenceReference,
  SourceReference,
} from "./evidence";
import type { VersionedIdentity } from "./capability";

export interface DerivedRepresentation<T> {
  readonly representationVersion: string;
  readonly derivedAt: string;
  readonly derivation: {
    readonly kind: "MODEL" | "DETERMINISTIC" | "PROJECTION";
    readonly implementationId: string;
    readonly implementationVersion: string;
    readonly sourceRecordIds: readonly string[];
  };
  readonly value: T;
}

export interface LearningTask {
  readonly id: string;
  readonly learnerId: string;
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  readonly goal: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly materialRefs: readonly ArtifactReference[];
}

export interface LearningEpisode {
  readonly id: string;
  readonly taskId: string;
  readonly status: "ACTIVE" | "COMPLETED" | "INTERRUPTED";
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly summary?: DerivedRepresentation<string>;
}

export interface ConversationEvent {
  readonly id: string;
  readonly taskId: string;
  readonly episodeId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly actor: "LEARNER" | "TEACHER" | "FOUNDRY" | "SYSTEM";
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly artifactRefs: readonly ArtifactReference[];
  readonly sourceRefs: readonly SourceReference[];
  readonly evidenceRefs: readonly EvidenceReference[];
}

export interface LearnerAttempt {
  readonly id: string;
  readonly taskId: string;
  readonly episodeId: string;
  readonly submittedAt: string;
  readonly status: "SUBMITTED" | "SUPERSEDED";
  readonly artifactRefs: readonly ArtifactReference[];
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly capability?: VersionedIdentity;
  readonly supersedesAttemptId?: string;
}

export interface ObservationCorrection {
  readonly id: string;
  readonly observationId: string;
  readonly createdAt: string;
  readonly actorId: string;
  readonly reason: string;
  readonly supersedesCorrectionId?: string;
}

export interface DiagnosticObservation {
  readonly id: string;
  readonly attemptId: string;
  readonly supersedesObservationId?: string;
  readonly createdAt: string;
  readonly sourceRefs: readonly SourceReference[];
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly provenance: {
    readonly capability?: VersionedIdentity;
    readonly executionId: string;
    readonly policyVersion: string;
  };
  readonly diagnosisPayload: DerivedRepresentation<unknown>;
  readonly corrections: readonly ObservationCorrection[];
}

export interface TeacherReview {
  readonly id: string;
  readonly observationId: string;
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly decision: "ACCEPT" | "CORRECT" | "ESCALATE";
  readonly rationale: string;
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly supersedesReviewId?: string;
}

export interface RetryAttempt {
  readonly id: string;
  readonly taskId: string;
  readonly episodeId: string;
  readonly originalAttemptId: string;
  readonly reviewId: string;
  readonly attemptId?: string;
  readonly status: "PLANNED" | "SUBMITTED" | "COMPLETED" | "CANCELLED";
  readonly createdAt: string;
}

export interface LearningOutcome {
  readonly id: string;
  readonly taskId: string;
  readonly episodeId: string;
  readonly originalAttemptId: string;
  readonly retryAttemptId: string;
  readonly recordedAt: string;
  readonly outcomeType: "RETRY" | "TRANSFER" | "RETENTION";
  readonly result: "IMPROVED" | "UNCHANGED" | "REGRESSED" | "INCONCLUSIVE";
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly recordedBy: string;
}

export type ProductRecordKind =
  | "LEARNING_TASK"
  | "LEARNING_EPISODE"
  | "CONVERSATION_EVENT"
  | "LEARNER_ATTEMPT"
  | "DIAGNOSTIC_OBSERVATION"
  | "TEACHER_REVIEW"
  | "RETRY_ATTEMPT"
  | "LEARNING_OUTCOME"
  | "RUNTIME_TRACE"
  | "RETRIEVAL_TRACE"
  | "AGENT_TRACE";

type RecordAuthority = {
  readonly record: "CANONICAL" | "DERIVED_OPERATIONAL_EVIDENCE";
  readonly derivedFields: readonly string[];
};

const authority: Readonly<Record<ProductRecordKind, RecordAuthority>> = {
  LEARNING_TASK: { record: "CANONICAL", derivedFields: [] },
  LEARNING_EPISODE: { record: "CANONICAL", derivedFields: ["summary"] },
  CONVERSATION_EVENT: { record: "CANONICAL", derivedFields: [] },
  LEARNER_ATTEMPT: { record: "CANONICAL", derivedFields: [] },
  DIAGNOSTIC_OBSERVATION: { record: "CANONICAL", derivedFields: ["diagnosisPayload"] },
  TEACHER_REVIEW: { record: "CANONICAL", derivedFields: [] },
  RETRY_ATTEMPT: { record: "CANONICAL", derivedFields: [] },
  LEARNING_OUTCOME: { record: "CANONICAL", derivedFields: [] },
  RUNTIME_TRACE: { record: "DERIVED_OPERATIONAL_EVIDENCE", derivedFields: ["record"] },
  RETRIEVAL_TRACE: { record: "DERIVED_OPERATIONAL_EVIDENCE", derivedFields: ["record"] },
  AGENT_TRACE: { record: "DERIVED_OPERATIONAL_EVIDENCE", derivedFields: ["record"] },
};

export function productRecordAuthority(kind: ProductRecordKind): RecordAuthority {
  return structuredClone(authority[kind]);
}
