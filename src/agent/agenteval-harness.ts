import type { AgentEvalToolResult } from "./agenteval";
import type { AgentRunRequest, AgentTrace } from "./types";

export interface AgentEvalHarnessHealth {
  readonly provider: string;
  readonly model: string;
  readonly thinkingMode: string;
}

export type AgentEvalHarnessResult =
  | { readonly ok: true; readonly trace: AgentTrace; readonly toolResults: readonly AgentEvalToolResult[] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface AgentEvalHarness {
  health(): Promise<AgentEvalHarnessHealth>;
  execute(request: AgentRunRequest & { readonly runPurpose: "AGENT_EVAL" }): Promise<AgentEvalHarnessResult>;
}

export class LegacyAgentEvalHarness implements AgentEvalHarness {
  constructor(
    private readonly gatewayUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  async health(): Promise<AgentEvalHarnessHealth> {
    const response = await this.fetcher(`${this.gatewayUrl}/health`);
    const body = await response.json() as { readonly configured?: boolean; readonly provider?: string; readonly model?: string | null; readonly thinkingMode?: string };
    if (!response.ok || !body.configured || !body.model) throw new Error("AGENT_NOT_CONFIGURED: Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL, then start the local services.");
    return { provider: body.provider ?? "deepseek", model: body.model, thinkingMode: body.thinkingMode ?? "unknown" };
  }

  async execute(request: AgentRunRequest & { readonly runPurpose: "AGENT_EVAL" }): Promise<AgentEvalHarnessResult> {
    const response = await this.fetcher(`${this.gatewayUrl}/agent/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await response.json() as { readonly ok?: boolean; readonly trace?: AgentTrace; readonly toolResults?: readonly AgentEvalToolResult[]; readonly error?: { readonly code?: string; readonly message?: string } };
    if (!response.ok || !body.ok || !body.trace) return { ok: false, error: { code: body.error?.code ?? "AGENT_RUN_FAILED", message: body.error?.message ?? "Agent run did not return a trace." } };
    return { ok: true, trace: body.trace, toolResults: body.toolResults ?? [] };
  }
}
