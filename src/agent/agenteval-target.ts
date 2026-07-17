import type { AgentEvalToolResult } from "./agenteval";
import type { AgentRunRequest, AgentTrace } from "./types";

export interface AgentEvalTargetHealth {
  readonly provider: string;
  readonly model: string;
  readonly thinkingMode: string;
  readonly baseUrlOrigin?: string;
  readonly maxTokens?: number;
  readonly responseFormat?: string;
  readonly agentPromptHash?: string;
  readonly responsePolicyHash?: string;
  readonly toolDefinitionsHash?: string;
  readonly capabilityRegistryHash?: string;
  readonly corpusDeliveryPolicyHash?: string;
  readonly corpusReady?: boolean;
  readonly corpusIndexVersion?: string | null;
  readonly corpusChunkCount?: number;
  readonly agentEvalDeliveryAuthorized?: boolean;
  readonly authoritativeAdapterId?: string;
  readonly runtimeAuthority?: string;
  readonly trainer?: {
    readonly diagnosisEndpointHash: string;
    readonly ready: boolean;
    readonly service: string | null;
    readonly governedCaseCount: number | null;
  };
}

export type AgentEvalTargetResult =
  | { readonly ok: true; readonly trace: AgentTrace; readonly toolResults: readonly AgentEvalToolResult[] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly httpStatus?: number } };

export interface AgentEvalTarget {
  health(): Promise<AgentEvalTargetHealth>;
  execute(request: AgentRunRequest & { readonly runPurpose: "AGENT_EVAL" }, options?: { readonly signal?: AbortSignal }): Promise<AgentEvalTargetResult>;
}

export class LegacyGatewayAgentEvalTarget implements AgentEvalTarget {
  constructor(
    private readonly gatewayUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  async health(): Promise<AgentEvalTargetHealth> {
    const response = await this.fetcher(`${this.gatewayUrl}/health`);
    const body = await response.json() as { readonly configured?: boolean; readonly provider?: string; readonly model?: string | null; readonly thinkingMode?: string } & Omit<AgentEvalTargetHealth, "provider" | "model" | "thinkingMode">;
    if (!response.ok || !body.configured || !body.model) throw new Error("AGENT_NOT_CONFIGURED: Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL, then start the local services.");
    const { configured: _configured, provider: _provider, model: _model, thinkingMode: _thinkingMode, ...details } = body;
    return { ...details, provider: body.provider ?? "deepseek", model: body.model, thinkingMode: body.thinkingMode ?? "unknown" };
  }

  async execute(request: AgentRunRequest & { readonly runPurpose: "AGENT_EVAL" }, options?: { readonly signal?: AbortSignal }): Promise<AgentEvalTargetResult> {
    const response = await this.fetcher(`${this.gatewayUrl}/agent/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    const body = await response.json() as { readonly ok?: boolean; readonly trace?: AgentTrace; readonly toolResults?: readonly AgentEvalToolResult[]; readonly error?: { readonly code?: string; readonly message?: string } };
    if (!response.ok || !body.ok || !body.trace) {
      const message = body.error?.message ?? "Agent run did not return a trace.";
      const originalStatus = Number(message.match(/\bHTTP\s+(408|429|5\d\d)\b/u)?.[1]);
      return { ok: false, error: { code: body.error?.code ?? "AGENT_RUN_FAILED", message, ...(Number.isFinite(originalStatus) ? { httpStatus: originalStatus } : {}) } };
    }
    return { ok: true, trace: body.trace, toolResults: body.toolResults ?? [] };
  }
}
