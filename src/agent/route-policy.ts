import type { AgentResponseEnvelope, AgentRunRequest, AgentToolCallRecord } from "./types";

export type AgentRoute = "COURSE_EXPLANATION" | "LEARNER_DIAGNOSIS_COMPLETE" | "LEARNER_DIAGNOSIS_INCOMPLETE" | "CAPABILITY_GAP" | "GENERAL";

interface SuccessfulToolResult { readonly name: string; readonly data: unknown }

function currentUserMessage(request: AgentRunRequest): string {
  return [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function looksLikeCompleteCalculationAttempt(input: string): boolean {
  return /(?:->|→|⇌)/u.test(input)
    && /\b(?:problem|original problem|calculate|find)\b/iu.test(input)
    && /\b(?:working|got|ratio|reported|my full working|check it|diagnose)\b/iu.test(input)
    && /\d/u.test(input);
}

function looksLikeIncompleteWorking(input: string): boolean {
  return /\b(?:working only|partial line|incomplete working|where is my first mistake|diagnose the first issue)\b/iu.test(input)
    && !looksLikeCompleteCalculationAttempt(input);
}

function looksLikeExplanation(input: string): boolean {
  return /^(?:why|how|explain|what evidence|which titres|find the course source|what does the syllabus)/iu.test(input.trim())
    || /\b(?:course explanation|course source|learning outcome)\b/iu.test(input);
}

export function classifyAgentRoute(request: AgentRunRequest, response?: AgentResponseEnvelope): AgentRoute {
  const input = currentUserMessage(request);
  if (looksLikeCompleteCalculationAttempt(input)) return "LEARNER_DIAGNOSIS_COMPLETE";
  if (looksLikeIncompleteWorking(input)) return "LEARNER_DIAGNOSIS_INCOMPLETE";
  if (looksLikeExplanation(input)) return "COURSE_EXPLANATION";
  if (/\b(?:capability gap|unsupported|arbitrary|multi-stage|entire route)\b/iu.test(input) || response?.status === "CAPABILITY_GAP") return "CAPABILITY_GAP";
  return "GENERAL";
}

function searchHasGovernedSource(results: readonly SuccessfulToolResult[]): boolean {
  return results.some((result) => {
    if (result.name !== "search_learning_resources" || !result.data || typeof result.data !== "object" || !("results" in result.data) || !Array.isArray(result.data.results)) return false;
    return result.data.results.some((item) => item && typeof item === "object" && "sourceType" in item && (item.sourceType === "OFFICIAL_SYLLABUS" || item.sourceType === "TEACHER_NOTE"));
  });
}

function diagnosisTraceIds(results: readonly SuccessfulToolResult[]): readonly string[] {
  return results.flatMap((result) => result.name === "run_learner_diagnosis" && result.data && typeof result.data === "object" && "traceId" in result.data && typeof result.data.traceId === "string" ? [result.data.traceId] : []);
}

export class RoutePolicyError extends Error {
  readonly code = "ROUTE_POLICY_REJECTED";
  constructor(readonly route: AgentRoute, message: string) { super(`ROUTE_POLICY_REJECTED: ${route}: ${message}`); }
}

export function enforceRoutePolicy(request: AgentRunRequest, response: AgentResponseEnvelope, toolCalls: readonly AgentToolCallRecord[], successfulToolResults: readonly SuccessfulToolResult[]): AgentRoute {
  const route = classifyAgentRoute(request, response);
  const successfulCalls = toolCalls.filter((call) => call.status === "SUCCEEDED");
  if (route === "COURSE_EXPLANATION" && response.status === "ANSWERED") {
    const retrievalCalls = successfulCalls.filter((call) => call.name === "search_learning_resources");
    if (retrievalCalls.length === 0 || !searchHasGovernedSource(successfulToolResults) || response.sourceRefs.length === 0 || !retrievalCalls.some((call) => response.evidenceRefs?.includes(call.resultRef))) {
      throw new RoutePolicyError(route, "ANSWERED requires successful retrieval of at least one curriculum or Teacher Note source.");
    }
  }
  if (route === "LEARNER_DIAGNOSIS_COMPLETE" && response.status === "ANSWERED") {
    const traceIds = diagnosisTraceIds(successfulToolResults);
    if (!successfulCalls.some((call) => call.name === "run_learner_diagnosis") || !response.diagnosisTraceId || !traceIds.includes(response.diagnosisTraceId) || !response.evidenceRefs?.includes(response.diagnosisTraceId)) {
      throw new RoutePolicyError(route, "ANSWERED requires a successful governed Diagnosis with a resolvable trace id.");
    }
  }
  if (route === "LEARNER_DIAGNOSIS_INCOMPLETE") {
    if (response.status !== "NEEDS_MORE_EVIDENCE" || successfulCalls.some((call) => call.name === "run_learner_diagnosis")) {
      throw new RoutePolicyError(route, "Incomplete evidence must return NEEDS_MORE_EVIDENCE and must not run Learner Diagnosis.");
    }
  }
  const gapIndex = successfulCalls.findIndex((call) => call.name === "record_capability_gap");
  if ((route === "CAPABILITY_GAP" || gapIndex >= 0) && response.status === "CAPABILITY_GAP") {
    const listIndex = successfulCalls.findIndex((call) => call.name === "list_capabilities");
    if (listIndex < 0 || (gapIndex >= 0 && listIndex > gapIndex)) throw new RoutePolicyError(route, "Capability gaps require registry evidence before a gap is recorded or returned.");
  }
  return route;
}
