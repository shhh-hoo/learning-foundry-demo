import { describe, expect, it } from "vitest";
import { classifyAgentRoute } from "../src/agent/route-policy";
import { runAgent, type AgentToolExecutor } from "../src/agent/run-agent";
import type { AgentModelClient } from "../src/agent/deepseek-client";
import type { AgentRunRequest } from "../src/agent/types";

const definition = (name: string) => ({ type: "function", function: { name } });
const allTools = [
  "search_learning_resources",
  "list_capabilities",
  "get_capability",
  "run_learner_diagnosis",
  "record_capability_gap",
  "propose_library_artifact",
  "propose_schedule_followup",
].map(definition);

function productRequest(messages: AgentRunRequest["messages"]): AgentRunRequest {
  return { conversationId: "tool-routing-regression", inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages };
}

function names(tools: readonly unknown[]): readonly string[] {
  return tools.flatMap((tool) => tool && typeof tool === "object" && "function" in tool
    && tool.function && typeof tool.function === "object" && "name" in tool.function && typeof tool.function.name === "string"
    ? [tool.function.name]
    : []);
}

const base = {
  model: "test-model",
  thinkingMode: "disabled" as const,
  systemPrompt: "Follow the governed route.",
  promptVersion: "1.3.1",
  capabilityRegistryVersion: "1.0.0",
  toolDefinitions: allTools,
};

describe("tool-routing regressions from PRODUCT traces", () => {
  it.each([
    "9701涉及的摩尔计算都有哪些情况？有什么特别的难点吗？",
    "AS 和A2怎么衔接",
    "一般 Born-Haber 需要用到哪些值，有哪些常见的错误呢？",
    "怎么计算Ecell",
  ])("routes curriculum and explanation intent through governed retrieval: %s", (input) => {
    expect(classifyAgentRoute(productRequest([{ role: "user", content: input }]))).toBe("COURSE_EXPLANATION");
  });

  it("keeps an elliptical follow-up on the prior explanation route", () => {
    const request = productRequest([
      { role: "user", content: "你好，我想知道 lattice energy 应该怎么算" },
      { role: "assistant", content: "Do you mean the CAIE direct Born-Haber calculation?" },
      { role: "user", content: "1.是的，3直接计算" },
    ]);
    expect(classifyAgentRoute(request)).toBe("COURSE_EXPLANATION");
  });

  it("keeps a concrete numerical problem on SOLVE_WITH_CHECKS", () => {
    const request = productRequest([{ role: "user", content: "Calculate the mass of MgO from 4.80 g Mg using 2Mg + O2 -> 2MgO." }]);
    expect(classifyAgentRoute(request)).toBe("SOLVE_WITH_CHECKS");
  });

  it("does not expose retrieval or Diagnosis tools to an ordinary solve route", async () => {
    const request = productRequest([{ role: "user", content: "Calculate the mass of MgO from 4.80 g Mg using 2Mg + O2 -> 2MgO." }]);
    const modelClient: AgentModelClient = { call: async ({ tools, requiredToolName }) => {
      expect(names(tools)).toEqual(["propose_library_artifact", "propose_schedule_followup"]);
      expect(requiredToolName).toBeUndefined();
      return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "The evidenced calculation can be solved directly.", sourceRefs: [], evidenceRefs: [] }) } };
    } };
    const tools: AgentToolExecutor = { execute: async () => { throw new Error("No tool should execute."); } };
    const trace = await runAgent({ ...base, request, modelClient, tools });
    expect(trace.route).toBe("SOLVE_WITH_CHECKS");
    expect(trace.toolCalls).toEqual([]);
  });

  it("permits exactly one curriculum retrieval and then removes all tools", async () => {
    const request = productRequest([{ role: "user", content: "AS 和A2怎么衔接" }]);
    let call = 0;
    const modelClient: AgentModelClient = { call: async ({ tools, requiredToolName }) => {
      call += 1;
      if (call === 1) {
        expect(names(tools)).toEqual(["search_learning_resources"]);
        expect(requiredToolName).toBe("search_learning_resources");
        return { message: { role: "assistant", content: null, tool_calls: [{ id: "search-once", type: "function", function: { name: "search_learning_resources", arguments: '{"query":"AS A2 curriculum transition"}' } }] } };
      }
      expect(names(tools)).toEqual([]);
      expect(requiredToolName).toBeUndefined();
      return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "The retrieved curriculum source supports the transition explanation.", sourceRefs: ["CAIE-9701-SYLLABUS-2025-2027-V1"], evidenceRefs: ["retrieval-once"] }) } };
    } };
    const tools: AgentToolExecutor = { execute: async () => ({
      resultRef: "retrieval-once",
      sourceRefs: ["CAIE-9701-SYLLABUS-2025-2027-V1"],
      evidenceRefs: ["retrieval-once"],
      data: { results: [{ sourceId: "CAIE-9701-SYLLABUS-2025-2027-V1", sourceType: "OFFICIAL_SYLLABUS" }] },
    }) };
    const trace = await runAgent({ ...base, request, modelClient, tools });
    expect(trace.toolCalls.map((item) => item.name)).toEqual(["search_learning_resources"]);
    expect(call).toBe(2);
  });

  it("returns NEEDS_MORE_EVIDENCE after one empty retrieval instead of searching six times", async () => {
    const request = productRequest([{ role: "user", content: "AS 和A2怎么衔接" }]);
    let call = 0;
    const modelClient: AgentModelClient = { call: async ({ tools }) => {
      call += 1;
      if (call === 1) {
        expect(names(tools)).toEqual(["search_learning_resources"]);
        return { message: { role: "assistant", content: null, tool_calls: [{ id: "empty-search", type: "function", function: { name: "search_learning_resources", arguments: '{"query":"AS A2 curriculum relationship"}' } }] } };
      }
      expect(names(tools)).toEqual([]);
      return { message: { role: "assistant", content: JSON.stringify({ status: "NEEDS_MORE_EVIDENCE", learnerMessage: "The governed corpus does not yet contain enough reviewed curriculum relationship evidence.", sourceRefs: [], evidenceRefs: ["retrieval-empty"] }) } };
    } };
    const tools: AgentToolExecutor = { execute: async () => ({ resultRef: "retrieval-empty", evidenceRefs: ["retrieval-empty"], data: { results: [] } }) };
    const trace = await runAgent({ ...base, request, modelClient, tools });
    expect(trace.finalResponse.status).toBe("NEEDS_MORE_EVIDENCE");
    expect(trace.toolCalls).toHaveLength(1);
    expect(call).toBe(2);
  });
});
