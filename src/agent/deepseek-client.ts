import type { TokenUsage } from "./types";
import type { ObservableAgentMessage, ObservableAgentToolCall } from "./trace-store";

export interface ModelToolCall extends ObservableAgentToolCall {}

export interface ModelMessage extends ObservableAgentMessage {
  readonly reasoning_content?: string;
}

export function toObservableAgentMessage(message: ModelMessage): ObservableAgentMessage {
  const { reasoning_content: _hiddenReasoning, ...observable } = message;
  return observable;
}

export interface ModelCallRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly unknown[];
  readonly requiredToolName?: string;
}

export interface ModelCallResult {
  readonly message: ModelMessage;
  readonly usage?: TokenUsage;
}

export interface AgentModelClient { call(request: ModelCallRequest, signal?: AbortSignal): Promise<ModelCallResult> }

interface DeepSeekClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly thinkingMode: "enabled" | "disabled";
  readonly fetcher?: typeof fetch;
}

export function createDeepSeekClient(options: DeepSeekClientOptions): AgentModelClient {
  const fetcher = options.fetcher ?? globalThis.fetch;
  return {
    async call(request, signal) {
      const response = await fetcher(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "authorization": `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages: request.messages,
          ...(request.tools.length ? {
            tools: request.tools,
            tool_choice: request.requiredToolName
              ? { type: "function", function: { name: request.requiredToolName } }
              : "auto",
          } : {}),
          response_format: { type: "json_object" },
          thinking: { type: options.thinkingMode },
          max_tokens: 1800,
          stream: false,
        }),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new Error(`DEEPSEEK_API_ERROR: HTTP ${response.status}: ${await response.text()}`);
      const body = await response.json() as {
        choices?: readonly { readonly message?: ModelMessage }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
      };
      const message = body.choices?.[0]?.message;
      if (!message) throw new Error("DEEPSEEK_API_ERROR: Response has no assistant message.");
      const usage = body.usage ? {
        promptTokens: body.usage.prompt_tokens ?? 0,
        completionTokens: body.usage.completion_tokens ?? 0,
        totalTokens: body.usage.total_tokens ?? 0,
        ...(body.usage.prompt_cache_hit_tokens === undefined ? {} : { promptCacheHitTokens: body.usage.prompt_cache_hit_tokens }),
        ...(body.usage.prompt_cache_miss_tokens === undefined ? {} : { promptCacheMissTokens: body.usage.prompt_cache_miss_tokens }),
      } : undefined;
      return { message, ...(usage ? { usage } : {}) };
    },
  };
}
