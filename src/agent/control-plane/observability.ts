export type { ContextSelectionDecision } from "./execution-plan";

export type EvidenceSufficiencyOutcome =
  | "EXECUTION_FAILED"
  | "NO_RESULTS"
  | "LOW_RELEVANCE"
  | "PARTIAL_COVERAGE"
  | "SUFFICIENT_EVIDENCE";

export interface EvidenceSufficiencyAssessment {
  readonly assessmentId: string;
  readonly toolId: string;
  readonly toolCallIndex: number;
  readonly outcome: EvidenceSufficiencyOutcome;
  readonly topicalFit: "UNKNOWN" | "LOW" | "ADEQUATE";
  readonly sourceAuthority: "UNKNOWN" | "INSUFFICIENT" | "GOVERNED";
  readonly coverage: "NONE" | "PARTIAL" | "SUFFICIENT";
  readonly missingAspects: readonly string[];
  readonly lineageComplete: boolean;
  readonly contaminationRisk: "UNKNOWN" | "NONE" | "DETECTED";
  readonly anotherCallJustified: boolean;
  readonly continueOrStopReason: string;
}

export interface ToolBudgetConsumption {
  readonly toolId: string;
  readonly consumed: number;
  readonly maximum: number;
}

export interface CapabilityIdentity {
  readonly id: string;
  readonly version: string;
}

export type CapabilityResolutionStatus =
  | "REQUESTED_CAPABILITY_FOUND"
  | "REQUESTED_CAPABILITY_NOT_FOUND"
  | "REQUEST_AMBIGUOUS"
  | "REGISTRY_EXECUTION_FAILED";

export interface CapabilityResolutionResult {
  readonly status: CapabilityResolutionStatus;
  readonly registryEvidenceRef?: string;
  readonly returnedCapabilities: readonly CapabilityIdentity[];
  readonly matchedCapabilities: readonly CapabilityIdentity[];
  readonly missingClarification?: string;
  readonly failureCode?: string;
}

export interface ApplicationResponseDisposition {
  readonly status: "ANSWERED" | "NEEDS_MORE_EVIDENCE" | "CAPABILITY_GAP";
  readonly reason: string;
}

export interface TerminalToolRejection {
  readonly toolId: string;
  readonly code: "DUPLICATE_TOOL_CALL" | "NEAR_DUPLICATE_TOOL_CALL" | "SECOND_SEARCH_JUSTIFICATION_REQUIRED" | "TOOL_BUDGET_EXCEEDED";
  readonly reason: string;
  readonly resultRef: string;
}

export interface ToolPhaseState {
  readonly state: "OPEN" | "CLOSED";
  readonly closedAt?: string;
  readonly reason?: string;
}

export type FinalTerminalCondition =
  | "PLAN_REQUIREMENTS_SATISFIED"
  | "EVIDENCE_INSUFFICIENT"
  | "CAPABILITY_NOT_FOUND"
  | "CAPABILITY_AMBIGUOUS"
  | "GOVERNED_WORKFLOW_COMPLETED"
  | "TERMINAL_TOOL_REJECTION"
  | "DETERMINISTIC_FAIL_CLOSED"
  | "REGISTRY_EXECUTION_FAILED";

export type GovernedWorkflowStepStatus = "PENDING" | "COMPLETED" | "BLOCKED";

export interface GovernedWorkflowTrace {
  readonly identity: { readonly id: string; readonly version: string };
  readonly steps: readonly {
    readonly id: string;
    readonly status: GovernedWorkflowStepStatus;
    readonly evidenceRef?: string;
    readonly reason?: string;
  }[];
}
