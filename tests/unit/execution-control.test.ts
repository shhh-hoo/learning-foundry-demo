import { describe, expect, it, vi } from "vitest";
import {
  assertExecutionActive,
  currentExecutionControl,
  runWithExecutionControl,
} from "@/application/execution-control";

describe("request-scoped execution control", () => {
  it("propagates the caller AbortSignal to a fake cooperative boundary", async () => {
    const request = new AbortController();
    const received = vi.fn();
    const pending = runWithExecutionControl({ signal: request.signal, deadlineMs: 1_000 }, async (control) => {
      received(control.signal);
      await new Promise<void>((_resolve, reject) => control.signal.addEventListener("abort", () => reject(control.signal.reason), { once: true }));
    });
    request.abort(new Error("request disconnected"));
    await expect(pending).rejects.toMatchObject({ code: "EXECUTION_ABORTED" });
    expect(received).toHaveBeenCalledOnce();
    expect((received.mock.calls[0]?.[0] as AbortSignal).aborted).toBe(true);
  });

  it("enforces a bounded deadline and exposes it to pre/post guards", async () => {
    let observedDeadline = 0;
    await expect(runWithExecutionControl({ deadlineMs: 5 }, async (control) => {
      observedDeadline = control.deadlineAt;
      await new Promise<void>((_resolve, reject) => control.signal.addEventListener("abort", () => reject(control.signal.reason), { once: true }));
      assertExecutionActive(control);
    })).rejects.toMatchObject({ code: "EXECUTION_TIMED_OUT" });
    expect(observedDeadline).toBeGreaterThan(0);
  });

  it("does not persist execution control outside its request scope", async () => {
    expect(currentExecutionControl()).toBeUndefined();
    await runWithExecutionControl({ deadlineMs: 100 }, async (control) => {
      expect(currentExecutionControl()).toBe(control);
    });
    expect(currentExecutionControl()).toBeUndefined();
  });
});
