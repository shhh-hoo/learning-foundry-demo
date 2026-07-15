import { describe, expect, it } from "vitest";
import { createAgentGateway } from "../src/agent/gateway";
import type { AgentTrace } from "../src/agent/types";

describe("DeepSeek Agent Gateway", () => {
  it("stays healthy but refuses runs when server configuration is missing", async () => {
    const gateway = createAgentGateway({ configured: false, model: null, thinkingMode: "disabled" });
    const health = await gateway.handle(new Request("http://127.0.0.1:4176/health"));
    expect(await health.json()).toEqual({ configured: false, provider: "deepseek", model: null, thinkingMode: "disabled" });
    const run = await gateway.handle(new Request("http://127.0.0.1:4176/agent/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: "c", inputOrigin: "USER_INPUT", messages: [{ role: "user", content: "hello" }] }) }));
    expect(run.status).toBe(503);
    expect(gateway.traces.size).toBe(0);
    expect(JSON.stringify(await run.json())).not.toMatch(/answer|traceId/i);
  });

  it("stores and returns only a trace produced by a configured run", async () => {
    const trace = { traceId: "trace-live", conversationId: "c", inputOrigin: "USER_INPUT", provider: "deepseek", model: "configured", thinkingMode: "disabled", promptVersion: "1", capabilityRegistryVersion: "1", startedAt: "2026-07-16T10:00:00.000Z", completedAt: "2026-07-16T10:00:01.000Z", toolCalls: [], finalResponse: { status: "ANSWERED", learnerMessage: "Hello", sourceRefs: [] }, latencyMs: 1000 } satisfies AgentTrace;
    const gateway = createAgentGateway({ configured: true, model: "configured", thinkingMode: "disabled", run: async () => trace });
    const response = await gateway.handle(new Request("http://127.0.0.1:4176/agent/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: "c", inputOrigin: "USER_INPUT", messages: [{ role: "user", content: "hello" }] }) }));
    expect(response.status).toBe(200);
    expect(gateway.traces.get("trace-live")).toEqual(trace);
    const found = await gateway.handle(new Request("http://127.0.0.1:4176/agent/runs/trace-live"));
    expect(await found.json()).toEqual({ ok: true, trace });
  });

  it("reads trace detail and filtered lists from the authoritative repository", async () => {
    const queries: unknown[] = [];
    const stored = { traceId: "persisted-trace", status: "FAILED", terminalError: { code: "MODEL_ERROR" } };
    const gateway = createAgentGateway({ configured: false, model: null, thinkingMode: "disabled", repository: { get: async (traceId) => traceId === "persisted-trace" ? stored : null, query: async (query) => { queries.push(query); return [stored]; } } });
    const detail = await gateway.handle(new Request("http://127.0.0.1:4176/agent/runs/persisted-trace"));
    expect(await detail.json()).toEqual({ ok: true, trace: stored });
    const list = await gateway.handle(new Request("http://127.0.0.1:4176/agent/runs?conversationId=c-1&status=FAILED&inputOrigin=PRESET_INPUT&startedFrom=2026-07-16T00%3A00%3A00.000Z"));
    expect(await list.json()).toEqual({ ok: true, runs: [stored] });
    expect(queries).toEqual([{ conversationId: "c-1", status: "FAILED", inputOrigin: "PRESET_INPUT", startedFrom: "2026-07-16T00:00:00.000Z" }]);
  });
});
