import { describe, expect, it } from "vitest";
import { LegacyTrainerCapabilityRuntime } from "../src/runtime/learning-capability-runtime";
import { LegacyAgentEvalHarness } from "../src/agent/agenteval-harness";

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
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ learnerAttempt: "evidenced input", runPurpose: "PRODUCT" });
  });

  it("preserves the structured failure when a Legacy Trainer trace cannot be resolved", async () => {
    const runtime = new LegacyTrainerCapabilityRuntime("http://127.0.0.1:4177/diagnose", async (_input, init) => init?.method === "POST"
      ? Response.json({ ok: true, result: { traceId: "missing-trace" } })
      : Response.json({ ok: false }, { status: 404 }));

    await expect(runtime.execute({ capabilityId: "capability", input: {}, runPurpose: "PRODUCT" })).rejects.toMatchObject({
      code: "UNRESOLVABLE_DIAGNOSIS_TRACE",
    });
  });

  it("executes AgentEval cases through the Legacy gateway without owning Foundry grading", async () => {
    const harness = new LegacyAgentEvalHarness("http://127.0.0.1:4176", async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json({ configured: true, provider: "deepseek", model: "configured", thinkingMode: "disabled" });
      return Response.json({ ok: true, trace: { traceId: "agent-trace" }, toolResults: [{ name: "search_learning_resources", resultRef: "retrieval-trace", data: {} }] });
    });

    await expect(harness.health()).resolves.toEqual({ provider: "deepseek", model: "configured", thinkingMode: "disabled" });
    await expect(harness.execute({ conversationId: "eval-case", inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", messages: [{ role: "user", content: "case input" }] })).resolves.toMatchObject({
      ok: true,
      trace: { traceId: "agent-trace" },
      toolResults: [{ resultRef: "retrieval-trace" }],
    });
  });
});
