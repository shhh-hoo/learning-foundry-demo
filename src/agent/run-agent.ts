import { agentResponseEnvelopeSchema, type AgentRunRequest, type AgentTrace, type TokenUsage } from "./types";
import type { AgentModelClient, ModelMessage } from "./deepseek-client";

export interface AgentToolResult { readonly resultRef: string; readonly data: unknown; readonly claimRefs?: readonly string[] }
export interface AgentToolExecutor { execute(name: string, argumentsValue: unknown): Promise<AgentToolResult> }

interface RunAgentOptions {
  readonly request: AgentRunRequest;
  readonly model: string;
  readonly thinkingMode: "enabled" | "disabled";
  readonly systemPrompt: string;
  readonly promptVersion: string;
  readonly capabilityRegistryVersion: string;
  readonly toolDefinitions: readonly unknown[];
  readonly modelClient: AgentModelClient;
  readonly tools: AgentToolExecutor;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly onToolResult?: (result: { readonly name: string; readonly resultRef: string; readonly data: unknown }) => void;
  readonly onModelResponse?: (message: ModelMessage, usage: TokenUsage | undefined) => void | Promise<void>;
  readonly onToolExecution?: (execution: { readonly name: string; readonly arguments: unknown; readonly resultRef: string; readonly status: "SUCCEEDED" | "FAILED"; readonly result?: unknown; readonly error?: { readonly code: string; readonly message: string } }) => void | Promise<void>;
}

export class AgentRunError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

function addUsage(total: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  if (!next) return total;
  return {
    promptTokens: (total?.promptTokens ?? 0) + next.promptTokens,
    completionTokens: (total?.completionTokens ?? 0) + next.completionTokens,
    totalTokens: (total?.totalTokens ?? 0) + next.totalTokens,
    promptCacheHitTokens: (total?.promptCacheHitTokens ?? 0) + (next.promptCacheHitTokens ?? 0),
    promptCacheMissTokens: (total?.promptCacheMissTokens ?? 0) + (next.promptCacheMissTokens ?? 0),
  };
}

function validateClaims(response: ReturnType<typeof agentResponseEnvelopeSchema.parse>, availableRefs: Set<string>, toolResults: readonly { readonly name: string; readonly data: unknown }[]): void {
  const claimed = [...response.sourceRefs, response.diagnosisTraceId, response.capabilityGapId].filter((item): item is string => Boolean(item));
  const unsupported = claimed.filter((item) => !availableRefs.has(item));
  if (unsupported.length) throw new AgentRunError("AGENT_UNSUPPORTED_CLAIM", `Final response referenced results not produced by tools: ${unsupported.join(", ")}`);
  const matchesProposal = (name: string, proposal: unknown) => toolResults.some((item) => item.name === name && JSON.stringify(item.data).includes(JSON.stringify(proposal).slice(1, -1)));
  if (response.proposedLibraryArtifact && !matchesProposal("propose_library_artifact", response.proposedLibraryArtifact)) throw new AgentRunError("AGENT_UNSUPPORTED_CLAIM", "Library proposal was not produced by its tool.");
  if (response.proposedFollowUp && !matchesProposal("propose_schedule_followup", response.proposedFollowUp)) throw new AgentRunError("AGENT_UNSUPPORTED_CLAIM", "Schedule proposal was not produced by its tool.");
}

export async function runAgent(options: RunAgentOptions): Promise<AgentTrace> {
  if (!options.model.trim()) throw new AgentRunError("AGENT_NOT_CONFIGURED", "DEEPSEEK_MODEL is required.");
  if (!options.request.messages.length) throw new AgentRunError("INVALID_AGENT_REQUEST", "At least one conversation message is required.");
  const start = options.now?.() ?? new Date();
  const traceId = options.createId?.() ?? `agent-trace-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  const messages: ModelMessage[] = [
    { role: "system", content: `${options.systemPrompt}\nReturn a json object with status, learnerMessage and sourceRefs. Optional fields are diagnosisTraceId, proposedLibraryArtifact, proposedFollowUp and capabilityGapId.` },
    ...options.request.messages,
  ];
  const records: AgentTrace["toolCalls"][number][] = [];
  const availableRefs = new Set<string>();
  const successfulToolResults: { readonly name: string; readonly data: unknown }[] = [];
  let tokenUsage: TokenUsage | undefined;
  let malformedRetries = 0;

  for (let round = 0; round < 6; round += 1) {
    const result = await options.modelClient.call({ messages, tools: options.toolDefinitions });
    await options.onModelResponse?.(result.message, result.usage);
    tokenUsage = addUsage(tokenUsage, result.usage);
    const assistant = result.message;
    messages.push(assistant);
    if (assistant.tool_calls?.length) {
      if (round === 5) throw new AgentRunError("AGENT_TOOL_LOOP_LIMIT_EXCEEDED", "The model requested tools after six rounds.");
      for (const call of assistant.tool_calls) {
        let parsed: unknown;
        try { parsed = JSON.parse(call.function.arguments); }
        catch { throw new AgentRunError("INVALID_TOOL_ARGUMENTS", `${call.function.name} arguments are not valid JSON.`); }
        try {
          const toolResult = await options.tools.execute(call.function.name, parsed);
          options.onToolResult?.({ name: call.function.name, resultRef: toolResult.resultRef, data: toolResult.data });
          successfulToolResults.push({ name: call.function.name, data: toolResult.data });
          await options.onToolExecution?.({ name: call.function.name, arguments: parsed, resultRef: toolResult.resultRef, status: "SUCCEEDED", result: toolResult.data });
          availableRefs.add(toolResult.resultRef);
          toolResult.claimRefs?.forEach((item) => availableRefs.add(item));
          records.push({ name: call.function.name, arguments: parsed, resultRef: toolResult.resultRef, status: "SUCCEEDED" });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ resultRef: toolResult.resultRef, data: toolResult.data }) });
        } catch (error) {
          const resultRef = `tool-error-${call.id}`;
          const structuredError = { code: error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "TOOL_EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) };
          await options.onToolExecution?.({ name: call.function.name, arguments: parsed, resultRef, status: "FAILED", error: structuredError });
          records.push({ name: call.function.name, arguments: parsed, resultRef, status: "FAILED" });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ resultRef, error: error instanceof Error ? error.message : String(error) }) });
        }
      }
      continue;
    }
    try {
      const response = agentResponseEnvelopeSchema.parse(JSON.parse(assistant.content ?? ""));
      validateClaims(response, availableRefs, successfulToolResults);
      const completed = options.now?.() ?? new Date();
      return {
        traceId,
        conversationId: options.request.conversationId,
        inputOrigin: options.request.inputOrigin,
        runPurpose: options.request.runPurpose,
        provider: "deepseek",
        model: options.model,
        thinkingMode: options.thinkingMode,
        promptVersion: options.promptVersion,
        capabilityRegistryVersion: options.capabilityRegistryVersion,
        startedAt: start.toISOString(),
        completedAt: completed.toISOString(),
        toolCalls: records,
        finalResponse: response,
        ...(tokenUsage ? { tokenUsage } : {}),
        latencyMs: Math.max(0, completed.getTime() - start.getTime()),
      };
    } catch (error) {
      if (error instanceof AgentRunError) throw error;
      if (malformedRetries >= 1) throw new AgentRunError("INVALID_AGENT_RESPONSE", "DeepSeek returned malformed or empty JSON twice.");
      malformedRetries += 1;
      messages.push({ role: "user", content: "Return one non-empty valid json object that matches the response contract. Do not add markdown." });
      round -= 1;
    }
  }
  throw new AgentRunError("AGENT_TOOL_LOOP_LIMIT_EXCEEDED", "The model did not finish within six tool rounds.");
}
