import type { DiagnosisCategory, DiagnosisFailureCode, DiagnosticLearningComponent, PublishedDiagnosticLearningComponent } from "../contracts/diagnostic-component";
import type { FoundryEvaluationReport } from "../governance/evaluation";

export interface ConversationMessage {
  readonly id: string;
  readonly role: "STUDENT" | "SYSTEM";
  readonly content: string;
}

export interface LearningConversation {
  readonly id: string;
  readonly messages: readonly ConversationMessage[];
  readonly retrievedSourceIds: readonly string[];
  readonly selectedCapabilityId: string;
  readonly selectedComponentId: string;
}

export interface GroundedDiagnosis {
  readonly stage: DiagnosisCategory;
  readonly failureCode: DiagnosisFailureCode;
  readonly groundedResponse: string;
  readonly observedRatio: number;
  readonly expectedRatio: number;
}

export interface DiagnosticEvidenceArtifact {
  readonly id: string;
  readonly conversationId: string;
  readonly componentId: string;
  readonly componentVersion: string;
  readonly stage: DiagnosisCategory;
  readonly failureCode: DiagnosisFailureCode;
  readonly observedEvidence: Readonly<Record<string, number | string>>;
  readonly createdAt: string;
}

export interface LearningArtifact {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly createdAt: string;
}

export interface ScheduleItem {
  readonly id: string;
  readonly title: string;
  readonly dueAt: string;
  readonly reason: string;
  readonly status: "SCHEDULED" | "COMPLETED";
}

export interface ComponentCandidate {
  readonly id: string;
  readonly source: "CONVERSATION_DERIVED";
  readonly sourceConversationIds: readonly string[];
  readonly sourceEvidenceIds: readonly string[];
  readonly pattern: {
    readonly stage: DiagnosisCategory;
    readonly failureCode: DiagnosisFailureCode;
    readonly occurrenceCount: number;
  };
  readonly proposedChange: string;
  readonly status: "DETECTED" | "PROMOTED_TO_FOUNDRY" | "EVALUATED" | "APPROVED" | "PUBLISHED";
}

export interface ExperienceState {
  readonly conversation: LearningConversation;
  readonly diagnosis: GroundedDiagnosis | null;
  readonly evidence: readonly DiagnosticEvidenceArtifact[];
  readonly learningArtifacts: readonly LearningArtifact[];
  readonly schedule: readonly ScheduleItem[];
  readonly candidate: ComponentCandidate;
  readonly publishedCandidate: PublishedDiagnosticLearningComponent | null;
}

export interface FoundryCandidateHandoff {
  readonly component: DiagnosticLearningComponent;
  readonly evaluation: FoundryEvaluationReport | null;
  readonly candidateSource: {
    readonly kind: "CONVERSATION_DERIVED";
    readonly conversationIds: readonly string[];
    readonly evidenceIds: readonly string[];
    readonly candidateId: string;
  };
}
