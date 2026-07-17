import type { AgentObligations, AgentRoute } from "../types";

export type ExecutionMode =
  | "DIRECT_MODEL"
  | "BOUNDED_AGENT"
  | "GOVERNED_WORKFLOW"
  | "DETERMINISTIC_CAPABILITY"
  | "PRODUCT_ACTION";

export type ExecutionIntent =
  | "OPEN_EXPLANATION"
  | "CONCRETE_CALCULATION"
  | "COMPLETE_ATTEMPT_DIAGNOSIS"
  | "INCOMPLETE_ATTEMPT_DIAGNOSIS"
  | "CAPABILITY_DISCOVERY"
  | "GENERAL_ASSISTANCE"
  | "PRODUCT_ACTION";

export interface GovernedWorkflowIdentity {
  readonly id: string;
  readonly version: string;
}
export type ExecutionDirective =
  | { readonly mode: "DIRECT_MODEL" }
  | { readonly mode: "BOUNDED_AGENT" }
  | { readonly mode: "GOVERNED_WORKFLOW"; readonly workflow: GovernedWorkflowIdentity }
  | { readonly mode: "DETERMINISTIC_CAPABILITY" }
  | { readonly mode: "PRODUCT_ACTION" };

export type ToolId =
  | "search_learning_resources"
  | "list_capabilities"
  | "get_capability"
  | "run_learner_diagnosis"
  | "record_capability_gap"
  | "propose_library_artifact"
  | "propose_schedule_followup";

export type ContextSelectionReason = "CURRENT_REQUEST" | "TASK_LOCAL_HISTORY";
export type ContextExclusionReason = "OTHER_TASK" | "STALE" | "SUPERSEDED" | "OUTSIDE_CONTEXT_BUDGET";

export interface ContextSelectionDecision {
  readonly schemaVersion: "1.0.0";
  readonly activeTaskId?: string;
  readonly activeEpisodeId?: string;
  readonly candidateMessageIndexes: readonly number[];
  readonly selectedMessageIndexes: readonly number[];
  readonly excludedContextItems: readonly { readonly messageIndex: number; readonly reason: ContextExclusionReason }[];
  readonly selectionReasons: readonly { readonly messageIndex: number; readonly reason: ContextSelectionReason }[];
  readonly contextPolicyVersion: "1.0.0";
}

export type TerminalCondition =
  | "PLAN_REQUIREMENTS_SATISFIED"
  | "EVIDENCE_INSUFFICIENT"
  | "TOOL_BUDGET_EXHAUSTED"
  | "GOVERNED_WORKFLOW_BLOCKED"
  | "MODEL_STEP_BUDGET_EXHAUSTED";

export type EvidenceRequirement =
  | "GOVERNED_SOURCE"
  | "CAPABILITY_REGISTRY"
  | "PERSISTED_WORKFLOW_RESULT";

export interface ExecutionPlanV1 {
  readonly schemaVersion: "1.0.0";
  readonly intent: ExecutionIntent;
  readonly execution: ExecutionDirective;
  readonly route: AgentRoute;
  readonly obligations: AgentObligations;
  readonly contextSelection: ContextSelectionDecision;
  readonly toolPolicy: {
    readonly permitted: readonly ToolId[];
    readonly required: readonly ToolId[];
    readonly forbidden: readonly ToolId[];
    readonly maximumModelSteps: number;
    readonly maximumCallsPerTool: Readonly<Record<ToolId, number>>;
  };
  readonly terminalConditions: readonly TerminalCondition[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
}

export function immutablePlan<T extends object>(value: T): Readonly<T> {
  const freeze = (item: unknown): unknown => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return item;
    for (const nested of Object.values(item)) freeze(nested);
    return Object.freeze(item);
  };
  return freeze(structuredClone(value)) as Readonly<T>;
}
