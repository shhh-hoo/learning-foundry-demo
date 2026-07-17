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
