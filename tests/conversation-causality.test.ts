import { describe, expect, it } from "vitest";
import type { AgentTrace } from "../src/agent/types";
import { aggregatePatternEvidence, applyAgentRun, createComponentCandidate, createInitialExperienceState } from "../src/experience/orchestration";

const trace = (index: number): AgentTrace => ({ traceId: `agent-trace-${index}`, conversationId: "test-conversation", inputOrigin: "PRESET_INPUT", provider: "deepseek", model: "configured-model", thinkingMode: "disabled", promptVersion: "1.0.0", capabilityRegistryVersion: "1.0.0", startedAt: `2026-07-16T10:0${index}:00.000Z`, completedAt: `2026-07-16T10:0${index}:01.000Z`, toolCalls: [{ name: "run_learner_diagnosis", arguments: {}, resultRef: `result-${index}`, status: "SUCCEEDED" }], finalResponse: { status: "ANSWERED", learnerMessage: "Check the coefficient ratio.", sourceRefs: [], diagnosisTraceId: `trainer-trace-${index}` }, latencyMs: 1000 });
const result = (index: number) => [{ name: "run_learner_diagnosis", resultRef: `result-${index}`, data: { componentId: "stoichiometric-product-mass", componentVersion: "1.0.0", traceId: `trainer-trace-${index}`, diagnosis: { decision: "STUDENT_ERROR", firstPedagogicalIssue: "FORMULA", failureCode: "WRONG_STOICHIOMETRIC_RATIO", evidence: ["actual runtime evidence"] }, recommendedSupport: "Compare coefficients." } }];

describe("actual-run causality", () => {
  it("starts with no diagnosis evidence and reaches the pattern threshold only after three actual runs", () => {
    let state = createInitialExperienceState();
    expect(aggregatePatternEvidence(state.diagnoses).occurrenceCount).toBe(0);
    state = applyAgentRun(state, "run 1", trace(1), result(1));
    state = applyAgentRun(state, "run 2", trace(2), result(2));
    expect(aggregatePatternEvidence(state.diagnoses).thresholdReached).toBe(false);
    state = applyAgentRun(state, "run 3", trace(3), result(3));
    expect(aggregatePatternEvidence(state.diagnoses)).toMatchObject({ occurrenceCount: 3, thresholdReached: true, traceIds: ["trainer-trace-1", "trainer-trace-2", "trainer-trace-3"] });
    expect(createComponentCandidate(state).candidate?.source).toBe("ACTUAL_AGENT_RUNS");
  });
});
