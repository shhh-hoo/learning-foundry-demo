import type { AgentTrace } from "./types";

export interface AgentEvalCase {
  readonly caseId: string; readonly category: string; readonly input: string; readonly inputOrigin: "USER_INPUT" | "PRESET_INPUT";
  readonly expectedStatus: readonly string[]; readonly requiredTools: readonly string[]; readonly forbiddenTools: readonly string[];
  readonly allowedCapabilities: readonly string[]; readonly expectedFailureCode?: string | null; readonly forbiddenClaims?: readonly string[]; readonly tags: readonly string[];
}
export interface AgentEvalToolResult { readonly name: string; readonly resultRef: string; readonly data: unknown }
export interface AgentEvalGrade { readonly passed: boolean; readonly checks: Readonly<Record<string, boolean>>; readonly errors: readonly string[] }

export function gradeAgentCase(testCase: AgentEvalCase, trace: AgentTrace, toolResults: readonly AgentEvalToolResult[]): AgentEvalGrade {
  const names = trace.toolCalls.filter((item) => item.status === "SUCCEEDED").map((item) => item.name);
  const finalText = JSON.stringify(trace.finalResponse);
  const diagnosis = toolResults.find((item) => item.name === "run_learner_diagnosis")?.data as { diagnosis?: { failureCode?: string | null } } | undefined;
  const capabilityArgs = trace.toolCalls.filter((item) => item.name === "get_capability" || item.name === "run_learner_diagnosis").map((item) => item.arguments as { id?: string; componentId?: string });
  const checks = {
    requiredTools: testCase.requiredTools.every((name) => names.includes(name)),
    forbiddenTools: testCase.forbiddenTools.every((name) => !names.includes(name)),
    status: testCase.expectedStatus.includes(trace.finalResponse.status),
    allowedCapability: capabilityArgs.every((args) => !args.id && !args.componentId || testCase.allowedCapabilities.includes(args.id ?? args.componentId ?? "")),
    diagnosisFidelity: testCase.expectedFailureCode === undefined || (diagnosis?.diagnosis?.failureCode ?? null) === testCase.expectedFailureCode,
    sourceRefs: trace.finalResponse.sourceRefs.every((ref) => ref.trim().length > 0),
    unsupportedClaims: !(testCase.forbiddenClaims ?? []).some((claim) => finalText.toLowerCase().includes(claim.toLowerCase())),
    fakeToolClaims: !/simulated tool|pretend tool|fake tool/iu.test(finalText),
    insufficientEvidence: testCase.category !== "capability-gap" || trace.finalResponse.status !== "ANSWERED",
  };
  const errors = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { passed: errors.length === 0, checks, errors };
}
