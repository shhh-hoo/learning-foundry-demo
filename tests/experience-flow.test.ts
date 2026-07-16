import { describe, expect, it } from "vitest";
import type { AgentTrace } from "../src/agent/types";
import { applyAgentRun, confirmLibraryProposal, confirmScheduleProposal, createInitialExperienceState, startNewLearningTask } from "../src/experience/orchestration";

function productTrace(conversationId: string, value: Partial<AgentTrace> = {}): AgentTrace {
  return {
    traceId: "agent-trace", conversationId, inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", provider: "deepseek", model: "configured", thinkingMode: "disabled", promptVersion: "1.3.0", capabilityRegistryVersion: "1", startedAt: "2026-07-16T10:00:00.000Z", completedAt: "2026-07-16T10:00:01.000Z", toolCalls: [], finalResponse: { status: "ANSWERED", learnerMessage: "Here is a proposal.", sourceRefs: [], proposedLibraryArtifact: { title: "Ratio note", content: "Use balanced coefficients." }, proposedFollowUp: { title: "Retry ratio", reason: "Check transfer", delayDays: 3 } }, latencyMs: 1000,
    ...value,
  };
}

describe("human-confirmed product writes and task isolation", () => {
  it("does not write a Library artifact or Schedule item until the user confirms proposals", () => {
    const initial = createInitialExperienceState();
    let state = applyAgentRun(initial, "help", productTrace(initial.conversationId), []);
    expect(state.library).toHaveLength(0); expect(state.schedule).toHaveLength(0);
    state = confirmLibraryProposal(state); expect(state.library).toEqual([expect.objectContaining({ title: "Ratio note", origin: "HUMAN_ACTION" })]);
    state = confirmScheduleProposal(state); expect(state.schedule).toEqual([expect.objectContaining({ title: "Retry ratio", origin: "HUMAN_ACTION" })]);
  });

  it("starts an isolated task while preserving confirmed records and historical evidence", () => {
    const initial = createInitialExperienceState();
    let state = applyAgentRun(initial, "help", productTrace(initial.conversationId), []);
    state = confirmLibraryProposal(state);
    state = confirmScheduleProposal(state);
    const previousConversationId = state.conversationId;
    const next = startNewLearningTask(state);

    expect(next.conversationId).not.toBe(previousConversationId);
    expect(next.messages).toEqual([]);
    expect(next.pendingResponse).toBeNull();
    expect(next.capabilityGaps).toEqual([]);
    expect(next.library).toEqual(state.library);
    expect(next.schedule).toEqual(state.schedule);
    expect(next.agentTraces).toEqual(state.agentTraces);
    expect(next.eventLog.at(-1)).toMatchObject({ type: "TASK_CREATED", payload: { previousConversationId, conversationId: next.conversationId } });
  });

  it("rejects a stale Product response from a previous task", () => {
    const initial = createInitialExperienceState();
    const next = startNewLearningTask(initial);
    expect(() => applyAgentRun(next, "old response", productTrace(initial.conversationId), [])).toThrow("active learning task");
  });

  it("rejects AgentEval traces from Product state", () => {
    const initial = createInitialExperienceState();
    const trace: AgentTrace = { traceId: "agent-eval-trace", conversationId: initial.conversationId, inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", provider: "deepseek", model: "configured", thinkingMode: "disabled", promptVersion: "1", capabilityRegistryVersion: "1", startedAt: "2026-07-16T10:00:00.000Z", completedAt: "2026-07-16T10:00:01.000Z", toolCalls: [], finalResponse: { status: "ANSWERED", learnerMessage: "AgentEval output", sourceRefs: [] }, latencyMs: 1000 };
    expect(() => applyAgentRun(initial, "agent-eval", trace, [])).toThrow("PRODUCT Agent runs only");
  });
});