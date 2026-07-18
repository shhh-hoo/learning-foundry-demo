import type { ExecutionPlanV1, ToolId } from "./execution-plan";
import type { EvidenceSufficiencyAssessment, ToolBudgetConsumption } from "./observability";

export type ToolAuthorization =
  | { readonly allowed: true; readonly disposition: "ALLOW" }
  | { readonly allowed: false; readonly disposition: "REJECT_RECOVERABLE"; readonly code: "TOOL_NOT_PERMITTED" | "TOOL_NOT_AVAILABLE_ON_ROUTE" | "TOOL_BUDGET_EXCEEDED" | "DUPLICATE_TOOL_CALL" | "NEAR_DUPLICATE_TOOL_CALL" | "SECOND_SEARCH_JUSTIFICATION_REQUIRED"; readonly reason: string }
  | { readonly allowed: false; readonly disposition: "REJECT_TERMINAL"; readonly code: "TOOL_BUDGET_EXCEEDED" | "DUPLICATE_TOOL_CALL" | "NEAR_DUPLICATE_TOOL_CALL" | "SECOND_SEARCH_JUSTIFICATION_REQUIRED"; readonly reason: string };

interface AuthorizationContext {
  readonly routeAvailable: boolean;
  readonly availableAlternativeTools: readonly string[];
  readonly governedWorkflowStepRemaining: boolean;
}

const DEFAULT_CONTEXT: AuthorizationContext = {
  routeAvailable: true,
  availableAlternativeTools: [],
  governedWorkflowStepRemaining: false,
};

const TERMINAL_REJECTION_CODES = new Set([
  "TOOL_BUDGET_EXCEEDED",
  "DUPLICATE_TOOL_CALL",
  "NEAR_DUPLICATE_TOOL_CALL",
  "SECOND_SEARCH_JUSTIFICATION_REQUIRED",
]);

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

  authorize(toolId: string, argumentsValue: unknown, assessments: readonly EvidenceSufficiencyAssessment[], context: AuthorizationContext = DEFAULT_CONTEXT): ToolAuthorization {
    const reject = (code: Exclude<ToolAuthorization, { allowed: true }>["code"], reason: string): ToolAuthorization => {
      const terminal = TERMINAL_REJECTION_CODES.has(code)
        && assessments.length > 0
        && context.availableAlternativeTools.length === 0
        && !context.governedWorkflowStepRemaining;
      if (terminal) return { allowed: false, disposition: "REJECT_TERMINAL", code: code as Extract<ToolAuthorization, { disposition: "REJECT_TERMINAL" }>["code"], reason };
      return { allowed: false, disposition: "REJECT_RECOVERABLE", code, reason };
    };
    if (!this.plan.toolPolicy.permitted.includes(toolId as ToolId)) return reject("TOOL_NOT_PERMITTED", `${toolId} is forbidden by the immutable Execution Plan.`);
    const typedToolId = toolId as ToolId;
    const used = this.consumed.get(typedToolId) ?? 0;
    const maximum = this.plan.toolPolicy.maximumCallsPerTool[typedToolId] ?? 0;
    if (used >= maximum) return reject("TOOL_BUDGET_EXCEEDED", `${toolId} exhausted its Plan budget (${used}/${maximum}).`);
    const callFingerprint = fingerprint(toolId, argumentsValue);
    if (this.calls.some((call) => call.fingerprint === callFingerprint)) return reject("DUPLICATE_TOOL_CALL", "An identical tool call cannot add Evidence.");
    if (toolId === "search_learning_resources") {
      const priorSearch = [...this.calls].reverse().find((call) => call.toolId === typedToolId);
      if (priorSearch) {
        if (querySimilarity(query(priorSearch.argumentsValue), query(argumentsValue)) >= 0.8) return reject("NEAR_DUPLICATE_TOOL_CALL", "The search query is materially equivalent to the previous query.");
        const assessment = [...assessments].reverse().find((item) => item.toolId === toolId);
        const supplied = justification(argumentsValue);
        const permittedOutcome = assessment?.outcome === "LOW_RELEVANCE" || assessment?.outcome === "PARTIAL_COVERAGE";
        const justified = permittedOutcome && assessment.anotherCallJustified
          && supplied.priorAssessmentId === assessment.assessmentId
          && Boolean(supplied.missingAspect && assessment.missingAspects.includes(supplied.missingAspect))
          && Boolean(supplied.expectedCoverageGain?.trim());
        if (!justified) return reject("SECOND_SEARCH_JUSTIFICATION_REQUIRED", "A second search requires a matching LOW_RELEVANCE or PARTIAL_COVERAGE assessment, explicit missing aspect and expected coverage gain.");
      }
    }
    if (!context.routeAvailable) return reject("TOOL_NOT_AVAILABLE_ON_ROUTE", `${toolId} is not available at this route step.`);
    this.calls.push({ toolId: typedToolId, argumentsValue: structuredClone(argumentsValue), fingerprint: callFingerprint });
    this.consumed.set(typedToolId, used + 1);
    return { allowed: true, disposition: "ALLOW" };
  }

  snapshot(): readonly ToolBudgetConsumption[] {
    return this.plan.toolPolicy.permitted.map((toolId) => ({ toolId, consumed: this.consumed.get(toolId) ?? 0, maximum: this.plan.toolPolicy.maximumCallsPerTool[toolId] }));
  }
}
