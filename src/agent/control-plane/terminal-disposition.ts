import type { AgentExecutionPlan, AgentRoute, AgentToolCallRecord } from "../types";
import type {
  ApplicationResponseDisposition,
  CapabilityResolutionResult,
  EvidenceSufficiencyAssessment,
  TerminalToolRejection,
  ToolBudgetConsumption,
} from "./observability";

interface DispositionInput {
  readonly plan: AgentExecutionPlan;
  readonly route: AgentRoute;
  readonly records: readonly AgentToolCallRecord[];
  readonly assessments: readonly EvidenceSufficiencyAssessment[];
  readonly budget: readonly ToolBudgetConsumption[];
  readonly capabilityResolution?: CapabilityResolutionResult;
  readonly terminalToolRejection?: TerminalToolRejection;
}

function succeeded(records: readonly AgentToolCallRecord[], toolId: string): boolean {
  return records.some((record) => record.name === toolId && record.status === "SUCCEEDED");
}

/** Derives a terminal response status from Foundry policy evidence, never model preference. */
export function deriveApplicationResponseDisposition(input: DispositionInput): ApplicationResponseDisposition | null {
  const latestRetrieval = [...input.assessments].reverse().find((assessment) => assessment.toolId === "search_learning_resources");
  if (input.route === "COURSE_EXPLANATION" && latestRetrieval) {
    if (latestRetrieval.outcome === "SUFFICIENT_EVIDENCE") return {
      status: "ANSWERED",
      reason: "The latest governed retrieval assessment is sufficient.",
    };
    const retrievalBudget = input.budget.find((item) => item.toolId === "search_learning_resources");
    const justifiedSearchRemains = latestRetrieval.anotherCallJustified
      && Boolean(retrievalBudget && retrievalBudget.consumed < retrievalBudget.maximum)
      && !input.terminalToolRejection;
    if (justifiedSearchRemains) return null;
    return {
      status: "NEEDS_MORE_EVIDENCE",
      reason: input.terminalToolRejection?.reason ?? latestRetrieval.continueOrStopReason,
    };
  }

  const capability = input.capabilityResolution;
  if (capability?.status === "REGISTRY_EXECUTION_FAILED") return null;
  if (capability?.status === "REQUESTED_CAPABILITY_NOT_FOUND") {
    if (input.route === "CAPABILITY_GAP" && succeeded(input.records, "record_capability_gap")) return {
      status: "CAPABILITY_GAP",
      reason: "Registry inspection found no requested capability and the governed gap record succeeded.",
    };
    if (input.route === "CAPABILITY_GAP" && input.plan.toolPolicy.permitted.includes("record_capability_gap")) return null;
    return { status: "NEEDS_MORE_EVIDENCE", reason: "The governed Registry did not return the requested capability." };
  }
  if (capability?.status === "REQUEST_AMBIGUOUS") return {
    status: "NEEDS_MORE_EVIDENCE",
    reason: capability.missingClarification ?? "The requested capability is ambiguous.",
  };

  if (input.route === "LEARNER_DIAGNOSIS_INCOMPLETE") return {
    status: "NEEDS_MORE_EVIDENCE",
    reason: "The original problem or complete learner Attempt is missing.",
  };
  if (input.route === "LEARNER_DIAGNOSIS_COMPLETE" && succeeded(input.records, "run_learner_diagnosis")) return {
    status: "ANSWERED",
    reason: "The governed Diagnosis sequence completed with a persisted result.",
  };
  if (capability?.status === "REQUESTED_CAPABILITY_FOUND" && input.plan.intent === "CAPABILITY_DISCOVERY") return {
    status: "ANSWERED",
    reason: "Exactly one requested capability was resolved from Registry evidence.",
  };
  return null;
}
