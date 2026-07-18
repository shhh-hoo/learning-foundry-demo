import { describe, expect, it } from "vitest";
import { inspectLegacyTrainerRuntime, LegacyTrainerCapabilityRuntime, trainerDiagnosisEndpointHash } from "../src/runtime/learning-capability-runtime";
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

    const signal = new AbortController().signal;
    await expect(runtime.execute({
      capabilityId: "any-learning-capability",
      capabilityVersion: "1.0.0",
      input: { componentId: "any-learning-capability", componentVersion: "1.0.0", learnerAttempt: "evidenced input" },
      runPurpose: "PRODUCT",
    }, signal)).resolves.toEqual({ traceId: "trainer-trace", result: { traceId: "trainer-trace", decision: "SOLVED" } });
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
    expect(requests.map((item) => item.init?.signal)).toEqual([signal, signal]);
  });

  it("preserves AGENT_EVAL purpose when the optional capability version is omitted", async () => {
    const payloads: Record<string, unknown>[] = [];
    const runtime = new LegacyTrainerCapabilityRuntime("http://127.0.0.1:4177/diagnose", async (_input, init) => {
      if (init?.method === "POST") {
        payloads.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Response.json({ ok: true, result: { traceId: "unversioned-trace" } });
      }
      return Response.json({ ok: true, diagnosis: { traceId: "unversioned-trace" } });
    });

    await runtime.execute({ capabilityId: "unversioned-capability", input: { learnerAttempt: "evidence" }, runPurpose: "AGENT_EVAL" });

    expect(payloads).toEqual([{ componentId: "unversioned-capability", learnerAttempt: "evidence", runPurpose: "AGENT_EVAL" }]);
  });

  it("probes and identifies the exact Trainer endpoint used by the Legacy adapter", async () => {
    const diagnosisUrl = "http://127.0.0.1:4177/diagnose";
    const requests: string[] = [];
    const health = await inspectLegacyTrainerRuntime(diagnosisUrl, async (input) => {
      requests.push(String(input));
      return Response.json({ ok: true, service: "trainer-diagnosis-api", governedCaseCount: 5 });
    });

    expect(requests).toEqual(["http://127.0.0.1:4177/health"]);
    expect(health).toEqual({ diagnosisEndpointHash: trainerDiagnosisEndpointHash(diagnosisUrl), ready: true, service: "trainer-diagnosis-api", governedCaseCount: 5 });
  });

  it("marks shadow capability evidence and cancels an in-flight Trainer write", async () => {
    let payload: Record<string, unknown> | undefined;
    let writeStarted!: () => void;
    const started = new Promise<void>((resolve) => { writeStarted = resolve; });
    const runtime = new LegacyTrainerCapabilityRuntime("http://127.0.0.1:4277/diagnose", async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writeStarted();
      await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
      throw new Error("unreachable");
    });
    const controller = new AbortController();
    const execution = runtime.execute({ capabilityId: "capability", input: {}, runPurpose: "AGENT_EVAL", executionRole: "SHADOW" }, controller.signal);
    await started;
    controller.abort(new Error("shadow timeout"));

    await expect(execution).rejects.toThrow("shadow timeout");
    expect(payload).toMatchObject({ runPurpose: "AGENT_EVAL", executionRole: "SHADOW" });
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
