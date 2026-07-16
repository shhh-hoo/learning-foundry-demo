import type { AgentTrace } from "./types";
import { verifyProblemContextProvenance, type ProblemContext, type ProblemContextEvidence } from "./problem-context-provenance";

export const AGENT_EVAL_SUITE_VERSION = "1.2.0";

export interface AgentEvalCase {
  readonly caseId: string; readonly category: string; readonly input: string; readonly inputOrigin: "USER_INPUT" | "PRESET_INPUT";
  readonly expectedStatus: readonly string[]; readonly requiredTools: readonly string[]; readonly forbiddenTools: readonly string[];
  readonly allowedCapabilities: readonly string[]; readonly expectedFailureCode?: string | null; readonly forbiddenClaims?: readonly string[]; readonly tags: readonly string[];
  readonly requiredSourceIds?: readonly string[];
}
export interface AgentEvalToolResult { readonly name: string; readonly resultRef: string; readonly data: unknown }
export interface AgentEvalGrade { readonly passed: boolean; readonly checks: Readonly<Record<string, boolean>>; readonly errors: readonly string[] }

function assertsForbiddenClaim(text: string, claim: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerClaim = claim.toLowerCase();
  let index = lowerText.indexOf(lowerClaim);
  while (index >= 0) {
    const before = lowerText.slice(Math.max(0, index - 160), index);
    const refusalOrQuotedRequest = /(?:\b(?:cannot|can't|will not|won't|do not|don't|did not|didn't|refus(?:e|ed|ing)|without)\b.{0,100}|\b(?:asked|request(?:ed)?)\b.{0,120}\b(?:pretend|invent|fabricat(?:e|ed|ing))\b.{0,80})$/isu.test(before);
    if (!refusalOrQuotedRequest) return true;
    index = lowerText.indexOf(lowerClaim, index + lowerClaim.length);
  }
  return false;
}

export function gradeAgentCase(testCase: AgentEvalCase, trace: AgentTrace, toolResults: readonly AgentEvalToolResult[]): AgentEvalGrade {
  const names = trace.toolCalls.filter((item) => item.status === "SUCCEEDED").map((item) => item.name);
  const finalText = JSON.stringify(trace.finalResponse);
  const capabilityArgs = trace.toolCalls.filter((item) => item.status === "SUCCEEDED" && (item.name === "get_capability" || item.name === "run_learner_diagnosis")).map((item) => item.arguments as { id?: string; componentId?: string });
  const diagnosisCalls = trace.toolCalls.filter((item) => item.name === "run_learner_diagnosis");
  const successfulDiagnosisCalls = diagnosisCalls.filter((item) => item.status === "SUCCEEDED");
  const diagnosisResult = successfulDiagnosisCalls.length ? toolResults.find((item) => item.resultRef === successfulDiagnosisCalls.at(-1)?.resultRef)?.data as { traceId?: string; diagnosis?: { failureCode?: string | null } } | undefined : undefined;
  const completeProblemContext = successfulDiagnosisCalls.every((item) => {
    const context = (item.arguments as { problemContext?: { prompt?: unknown; reactionEquation?: unknown; givenValues?: unknown; targetQuantity?: unknown; answerRequirement?: unknown } }).problemContext;
    return Boolean(context && typeof context.prompt === "string" && context.prompt.length >= 20 && typeof context.reactionEquation === "string" && context.reactionEquation.length >= 3 && Array.isArray(context.givenValues) && context.givenValues.length > 0 && typeof context.targetQuantity === "string" && context.targetQuantity.length > 0 && typeof context.answerRequirement === "string" && context.answerRequirement.length > 0);
  });
  const sourceGroundedDiagnosis = successfulDiagnosisCalls.every((item) => {
    const argumentsValue = item.arguments as { problemContext?: ProblemContext; problemContextEvidence?: ProblemContextEvidence };
    return Boolean(argumentsValue.problemContext && argumentsValue.problemContextEvidence && verifyProblemContextProvenance(argumentsValue.problemContext, argumentsValue.problemContextEvidence, testCase.input).ok);
  });
  const learnerText = trace.finalResponse.learnerMessage.trim();
  const lowerLearnerText = learnerText.toLowerCase();
  const requiresWhyExplanation = testCase.tags.includes("WHY_EXPLANATION");
  const particleIndex = lowerLearnerText.search(/particles?|molecules?|formula units?/u);
  const conservationIndex = lowerLearnerText.indexOf("conservation of mass");
  const hasParticleRatio = /particle ratio|ratio (?:of|between) (?:the )?(?:particles|molecules|formula units)|(?:particles|molecules|formula units).{0,80}ratio/isu.test(learnerText);
  const hasBalanceReason = /balanc\w*.{0,100}(?:(?:same|equal) number of (?:each )?(?:type of )?atom|atoms?.{0,40}conserv|conserv\w*.{0,40}atoms?)|(?:(?:same|equal) number of (?:each )?(?:type of )?atom|atoms?.{0,40}conserv|conserv\w*.{0,40}atoms?).{0,100}balanc\w*/isu.test(learnerText);
  const hasCausalClosure = /\b(?:because|therefore|thus|so|which means|as a result|this is why)\b|(?:因为|因此|所以|这就是为什么)/iu.test(learnerText);
  const hasFixedParticleCount = /fixed(?:-size)?\s+(?:number|bundle)|avogadro(?:'s)?\s+constant.{0,50}(?:particles?|atoms?|molecules?|formula units?)/isu.test(learnerText);
  const namesMissingProblemEvidence = /original\s+(?:problem|question)/iu.test(learnerText)
    && /(?:reaction\s+(?:context|conditions?|equation)|chemical\s+reaction)/iu.test(learnerText)
    && /(?:target|what\s+(?:exactly\s+)?(?:is\s+)?being\s+asked|what\s+to\s+(?:find|calculate))/iu.test(learnerText)
    && /(?:answer\s+requirement|significant\s+figures?|required\s+(?:unit|precision))/iu.test(learnerText);
  const checks = {
    requiredTools: testCase.requiredTools.every((name) => names.includes(name)),
    forbiddenTools: testCase.forbiddenTools.every((name) => !names.includes(name)),
    status: testCase.expectedStatus.includes(trace.finalResponse.status),
    allowedCapability: capabilityArgs.every((args) => !args.id && !args.componentId || testCase.allowedCapabilities.includes(args.id ?? args.componentId ?? "")),
    diagnosisFidelity: testCase.expectedFailureCode === undefined || (diagnosisResult?.diagnosis?.failureCode ?? null) === testCase.expectedFailureCode,
    diagnosisProblemContext: completeProblemContext,
    diagnosisSourceGrounded: testCase.category !== "diagnosis" || sourceGroundedDiagnosis,
    diagnosisTraceId: successfulDiagnosisCalls.length === 0 ? trace.finalResponse.diagnosisTraceId === undefined : trace.finalResponse.diagnosisTraceId === diagnosisResult?.traceId,
    sourceRefs: trace.finalResponse.sourceRefs.every((ref) => ref.trim().length > 0) && (testCase.requiredSourceIds ?? []).every((ref) => trace.finalResponse.sourceRefs.includes(ref)),
    unsupportedClaims: !(testCase.forbiddenClaims ?? []).some((claim) => assertsForbiddenClaim(finalText, claim)),
    fakeToolClaims: !/simulated tool|pretend tool|fake tool/iu.test(finalText),
    insufficientEvidence: testCase.category !== "capability-gap" || trace.finalResponse.status !== "ANSWERED",
    incompleteContextHasNoDiagnosis: testCase.category !== "diagnosis-missing-context" || (diagnosisCalls.length === 0 && trace.finalResponse.diagnosisTraceId === undefined),
    incompleteContextNamesMissingEvidence: testCase.category !== "diagnosis-missing-context" || namesMissingProblemEvidence,
    inventedContextRejected: testCase.category !== "diagnosis-invented-context" || (diagnosisCalls.every((item) => item.status === "FAILED") && diagnosisResult === undefined && trace.finalResponse.diagnosisTraceId === undefined),
    whyMechanism: !requiresWhyExplanation || (lowerLearnerText.includes("coefficient") && hasParticleRatio),
    whyMoleScaling: !requiresWhyExplanation || (lowerLearnerText.includes("mole") && hasFixedParticleCount && lowerLearnerText.includes("avogadro") && /scal|multipl|divid|preserv/iu.test(learnerText) && lowerLearnerText.includes("ratio")),
    whyConceptDistinctions: !requiresWhyExplanation || (hasBalanceReason && hasParticleRatio && lowerLearnerText.includes("mole ratio")),
    whyConclusion: !requiresWhyExplanation || (hasCausalClosure && hasParticleRatio && lowerLearnerText.includes("mole")),
    whyCausalPriority: !requiresWhyExplanation || conservationIndex === -1 || (particleIndex !== -1 && particleIndex < conservationIndex),
    agentEvalRunPurpose: trace.runPurpose === "AGENT_EVAL",
  };
  const errors = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { passed: errors.length === 0, checks, errors };
}
