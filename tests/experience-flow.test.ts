import { describe, expect, it } from "vitest";
import type { AgentTrace } from "../src/agent/types";
import { applyAgentRun, confirmLibraryProposal, confirmScheduleProposal, createInitialExperienceState } from "../src/experience/orchestration";

describe("human-confirmed product writes", () => {
  it("does not write a Library artifact or Schedule item until the user confirms proposals", () => {
    const trace: AgentTrace = { traceId: "agent-trace", conversationId: "conversation", inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", provider: "deepseek", model: "configured", thinkingMode: "disabled", promptVersion: "1", capabilityRegistryVersion: "1", startedAt: "2026-07-16T10:00:00.000Z", completedAt: "2026-07-16T10:00:01.000Z", toolCalls: [], finalResponse: { status: "ANSWERED", learnerMessage: "Here is a proposal.", sourceRefs: [], proposedLibraryArtifact: { title: "Ratio note", content: "Use balanced coefficients." }, proposedFollowUp: { title: "Retry ratio", reason: "Check transfer", delayDays: 3 } }, latencyMs: 1000 };
    let state = applyAgentRun(createInitialExperienceState(), "help", trace, []);
    expect(state.library).toHaveLength(0); expect(state.schedule).toHaveLength(0);
    state = confirmLibraryProposal(state); expect(state.library).toEqual([expect.objectContaining({ title: "Ratio note", origin: "HUMAN_ACTION" })]);
    state = confirmScheduleProposal(state); expect(state.schedule).toEqual([expect.objectContaining({ title: "Retry ratio", origin: "HUMAN_ACTION" })]);
  });

  it("rejects AgentEval traces from Product state", () => {
    const trace: AgentTrace = { traceId: "agent-eval-trace", conversationId: "agent-eval", inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", provider: "deepseek", model: "configured", thinkingMode: "disabled", promptVersion: "1", capabilityRegistryVersion: "1", startedAt: "2026-07-16T10:00:00.000Z", completedAt: "2026-07-16T10:00:01.000Z", toolCalls: [], finalResponse: { status: "ANSWERED", learnerMessage: "AgentEval output", sourceRefs: [] }, latencyMs: 1000 };
    expect(() => applyAgentRun(createInitialExperienceState(), "agent-eval", trace, [])).toThrow("PRODUCT Agent runs only");
  });
});
