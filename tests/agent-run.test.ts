import { describe, expect, it } from "vitest";
import { runAgent, AgentRunError, type AgentToolExecutor } from "../src/agent/run-agent";
import type { AgentModelClient, ModelCallResult } from "../src/agent/deepseek-client";

const TEST_FIXTURE = "TEST_FIXTURE" as const;
const request = { conversationId: "test-conversation", inputOrigin: "PRESET_INPUT" as const, runPurpose: "PRODUCT" as const, messages: [{ role: "user" as const, content: "Explain why coefficients give mole ratios." }] };
const base = { request, model: "configured-test-model", thinkingMode: "disabled" as const, systemPrompt: "Return json grounded in tools.", promptVersion: "1.3.0", capabilityRegistryVersion: "1.0.0", toolDefinitions: [] };

function client(results: readonly ModelCallResult[]): AgentModelClient {
  let index = 0;
  return { call: async () => results[index++]! };
}

describe("real agent orchestration contract", () => {
  it("resolves the route before the provider call, performs the tool loop and records the route", async () => {
    expect(TEST_FIXTURE).toBe("TEST_FIXTURE");
    let providerCalls = 0;
    const modelClient: AgentModelClient = { call: async ({ messages, tools, requiredToolName }) => {
      providerCalls += 1;
      if (providerCalls === 1) {
        expect(messages[0]?.content).toContain("Application route: COURSE_EXPLANATION");
        expect(messages[0]?.content).toContain("must call search_learning_resources");
        expect(messages[0]?.content).toContain("balancing conserves atoms");
        expect(tools).toHaveLength(1);
        expect(requiredToolName).toBe("search_learning_resources");
        return { message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "search_learning_resources", arguments: '{"query":"coefficients"}' } }] }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
      }
      expect(tools).toHaveLength(0);
      expect(requiredToolName).toBeUndefined();
      return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Coefficients give relative mole amounts because a fixed particle ratio remains unchanged when every count is scaled by the same Avogadro constant.", sourceRefs: ["CAIE-SOURCE-1"], evidenceRefs: ["search-result-1"] }) }, usage: { promptTokens: 15, completionTokens: 8, totalTokens: 23 } };
    } };
    const tools: AgentToolExecutor = { execute: async () => ({ resultRef: "search-result-1", sourceRefs: ["TN-001", "CAIE-SOURCE-1"], evidenceRefs: ["search-result-1"], data: { retrievalTraceId: "search-result-1", results: [{ sourceId: "TN-001", sourceType: "TEACHER_NOTE" }, { sourceId: "CAIE-SOURCE-1", sourceType: "OFFICIAL_SYLLABUS" }] } }) };
    const trace = await runAgent({ ...base, toolDefinitions: [{ type: "function", function: { name: "search_learning_resources" } }], modelClient, tools, createId: () => "agent-trace-test", now: () => new Date("2026-07-16T10:00:00.000Z") });

    expect(trace.toolCalls).toEqual([{ name: "search_learning_resources", arguments: { query: "coefficients" }, resultRef: "search-result-1", status: "SUCCEEDED" }]);
    expect(trace).toMatchObject({ initialRoute: "COURSE_EXPLANATION", route: "COURSE_EXPLANATION" });
    expect(trace.finalResponse.sourceRefs).toEqual(["TN-001", "CAIE-SOURCE-1"]);
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
        expect(messages[0]?.content).toContain("sourceRefs and evidenceRefs are arrays of string IDs");
        expect(messages[0]?.content).toContain("Application route: COURSE_EXPLANATION");
        return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Coefficients give mole ratios.", sourceRefs: [{ source: "search_learning_resources", result: "invented" }] }) } };
      }
      if (callIndex === 2) {
        const correction = messages.at(-1)?.content ?? "";
        expect(correction).toContain("sourceRefs.0");
        expect(correction).toContain("arrays of string IDs");
        expect(correction).toContain("search_learning_resources");
        return { message: { role: "assistant", content: null, tool_calls: [{ id: "call-recovery", type: "function", function: { name: "search_learning_resources", arguments: '{"query":"balanced equation coefficients mole ratios"}' } }] } };
      }
      return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Coefficients give relative mole amounts because scaling each particle count by the same fixed amount preserves the ratio.", sourceRefs: ["CAIE-SOURCE-1"], evidenceRefs: ["search-result"] }) } };
    } };
    const trace = await runAgent({ ...base, toolDefinitions: [{ type: "function", function: { name: "search_learning_resources" } }], modelClient, tools: { execute: async () => ({ resultRef: "search-result", sourceRefs: ["CAIE-SOURCE-1"], evidenceRefs: ["search-result"], data: { retrievalTraceId: "search-result", results: [{ sourceId: "CAIE-SOURCE-1", sourceType: "TEACHER_NOTE" }] } }) } });
    expect(trace.finalResponse.sourceRefs).toEqual(["CAIE-SOURCE-1"]);
    expect(trace.toolCalls).toEqual([expect.objectContaining({ name: "search_learning_resources", status: "SUCCEEDED" })]);
  });

  it("rejects final references that were never returned by a tool", async () => {
    const modelClient = client([
      { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Unsupported", sourceRefs: ["invented-source"] }) } },
      { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Still unsupported", sourceRefs: ["invented-source"] }) } },
    ]);
    await expect(runAgent({ ...base, modelClient, tools: { execute: async () => { throw new Error("unused"); } } }))
      .rejects.toMatchObject({ code: "AGENT_UNSUPPORTED_CLAIM" });
  });

  it("gives one bounded correction for a wrong reference class", async () => {
    let callIndex = 0;
    const modelClient: AgentModelClient = { call: async ({ messages }) => {
      callIndex += 1;
      if (callIndex === 1) return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Diagnosis complete.", sourceRefs: ["stoichiometric-product-mass@1.0.0"], evidenceRefs: [] }) } };
      expect(messages.at(-1)?.content).toContain("reference class");
      return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Diagnosis complete.", sourceRefs: [], evidenceRefs: [] }) } };
    } };
    const trace = await runAgent({ ...base, initialRoute: "SOLVE_WITH_CHECKS", modelClient, tools: { execute: async () => { throw new Error("unused"); } } });
    expect(trace.finalResponse.sourceRefs).toEqual([]);
    expect(callIndex).toBe(2);
  });

  it("rejects Library and Schedule proposals that were not produced by proposal tools", async () => {
    const invalid = { message: { role: "assistant" as const, content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Saved", sourceRefs: [], proposedLibraryArtifact: { title: "Invented", content: "Not called" } }) } };
    const modelClient = client([invalid, invalid]);
    await expect(runAgent({ ...base, modelClient, tools: { execute: async () => { throw new Error("unused"); } } })).rejects.toMatchObject({ code: "AGENT_UNSUPPORTED_CLAIM" });
  });

  it("exposes one required Diagnosis tool at a time and none after successful Diagnosis", async () => {
    const diagnosisRequest = { ...request, messages: [{ role: "user" as const, content: "Original problem: 2Mg + O2 -> 2MgO. Calculate from 4.80 g Mg using Ar(Mg)=24.0 and Mr(MgO)=40.0 to 3 significant figures. My working: 4.80/24.0=0.200 mol, ratio 0.5, answer 4.00 g. Diagnose it." }] };
    const toolDefinitions = ["search_learning_resources", "list_capabilities", "get_capability", "run_learner_diagnosis"].map((name) => ({ type: "function", function: { name } }));
    const expectedTools = [["list_capabilities"], ["get_capability"], ["run_learner_diagnosis"], ["run_learner_diagnosis"], []];
    const calls = [
      { id: "list", name: "list_capabilities", arguments: "{}" },
      { id: "get", name: "get_capability", arguments: '{"id":"stoichiometric-product-mass"}' },
      { id: "wrong-route-tool", name: "search_learning_resources", arguments: '{"query":"not available on this route"}' },
      { id: "diagnose", name: "run_learner_diagnosis", arguments: "{}" },
    ];
    let providerCall = 0;
    const modelClient: AgentModelClient = { call: async ({ tools, requiredToolName }) => {
      expect(tools.map((tool) => (tool as { function: { name: string } }).function.name)).toEqual(expectedTools[providerCall]);
      expect(requiredToolName).toBe(expectedTools[providerCall]?.[0]);
      const next = calls[providerCall++];
      if (next) return { message: { role: "assistant", content: null, tool_calls: [{ id: next.id, type: "function", function: { name: next.name, arguments: next.arguments } }] } };
      return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Governed diagnosis complete.", sourceRefs: ["stoichiometric-product-mass@1.0.0"], evidenceRefs: ["diagnosis-result"] }) } };
    } };

    const executedNames: string[] = [];
    const trace = await runAgent({ ...base, request: diagnosisRequest, toolDefinitions, modelClient, tools: { execute: async (name) => {
      executedNames.push(name);
      if (name === "list_capabilities") return { resultRef: "capability-list", data: [], evidenceRefs: ["capability-list"] };
      if (name === "get_capability") return { resultRef: "capability", data: { id: "stoichiometric-product-mass" }, evidenceRefs: ["capability"] };
      return { resultRef: "diagnosis-result", data: { traceId: "trainer-trace" }, evidenceRefs: ["diagnosis-result", "trainer-trace"] };
    } } });

    expect(trace.initialRoute).toBe("LEARNER_DIAGNOSIS_COMPLETE");
    expect(executedNames).toEqual(["list_capabilities", "get_capability", "run_learner_diagnosis"]);
    expect(trace.toolCalls.map((item) => [item.name, item.status])).toEqual([["list_capabilities", "SUCCEEDED"], ["get_capability", "SUCCEEDED"], ["search_learning_resources", "FAILED"], ["run_learner_diagnosis", "SUCCEEDED"]]);
    expect(trace.finalResponse).toMatchObject({ status: "ANSWERED", sourceRefs: [], evidenceRefs: ["capability-list", "capability", "diagnosis-result", "trainer-trace"], diagnosisTraceId: "trainer-trace" });
  });

  it("records malformed tool JSON and permits a bounded retry within the existing round limit", async () => {
    const diagnosisRequest = { ...request, messages: [{ role: "user" as const, content: "Original problem: 2Mg + O2 -> 2MgO. Calculate 4.80 g Mg to MgO. My working gives 8.00 g. Diagnose it." }] };
    const toolDefinitions = ["list_capabilities", "get_capability", "run_learner_diagnosis"].map((name) => ({ type: "function", function: { name } }));
    const modelClient = client([
      { message: { role: "assistant", content: null, tool_calls: [{ id: "list", type: "function", function: { name: "list_capabilities", arguments: "{}" } }] } },
      { message: { role: "assistant", content: null, tool_calls: [{ id: "get", type: "function", function: { name: "get_capability", arguments: '{"id":"stoichiometric-product-mass"}' } }] } },
      { message: { role: "assistant", content: null, tool_calls: [{ id: "bad", type: "function", function: { name: "run_learner_diagnosis", arguments: "{not-json" } }] } },
      { message: { role: "assistant", content: null, tool_calls: [{ id: "good", type: "function", function: { name: "run_learner_diagnosis", arguments: "{}" } }] } },
      { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Governed diagnosis complete.", sourceRefs: [], evidenceRefs: ["capability-list", "capability", "diagnosis-result", "trainer-trace"], diagnosisTraceId: "trainer-trace" }) } },
    ]);
    const executions: { status: string; error?: { code: string } }[] = [];
    const tools: AgentToolExecutor = { execute: async (name) => {
      if (name === "list_capabilities") return { resultRef: "capability-list", data: [], evidenceRefs: ["capability-list"] };
      if (name === "get_capability") return { resultRef: "capability", data: {}, evidenceRefs: ["capability"] };
      return { resultRef: "diagnosis-result", data: { traceId: "trainer-trace" }, evidenceRefs: ["diagnosis-result", "trainer-trace"] };
    } };

    const trace = await runAgent({ ...base, request: diagnosisRequest, toolDefinitions, modelClient, tools, onToolExecution: (execution) => { executions.push(execution); } });

    expect(trace.toolCalls.filter((item) => item.name === "run_learner_diagnosis").map((item) => item.status)).toEqual(["FAILED", "SUCCEEDED"]);
    expect(executions.find((item) => item.status === "FAILED")?.error?.code).toBe("INVALID_TOOL_ARGUMENTS");
  });

  it("stops tool recursion after six rounds with a structured error", async () => {
    const repeated = Array.from({ length: 6 }, (_, index) => ({ message: { role: "assistant" as const, content: null, tool_calls: [{ id: `call-${index}`, type: "function" as const, function: { name: "list_capabilities", arguments: "{}" } }] } }));
    await expect(runAgent({ ...base, modelClient: client(repeated), tools: { execute: async () => ({ resultRef: "capabilities", data: [] }) } }))
      .rejects.toEqual(new AgentRunError("AGENT_TOOL_LOOP_LIMIT_EXCEEDED", "The model requested tools after six rounds."));
  });
});
