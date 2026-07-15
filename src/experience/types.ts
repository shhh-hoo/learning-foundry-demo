import type { PublishedDiagnosticLearningComponent, DiagnosticLearningComponent } from "../contracts/diagnostic-component";
import type { DemoEvent } from "../demo/events";
import type { ComponentContractCheckReport } from "../governance/component-contract-checks";
import type { AgentResponseEnvelope, AgentTrace, InputOrigin } from "../agent/types";

export interface ProductMessage {
  readonly id: string;
  readonly role: "USER" | "AGENT";
  readonly content: string;
  readonly inputOrigin?: InputOrigin;
  readonly sourceRefs?: readonly string[];
}

export interface LearnerDiagnosisRecord {
  readonly traceId: string;
  readonly agentTraceId: string;
  readonly inputOrigin: InputOrigin;
  readonly origin: "TOOL_OUTPUT";
  readonly componentId: string;
  readonly componentVersion: string;
  readonly decision: "SOLVED" | "STUDENT_ERROR" | "INCOMPLETE_EVIDENCE";
  readonly firstPedagogicalIssue: string | null;
  readonly failureCode: string | null;
  readonly evidence: readonly string[];
  readonly recommendedSupport: string | null;
  readonly createdAt: string;
}

export interface HumanLibraryArtifact {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly origin: "HUMAN_ACTION";
  readonly createdAt: string;
}

export interface HumanScheduleItem {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
  readonly dueAt: string;
  readonly status: "SCHEDULED" | "COMPLETED";
  readonly origin: "HUMAN_ACTION";
}

export interface CapabilityGapRecord {
  readonly id: string;
  readonly summary: string;
  readonly missingEvidence: readonly string[];
  readonly origin: "TOOL_OUTPUT";
}

export interface ComponentCandidate {
  readonly id: string;
  readonly source: "ACTUAL_AGENT_RUNS";
  readonly sourceTraceIds: readonly string[];
  readonly sourceDiagnosisTraceIds: readonly string[];
  readonly sourceAgentTraceIds: readonly string[];
  readonly pattern: { readonly componentId: string; readonly failureCode: string; readonly occurrenceCount: number };
  readonly proposedChange: string;
  readonly status: "CREATED" | "PROMOTED_TO_FOUNDRY" | "CHECKED" | "APPROVED" | "PUBLISHED";
}

export interface ExperienceState {
  readonly conversationId: string;
  readonly messages: readonly ProductMessage[];
  readonly agentConfigured: boolean | null;
  readonly gatewayModel: string | null;
  readonly agentTraces: readonly AgentTrace[];
  readonly diagnoses: readonly LearnerDiagnosisRecord[];
  readonly library: readonly HumanLibraryArtifact[];
  readonly schedule: readonly HumanScheduleItem[];
  readonly capabilityGaps: readonly CapabilityGapRecord[];
  readonly pendingResponse: AgentResponseEnvelope | null;
  readonly candidate: ComponentCandidate | null;
  readonly publishedCandidate: PublishedDiagnosticLearningComponent | null;
  readonly registryAccepted: boolean;
  readonly eventLog: readonly DemoEvent[];
}

export interface PatternAggregate {
  readonly componentId: string | null;
  readonly failureCode: string | null;
  readonly occurrenceCount: number;
  readonly threshold: number;
  readonly thresholdReached: boolean;
  readonly traceIds: readonly string[];
  readonly agentTraceIds: readonly string[];
}

export interface ComponentRevisionRecord {
  readonly baseComponentVersion: string;
  readonly changedField: string;
  readonly beforeValue: string;
  readonly afterValue: string;
  readonly teacherRationale: string;
  readonly sourceDiagnosisTraceIds: readonly string[];
  readonly sourceAgentTraceIds: readonly string[];
  readonly changedAt: string;
}

export interface FoundryCandidateHandoff {
  readonly baseComponent: PublishedDiagnosticLearningComponent;
  readonly component: DiagnosticLearningComponent;
  readonly contractChecks: ComponentContractCheckReport | null;
  readonly revision: ComponentRevisionRecord | null;
  readonly candidateSource: { readonly kind: "ACTUAL_AGENT_RUNS"; readonly diagnosisTraceIds: readonly string[]; readonly agentTraceIds: readonly string[]; readonly candidateId: string };
}

export interface GatewayToolResult {
  readonly name: string;
  readonly resultRef: string;
  readonly data: unknown;
}
