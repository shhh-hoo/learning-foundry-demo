import { agentResponseEnvelopeSchema, inputOriginSchema, type AgentRunRequest, type AgentTrace } from "./types";
import { z } from "zod";

const requestSchema = z.object({
  conversationId: z.string().min(1),
  inputOrigin: inputOriginSchema,
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) })).min(1),
}).strict();

interface GatewayOptions {
  readonly configured: boolean;
  readonly model: string | null;
  readonly thinkingMode: "enabled" | "disabled";
  readonly run?: (request: AgentRunRequest) => Promise<AgentTrace | { readonly trace: AgentTrace; readonly toolResults: readonly { readonly name: string; readonly resultRef: string; readonly data: unknown }[] }>;
  readonly repository?: { get(traceId: string): Promise<unknown | null>; query(query: { readonly conversationId?: string; readonly status?: "RUNNING" | "COMPLETED" | "FAILED"; readonly inputOrigin?: "USER_INPUT" | "PRESET_INPUT"; readonly startedFrom?: string; readonly startedTo?: string }): Promise<readonly unknown[]>; clear?(): Promise<void> };
}

type AgentRunQuery = Parameters<NonNullable<GatewayOptions["repository"]>["query"]>[0];

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "access-control-allow-origin": "http://127.0.0.1:4173", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS" } });
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z_]+:/.test(message) ? message.slice(0, message.indexOf(":")) : "AGENT_GATEWAY_ERROR";
}

export function createAgentGateway(options: GatewayOptions) {
  const traces = new Map<string, AgentTrace>();
  return {
    traces,
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return json(204, null);
      if (request.method === "GET" && url.pathname === "/health") return json(200, { configured: options.configured, provider: "deepseek", model: options.model, thinkingMode: options.thinkingMode });
      if (request.method === "GET" && url.pathname.startsWith("/agent/runs/")) {
        const traceId = decodeURIComponent(url.pathname.slice("/agent/runs/".length));
        const trace = options.repository ? await options.repository.get(traceId) : traces.get(traceId);
        return trace ? json(200, { ok: true, trace }) : json(404, { ok: false, error: { code: "TRACE_NOT_FOUND", message: "No actual Agent run has this trace id." } });
      }
      if (request.method === "GET" && url.pathname === "/agent/runs") {
        const status = url.searchParams.get("status"); const inputOrigin = url.searchParams.get("inputOrigin");
        const query: AgentRunQuery = { ...(url.searchParams.get("conversationId") ? { conversationId: url.searchParams.get("conversationId")! } : {}), ...(status === "RUNNING" || status === "COMPLETED" || status === "FAILED" ? { status } : {}), ...(inputOrigin === "USER_INPUT" || inputOrigin === "PRESET_INPUT" ? { inputOrigin } : {}), ...(url.searchParams.get("startedFrom") ? { startedFrom: url.searchParams.get("startedFrom")! } : {}), ...(url.searchParams.get("startedTo") ? { startedTo: url.searchParams.get("startedTo")! } : {}) };
        const runs = options.repository ? await options.repository.query(query) : [...traces.values()];
        return json(200, { ok: true, runs });
      }
      if (request.method === "DELETE" && url.pathname === "/agent/runs") {
        await options.repository?.clear?.(); traces.clear();
        return json(200, { ok: true, cleared: "agent-runs" });
      }
      if (request.method === "POST" && url.pathname === "/agent/runs") {
        if (!options.configured || !options.run) return json(503, { ok: false, error: { code: "AGENT_NOT_CONFIGURED", message: "Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL on the server." } });
        try {
          const body = requestSchema.parse(await request.json());
          const runResult = await options.run(body);
          const trace = "trace" in runResult ? runResult.trace : runResult;
          const toolResults = "trace" in runResult ? runResult.toolResults : [];
          agentResponseEnvelopeSchema.parse(trace.finalResponse);
          traces.set(trace.traceId, trace);
          return json(200, { ok: true, trace, toolResults });
        } catch (error) {
          return json(400, { ok: false, error: { code: errorCode(error), message: error instanceof Error ? error.message : String(error) } });
        }
      }
      return json(404, { ok: false, error: { code: "NOT_FOUND", message: "Route not found." } });
    },
  };
}
