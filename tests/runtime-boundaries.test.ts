import { describe, expect, it } from "vitest";
import { LegacyTrainerCapabilityRuntime } from "../src/runtime/learning-capability-runtime";
import { LegacyGatewayAgentEvalTarget } from "../src/agent/agenteval-target";

describe("replaceable runtime boundaries", () => {
  it("executes a capability through the Legacy Trainer protocol and resolves its persisted trace", async () => {
    const requests: { readonly url: string; readonly init?: RequestInit }[] = [];
    const runtime = new LegacyTrainerCapabilityRuntime("http://127.0.0.1:4177/diagnose", async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      return init?.method === "POST"
        ? Response.json({ ok: true, result: { traceId: "trainer-trace", decision: "SOLVED" } })
        : Response.json({ ok: true, diagnosis: { traceId: "trainer-trace" } });
    });

    await expect(runtime.execute({
      capabilityId: "any-learning-capability",
      capabilityVersion: "1.0.0",
      input: { learnerAttempt: "evidenced input" },
      runPurpose: "PRODUCT",
    })).resolves.toEqual({ traceId: "trainer-trace", result: { traceId: "trainer-trace", decision: "SOLVED" } });
    expect(requests.map((item) => [item.url, item.init?.method])).toEqual([
      ["http://127.0.0.1:4177/diagnose", "POST"],
      ["http://127.0.0.1:4177/diagnoses/trainer-trace", undefined],
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      learnerAttempt: "evidenced input",
      componentId: "any-learning-capability",
      componentVersion: "1.0.0",
      runPurpose: "PRODUCT",
    });
  });

  it("preserves the structured failure when a Legacy Trainer trace cannot be resolved", async () => {
    const runtime = new LegacyTrainerCapabilityRuntime("http://127.0.0.1:4177/diagnose", async (_input, init) => init?.method === "POST"
      ? Response.json({ ok: true, result: { traceId: "missing-trace" } })
      : Response.json({ ok: false }, { status: 404 }));

    await expect(runtime.execute({ capabilityId: "capability", input: {}, runPurpose: "PRODUCT" })).rejects.toMatchObject({
      code: "UNRESOLVABLE_DIAGNOSIS_TRACE",
    });
  });

  it("rejects capability id or version mismatches before invoking the Legacy Trainer", async () => {
    let requestCount = 0;
    const runtime = new LegacyTrainerCapabilityRuntime("http://127.0.0.1:4177/diagnose", async () => {
      requestCount += 1;
      return Response.json({ ok: true, result: { traceId: "unexpected-trace" } });
    });

    for (const input of [
      { componentId: "capability-b", componentVersion: "1.0.0" },
      { componentId: "capability-a", componentVersion: "2.0.0" },
    ]) {
      await expect(runtime.execute({
        capabilityId: "capability-a",
        capabilityVersion: "1.0.0",
        input,
        runPurpose: "PRODUCT",
      })).rejects.toMatchObject({ code: "CAPABILITY_IDENTITY_MISMATCH" });
    }
    expect(requestCount).toBe(0);
  });

  it("executes AgentEval cases through the Legacy gateway without owning Foundry grading", async () => {
    const target = new LegacyGatewayAgentEvalTarget("http://127.0.0.1:4176", async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json({ configured: true, provider: "deepseek", model: "configured", thinkingMode: "disabled" });
      return Response.json({ ok: true, trace: { traceId: "agent-trace" }, toolResults: [{ name: "search_learning_resources", resultRef: "retrieval-trace", data: {} }] });
    });

    await expect(target.health()).resolves.toEqual({ provider: "deepseek", model: "configured", thinkingMode: "disabled" });
    await expect(target.execute({ conversationId: "target-case", inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", messages: [{ role: "user", content: "case input" }] })).resolves.toMatchObject({
      ok: true,
      trace: { traceId: "agent-trace" },
      toolResults: [{ resultRef: "retrieval-trace" }],
    });
  });
});
