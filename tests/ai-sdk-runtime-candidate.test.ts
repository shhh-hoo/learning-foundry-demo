import { describe, expect, it, vi } from "vitest";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { resolveAgentExecutionPlan } from "../src/agent/route-policy";
import {
  AI_SDK_CANDIDATE_ADAPTER_VERSION,
  createAiSdkRuntimeExecutor,
  parseAiSdkCandidateConfiguration,
} from "../src/runtime/ai-sdk-runtime-executor";
import {
  createRuntimeShadowCoordinator,
  type RuntimeExecutionRecord,
  type RuntimeExecutor,
} from "../src/runtime/runtime-shadow";

const request = {
  conversationId: "ai-sdk-candidate-case",
  inputOrigin: "PRESET_INPUT",
  runPurpose: "AGENT_EVAL",
  messages: [{ role: "user", content: "Explain this with governed evidence." }],
} as const;

const normalizedInput = {
  request,
  executionPlan: resolveAgentExecutionPlan(request),
  policy: {
    prompt: { version: "1.3.0", contentHash: "prompt-hash" },
    capabilityRegistry: { version: "1.0.0", contentHash: "capability-hash" },
    toolDefinitions: { version: "1.0.0", contentHash: "tool-hash" },
  },
  caseId: "A-course-explanation",
} as const;

describe("AI SDK 7 RuntimeExecutor candidate", () => {
  it("is configured independently but remains controlled by the existing default-off shadow mode", () => {
    expect(parseAiSdkCandidateConfiguration({})).toEqual({ configured: false, modelId: null, thinkingMode: "disabled", timeoutMs: 30_000 });
    expect(parseAiSdkCandidateConfiguration({ DEEPSEEK_API_KEY: "secret", DEEPSEEK_MODEL: "deepseek-chat", DEEPSEEK_THINKING_MODE: "enabled", AI_SDK_CANDIDATE_TIMEOUT_MS: "12000" })).toEqual({
      configured: true,
      modelId: "deepseek-chat",
      thinkingMode: "enabled",
      timeoutMs: 12_000,
    });
    expect(AI_SDK_CANDIDATE_ADAPTER_VERSION).toBe("1.0.0");
  });

  it("translates Foundry-selected tools, returns a structured final result and preserves cache usage", async () => {
    const calls: Record<string, unknown>[] = [];
    const generate = vi.fn(async (options: Record<string, unknown>) => {
      calls.push(options);
      if (calls.length === 1) {
        return {
          text: "",
          output: undefined,
          toolCalls: [{ toolCallId: "search-1", toolName: "search_learning_resources", input: { query: "governed evidence" } }],
          usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
          providerMetadata: { deepseek: { promptCacheHitTokens: 7, promptCacheMissTokens: 3 } },
        };
      }
      return {
        text: "",
        output: { status: "ANSWERED", learnerMessage: "Grounded explanation.", sourceRefs: ["source-1"], evidenceRefs: ["retrieval-1"] },
        toolCalls: [],
        usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
        providerMetadata: { deepseek: { promptCacheHitTokens: 8, promptCacheMissTokens: 4 } },
      };
    });
    const executor = createAiSdkRuntimeExecutor({
      model: {} as never,
      modelId: "deepseek-chat",
      thinkingMode: "disabled",
      timeoutMs: 30_000,
      systemPrompt: "Foundry policy",
      toolDefinitions: [{ type: "function", function: { name: "search_learning_resources", description: "Search", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } } }],
      generateText: generate,
      createTools: (_input, signal) => ({
        async execute(name, _arguments, receivedSignal) {
          expect(name).toBe("search_learning_resources");
          expect(receivedSignal).toBe(signal);
          return { resultRef: "retrieval-1", sourceRefs: ["source-1"], evidenceRefs: ["retrieval-1"], data: { results: [{ sourceId: "source-1", sourceType: "TEACHER_NOTE", section: "one", score: 1 }] } };
        },
      }),
      createId: () => "ai-sdk-trace",
      now: (() => { const values = [new Date("2026-07-18T00:00:00.000Z"), new Date("2026-07-18T00:00:01.000Z")]; return () => values.shift()!; })(),
    });

    const signal = new AbortController().signal;
    const result = await executor.execute(normalizedInput, signal);

    expect(executor.identity).toEqual({ adapterId: "ai-sdk7-deepseek", adapterVersion: "1.0.0", providerId: "deepseek", modelId: "deepseek-chat" });
    expect(calls[0]).toMatchObject({ abortSignal: signal, timeout: { totalMs: 30_000 }, toolChoice: { type: "tool", toolName: "search_learning_resources" } });
    expect(calls[0]?.tools).toHaveProperty("search_learning_resources");
    expect(calls[1]?.tools).toBeUndefined();
    expect(calls[1]?.output).toBeDefined();
    expect(result.trace.finalResponse).toEqual({ status: "ANSWERED", learnerMessage: "Grounded explanation.", sourceRefs: ["source-1"], evidenceRefs: ["retrieval-1"] });
    expect(result.trace.tokenUsage).toEqual({ promptTokens: 22, completionTokens: 8, totalTokens: 30, promptCacheHitTokens: 15, promptCacheMissTokens: 7 });
    expect(result.toolResults).toEqual([{ name: "search_learning_resources", resultRef: "retrieval-1", data: { results: [{ sourceId: "source-1", sourceType: "TEACHER_NOTE", section: "one", score: 1 }] } }]);
    expect(normalizedInput).not.toHaveProperty("productState");
  });

  it("keeps the structured response contract when a non-required tool remains available", async () => {
    const capabilityRequest = {
      conversationId: "ai-sdk-optional-tool-case",
      inputOrigin: "PRESET_INPUT",
      runPurpose: "AGENT_EVAL",
      messages: [{ role: "user", content: "This arbitrary target is unsupported by the current capability set." }],
    } as const;
    const input = { ...normalizedInput, request: capabilityRequest, executionPlan: resolveAgentExecutionPlan(capabilityRequest) };
    const calls: Record<string, unknown>[] = [];
    const executor = createAiSdkRuntimeExecutor({
      model: {} as never,
      modelId: "deepseek-chat",
      thinkingMode: "disabled",
      timeoutMs: 30_000,
      systemPrompt: "Foundry policy",
      toolDefinitions: [
        { type: "function", function: { name: "list_capabilities", parameters: { type: "object", properties: {}, additionalProperties: false } } },
        { type: "function", function: { name: "record_capability_gap", parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"], additionalProperties: false } } },
      ],
      createTools: () => ({ execute: async () => ({ resultRef: "capability-list", data: [{ id: "registered-capability" }], evidenceRefs: ["capability-list"] }) }),
      generateText: async (options: Record<string, unknown>) => {
        calls.push(options);
        return calls.length === 1
          ? { text: "", output: undefined, toolCalls: [{ toolCallId: "list-1", toolName: "list_capabilities", input: {} }] }
          : { text: "", output: { status: "NEEDS_MORE_EVIDENCE", learnerMessage: "No governed capability supports this target.", sourceRefs: [], evidenceRefs: ["capability-list"] }, toolCalls: [] };
      },
    });

    const result = await executor.execute(input, new AbortController().signal);

    expect(input.executionPlan.route).toBe("CAPABILITY_GAP");
    expect(calls[1]).toMatchObject({ toolChoice: "auto" });
    expect(calls[1]?.tools).toHaveProperty("record_capability_gap");
    expect(calls[1]?.output).toBeDefined();
    expect(result.trace.finalResponse.status).toBe("NEEDS_MORE_EVIDENCE");
  });

  it("propagates cooperative cancellation through the model boundary", async () => {
    let receivedSignal: AbortSignal | undefined;
    let markModelStarted!: () => void;
    const modelStarted = new Promise<void>((resolve) => { markModelStarted = resolve; });
    const executor = createAiSdkRuntimeExecutor({
      model: {} as never,
      modelId: "deepseek-chat",
      thinkingMode: "disabled",
      timeoutMs: 30_000,
      systemPrompt: "Foundry policy",
      toolDefinitions: [],
      createTools: () => ({ execute: async () => { throw new Error("unused"); } }),
      generateText: async (options: Record<string, unknown>) => {
        receivedSignal = options.abortSignal as AbortSignal;
        markModelStarted();
        await new Promise<void>((resolve) => receivedSignal!.addEventListener("abort", () => resolve(), { once: true }));
        throw receivedSignal!.reason;
      },
    });
    const controller = new AbortController();
    const execution = executor.execute(normalizedInput, controller.signal);
    await modelStarted;
    controller.abort(new Error("candidate cancelled"));

    await expect(execution).rejects.toThrow("candidate cancelled");
    expect(receivedSignal).toBe(controller.signal);
  });

  it("keeps an AI SDK candidate failure out of the authoritative result", async () => {
    const candidate = createAiSdkRuntimeExecutor({
      model: {} as never,
      modelId: "deepseek-chat",
      thinkingMode: "disabled",
      timeoutMs: 30_000,
      systemPrompt: "Foundry policy",
      toolDefinitions: [],
      createTools: () => ({ execute: async () => { throw new Error("unused"); } }),
      generateText: async () => { throw Object.assign(new Error("candidate offline"), { code: "CANDIDATE_OFFLINE" }); },
    });
    const authoritative: RuntimeExecutor = {
      identity: { adapterId: "legacy-deepseek-agent", adapterVersion: "1.0.0", providerId: "deepseek", modelId: "deepseek-chat" },
      execute: async (input) => ({
        trace: {
          traceId: "legacy-trace",
          conversationId: input.request.conversationId,
          inputOrigin: input.request.inputOrigin,
          runPurpose: input.request.runPurpose,
          initialRoute: input.executionPlan.route,
          route: input.executionPlan.route,
          obligations: input.executionPlan.obligations,
          provider: "deepseek",
          model: "deepseek-chat",
          thinkingMode: "disabled",
          promptVersion: input.policy.prompt.version,
          capabilityRegistryVersion: input.policy.capabilityRegistry.version,
          startedAt: "2026-07-18T00:00:00.000Z",
          completedAt: "2026-07-18T00:00:01.000Z",
          toolCalls: [],
          finalResponse: { status: "ANSWERED", learnerMessage: "Legacy answer.", sourceRefs: [], evidenceRefs: [] },
          latencyMs: 1000,
        },
        toolResults: [],
      }),
    };
    const records: RuntimeExecutionRecord[] = [];
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: true,
      authoritativeExecutor: authoritative,
      shadowExecutor: candidate,
      recorder: { record: async (record) => { records.push(record); } },
      createId: (() => { const ids = ["legacy-execution", "candidate-execution"]; return () => ids.shift()!; })(),
      now: () => "2026-07-18T00:00:02.000Z",
    });

    const execution = await coordinator.execute(normalizedInput);
    await expect(execution.shadowCompletion).resolves.toBeUndefined();

    expect(execution.authoritativeResult.trace.finalResponse.learnerMessage).toBe("Legacy answer.");
    expect(records).toContainEqual(expect.objectContaining({
      executionId: "candidate-execution",
      parentAuthoritativeExecutionId: "legacy-execution",
      role: "SHADOW",
      runtimeAdapterId: "ai-sdk7-deepseek",
      status: "FAILED",
      terminalError: { code: "CANDIDATE_OFFLINE", message: "candidate offline" },
    }));
  });

  it("executes offline through the installed official DeepSeek provider and AI SDK generateText primitive", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const responses = [
      {
        id: "fake-tool-step",
        created: 1,
        model: "deepseek-chat",
        choices: [{
          message: { role: "assistant", content: null, tool_calls: [{ id: "search-official", function: { name: "search_learning_resources", arguments: '{"query":"governed evidence"}' } }] },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 },
      },
      {
        id: "fake-final-step",
        created: 2,
        model: "deepseek-chat",
        choices: [{
          message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Official provider path.", sourceRefs: ["source-1"], evidenceRefs: ["retrieval-1"] }) },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 7 },
      },
    ];
    const provider = createDeepSeek({
      apiKey: "offline-fixture",
      fetch: async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json(responses.shift());
      },
    });
    const executor = createAiSdkRuntimeExecutor({
      model: provider("deepseek-chat"),
      modelId: "deepseek-chat",
      thinkingMode: "disabled",
      timeoutMs: 30_000,
      systemPrompt: "Foundry policy",
      toolDefinitions: [{ type: "function", function: { name: "search_learning_resources", description: "Search", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } } }],
      createTools: () => ({ execute: async () => ({ resultRef: "retrieval-1", sourceRefs: ["source-1"], evidenceRefs: ["retrieval-1"], data: { results: [{ sourceId: "source-1", sourceType: "TEACHER_NOTE", section: "one", score: 1 }] } }) }),
      createId: () => "official-provider-trace",
    });

    const result = await executor.execute(normalizedInput, new AbortController().signal);

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).toMatchObject({ model: "deepseek-chat", tool_choice: { type: "function", function: { name: "search_learning_resources" } }, thinking: { type: "disabled" } });
    expect(requestBodies[1]).toMatchObject({ model: "deepseek-chat", response_format: { type: "json_object" }, thinking: { type: "disabled" } });
    expect(result.trace.finalResponse.learnerMessage).toBe("Official provider path.");
    expect(result.trace.tokenUsage).toEqual({ promptTokens: 22, completionTokens: 6, totalTokens: 28, promptCacheHitTokens: 9, promptCacheMissTokens: 13 });
  });
});
