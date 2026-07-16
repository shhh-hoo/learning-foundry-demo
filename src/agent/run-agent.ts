import { agentResponseEnvelopeSchema, type AgentRoute, type AgentRunRequest, type AgentTrace, type TokenUsage } from "./types";
import type { AgentModelClient, ModelMessage } from "./deepseek-client";
import { ZodError } from "zod";
import { classifyAgentRoute, enforceRoutePolicy, routeInstruction, RoutePolicyError } from "./route-policy";

export interface AgentToolResult { readonly resultRef: string; readonly data: unknown; readonly sourceRefs?: readonly string[]; readonly evidenceRefs?: readonly string[]; readonly claimRefs?: readonly string[] }
export interface AgentToolExecutor { execute(name: string, argumentsValue: unknown): Promise<AgentToolResult> }

interface RunAgentOptions {
  readonly request: AgentRunRequest;
  readonly initialRoute?: AgentRoute;
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

function validateClaims(response: ReturnType<typeof agentResponseEnvelopeSchema.parse>, availableSourceRefs: Set<string>, availableEvidenceRefs: Set<string>, toolResults: readonly { readonly name: string; readonly data: unknown }[]): void {
  const unsupportedSources = response.sourceRefs.filter((item) => !availableSourceRefs.has(item));
  const claimedEvidence = [...(response.evidenceRefs ?? []), response.diagnosisTraceId, response.capabilityGapId].filter((item): item is string => Boolean(item));
  const unsupportedEvidence = claimedEvidence.filter((item) => !availableEvidenceRefs.has(item));
  if (unsupportedSources.length || unsupportedEvidence.length) throw new AgentRunError("AGENT_UNSUPPORTED_CLAIM", `Final response referenced results not produced in the correct reference class: ${[...unsupportedSources, ...unsupportedEvidence].join(", ")}`);
  const matchesProposal = (name: string, proposal: unknown) => toolResults.some((item) => item.name === name && JSON.stringify(item.data).includes(JSON.stringify(proposal).slice(1, -1)));
  if (response.proposedLibraryArtifact && !matchesProposal("propose_library_artifact", response.proposedLibraryArtifact)) throw new AgentRunError("AGENT_UNSUPPORTED_CLAIM", "Library proposal was not produced by its tool.");
  if (response.proposedFollowUp && !matchesProposal("propose_schedule_followup", response.proposedFollowUp)) throw new AgentRunError("AGENT_UNSUPPORTED_CLAIM", "Schedule proposal was not produced by its tool.");
}

export const AGENT_PROMPT_VERSION = "1.3.0";

const finalResponseContract = [
  "Return only one JSON object after all required tools have succeeded.",
  "Required exact field types: status is ANSWERED, NEEDS_MORE_EVIDENCE, or CAPABILITY_GAP; learnerMessage is a non-empty string; sourceRefs and evidenceRefs are arrays of string IDs.",
  "sourceRefs may contain only curriculum, Teacher Note, or governed case source IDs returned by search_learning_resources. Capability, gap, retrieval-trace, AgentTrace, and Diagnosis IDs belong only in evidenceRefs.",
  "Optional fields: diagnosisTraceId and capabilityGapId are evidence IDs returned by tools; proposedLibraryArtifact is {title:string,content:string}; proposedFollowUp is {title:string,reason:string,delayDays:integer}.",
].join(" ");

export function buildAgentSystemPrompt(systemPrompt: string, route?: AgentRoute): string {
  return `${systemPrompt}\n${route ? routeInstruction(route) : ""}\n${finalResponseContract}`;
}

function validationDetail(error: unknown): string {
  return error instanceof ZodError
    ? error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ")
    : error instanceof SyntaxError ? "response: empty or invalid JSON" : "response: invalid response contract";
}

function correctionForMalformedResponse(error: unknown): string {
  if (error instanceof RoutePolicyError) return `Your previous final response was rejected by the application route policy: ${error.message}. Call the missing required tool or return the required non-ANSWERED status, then emit the complete JSON contract. Do not add markdown.`;
  return `Your previous final response failed validation: ${validationDetail(error)}. ${finalResponseContract} If the answer requires source-grounded course evidence and search_learning_resources has not succeeded in this run, call search_learning_resources now instead of returning a final response. Do not repeat the invalid response and do not add markdown.`;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentTrace> {
  if (!options.model.trim()) throw new AgentRunError("AGENT_NOT_CONFIGURED", "DEEPSEEK_MODEL is required.");
  if (!options.request.messages.length) throw new AgentRunError("INVALID_AGENT_REQUEST", "At least one conversation message is required.");
  const start = options.now?.() ?? new Date();
  const traceId = options.createId?.() ?? `agent-trace-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  const initialRoute = options.initialRoute ?? classifyAgentRoute(options.request);
  const messages: ModelMessage[] = [
    { role: "system", content: buildAgentSystemPrompt(options.systemPrompt, initialRoute) },
    ...options.request.messages,
  ];
  const records: AgentTrace["toolCalls"][number][] = [];
  const availableSourceRefs = new Set<string>();
  const availableEvidenceRefs = new Set<string>();
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
          availableEvidenceRefs.add(toolResult.resultRef);
          toolResult.sourceRefs?.forEach((item) => availableSourceRefs.add(item));
          toolResult.evidenceRefs?.forEach((item) => availableEvidenceRefs.add(item));
          toolResult.claimRefs?.forEach((item) => availableSourceRefs.add(item));
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
      validateClaims(response, availableSourceRefs, availableEvidenceRefs, successfulToolResults);
      const route = enforceRoutePolicy(options.request, response, records, successfulToolResults, initialRoute);
      const completed = options.now?.() ?? new Date();
      return {
        traceId,
        conversationId: options.request.conversationId,
        inputOrigin: options.request.inputOrigin,
        runPurpose: options.request.runPurpose,
        initialRoute,
        route,
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
      if (malformedRetries >= 1) {
        if (error instanceof RoutePolicyError) throw new AgentRunError(error.code, error.message);
        throw new AgentRunError("INVALID_AGENT_RESPONSE", `DeepSeek final response failed validation twice. Last error: ${validationDetail(error)}.`);
      }
      malformedRetries += 1;
      messages.push({ role: "user", content: correctionForMalformedResponse(error) });
      round -= 1;
    }
  }
  throw new AgentRunError("AGENT_TOOL_LOOP_LIMIT_EXCEEDED", "The model did not finish within six tool rounds.");
}