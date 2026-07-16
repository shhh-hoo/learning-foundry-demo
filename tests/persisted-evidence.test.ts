import { describe, expect, it } from "vitest";
import { loadPersistedLearningEvidence } from "../src/experience/persisted-evidence";
import { aggregatePatternEvidence, createComponentCandidate, createInitialExperienceState } from "../src/experience/orchestration";

describe("persisted product evidence", () => {
  it("rebuilds the repeated-diagnosis signal after browser state has been reset", async () => {
    const agentRuns = [1, 2, 3].map((index) => ({
      traceId: `agent-${index}`, status: "COMPLETED", provider: "deepseek", model: "deepseek-chat", thinkingMode: "disabled",
      request: { conversationId: `conversation-${index}`, inputOrigin: "PRESET_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content: "working" }] },
      prompt: { version: "1", contentHash: "prompt" }, capabilityRegistry: { version: "1", contentHash: "cap" }, toolDefinitions: { version: "1", contentHash: "tools" },
      startedAt: `2026-07-16T00:0${index}:00.000Z`, completedAt: `2026-07-16T00:0${index}:01.000Z`, updatedAt: `2026-07-16T00:0${index}:01.000Z`, tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      observableModelMessages: [], toolExecutions: [{ name: "run_learner_diagnosis", arguments: {}, resultRef: `result-${index}`, status: "SUCCEEDED", result: { traceId: `diagnosis-${index}` } }],
      finalResponse: { status: "ANSWERED", learnerMessage: "Check the ratio.", sourceRefs: [], diagnosisTraceId: `diagnosis-${index}` },
    }));
    const diagnoses = [1, 2, 3].map((index) => ({ traceId: `diagnosis-${index}`, runPurpose: "PRODUCT", request: { componentId: "stoichiometric-product-mass" }, component: { id: "stoichiometric-product-mass", version: "1.0.0", contentHash: "hash" }, runtimeVersion: "runtime", diagnosis: { decision: "STUDENT_ERROR", firstPedagogicalIssue: "FORMULA", failureCode: "WRONG_STOICHIOMETRIC_RATIO", evidence: ["ratio"] }, recommendedSupport: "Compare coefficients.", timestamp: `2026-07-16T00:0${index}:01.000Z` }));
    const fetcher = async (input: RequestInfo | URL) => Response.json(String(input).includes(":4176") ? { ok: true, runs: agentRuns } : { ok: true, diagnoses });
    const evidence = await loadPersistedLearningEvidence(fetcher);
    expect(evidence.agentTraces).toHaveLength(3);
    expect(evidence.diagnoses.map((item) => [item.traceId, item.agentTraceId])).toEqual([["diagnosis-1", "agent-1"], ["diagnosis-2", "agent-2"], ["diagnosis-3", "agent-3"]]);
    const candidate = createComponentCandidate({ ...createInitialExperienceState(), agentTraces: evidence.agentTraces, diagnoses: evidence.diagnoses }).candidate!;
    expect(candidate.sourceDiagnosisTraceIds.every((traceId) => diagnoses.some((item) => item.traceId === traceId))).toBe(true);
    expect(candidate.sourceAgentTraceIds.every((traceId) => agentRuns.some((item) => item.traceId === traceId))).toBe(true);
  });

  it("keeps AgentEval diagnosis cases out of Product Pattern evidence", async () => {
    const agentEvalRun = {
      traceId: "agent-eval-trace", status: "COMPLETED", provider: "deepseek", model: "deepseek-chat", thinkingMode: "disabled",
      request: { conversationId: "agent-eval-conversation", inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", messages: [{ role: "user", content: "case" }] },
      prompt: { version: "1", contentHash: "prompt" }, capabilityRegistry: { version: "1", contentHash: "cap" }, toolDefinitions: { version: "1", contentHash: "tools" },
      startedAt: "2026-07-16T01:00:00.000Z", completedAt: "2026-07-16T01:00:01.000Z", updatedAt: "2026-07-16T01:00:01.000Z", observableModelMessages: [],
      toolExecutions: [{ name: "run_learner_diagnosis", arguments: {}, resultRef: "result", status: "SUCCEEDED", result: { traceId: "agent-eval-diagnosis" } }],
      finalResponse: { status: "ANSWERED", learnerMessage: "case answer", sourceRefs: [], diagnosisTraceId: "agent-eval-diagnosis" },
    };
    const diagnosis = { traceId: "agent-eval-diagnosis", runPurpose: "AGENT_EVAL", request: { componentId: "stoichiometric-product-mass" }, component: { id: "stoichiometric-product-mass", version: "1.0.0", contentHash: "hash" }, runtimeVersion: "runtime", diagnosis: { decision: "STUDENT_ERROR", failureCode: "WRONG_STOICHIOMETRIC_RATIO", evidence: ["case"] }, recommendedSupport: "case support", timestamp: "2026-07-16T01:00:01.000Z" };
    const fetcher = async (input: RequestInfo | URL) => Response.json(String(input).includes(":4176") ? { ok: true, runs: [agentEvalRun] } : { ok: true, diagnoses: [diagnosis] });
    const evidence = await loadPersistedLearningEvidence(fetcher);
    expect(evidence).toEqual({ agentTraces: [], diagnoses: [] });
    expect(aggregatePatternEvidence(evidence.diagnoses)).toMatchObject({ occurrenceCount: 0, thresholdReached: false });
    expect(() => createComponentCandidate({ ...createInitialExperienceState(), ...evidence })).toThrow("requires three matching actual local Agent runs");
  });
});
