import type { AgentTrace } from "./types";

export interface AgentEvalCase {
  readonly caseId: string; readonly category: string; readonly input: string; readonly inputOrigin: "USER_INPUT" | "PRESET_INPUT";
  readonly expectedStatus: readonly string[]; readonly requiredTools: readonly string[]; readonly forbiddenTools: readonly string[];
  readonly allowedCapabilities: readonly string[]; readonly expectedFailureCode?: string | null; readonly forbiddenClaims?: readonly string[]; readonly tags: readonly string[];
  readonly requiredSourceIds?: readonly string[];
}
export interface AgentEvalToolResult { readonly name: string; readonly resultRef: string; readonly data: unknown }
export interface AgentEvalGrade { readonly passed: boolean; readonly checks: Readonly<Record<string, boolean>>; readonly errors: readonly string[] }

export function gradeAgentCase(testCase: AgentEvalCase, trace: AgentTrace, toolResults: readonly AgentEvalToolResult[]): AgentEvalGrade {
  const names = trace.toolCalls.filter((item) => item.status === "SUCCEEDED").map((item) => item.name);
  const finalText = JSON.stringify(trace.finalResponse);
  const capabilityArgs = trace.toolCalls.filter((item) => item.name === "get_capability" || item.name === "run_learner_diagnosis").map((item) => item.arguments as { id?: string; componentId?: string });
  const diagnosisCalls = trace.toolCalls.filter((item) => item.name === "run_learner_diagnosis");
  const diagnosisResult = diagnosisCalls.length ? toolResults.find((item) => item.resultRef === diagnosisCalls.at(-1)?.resultRef)?.data as { traceId?: string; diagnosis?: { failureCode?: string | null } } | undefined : undefined;
  const completeProblemContext = diagnosisCalls.every((item) => {
    const context = (item.arguments as { problemContext?: { prompt?: unknown; reactionEquation?: unknown; givenValues?: unknown; targetQuantity?: unknown; answerRequirement?: unknown } }).problemContext;
    return Boolean(context && typeof context.prompt === "string" && context.prompt.length >= 20 && typeof context.reactionEquation === "string" && context.reactionEquation.length >= 3 && Array.isArray(context.givenValues) && context.givenValues.length > 0 && typeof context.targetQuantity === "string" && context.targetQuantity.length > 0 && typeof context.answerRequirement === "string" && context.answerRequirement.length > 0);
  });
  const checks = {
    requiredTools: testCase.requiredTools.every((name) => names.includes(name)),
    forbiddenTools: testCase.forbiddenTools.every((name) => !names.includes(name)),
    status: testCase.expectedStatus.includes(trace.finalResponse.status),
    allowedCapability: capabilityArgs.every((args) => !args.id && !args.componentId || testCase.allowedCapabilities.includes(args.id ?? args.componentId ?? "")),
    diagnosisFidelity: testCase.expectedFailureCode === undefined || (diagnosisResult?.diagnosis?.failureCode ?? null) === testCase.expectedFailureCode,
    diagnosisProblemContext: completeProblemContext,
    diagnosisTraceId: diagnosisCalls.length === 0 ? trace.finalResponse.diagnosisTraceId === undefined : trace.finalResponse.diagnosisTraceId === diagnosisResult?.traceId,
    sourceRefs: trace.finalResponse.sourceRefs.every((ref) => ref.trim().length > 0) && (testCase.requiredSourceIds ?? []).every((ref) => trace.finalResponse.sourceRefs.includes(ref)),
    unsupportedClaims: !(testCase.forbiddenClaims ?? []).some((claim) => finalText.toLowerCase().includes(claim.toLowerCase())),
    fakeToolClaims: !/simulated tool|pretend tool|fake tool/iu.test(finalText),
    insufficientEvidence: testCase.category !== "capability-gap" || trace.finalResponse.status !== "ANSWERED",
    incompleteContextHasNoDiagnosis: testCase.category !== "diagnosis-missing-context" || (diagnosisCalls.length === 0 && trace.finalResponse.diagnosisTraceId === undefined),
    incompleteContextNamesMissingEvidence: testCase.category !== "diagnosis-missing-context" || ["original problem", "reaction condition", "target", "answer requirement"].every((term) => trace.finalResponse.learnerMessage.toLowerCase().includes(term)),
  };
  const errors = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { passed: errors.length === 0, checks, errors };
}
