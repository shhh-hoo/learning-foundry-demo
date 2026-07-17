import type { AgentToolCallRecord } from "../types";
import type { GovernedWorkflowTrace } from "./observability";

const STEPS = [
  "INSPECT_CAPABILITY",
  "RESOLVE_CAPABILITY",
  "VALIDATE_PROBLEM_PROVENANCE",
  "VALIDATE_ATTEMPT",
  "EXECUTE_CAPABILITY",
  "VALIDATE_PERSISTED_RESULT",
  "COMPOSE_RESPONSE",
] as const;

const TOOL_STEPS = [
  { tool: "list_capabilities", completesThrough: 0 },
  { tool: "get_capability", completesThrough: 1 },
  // The capability Adapter validates provenance and Attempt before execution,
  // then resolves the persisted result before returning success.
  { tool: "run_learner_diagnosis", completesThrough: 5 },
] as const;

/** Known-order governed work. The model supplies language/arguments, never step order. */
export class DiagnosisWorkflow {
  readonly identity = { id: "LEARNER_DIAGNOSIS", version: "1.0.0" } as const;

  nextTool(records: readonly AgentToolCallRecord[]): "list_capabilities" | "get_capability" | "run_learner_diagnosis" | null {
    for (const step of TOOL_STEPS) {
      const calls = records.filter((record) => record.name === step.tool && !this.preExecutionRejection(record));
      if (calls.some((call) => call.status === "SUCCEEDED")) continue;
      if (calls.some((call) => call.status === "FAILED")) return null;
      return step.tool;
    }
    return null;
  }

  trace(records: readonly AgentToolCallRecord[], responseComposed = false): GovernedWorkflowTrace {
    let completedThrough = -1;
    let blockedAt = -1;
    let blockedReason: string | undefined;
    for (const step of TOOL_STEPS) {
      const calls = records.filter((record) => record.name === step.tool && !this.preExecutionRejection(record));
      const success = calls.find((call) => call.status === "SUCCEEDED");
      if (success) { completedThrough = step.completesThrough; continue; }
      const failure = calls.find((call) => call.status === "FAILED");
      if (failure) { blockedAt = Math.max(completedThrough + 1, step.completesThrough === 5 ? 2 : step.completesThrough); blockedReason = `${step.tool} failed (${failure.resultRef}).`; }
      break;
    }
    return {
      identity: this.identity,
      steps: STEPS.map((id, index) => {
        if (index <= completedThrough) {
          const evidence = index === 0 ? records.find((record) => record.name === "list_capabilities" && record.status === "SUCCEEDED")?.resultRef
            : index === 1 ? records.find((record) => record.name === "get_capability" && record.status === "SUCCEEDED")?.resultRef
              : index <= 5 ? records.find((record) => record.name === "run_learner_diagnosis" && record.status === "SUCCEEDED")?.resultRef : undefined;
          return { id, status: "COMPLETED" as const, ...(evidence ? { evidenceRef: evidence } : {}) };
        }
        if (index === STEPS.length - 1 && responseComposed && completedThrough >= 5) return { id, status: "COMPLETED" as const };
        if (blockedAt >= 0 && index >= blockedAt) return { id, status: "BLOCKED" as const, ...(index === blockedAt && blockedReason ? { reason: blockedReason } : {}) };
        return { id, status: "PENDING" as const };
      }),
    };
  }

  private preExecutionRejection(record: AgentToolCallRecord): boolean {
    return Boolean(record.arguments && typeof record.arguments === "object"
      && ("invalidJson" in record.arguments || "rejectedByRoute" in record.arguments));
  }
}
