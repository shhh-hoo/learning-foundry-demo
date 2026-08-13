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
  readonly teacherId: string;
  readonly learnerId: string;
  readonly status: "OPEN" | "CLOSED";
  readonly goal: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LearningEpisode {
  readonly id: string;
  readonly taskId: string;
  readonly status: "ACTIVE" | "COMPLETED" | "INTERRUPTED";
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface LearnerAttempt {
  readonly id: string;
  readonly taskId: string;
  readonly episodeId: string;
  readonly runtimeSessionId?: string;
  readonly submittedAt: string;
  readonly capability?: VersionedIdentity;
  readonly response: unknown;
  readonly stateSnapshot?: unknown;
  readonly assistanceUsed?: unknown;
}

export interface DiagnosticObservationProposal {
  readonly id: string;
  readonly attemptId: string;
  readonly createdAt: string;
  readonly diagnosis: DerivedRepresentation<unknown>;
  readonly confidence?: number;
  readonly evidenceRefs: readonly string[];
}
