import {
  generateText,
  jsonSchema,
  tool,
  type LanguageModel,
  type ModelMessage as AiSdkModelMessage,
  type ToolSet,
} from "ai";
import type { DeepSeekLanguageModelOptions } from "@ai-sdk/deepseek";
import type { TokenUsage } from "../agent/types";
import type { AgentModelClient, ModelCallResult, ModelMessage } from "../agent/deepseek-client";
import { runAgent, type AgentToolExecutor } from "../agent/run-agent";
import type {
  NormalizedRuntimeExecutionRequest,
  RuntimeExecutionResult,
  RuntimeExecutor,
} from "./runtime-shadow";

export const AI_SDK_TRANSPORT_CANDIDATE_ADAPTER_VERSION = "1.0.0" as const;

export interface AiSdkTransportCandidateConfiguration {
  readonly configured: boolean;
  readonly modelId: string | null;
  readonly thinkingMode: "enabled" | "disabled";
  readonly timeoutMs: number;
}

export function parseAiSdkTransportCandidateConfiguration(environment: Readonly<Record<string, string | undefined>>): AiSdkTransportCandidateConfiguration {
  const apiKey = environment.DEEPSEEK_API_KEY?.trim() ?? "";
  const modelId = environment.DEEPSEEK_MODEL?.trim() ?? "";
  const configuredTimeout = Number(environment.AI_SDK_CANDIDATE_TIMEOUT_MS);
  return {
    configured: Boolean(apiKey && modelId),
    modelId: modelId || null,
    thinkingMode: environment.DEEPSEEK_THINKING_MODE === "enabled" ? "enabled" : "disabled",
    timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30_000,
  };
}

interface AiSdkGenerationRequest extends Record<string, unknown> {
  readonly model: LanguageModel;
  readonly messages: readonly AiSdkModelMessage[];
  readonly instructions?: string;
  readonly tools?: ToolSet;
  readonly toolChoice?: "auto" | { readonly type: "tool"; readonly toolName: string };
  readonly abortSignal: AbortSignal;
  readonly timeout: { readonly totalMs: number };
  readonly maxRetries: 0;
}

interface AiSdkGenerationResult {
  readonly text: string;
  readonly toolCalls: readonly {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly input: unknown;
  }[];
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
  readonly providerMetadata?: Record<string, Record<string, unknown> | undefined>;
}

export type AiSdkGenerateText = (request: AiSdkGenerationRequest) => Promise<AiSdkGenerationResult>;

interface FoundryToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: Record<string, unknown>;
  };
}

function isFoundryToolDefinition(value: unknown): value is FoundryToolDefinition {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "function" || !("function" in value)) return false;
  const definition = value.function;
  return Boolean(definition && typeof definition === "object" && "name" in definition && typeof definition.name === "string" && definition.name.trim());
}

export function translateFoundryToolDefinitions(definitions: readonly unknown[]): ToolSet {
  const translated: ToolSet = {};
  for (const value of definitions) {
    if (!isFoundryToolDefinition(value)) throw new Error("AI_SDK_INVALID_TOOL_DEFINITION: Foundry tool definitions must use the governed function-tool contract.");
    const name = value.function.name;
    if (translated[name]) throw new Error(`AI_SDK_DUPLICATE_TOOL_DEFINITION: ${name}`);
    translated[name] = tool({
      description: value.function.description,
      inputSchema: jsonSchema(value.function.parameters ?? { type: "object", properties: {}, additionalProperties: false }),
    });
  }
  return translated;
}

function parseToolInput(argumentsValue: string): unknown {
  try { return JSON.parse(argumentsValue); }
  catch { return argumentsValue; }
}

function toAiSdkPrompt(messages: readonly ModelMessage[]): { readonly instructions?: string; readonly messages: readonly AiSdkModelMessage[] } {
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.function.name);
  }
  const instructions = messages.filter((message) => message.role === "system").map((message) => message.content ?? "").filter(Boolean).join("\n");
  const translated = messages.filter((message) => message.role !== "system").map((message): AiSdkModelMessage => {
    if (message.role === "user") return { role: "user", content: message.content ?? "" };
    if (message.role === "assistant") {
      if (!message.tool_calls?.length) return { role: "assistant", content: message.content ?? "" };
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.tool_calls.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.function.name,
            input: parseToolInput(call.function.arguments),
          })),
        ],
      };
    }
    if (message.role !== "tool" || !message.tool_call_id) throw new Error("AI_SDK_INVALID_MODEL_MESSAGE: Expected a governed tool result message.");
    const toolCallId = message.tool_call_id;
    const toolName = toolNames.get(toolCallId);
    if (!toolName) throw new Error(`AI_SDK_TOOL_RESULT_WITHOUT_CALL: ${toolCallId}`);
    return {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "text", value: message.content ?? "" },
      }],
    };
  });
  return { ...(instructions ? { instructions } : {}), messages: translated };
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toTokenUsage(result: AiSdkGenerationResult): TokenUsage | undefined {
  const inputTokens = number(result.usage?.inputTokens);
  const outputTokens = number(result.usage?.outputTokens);
  const totalTokens = number(result.usage?.totalTokens);
  const deepSeekMetadata = result.providerMetadata?.deepseek;
  const promptCacheHitTokens = number(deepSeekMetadata?.promptCacheHitTokens);
  const promptCacheMissTokens = number(deepSeekMetadata?.promptCacheMissTokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined && promptCacheHitTokens === undefined && promptCacheMissTokens === undefined) return undefined;
  return {
    promptTokens: inputTokens ?? 0,
    completionTokens: outputTokens ?? 0,
    totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
    ...(promptCacheHitTokens === undefined ? {} : { promptCacheHitTokens }),
    ...(promptCacheMissTokens === undefined ? {} : { promptCacheMissTokens }),
  };
}

const defaultGenerateText: AiSdkGenerateText = async (request) => {
  const result = await generateText(request as Parameters<typeof generateText>[0]);
  return result as unknown as AiSdkGenerationResult;
};

function createAiSdkModelClient(options: {
  readonly model: LanguageModel;
  readonly thinkingMode: "enabled" | "disabled";
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly generateText: AiSdkGenerateText;
}): AgentModelClient {
  return {
    async call(request): Promise<ModelCallResult> {
      options.signal.throwIfAborted();
      const tools = translateFoundryToolDefinitions(request.tools);
      const hasTools = Object.keys(tools).length > 0;
      const providerOptions = {
        deepseek: {
          thinking: { type: options.thinkingMode },
        } satisfies DeepSeekLanguageModelOptions,
      };
      const prompt = toAiSdkPrompt(request.messages);
      const result = await options.generateText({
        model: options.model,
        ...prompt,
        ...(hasTools ? {
          tools,
          toolChoice: request.requiredToolName ? { type: "tool", toolName: request.requiredToolName } : "auto",
        } : {}),
        providerOptions,
        abortSignal: options.signal,
        timeout: { totalMs: options.timeoutMs },
        maxRetries: 0,
        maxOutputTokens: 1800,
      });
      options.signal.throwIfAborted();
      return {
        message: result.toolCalls.length
          ? {
              role: "assistant",
              content: result.text || null,
              tool_calls: result.toolCalls.map((call) => ({
                id: call.toolCallId,
                type: "function" as const,
                function: { name: call.toolName, arguments: JSON.stringify(call.input) },
              })),
            }
          : { role: "assistant", content: result.text },
        ...(toTokenUsage(result) ? { usage: toTokenUsage(result) } : {}),
      };
    },
  };
}

interface CreateAiSdkTransportRuntimeExecutorOptions {
  readonly model: LanguageModel;
  readonly modelId: string;
  readonly thinkingMode: "enabled" | "disabled";
  readonly timeoutMs: number;
  readonly systemPrompt: string;
  readonly toolDefinitions: readonly unknown[];
  readonly createTools: (input: NormalizedRuntimeExecutionRequest, signal: AbortSignal) => AgentToolExecutor;
  readonly generateText?: AiSdkGenerateText;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

/**
 * RuntimeExecutor-shaped shadow adapter for one explicit hypothesis:
 * AI SDK replaces the DeepSeek model/provider transport only. Foundry's
 * existing runAgent implementation still owns the multi-call tool loop.
 */
export function createAiSdkTransportRuntimeExecutor(options: CreateAiSdkTransportRuntimeExecutorOptions): RuntimeExecutor {
  return {
    identity: {
      adapterId: "ai-sdk7-deepseek-transport",
      adapterVersion: AI_SDK_TRANSPORT_CANDIDATE_ADAPTER_VERSION,
      providerId: "deepseek",
      modelId: options.modelId,
    },
    async execute(input, signal): Promise<RuntimeExecutionResult> {
      signal.throwIfAborted();
      const toolResults: { readonly name: string; readonly resultRef: string; readonly data: unknown }[] = [];
      const tools = options.createTools(input, signal);
      const trace = await runAgent({
        request: input.request,
        executionPlan: input.executionPlan,
        model: options.modelId,
        thinkingMode: options.thinkingMode,
        systemPrompt: options.systemPrompt,
        promptVersion: input.policy.prompt.version,
        capabilityRegistryVersion: input.policy.capabilityRegistry.version,
        toolDefinitions: options.toolDefinitions,
        modelClient: createAiSdkModelClient({
          model: options.model,
          thinkingMode: options.thinkingMode,
          timeoutMs: options.timeoutMs,
          signal,
          generateText: options.generateText ?? defaultGenerateText,
        }),
        tools,
        signal,
        ...(options.createId ? { createId: options.createId } : {}),
        ...(options.now ? { now: options.now } : {}),
        onToolResult: (result) => { toolResults.push(result); },
      });
      signal.throwIfAborted();
      return { trace, toolResults };
    },
  };
}
