import type { ExecutionPlanV1, ToolId } from "./execution-plan";
import type { EvidenceSufficiencyAssessment, ToolBudgetConsumption } from "./observability";

export type ToolAuthorization =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: "TOOL_NOT_PERMITTED" | "TOOL_BUDGET_EXCEEDED" | "DUPLICATE_TOOL_CALL" | "NEAR_DUPLICATE_TOOL_CALL" | "SECOND_SEARCH_JUSTIFICATION_REQUIRED"; readonly reason: string };

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]));
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : value;
}

function fingerprint(toolId: string, argumentsValue: unknown): string {
  return `${toolId}:${JSON.stringify(normalize(argumentsValue))}`;
}

function query(argumentsValue: unknown): string {
  return argumentsValue && typeof argumentsValue === "object" && "query" in argumentsValue && typeof argumentsValue.query === "string" ? argumentsValue.query : "";
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).filter(Boolean));
}

function querySimilarity(left: string, right: string): number {
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / new Set([...a, ...b]).size;
}

function justification(argumentsValue: unknown): { priorAssessmentId?: string; missingAspect?: string; expectedCoverageGain?: string } {
  if (!argumentsValue || typeof argumentsValue !== "object" || !("retrievalJustification" in argumentsValue)) return {};
  const value = argumentsValue.retrievalJustification;
  return value && typeof value === "object" ? value as ReturnType<typeof justification> : {};
}

/** Applies one immutable Plan to every model-requested tool call. */
export class ToolExecutionGovernor {
  private readonly calls: { readonly toolId: ToolId; readonly argumentsValue: unknown; readonly fingerprint: string }[] = [];
  private readonly consumed = new Map<ToolId, number>();

  constructor(private readonly plan: ExecutionPlanV1) {}

  authorize(toolId: string, argumentsValue: unknown, assessments: readonly EvidenceSufficiencyAssessment[]): ToolAuthorization {
    if (!this.plan.toolPolicy.permitted.includes(toolId as ToolId)) return { allowed: false, code: "TOOL_NOT_PERMITTED", reason: `${toolId} is forbidden by the immutable Execution Plan.` };
    const typedToolId = toolId as ToolId;
    const used = this.consumed.get(typedToolId) ?? 0;
    const maximum = this.plan.toolPolicy.maximumCallsPerTool[typedToolId] ?? 0;
    if (used >= maximum) return { allowed: false, code: "TOOL_BUDGET_EXCEEDED", reason: `${toolId} exhausted its Plan budget (${used}/${maximum}).` };
    const callFingerprint = fingerprint(toolId, argumentsValue);
    if (this.calls.some((call) => call.fingerprint === callFingerprint)) return { allowed: false, code: "DUPLICATE_TOOL_CALL", reason: "An identical tool call cannot add Evidence." };
    if (toolId === "search_learning_resources") {
      const priorSearch = [...this.calls].reverse().find((call) => call.toolId === typedToolId);
      if (priorSearch) {
        if (querySimilarity(query(priorSearch.argumentsValue), query(argumentsValue)) >= 0.8) return { allowed: false, code: "NEAR_DUPLICATE_TOOL_CALL", reason: "The search query is materially equivalent to the previous query." };
        const assessment = [...assessments].reverse().find((item) => item.toolId === toolId);
        const supplied = justification(argumentsValue);
        const permittedOutcome = assessment?.outcome === "LOW_RELEVANCE" || assessment?.outcome === "PARTIAL_COVERAGE";
        const justified = permittedOutcome && assessment.anotherCallJustified
          && supplied.priorAssessmentId === assessment.assessmentId
          && Boolean(supplied.missingAspect && assessment.missingAspects.includes(supplied.missingAspect))
          && Boolean(supplied.expectedCoverageGain?.trim());
        if (!justified) return { allowed: false, code: "SECOND_SEARCH_JUSTIFICATION_REQUIRED", reason: "A second search requires a matching LOW_RELEVANCE or PARTIAL_COVERAGE assessment, explicit missing aspect and expected coverage gain." };
      }
    }
    this.calls.push({ toolId: typedToolId, argumentsValue: structuredClone(argumentsValue), fingerprint: callFingerprint });
    this.consumed.set(typedToolId, used + 1);
    return { allowed: true };
  }

  snapshot(): readonly ToolBudgetConsumption[] {
    return this.plan.toolPolicy.permitted.map((toolId) => ({ toolId, consumed: this.consumed.get(toolId) ?? 0, maximum: this.plan.toolPolicy.maximumCallsPerTool[toolId] }));
  }
}
