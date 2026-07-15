import { describe, expect, it } from "vitest";
import { runAgent, AgentRunError, type AgentToolExecutor } from "../src/agent/run-agent";
import type { AgentModelClient, ModelCallResult } from "../src/agent/deepseek-client";

const TEST_FIXTURE = "TEST_FIXTURE" as const;
const request = { conversationId: "test-conversation", inputOrigin: "PRESET_INPUT" as const, runPurpose: "PRODUCT" as const, messages: [{ role: "user" as const, content: "Where is my first mistake?" }] };
const base = { request, model: "configured-test-model", thinkingMode: "disabled" as const, systemPrompt: "Return json grounded in tools.", promptVersion: "1.0.0", capabilityRegistryVersion: "1.0.0", toolDefinitions: [] };

function client(results: readonly ModelCallResult[]): AgentModelClient {
  let index = 0;
  return { call: async () => results[index++]! };
}

describe("real agent orchestration contract", () => {
  it("performs a model → tool → model loop and records only real tool metadata", async () => {
    expect(TEST_FIXTURE).toBe("TEST_FIXTURE");
    const modelClient = client([
      { message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "search_learning_resources", arguments: '{"query":"coefficients"}' } }] }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Coefficients give relative mole amounts.", sourceRefs: ["CAIE-SOURCE-1"] }) }, usage: { promptTokens: 15, completionTokens: 8, totalTokens: 23 } },
    ]);
    const tools: AgentToolExecutor = { execute: async () => ({ resultRef: "search-result-1", claimRefs: ["CAIE-SOURCE-1"], data: [{ sourceId: "CAIE-SOURCE-1" }] }) };
    const trace = await runAgent({ ...base, modelClient, tools, createId: () => "agent-trace-test", now: () => new Date("2026-07-16T10:00:00.000Z") });

    expect(trace.toolCalls).toEqual([{ name: "search_learning_resources", arguments: { query: "coefficients" }, resultRef: "search-result-1", status: "SUCCEEDED" }]);
    expect(trace.finalResponse.sourceRefs).toEqual(["CAIE-SOURCE-1"]);
    expect(trace.tokenUsage?.totalTokens).toBe(38);
    expect(JSON.stringify(trace)).not.toMatch(/api.?key|authorization|reasoning_content/i);
  });

  it("retries malformed final JSON once and then fails without canned content", async () => {
    const modelClient = client([
      { message: { role: "assistant", content: "" } },
      { message: { role: "assistant", content: "still not json" } },
    ]);
    await expect(runAgent({ ...base, modelClient, tools: { execute: async () => { throw new Error("unused"); } } }))
      .rejects.toMatchObject({ code: "INVALID_AGENT_RESPONSE", message: expect.stringContaining("empty or invalid JSON") });
  });

  it("gives actionable schema feedback and permits recovery through a required source tool", async () => {
    let callIndex = 0;
    const modelClient: AgentModelClient = { call: async ({ messages }) => {
      callIndex += 1;
      if (callIndex === 1) {
        expect(messages[0]?.content).toContain("sourceRefs is an array of string IDs");
        return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Coefficients give mole ratios.", sourceRefs: [{ source: "search_learning_resources", result: "invented" }] }) } };
      }
      if (callIndex === 2) {
        const correction = messages.at(-1)?.content ?? "";
        expect(correction).toContain("sourceRefs.0");
        expect(correction).toContain("array of string IDs");
        expect(correction).toContain("search_learning_resources");
        return { message: { role: "assistant", content: null, tool_calls: [{ id: "call-recovery", type: "function", function: { name: "search_learning_resources", arguments: '{"query":"balanced equation coefficients mole ratios"}' } }] } };
      }
      return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Coefficients give relative mole amounts.", sourceRefs: ["CAIE-SOURCE-1"] }) } };
    } };
    const trace = await runAgent({ ...base, modelClient, tools: { execute: async () => ({ resultRef: "search-result", claimRefs: ["CAIE-SOURCE-1"], data: [{ sourceId: "CAIE-SOURCE-1" }] }) } });
    expect(trace.finalResponse.sourceRefs).toEqual(["CAIE-SOURCE-1"]);
    expect(trace.toolCalls).toEqual([expect.objectContaining({ name: "search_learning_resources", status: "SUCCEEDED" })]);
  });

  it("rejects final references that were never returned by a tool", async () => {
    const modelClient = client([{ message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Unsupported", sourceRefs: ["invented-source"] }) } }]);
    await expect(runAgent({ ...base, modelClient, tools: { execute: async () => { throw new Error("unused"); } } }))
      .rejects.toMatchObject({ code: "AGENT_UNSUPPORTED_CLAIM" });
  });

  it("rejects Library and Schedule proposals that were not produced by proposal tools", async () => {
    const modelClient = client([{ message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Saved", sourceRefs: [], proposedLibraryArtifact: { title: "Invented", content: "Not called" } }) } }]);
    await expect(runAgent({ ...base, modelClient, tools: { execute: async () => { throw new Error("unused"); } } })).rejects.toMatchObject({ code: "AGENT_UNSUPPORTED_CLAIM" });
  });

  it("stops tool recursion after six rounds with a structured error", async () => {
    const repeated = Array.from({ length: 6 }, (_, index) => ({ message: { role: "assistant" as const, content: null, tool_calls: [{ id: `call-${index}`, type: "function" as const, function: { name: "list_capabilities", arguments: "{}" } }] } }));
    await expect(runAgent({ ...base, modelClient: client(repeated), tools: { execute: async () => ({ resultRef: "capabilities", data: [] }) } }))
      .rejects.toEqual(new AgentRunError("AGENT_TOOL_LOOP_LIMIT_EXCEEDED", "The model requested tools after six rounds."));
  });
});
