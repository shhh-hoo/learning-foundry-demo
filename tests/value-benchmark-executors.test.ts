import { describe, expect, it, vi } from "vitest";
import type { AgentEvalTarget } from "../src/agent/agenteval-target";
import type { BenchmarkCase, BenchmarkPlannedExecution } from "../src/value-benchmark";
import { createValueBenchmarkExecutors } from "../src/value-benchmark/executors";

const testCase: BenchmarkCase = {
  schemaVersion: "1.0.0", caseId: "VB-S05-V2", scenario: "TOPIC_SWITCH_CONTAMINATION", variant: 2, exposureClass: "NOVEL_GENERALIZATION",
  input: "Now answer only the active task.", activeTaskId: "task-active", activeEpisodeId: "episode-active",
  messages: [
    { role: "user", content: "Old question", context: { taskId: "task-stale", lifecycle: "STALE" } },
    { role: "assistant", content: "Old answer", context: { taskId: "task-stale", lifecycle: "STALE" } },
    { role: "user", content: "Now answer only the active task.", context: { taskId: "task-active", episodeId: "episode-active", lifecycle: "ACTIVE" } },
  ],
};
const execution: BenchmarkPlannedExecution = { executionId: "execution-1", caseId: testCase.caseId, arm: "A_BARE_LLM", order: 0, conversationId: "conversation-fresh", attemptKind: "FIRST" };

describe("value benchmark arm executors", () => {
  it("uses identical model settings for A/B, sends no tools, strips Context metadata, and never persists reasoning", async () => {
    const bodies: unknown[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: "Structured answer" }), reasoning_content: "private chain" } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 } });
    }) as unknown as typeof fetch;
    const target = { health: vi.fn(), execute: vi.fn() } as unknown as AgentEvalTarget;
    const executors = createValueBenchmarkExecutors({
      prompts: { schemaVersion: "1.0.0", directAnswerContract: "Return JSON answer.", arms: { A_BARE_LLM: { systemPrompt: "Minimal tutor.", tools: [] }, B_FOUNDRY_POLICY_NO_TOOLS: { systemPrompt: "Foundry policy without tools.", tools: [] } } },
      model: { apiKey: "test-key", baseUrl: "https://api.example.test", model: "same-model", thinkingMode: "disabled", temperature: null, topP: null, maxTokens: 1800 },
      target, fullFoundrySystemPromptForCase: () => "full prompt", fetcher,
    });
    const signal = new AbortController().signal;
    const a = await executors.A_BARE_LLM.execute({ testCase, execution, signal });
    const b = await executors.B_FOUNDRY_POLICY_NO_TOOLS.execute({ testCase, execution: { ...execution, arm: "B_FOUNDRY_POLICY_NO_TOOLS" }, signal });
    const [aBody, bBody] = bodies as Record<string, unknown>[];
    expect(a.answer).toBe("Structured answer");
    expect(JSON.stringify([a, b])).not.toContain("private chain");
    expect(aBody).not.toHaveProperty("tools");
    expect(bBody).not.toHaveProperty("tools");
    expect(JSON.stringify([aBody, bBody])).not.toContain("task-active");
    expect({ ...aBody, messages: undefined }).toEqual({ ...bBody, messages: undefined });
    expect(aBody).toMatchObject({ model: "same-model", max_tokens: 1800, response_format: { type: "json_object" }, thinking: { type: "disabled" }, stream: false });
  });

  it("runs C through the authoritative target with a fresh AGENT_EVAL conversation and excerpt-free trace evidence", async () => {
    const execute = vi.fn(async (_request: Parameters<AgentEvalTarget["execute"]>[0], _options?: Parameters<AgentEvalTarget["execute"]>[1]) => ({ ok: true as const, trace: {
      traceId: "trace-1", conversationId: "conversation-fresh", inputOrigin: "USER_INPUT" as const, runPurpose: "AGENT_EVAL" as const,
      route: "COURSE_EXPLANATION" as const, obligations: { retrievalRequired: true, capabilityInspectionRequired: false, diagnosisRequired: false }, provider: "deepseek", model: "same-model", thinkingMode: "disabled" as const,
      promptVersion: "1", capabilityRegistryVersion: "1", startedAt: "2026-07-17T00:00:00Z", completedAt: "2026-07-17T00:00:01Z", latencyMs: 100,
      toolCalls: [{ name: "search_learning_resources", arguments: { query: "secret excerpt" }, resultRef: "evidence-1", status: "SUCCEEDED" as const }],
      finalResponse: { status: "ANSWERED" as const, learnerMessage: "Grounded answer", sourceRefs: ["source-1"], evidenceRefs: ["evidence-1"] },
    }, toolResults: [{ name: "search_learning_resources", resultRef: "evidence-1", data: { privateExcerpt: "do not copy", retrievalTraceId: "evidence-1", deliveryPolicy: { version: "1.2.0", contentHash: "policy-hash" }, results: [{ chunkId: "chunk-1", sourceId: "source-1", sourceType: "OFFICIAL_SYLLABUS", syllabusCode: "9701", syllabusVersion: "2025-2027", section: "2.1", privateExcerpt: "secret" }] } }] }));
    const target: AgentEvalTarget = { health: async () => ({ provider: "deepseek", model: "same-model", thinkingMode: "disabled" }), execute };
    const executors = createValueBenchmarkExecutors({
      prompts: { schemaVersion: "1.0.0", directAnswerContract: "Return JSON.", arms: { A_BARE_LLM: { systemPrompt: "A", tools: [] }, B_FOUNDRY_POLICY_NO_TOOLS: { systemPrompt: "B", tools: [] } } },
      model: { apiKey: "unused", baseUrl: "https://api.example.test", model: "same-model", thinkingMode: "disabled", temperature: null, topP: null, maxTokens: 1800 },
      target, fullFoundrySystemPromptForCase: () => "exact full prompt",
    });
    const output = await executors.C_FULL_FOUNDRY.execute({ testCase, execution: { ...execution, arm: "C_FULL_FOUNDRY" }, signal: new AbortController().signal });
    const request = execute.mock.calls[0]![0];
    expect(request).toMatchObject({ conversationId: "conversation-fresh", runPurpose: "AGENT_EVAL", activeTaskId: "task-active", activeEpisodeId: "episode-active" });
    expect(request).not.toHaveProperty("evalCaseId");
    expect(output).toMatchObject({ answer: "Grounded answer", sourceRefs: ["source-1"], evidenceRefs: ["evidence-1"], systemPrompt: "exact full prompt" });
    expect(JSON.stringify(output.runtimeEvidence)).not.toContain("do not copy");
    expect(output.runtimeEvidence?.toolResults).toEqual([{ name: "search_learning_resources", resultRef: "evidence-1", dataShape: { type: "object", keys: ["deliveryPolicy", "privateExcerpt", "results", "retrievalTraceId"] }, metadata: { retrievalTraceId: "evidence-1", deliveryPolicy: { version: "1.2.0", contentHash: "policy-hash" }, results: [{ chunkId: "chunk-1", sourceId: "source-1", sourceType: "OFFICIAL_SYLLABUS", syllabusCode: "9701", syllabusVersion: "2025-2027", section: "2.1" }] } }]);
  });

  it("preserves the original provider status for C-arm infrastructure classification", async () => {
    const target: AgentEvalTarget = {
      health: async () => ({ provider: "deepseek", model: "same-model", thinkingMode: "disabled" }),
      execute: async () => ({ ok: false, error: { code: "DEEPSEEK_API_ERROR", message: "DEEPSEEK_API_ERROR: HTTP 503: unavailable", httpStatus: 503 } }),
    };
    const executors = createValueBenchmarkExecutors({
      prompts: { schemaVersion: "1.0.0", directAnswerContract: "Return JSON.", arms: { A_BARE_LLM: { systemPrompt: "A", tools: [] }, B_FOUNDRY_POLICY_NO_TOOLS: { systemPrompt: "B", tools: [] } } },
      model: { apiKey: "unused", baseUrl: "https://api.example.test", model: "same-model", thinkingMode: "disabled", temperature: null, topP: null, maxTokens: 1800 },
      target, fullFoundrySystemPromptForCase: () => "full prompt",
    });
    await expect(executors.C_FULL_FOUNDRY.execute({ testCase, execution: { ...execution, arm: "C_FULL_FOUNDRY" }, signal: new AbortController().signal })).rejects.toMatchObject({ code: "DEEPSEEK_API_ERROR", httpStatus: 503 });
  });
});
