import type { AgentExecutionPlan, AgentObligations, AgentResponseEnvelope, AgentRoute, AgentRunRequest, AgentToolCallRecord } from "./types";
import { ContextCompiler } from "./control-plane/context-compiler";
import { ExecutionPlanner } from "./control-plane/execution-planner";

interface SuccessfulToolResult { readonly name: string; readonly data: unknown }

function currentUserMessage(request: AgentRunRequest): string {
  return [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function looksLikeCompleteCalculationAttempt(input: string): boolean {
  const hasEquation = /(?:->|→|⇌)/u.test(input);
  const hasProblem = /\b(?:problem|original problem|calculate|find)\b|(?:题目|原题|计算|求)/iu.test(input);
  const hasWorking = /\b(?:working|got|ratio|reported|my full working|check it|diagnose)\b|(?:解题过程|计算过程|我的答案|检查|诊断|错误)/iu.test(input);
  return hasEquation && hasProblem && hasWorking && /\d/u.test(input);
}

function looksLikeIncompleteWorking(input: string): boolean {
  const incompleteSignal = /\b(?:working only|partial line|incomplete working|part of the working|only have part|where is my first mistake|diagnose the first issue)\b|(?:只有过程|部分过程|过程不完整|只写了|第一处错误|哪里错|诊断)/iu.test(input);
  return incompleteSignal && !looksLikeCompleteCalculationAttempt(input);
}

function looksLikeExplanation(input: string): boolean {
  return /^(?:why|how|explain|what evidence|which titres|find the course source|what does the syllabus)/iu.test(input.trim())
    || /^(?:为什么|怎么|如何|解释|哪些证据|课程要求|大纲)/u.test(input.trim())
    || /\b(?:course explanation|course source|learning outcome)\b/iu.test(input);
}

function explicitlyRequestsCapabilityGap(input: string): boolean {
  return /\b(?:capability gap|unsupported|no supported capability|arbitrary target|not supported)\b|(?:能力缺口|不支持的能力|当前能力无法处理)/iu.test(input);
}

function requiresCapabilityInspection(input: string): boolean {
  return /\b(?:current|available|supported)\s+(?:tools?|capabilit(?:y|ies))\b/iu.test(input)
    || /\b(?:run|use)\b.{0,60}\bdiagnosis\s+tool\b/iu.test(input)
    || /\bdiagnos(?:e|is)\b.{0,80}\b(?:entire\s+multi-stage|across)\b/iu.test(input)
    || /\b(?:capabilit(?:y|ies)|tool\s+trace)\b/iu.test(input);
}

export function classifyAgentRoute(request: AgentRunRequest, response?: AgentResponseEnvelope): AgentRoute {
  const input = currentUserMessage(request);
  if (looksLikeCompleteCalculationAttempt(input)) return "LEARNER_DIAGNOSIS_COMPLETE";
  if (looksLikeIncompleteWorking(input)) return "LEARNER_DIAGNOSIS_INCOMPLETE";
  if (looksLikeExplanation(input)) return "COURSE_EXPLANATION";
  if (explicitlyRequestsCapabilityGap(input) || response?.status === "CAPABILITY_GAP") return "CAPABILITY_GAP";
  return "SOLVE_WITH_CHECKS";
}

export function resolveAgentExecutionPlan(request: AgentRunRequest): AgentExecutionPlan {
  const context = new ContextCompiler().compile(request);
  return new ExecutionPlanner().plan(request, context);
}

export function routeInstruction(route: AgentRoute): string {
  if (route === "COURSE_EXPLANATION") return "Application route: COURSE_EXPLANATION. You must call search_learning_resources and cite governed learner-facing sources before returning ANSWERED. For coefficient-to-mole-ratio questions, distinguish the roles explicitly: balancing conserves atoms; coefficients encode the particle ratio; scaling every particle count by the same fixed Avogadro constant preserves that ratio and therefore gives the mole ratio.";
  if (route === "SOLVE_WITH_CHECKS") return "Application route: SOLVE_WITH_CHECKS. Solve only from the evidenced problem. Use bounded arithmetic, unit, formula and precision checks when available. Do not present a Learner Diagnosis unless the learner supplied working and the route changes through governed policy.";
  if (route === "LEARNER_DIAGNOSIS_COMPLETE") return "Application route: LEARNER_DIAGNOSIS_COMPLETE. Do not replace the governed judgment with your own calculation. Call list_capabilities, then get_capability for a returned learner-facing ID, then run Learner Diagnosis. Reference the persisted Diagnosis trace before returning ANSWERED.";
  if (route === "LEARNER_DIAGNOSIS_INCOMPLETE") return "Application route: LEARNER_DIAGNOSIS_INCOMPLETE. Do not run Learner Diagnosis. Return NEEDS_MORE_EVIDENCE and name the missing problem or learner-working evidence.";
  return "Application route: CAPABILITY_GAP. Inspect the real Capability Registry before recording or returning a capability gap. Do not invent a capability or use registry metadata to fill missing problem facts.";
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

export function enforceRoutePolicy(
  request: AgentRunRequest,
  response: AgentResponseEnvelope,
  toolCalls: readonly AgentToolCallRecord[],
  successfulToolResults: readonly SuccessfulToolResult[],
  initialRoute: AgentRoute = classifyAgentRoute(request),
  obligations: AgentObligations = resolveAgentExecutionPlan(request).obligations,
): AgentRoute {
  const route = initialRoute;
  const successfulCalls = toolCalls.filter((call) => call.status === "SUCCEEDED");

  if (route === "COURSE_EXPLANATION" && response.status !== "ANSWERED") {
    throw new RoutePolicyError(route, "A course explanation with governed retrieval must return ANSWERED, not change application route from model output.");
  }

  if (route === "COURSE_EXPLANATION") {
    const retrievalCalls = successfulCalls.filter((call) => call.name === "search_learning_resources");
    if (retrievalCalls.length === 0 || !searchHasGovernedSource(successfulToolResults) || response.sourceRefs.length === 0 || !retrievalCalls.some((call) => response.evidenceRefs?.includes(call.resultRef))) {
      throw new RoutePolicyError(route, "ANSWERED requires successful retrieval of at least one curriculum or Teacher Note source.");
    }
  }

  if (route === "LEARNER_DIAGNOSIS_COMPLETE" && response.status !== "ANSWERED") {
    throw new RoutePolicyError(route, "A completed governed Diagnosis must return ANSWERED and reference its persisted trace.");
  }

  if (route === "LEARNER_DIAGNOSIS_COMPLETE") {
    const listIndex = successfulCalls.findIndex((call) => call.name === "list_capabilities");
    const getIndex = successfulCalls.findIndex((call) => call.name === "get_capability");
    const diagnosisIndex = successfulCalls.findIndex((call) => call.name === "run_learner_diagnosis");
    const traceIds = diagnosisTraceIds(successfulToolResults);
    if (listIndex < 0 || getIndex < 0 || diagnosisIndex < 0 || !(listIndex < getIndex && getIndex < diagnosisIndex)) {
      throw new RoutePolicyError(route, "ANSWERED requires ordered capability resolution: list_capabilities, get_capability, then run_learner_diagnosis.");
    }
    if (!response.diagnosisTraceId || !traceIds.includes(response.diagnosisTraceId) || !response.evidenceRefs?.includes(response.diagnosisTraceId)) {
      throw new RoutePolicyError(route, "ANSWERED requires a successful governed Diagnosis with a resolvable trace id.");
    }
  }

  if (route === "LEARNER_DIAGNOSIS_INCOMPLETE") {
    if (response.status !== "NEEDS_MORE_EVIDENCE" || successfulCalls.some((call) => call.name === "run_learner_diagnosis")) {
      throw new RoutePolicyError(route, "Incomplete evidence must return NEEDS_MORE_EVIDENCE and must not run Learner Diagnosis.");
    }
  }

  const listIndex = successfulCalls.findIndex((call) => call.name === "list_capabilities");
  const gapIndex = successfulCalls.findIndex((call) => call.name === "record_capability_gap");
  if (gapIndex >= 0 && (listIndex < 0 || listIndex > gapIndex)) {
    throw new RoutePolicyError("CAPABILITY_GAP", "A capability gap may be recorded only after successful Registry inspection.");
  }
  if (obligations.capabilityInspectionRequired && listIndex < 0) {
    throw new RoutePolicyError(route, "Capability inspection requires successful Registry evidence before the final response.");
  }

  if (route === "CAPABILITY_GAP") {
    if (response.status === "ANSWERED") throw new RoutePolicyError(route, "A capability gap route cannot return an unbounded ANSWERED response.");
    if (listIndex < 0) throw new RoutePolicyError(route, "Capability gaps require Registry evidence before a gap is returned.");
    if (response.status === "CAPABILITY_GAP") {
      if (gapIndex < 0 || !response.capabilityGapId || !response.evidenceRefs?.includes(response.capabilityGapId)) {
        throw new RoutePolicyError(route, "CAPABILITY_GAP requires a persisted gap record and matching evidence reference.");
      }
    }
  }

  return route;
}
