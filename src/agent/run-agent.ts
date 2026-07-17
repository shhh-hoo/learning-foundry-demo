import { agentResponseEnvelopeSchema, type AgentExecutionPlan, type AgentObligations, type AgentRoute, type AgentRunRequest, type AgentTrace, type TokenUsage } from "./types";
import type { AgentModelClient, ModelMessage } from "./deepseek-client";
import { ZodError } from "zod";
import { enforceRoutePolicy, resolveAgentExecutionPlan, routeInstruction, RoutePolicyError } from "./route-policy";
import { EvidenceSufficiencyAssessor } from "./control-plane/evidence-sufficiency";
import { ToolExecutionGovernor } from "./control-plane/tool-execution-governor";
import { DiagnosisWorkflow } from "./control-plane/diagnosis-workflow";
import type { EvidenceSufficiencyAssessment } from "./control-plane/observability";

export interface AgentToolResult { readonly resultRef: string; readonly data: unknown; readonly evidenceData?: unknown; readonly executedArguments?: unknown; readonly sourceRefs?: readonly string[]; readonly evidenceRefs?: readonly string[]; readonly claimRefs?: readonly string[] }
export interface AgentToolExecutor { execute(name: string, argumentsValue: unknown): Promise<AgentToolResult> }

interface RunAgentOptions {
  readonly request: AgentRunRequest;
  readonly executionPlan?: AgentExecutionPlan;
  readonly initialRoute?: AgentRoute;
  readonly initialObligations?: AgentObligations;
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

export function buildAgentSystemPrompt(systemPrompt: string, route?: AgentRoute, obligations?: AgentObligations): string {
  const obligationInstruction = obligations?.capabilityInspectionRequired && !obligations.diagnosisRequired
    ? "Application obligation: capability inspection is required. Call list_capabilities, ground capability-boundary claims in that result, and do not run Learner Diagnosis."
    : "";
  return `${systemPrompt}\n${route ? routeInstruction(route) : ""}\n${obligationInstruction}\n${finalResponseContract}`;
}

function validationDetail(error: unknown): string {
  return error instanceof ZodError
    ? error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ")
    : error instanceof SyntaxError ? "response: empty or invalid JSON" : "response: invalid response contract";
}

function correctionForMalformedResponse(error: unknown): string {
  if (error instanceof RoutePolicyError) return `Your previous final response was rejected by the application route policy: ${error.message}. Call the missing required tool or return the required non-ANSWERED status, then emit the complete JSON contract. Do not add markdown.`;
  if (error instanceof AgentRunError && error.code === "AGENT_UNSUPPORTED_CLAIM") return `Your previous final response used an ID in the wrong reference class: ${error.message}. sourceRefs may contain only source IDs returned by search_learning_resources; capability, retrieval, gap and Diagnosis IDs belong in evidenceRefs. Use only IDs actually returned in this run and emit the complete JSON contract. Do not add markdown.`;
  return `Your previous final response failed validation: ${validationDetail(error)}. ${finalResponseContract} If the answer requires source-grounded course evidence and search_learning_resources has not succeeded in this run, call search_learning_resources now instead of returning a final response. Do not repeat the invalid response and do not add markdown.`;
}

function toolName(definition: unknown): string | null {
  if (!definition || typeof definition !== "object" || !("function" in definition)) return null;
  const functionDefinition = definition.function;
  return functionDefinition && typeof functionDefinition === "object" && "name" in functionDefinition && typeof functionDefinition.name === "string" ? functionDefinition.name : null;
}

function matchingToolDefinitions(definitions: readonly unknown[], names: readonly string[]): readonly unknown[] {
  return definitions.filter((definition) => names.includes(toolName(definition) ?? ""));
}

function providerToolsForPlan(plan: AgentExecutionPlan, definitions: readonly unknown[], records: AgentTrace["toolCalls"], assessments: readonly EvidenceSufficiencyAssessment[], governor: ToolExecutionGovernor, diagnosisWorkflow: DiagnosisWorkflow): readonly unknown[] {
  const route = plan.route;
  const obligations = plan.obligations;
  const permittedDefinitions = matchingToolDefinitions(definitions, plan.toolPolicy.permitted);
  if (plan.execution.mode === "GOVERNED_WORKFLOW") {
    const nextTool = diagnosisWorkflow.nextTool(records);
    return nextTool ? matchingToolDefinitions(permittedDefinitions, [nextTool]) : [];
  }
  const listSucceeded = records.some((record) => record.name === "list_capabilities" && record.status === "SUCCEEDED");
  if (obligations.capabilityInspectionRequired && !listSucceeded) return matchingToolDefinitions(permittedDefinitions, ["list_capabilities"]);
  if (route === "COURSE_EXPLANATION") {
    const latest = [...assessments].reverse().find((item) => item.toolId === "search_learning_resources");
    const budget = governor.snapshot().find((item) => item.toolId === "search_learning_resources");
    const searchAvailable = !latest || Boolean(latest.anotherCallJustified && budget && budget.consumed < budget.maximum);
    return searchAvailable ? matchingToolDefinitions(permittedDefinitions, ["search_learning_resources"]) : [];
  }
  if (obligations.capabilityInspectionRequired && !obligations.diagnosisRequired && (route === "LEARNER_DIAGNOSIS_INCOMPLETE" || route === "SOLVE_WITH_CHECKS")) return [];
  if (route === "CAPABILITY_GAP") return matchingToolDefinitions(permittedDefinitions, ["record_capability_gap"]);
  return permittedDefinitions;
}

function canonicalizeRouteOwnedReferences(
  response: ReturnType<typeof agentResponseEnvelopeSchema.parse>,
  route: AgentRoute,
  currentUserMessage: string,
  successfulToolResults: readonly { readonly name: string; readonly data: unknown }[],
  availableEvidenceRefs: Set<string>,
): ReturnType<typeof agentResponseEnvelopeSchema.parse> {
  if (route === "COURSE_EXPLANATION") {
    const retrieval = [...successfulToolResults].reverse().find((item) => item.name === "search_learning_resources" && item.data && typeof item.data === "object" && "results" in item.data && Array.isArray(item.data.results));
    const results = retrieval?.data && typeof retrieval.data === "object" && "results" in retrieval.data && Array.isArray(retrieval.data.results) ? retrieval.data.results : [];
    const officialSourceRequested = /(?:course|official)\s+source|syllabus/iu.test(currentUserMessage);
    const primaryResult = officialSourceRequested
      ? results.find((item) => item && typeof item === "object" && "sourceType" in item && item.sourceType === "OFFICIAL_SYLLABUS") ?? results[0]
      : results[0];
    const primarySourceId = primaryResult && typeof primaryResult === "object" && "sourceId" in primaryResult && typeof primaryResult.sourceId === "string" ? primaryResult.sourceId : undefined;
    return { ...response, sourceRefs: [...new Set([...(primarySourceId ? [primarySourceId] : []), ...response.sourceRefs])] };
  }
  if (route !== "LEARNER_DIAGNOSIS_COMPLETE") return response;
  const diagnosis = [...successfulToolResults].reverse().find((item) => item.name === "run_learner_diagnosis" && item.data && typeof item.data === "object" && "traceId" in item.data && typeof item.data.traceId === "string");
  if (!diagnosis || !diagnosis.data || typeof diagnosis.data !== "object" || !("traceId" in diagnosis.data) || typeof diagnosis.data.traceId !== "string") return response;
  return {
    ...response,
    sourceRefs: [],
    evidenceRefs: [...availableEvidenceRefs],
    diagnosisTraceId: diagnosis.data.traceId,
  };
}

export async function runAgent(options: RunAgentOptions): Promise<AgentTrace> {
  if (!options.model.trim()) throw new AgentRunError("AGENT_NOT_CONFIGURED", "DEEPSEEK_MODEL is required.");
  if (!options.request.messages.length) throw new AgentRunError("INVALID_AGENT_REQUEST", "At least one conversation message is required.");
  const start = options.now?.() ?? new Date();
  const traceId = options.createId?.() ?? `agent-trace-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  const resolvedPlan = options.executionPlan ?? resolveAgentExecutionPlan(options.request);
  const initialRoute = options.initialRoute ?? resolvedPlan.route;
  const obligations = options.initialObligations ?? resolvedPlan.obligations;
  const currentUserMessage = [...options.request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const messages: ModelMessage[] = [
    { role: "system", content: buildAgentSystemPrompt(options.systemPrompt, initialRoute, obligations) },
    ...resolvedPlan.contextSelection.selectedMessageIndexes.map((index) => options.request.messages[index]).filter((message): message is AgentRunRequest["messages"][number] => Boolean(message)),
  ];
  const records: AgentTrace["toolCalls"][number][] = [];
  const availableSourceRefs = new Set<string>();
  const availableEvidenceRefs = new Set<string>();
  const successfulToolResults: { readonly name: string; readonly data: unknown }[] = [];
  let tokenUsage: TokenUsage | undefined;
  let malformedRetries = 0;
  const evidenceAssessments: EvidenceSufficiencyAssessment[] = [];
  const evidenceAssessor = new EvidenceSufficiencyAssessor();
  const governor = new ToolExecutionGovernor(resolvedPlan);
  const diagnosisWorkflow = new DiagnosisWorkflow();

  for (let round = 0; round < resolvedPlan.toolPolicy.maximumModelSteps; round += 1) {
    const providerTools = providerToolsForPlan(resolvedPlan, options.toolDefinitions, records, evidenceAssessments, governor, diagnosisWorkflow);
    const requiredToolName = (initialRoute === "COURSE_EXPLANATION" || initialRoute === "LEARNER_DIAGNOSIS_COMPLETE" || obligations.capabilityInspectionRequired) && providerTools.length === 1
      ? toolName(providerTools[0]) ?? undefined
      : undefined;
    const result = await options.modelClient.call({ messages, tools: providerTools, ...(requiredToolName ? { requiredToolName } : {}) });
    await options.onModelResponse?.(result.message, result.usage);
    tokenUsage = addUsage(tokenUsage, result.usage);
    const assistant = result.message;
    messages.push(assistant);
    if (assistant.tool_calls?.length) {
      if (round === resolvedPlan.toolPolicy.maximumModelSteps - 1) throw new AgentRunError("AGENT_TOOL_LOOP_LIMIT_EXCEEDED", resolvedPlan.toolPolicy.maximumModelSteps === 6 ? "The model requested tools after six rounds." : `The model requested tools after ${resolvedPlan.toolPolicy.maximumModelSteps} rounds.`);
      for (const call of assistant.tool_calls) {
        const availableToolNames = new Set(providerTools.map((definition) => toolName(definition)).filter((name): name is string => Boolean(name)));
        if (!availableToolNames.has(call.function.name)) {
          const resultRef = `tool-error-${call.id}`;
          const structuredError = { code: "TOOL_NOT_AVAILABLE_ON_ROUTE", message: `${call.function.name} is not available at this route step.` };
          await options.onToolExecution?.({ name: call.function.name, arguments: { rejectedByRoute: true }, resultRef, status: "FAILED", error: structuredError });
          records.push({ name: call.function.name, arguments: { rejectedByRoute: true }, resultRef, status: "FAILED" });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ resultRef, error: `${structuredError.code}: ${structuredError.message}` }) });
          continue;
        }
        let parsed: unknown;
        try { parsed = JSON.parse(call.function.arguments); }
        catch {
          const resultRef = `tool-error-${call.id}`;
          const structuredError = { code: "INVALID_TOOL_ARGUMENTS", message: `${call.function.name} arguments are not valid JSON.` };
          await options.onToolExecution?.({ name: call.function.name, arguments: { invalidJson: true }, resultRef, status: "FAILED", error: structuredError });
          records.push({ name: call.function.name, arguments: { invalidJson: true }, resultRef, status: "FAILED" });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ resultRef, error: `${structuredError.code}: ${structuredError.message}` }) });
          continue;
        }
        const authorization = governor.authorize(call.function.name, parsed, evidenceAssessments);
        if (!authorization.allowed) {
          const resultRef = `tool-error-${call.id}`;
          const structuredError = { code: authorization.code, message: authorization.reason };
          await options.onToolExecution?.({ name: call.function.name, arguments: parsed, resultRef, status: "FAILED", error: structuredError });
          records.push({ name: call.function.name, arguments: parsed, resultRef, status: "FAILED" });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ resultRef, error: `${structuredError.code}: ${structuredError.message}` }) });
          continue;
        }
        try {
          const toolResult = await options.tools.execute(call.function.name, parsed);
          const evidenceData = toolResult.evidenceData ?? toolResult.data;
          const executedArguments = toolResult.executedArguments ?? parsed;
          options.onToolResult?.({ name: call.function.name, resultRef: toolResult.resultRef, data: evidenceData });
          successfulToolResults.push({ name: call.function.name, data: evidenceData });
          await options.onToolExecution?.({ name: call.function.name, arguments: executedArguments, resultRef: toolResult.resultRef, status: "SUCCEEDED", result: evidenceData });
          availableEvidenceRefs.add(toolResult.resultRef);
          toolResult.sourceRefs?.forEach((item) => availableSourceRefs.add(item));
          toolResult.evidenceRefs?.forEach((item) => availableEvidenceRefs.add(item));
          toolResult.claimRefs?.forEach((item) => availableSourceRefs.add(item));
          records.push({ name: call.function.name, arguments: executedArguments, resultRef: toolResult.resultRef, status: "SUCCEEDED" });
          const assessment = evidenceAssessor.assess({ toolId: call.function.name, toolCallIndex: records.length - 1, status: "SUCCEEDED", result: evidenceData });
          evidenceAssessments.push(assessment);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ resultRef: toolResult.resultRef, data: toolResult.data, evidenceAssessment: assessment }) });
        } catch (error) {
          const resultRef = `tool-error-${call.id}`;
          const structuredError = { code: error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "TOOL_EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) };
          await options.onToolExecution?.({ name: call.function.name, arguments: parsed, resultRef, status: "FAILED", error: structuredError });
          records.push({ name: call.function.name, arguments: parsed, resultRef, status: "FAILED" });
          evidenceAssessments.push(evidenceAssessor.assess({ toolId: call.function.name, toolCallIndex: records.length - 1, status: "FAILED" }));
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ resultRef, error: error instanceof Error ? error.message : String(error) }) });
        }
      }
      continue;
    }
    try {
      const parsedResponse = agentResponseEnvelopeSchema.parse(JSON.parse(assistant.content ?? ""));
      const response = canonicalizeRouteOwnedReferences(parsedResponse, initialRoute, currentUserMessage, successfulToolResults, availableEvidenceRefs);
      validateClaims(response, availableSourceRefs, availableEvidenceRefs, successfulToolResults);
      const budgetConsumption = governor.snapshot();
      const route = enforceRoutePolicy(options.request, response, records, successfulToolResults, initialRoute, obligations, evidenceAssessments, resolvedPlan, budgetConsumption);
      const completed = options.now?.() ?? new Date();
      const latestEvidence = [...evidenceAssessments].reverse().find((item) => item.toolId === "search_learning_resources");
      const stopReason = response.status === "NEEDS_MORE_EVIDENCE" && latestEvidence
        ? latestEvidence.continueOrStopReason
        : resolvedPlan.execution.mode === "GOVERNED_WORKFLOW" ? "Governed workflow completed in its application-owned order." : "Execution Plan requirements satisfied.";
      return {
        traceId,
        conversationId: options.request.conversationId,
        inputOrigin: options.request.inputOrigin,
        runPurpose: options.request.runPurpose,
        initialRoute,
        route,
        obligations,
        executionPlan: resolvedPlan,
        contextSelection: resolvedPlan.contextSelection,
        budgetConsumption,
        evidenceAssessments,
        stopReason,
        ...(resolvedPlan.execution.mode === "GOVERNED_WORKFLOW" ? { governedWorkflow: diagnosisWorkflow.trace(records, true) } : {}),
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
      if (error instanceof AgentRunError && error.code !== "AGENT_UNSUPPORTED_CLAIM") throw error;
      if (malformedRetries >= 1) {
        if (error instanceof AgentRunError) throw error;
        if (error instanceof RoutePolicyError) throw new AgentRunError(error.code, error.message);
        throw new AgentRunError("INVALID_AGENT_RESPONSE", `DeepSeek final response failed validation twice. Last error: ${validationDetail(error)}.`);
      }
      malformedRetries += 1;
      messages.push({ role: "user", content: correctionForMalformedResponse(error) });
      round -= 1;
    }
  }
  throw new AgentRunError("AGENT_TOOL_LOOP_LIMIT_EXCEEDED", `The model did not finish within ${resolvedPlan.toolPolicy.maximumModelSteps} tool rounds.`);
}
