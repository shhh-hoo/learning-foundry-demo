import type { AgentEvalTarget } from "../agent/agenteval-target";
import type { TokenUsage } from "../agent/types";
import type { BenchmarkArmExecutor, BenchmarkArmOutput, BenchmarkCase, BenchmarkPlannedExecution, BenchmarkReplacementExecution } from "./index";

export interface FrozenBenchmarkPrompts {
  readonly schemaVersion: "1.0.0";
  readonly directAnswerContract: string;
  readonly arms: {
    readonly A_BARE_LLM: { readonly systemPrompt: string; readonly tools: readonly [] };
    readonly B_FOUNDRY_POLICY_NO_TOOLS: { readonly systemPrompt: string; readonly tools: readonly [] };
  };
}

export interface BenchmarkModelConfiguration {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly thinkingMode: "enabled" | "disabled";
  readonly temperature: number | null;
  readonly topP: number | null;
  readonly maxTokens: number;
}

interface DeepSeekResponseBody {
  readonly choices?: readonly { readonly message?: { readonly content?: string; readonly reasoning_content?: string } }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number; readonly total_tokens?: number; readonly prompt_cache_hit_tokens?: number; readonly prompt_cache_miss_tokens?: number };
}

function tokenUsage(value: DeepSeekResponseBody["usage"]): TokenUsage | undefined {
  if (!value) return undefined;
  return {
    promptTokens: value.prompt_tokens ?? 0,
    completionTokens: value.completion_tokens ?? 0,
    totalTokens: value.total_tokens ?? 0,
    ...(value.prompt_cache_hit_tokens === undefined ? {} : { promptCacheHitTokens: value.prompt_cache_hit_tokens }),
    ...(value.prompt_cache_miss_tokens === undefined ? {} : { promptCacheMissTokens: value.prompt_cache_miss_tokens }),
  };
}

function parseAnswer(content: string | undefined): string {
  if (!content) throw Object.assign(new Error("Model response has no content."), { code: "MODEL_RESPONSE_INVALID" });
  try {
    const parsed = JSON.parse(content) as { readonly answer?: unknown; readonly learnerMessage?: unknown };
    const answer = typeof parsed.answer === "string" ? parsed.answer : typeof parsed.learnerMessage === "string" ? parsed.learnerMessage : undefined;
    if (!answer?.trim()) throw new Error("missing answer");
    return answer;
  } catch (error) {
    throw Object.assign(new Error(`Structured model answer is invalid: ${error instanceof Error ? error.message : String(error)}`), { code: "MODEL_RESPONSE_INVALID" });
  }
}

export class DirectDeepSeekBenchmarkExecutor implements BenchmarkArmExecutor {
  constructor(
    private readonly systemPrompt: string,
    private readonly config: BenchmarkModelConfiguration,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  async execute({ testCase, signal }: { readonly testCase: BenchmarkCase; readonly execution: BenchmarkPlannedExecution | BenchmarkReplacementExecution; readonly signal: AbortSignal }): Promise<BenchmarkArmOutput> {
    const started = performance.now();
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: "system", content: this.systemPrompt }, ...testCase.messages.map(({ role, content }) => ({ role, content }))],
        response_format: { type: "json_object" },
        thinking: { type: this.config.thinkingMode },
        max_tokens: this.config.maxTokens,
        ...(this.config.temperature === null ? {} : { temperature: this.config.temperature }),
        ...(this.config.topP === null ? {} : { top_p: this.config.topP }),
        stream: false,
      }),
    });
    if (!response.ok) {
      const error = Object.assign(new Error(`DeepSeek benchmark request failed with HTTP ${response.status}.`), { code: "DEEPSEEK_API_ERROR", httpStatus: response.status });
      throw error;
    }
    const body = await response.json() as DeepSeekResponseBody;
    const usage = tokenUsage(body.usage);
    return {
      answer: parseAnswer(body.choices?.[0]?.message?.content), sourceRefs: [], evidenceRefs: [], toolTrajectory: [],
      ...(usage ? { tokenUsage: usage } : {}), ...(body.usage ? { providerUsage: { prompt_tokens: body.usage.prompt_tokens ?? 0, completion_tokens: body.usage.completion_tokens ?? 0, total_tokens: body.usage.total_tokens ?? 0, ...(body.usage.prompt_cache_hit_tokens === undefined ? {} : { prompt_cache_hit_tokens: body.usage.prompt_cache_hit_tokens }), ...(body.usage.prompt_cache_miss_tokens === undefined ? {} : { prompt_cache_miss_tokens: body.usage.prompt_cache_miss_tokens }) } } : {}),
      systemPrompt: this.systemPrompt, rawClientLatencyMs: Math.max(0, performance.now() - started),
    };
  }
}

function dataShape(value: unknown): unknown {
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (value && typeof value === "object") return { type: "object", keys: Object.keys(value).sort() };
  return { type: value === null ? "null" : typeof value };
}

export class FullFoundryBenchmarkExecutor implements BenchmarkArmExecutor {
  constructor(
    private readonly target: AgentEvalTarget,
    private readonly systemPromptForCase: (testCase: BenchmarkCase) => string,
  ) {}

  async execute({ testCase, execution, signal }: { readonly testCase: BenchmarkCase; readonly execution: BenchmarkPlannedExecution | BenchmarkReplacementExecution; readonly signal: AbortSignal }): Promise<BenchmarkArmOutput> {
    const started = performance.now();
    const result = await this.target.execute({
      conversationId: execution.conversationId, inputOrigin: "USER_INPUT", runPurpose: "AGENT_EVAL",
      ...(testCase.activeTaskId ? { activeTaskId: testCase.activeTaskId } : {}), ...(testCase.activeEpisodeId ? { activeEpisodeId: testCase.activeEpisodeId } : {}),
      messages: testCase.messages.map((message) => ({ role: message.role, content: message.content, ...(message.context ? { context: message.context } : {}) })),
    }, { signal });
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    const trace = result.trace;
    return {
      answer: trace.finalResponse.learnerMessage, sourceRefs: [...trace.finalResponse.sourceRefs], evidenceRefs: [...(trace.finalResponse.evidenceRefs ?? [])],
      toolTrajectory: trace.toolCalls.map(({ name, status, resultRef }) => ({ name, status, resultRef })),
      ...(trace.tokenUsage ? { tokenUsage: trace.tokenUsage } : {}), systemPrompt: this.systemPromptForCase(testCase),
      rawClientLatencyMs: Math.max(0, performance.now() - started),
      runtimeEvidence: {
        traceId: trace.traceId, route: trace.route, obligations: trace.obligations, executionPlan: trace.executionPlan,
        contextSelection: trace.contextSelection, budgetConsumption: trace.budgetConsumption, evidenceAssessments: trace.evidenceAssessments,
        stopReason: trace.stopReason, governedWorkflow: trace.governedWorkflow,
        toolResults: result.toolResults.map(({ name, resultRef, data }) => ({ name, resultRef, dataShape: dataShape(data) })),
      },
    };
  }
}

export function createValueBenchmarkExecutors(options: {
  readonly prompts: FrozenBenchmarkPrompts;
  readonly model: BenchmarkModelConfiguration;
  readonly target: AgentEvalTarget;
  readonly fullFoundrySystemPromptForCase: (testCase: BenchmarkCase) => string;
  readonly fetcher?: typeof fetch;
}) {
  return {
    A_BARE_LLM: new DirectDeepSeekBenchmarkExecutor(`${options.prompts.arms.A_BARE_LLM.systemPrompt}\n${options.prompts.directAnswerContract}`, options.model, options.fetcher),
    B_FOUNDRY_POLICY_NO_TOOLS: new DirectDeepSeekBenchmarkExecutor(`${options.prompts.arms.B_FOUNDRY_POLICY_NO_TOOLS.systemPrompt}\n${options.prompts.directAnswerContract}`, options.model, options.fetcher),
    C_FULL_FOUNDRY: new FullFoundryBenchmarkExecutor(options.target, options.fullFoundrySystemPromptForCase),
  } as const;
}

