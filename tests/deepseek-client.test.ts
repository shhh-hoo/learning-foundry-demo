import { describe, expect, it } from "vitest";
import { createDeepSeekClient } from "../src/agent/deepseek-client";

const TEST_FIXTURE = "TEST_FIXTURE" as const;

describe("DeepSeek HTTP boundary", () => {
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
});
