import { describe, expect, it } from "vitest";
import { createDeepSeekClient, toObservableAgentMessage } from "../src/agent/deepseek-client";

const TEST_FIXTURE = "TEST_FIXTURE" as const;

describe("DeepSeek HTTP boundary", () => {
  it("maps provider output to the neutral observable message without hidden reasoning", () => {
    expect(toObservableAgentMessage({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-1", type: "function", function: { name: "search_learning_resources", arguments: "{}" } }],
      reasoning_content: "private provider reasoning",
    })).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-1", type: "function", function: { name: "search_learning_resources", arguments: "{}" } }],
    });
  });

  it("uses the configured model, JSON output, tools and explicit thinking toggle", async () => {
    let url = ""; let init: RequestInit | undefined;
    const client = createDeepSeekClient({ apiKey: TEST_FIXTURE, model: "configured-model", baseUrl: "https://api.deepseek.com", thinkingMode: "disabled", fetcher: async (input, requestInit) => {
      url = String(input); init = requestInit;
      return Response.json({ choices: [{ message: { role: "assistant", content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 } });
    } });
    const result = await client.call({ messages: [{ role: "user", content: "json please" }], tools: [{ type: "function" }] });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(body).toMatchObject({ model: "configured-model", response_format: { type: "json_object" }, thinking: { type: "disabled" }, tool_choice: "auto" });
    expect(result.usage).toMatchObject({ totalTokens: 12, promptCacheHitTokens: 4, promptCacheMissTokens: 6 });
  });

  it("forces a required route tool and omits tool fields when the route is terminal", async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = createDeepSeekClient({ apiKey: TEST_FIXTURE, model: "configured-model", baseUrl: "https://api.deepseek.com", thinkingMode: "disabled", fetcher: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ choices: [{ message: { role: "assistant", content: "{}" } }] });
    } });

    await client.call({ messages: [{ role: "user", content: "diagnose" }], tools: [{ type: "function", function: { name: "list_capabilities" } }], requiredToolName: "list_capabilities" });
    await client.call({ messages: [{ role: "user", content: "finish" }], tools: [] });

    expect(bodies[0]).toMatchObject({ tools: [expect.any(Object)], tool_choice: { type: "function", function: { name: "list_capabilities" } } });
    expect(bodies[1]).not.toHaveProperty("tools");
    expect(bodies[1]).not.toHaveProperty("tool_choice");
  });
});
