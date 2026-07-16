import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createDeepSeekClient, toObservableAgentMessage } from "../src/agent/deepseek-client.ts";
import { createAgentGateway, type AgentExecution } from "../src/agent/gateway.ts";
import { resolveAgentExecutionPlan } from "../src/agent/route-policy.ts";
import { AGENT_PROMPT_VERSION, buildAgentSystemPrompt, runAgent } from "../src/agent/run-agent.ts";
import { createAgentToolExecutor, type CapabilityRecord } from "../src/agent/tool-executor.ts";
import { PurposeSeparatedAgentTraceRepository } from "./lib/agent-trace-repository.ts";
import { LegacyLexicalEvidenceSearch, inspectCorpus } from "./lib/corpus-repository.ts";
import type { CorpusSearchService } from "../src/corpus/types.ts";
import { createCorpusDeliveryPolicyRuntime } from "../src/corpus/delivery-policy.ts";
import { LegacyTrainerCapabilityRuntime } from "../src/runtime/learning-capability-runtime.ts";
import { createRuntimeShadowCoordinator, parseRuntimeShadowConfiguration, type RuntimeExecutor } from "../src/runtime/runtime-shadow.ts";
import { RoleSeparatedFileRuntimeExecutionRecorder } from "./lib/runtime-execution-recorder.ts";

const root = new URL("../", import.meta.url);
const readText = (path: string) => readFile(new URL(path, root), "utf8");
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readText(path)) as T;
const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
const model = process.env.DEEPSEEK_MODEL?.trim() ?? "";
const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
const thinkingMode = process.env.DEEPSEEK_THINKING_MODE === "enabled" ? "enabled" : "disabled";
const port = Number(process.env.AGENT_GATEWAY_PORT ?? 4176);
const diagnosisUrl = process.env.TRAINER_DIAGNOSIS_URL?.trim() || "http://127.0.0.1:4177/diagnose";
const capabilities = await readJson<{ readonly version: string; readonly capabilities: readonly CapabilityRecord[] }>("config/capabilities/registry.json");
const toolConfig = await readJson<{ readonly version: string; readonly tools: readonly unknown[] }>("config/tools/tool-descriptions.json");
const responsePolicy = await readText("config/agent/response-policy.json");
const corpusDeliveryPolicyText = await readText("config/corpus/delivery-policy.json");
const corpusDeliveryPolicy = createCorpusDeliveryPolicyRuntime(JSON.parse(corpusDeliveryPolicyText), contentHash(corpusDeliveryPolicyText));
const systemPrompt = `${await readText("config/agent/instructions.md")}\nResponse policy: ${responsePolicy}`;
function contentHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
const corpusReport = await inspectCorpus();
let corpus: CorpusSearchService;
try { corpus = await LegacyLexicalEvidenceSearch.open(); }
catch { corpus = { search: async () => { throw new Error("CORPUS_INDEX_MISSING: run npm run corpus:ingest before starting the Agent Gateway."); } }; }
const traceRepositories = new PurposeSeparatedAgentTraceRepository(
  resolve(process.env.PRODUCT_TRACE_STORE_DIR ?? process.env.TRACE_STORE_DIR ?? ".local-data/product-agent-runs"),
  resolve(process.env.AGENT_EVAL_TRACE_STORE_DIR ?? ".local-data/agent-eval-agent-runs"),
);
const runtimeExecutionRecorder = new RoleSeparatedFileRuntimeExecutionRecorder(resolve(process.env.RUNTIME_EXECUTION_STORE_DIR ?? ".local-data/runtime-executions"));
const shadowConfiguration = parseRuntimeShadowConfiguration(process.env.RUNTIME_SHADOW_MODE, process.env.RUNTIME_SHADOW_TIMEOUT_MS);
const configured = Boolean(apiKey && model);
const client = configured ? createDeepSeekClient({ apiKey, model, baseUrl, thinkingMode }) : null;
const capabilityRuntime = new LegacyTrainerCapabilityRuntime(diagnosisUrl);
const legacyDeepSeekRuntimeExecutor: RuntimeExecutor | null = client ? {
  identity: { adapterId: "legacy-deepseek-agent", adapterVersion: "1.0.0", providerId: "deepseek", modelId: model },
  execute: async ({ request, executionPlan, policy }) => {
    const toolResults: { readonly name: string; readonly resultRef: string; readonly data: unknown }[] = [];
    const traceRepository = traceRepositories.forPurpose(request.runPurpose);
    const currentUserMessage = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const initialRoute = executionPlan.route;
    const tools = createAgentToolExecutor({ capabilities: capabilities.capabilities, corpus, corpusDeliveryPolicy, provider: "deepseek", capabilityRuntime, runPurpose: request.runPurpose, conversationId: request.conversationId, conversationEvidenceHash: contentHash(currentUserMessage), currentUserMessage });
    const traceId = `agent-trace-${randomUUID()}`; const startedAt = new Date().toISOString();
    await traceRepository.start({ traceId, request, initialRoute, obligations: executionPlan.obligations, provider: "deepseek", model, thinkingMode, prompt: policy.prompt, capabilityRegistry: policy.capabilityRegistry, toolDefinitions: policy.toolDefinitions, startedAt });
    try {
      const trace = await runAgent({ request, initialRoute, initialObligations: executionPlan.obligations, model, thinkingMode, systemPrompt, promptVersion: AGENT_PROMPT_VERSION, capabilityRegistryVersion: capabilities.version, toolDefinitions: toolConfig.tools, modelClient: client, tools, createId: () => traceId, onToolResult: (result) => toolResults.push(result), onModelResponse: (message, usage) => traceRepository.appendModelResponse(traceId, toObservableAgentMessage(message), usage), onToolExecution: (execution) => traceRepository.appendToolExecution(traceId, execution) });
      await traceRepository.complete(traceId, trace.finalResponse, trace.completedAt, trace.route);
      return { trace, toolResults };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "AGENT_RUN_FAILED";
      await traceRepository.fail(traceId, { code, message: error instanceof Error ? error.message : String(error) }, new Date().toISOString());
      throw error;
    }
  },
} : null;
const runtimeCoordinator = legacyDeepSeekRuntimeExecutor ? createRuntimeShadowCoordinator({
  shadowEnabled: shadowConfiguration.enabled,
  shadowTimeoutMs: shadowConfiguration.timeoutMs,
  authoritativeExecutor: legacyDeepSeekRuntimeExecutor,
  recorder: runtimeExecutionRecorder,
  onRecorderError: (error, record) => { console.error(`Runtime comparison record failed for ${record.executionId}: ${error instanceof Error ? error.message : String(error)}`); },
}) : null;
const legacyDeepSeekAgentExecution: AgentExecution | null = runtimeCoordinator ? {
  execute: async (request) => {
    const executionPlan = resolveAgentExecutionPlan(request);
    const observableSystemPrompt = buildAgentSystemPrompt(systemPrompt, executionPlan.route, executionPlan.obligations);
    const execution = await runtimeCoordinator.execute({
      request,
      executionPlan,
      policy: {
        prompt: { version: AGENT_PROMPT_VERSION, contentHash: contentHash(observableSystemPrompt) },
        capabilityRegistry: { version: capabilities.version, contentHash: contentHash(JSON.stringify(capabilities)) },
        toolDefinitions: { version: toolConfig.version, contentHash: contentHash(JSON.stringify(toolConfig)) },
      },
    });
    void execution.shadowCompletion;
    return execution.authoritativeResult;
  },
} : null;
const gateway = createAgentGateway({
  configured,
  model: model || null,
  thinkingMode,
  repository: traceRepositories,
  ...(legacyDeepSeekAgentExecution ? { execution: legacyDeepSeekAgentExecution } : {}),
});

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const webRequest = new Request(`http://127.0.0.1:${port}${request.url ?? "/"}`, { method: request.method, headers: request.headers as HeadersInit, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
  const result = await gateway.handle(webRequest);
  response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
  response.end(Buffer.from(await result.arrayBuffer()));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DeepSeek Agent Gateway listening on http://127.0.0.1:${port} · configured=${configured}`);
  for (const source of corpusReport.sources) console.log(`corpus source ${source.status === "REGISTERED" ? "registered" : "missing"}: ${source.sourceId}`);
  console.log(`index version: ${corpusReport.indexVersion ?? "missing"}`);
  console.log(`corpus delivery policy: ${corpusDeliveryPolicy.policy.version} (${corpusDeliveryPolicy.contentHash})`);
  console.log(`runtime shadow: ${shadowConfiguration.enabled ? "enabled (candidate not configured)" : "disabled; Legacy authoritative"}`);
  for (const [key, count] of Object.entries(corpusReport.chunkCounts).sort()) console.log(`chunks ${key}: ${count}`);
});
