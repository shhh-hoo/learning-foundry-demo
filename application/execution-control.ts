import { AsyncLocalStorage } from "node:async_hooks";
import { DomainInvariantError } from "@/domain/invariants";

export const DEFAULT_WORKFLOW_DEADLINE_MS = 30_000;
export const MAX_WORKFLOW_DEADLINE_MS = 120_000;

export type ExecutionControlInput = {
  signal?: AbortSignal;
  deadlineMs?: number;
};

export type ExecutionControl = {
  signal: AbortSignal;
  deadlineAt: number;
};

export type ExecutionCompletionPolicy<T> = {
  /**
   * A caller may commit a returned result after cancellation only when that
   * result proves the cancellation/timeout was persisted as terminal truth.
   */
  acceptStoppedResult?: (result: T) => boolean;
};

const executionScope = new AsyncLocalStorage<ExecutionControl>();

function boundedDeadline(value: number | undefined): number {
  const configured = value ?? Number(process.env.FOUNDRY_WORKFLOW_DEADLINE_MS ?? DEFAULT_WORKFLOW_DEADLINE_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    throw new DomainInvariantError("Workflow deadline must be a positive finite duration", "EXECUTION_DEADLINE_INVALID");
  }
  return Math.min(Math.floor(configured), MAX_WORKFLOW_DEADLINE_MS);
}

function stoppedError(control: ExecutionControl): DomainInvariantError {
  if (Date.now() >= control.deadlineAt || (control.signal.reason instanceof DomainInvariantError && control.signal.reason.code === "EXECUTION_TIMED_OUT")) {
    return new DomainInvariantError("Workflow execution exceeded its bounded deadline", "EXECUTION_TIMED_OUT");
  }
  return new DomainInvariantError("Workflow execution was aborted by the request", "EXECUTION_ABORTED");
}

export function currentExecutionControl(): ExecutionControl | undefined {
  return executionScope.getStore();
}

export function assertExecutionActive(control = currentExecutionControl()): void {
  if (!control) return;
  if (control.signal.aborted || Date.now() >= control.deadlineAt) throw stoppedError(control);
}

export function rethrowIfExecutionStopped(error: unknown, control = currentExecutionControl()): void {
  if (error instanceof DomainInvariantError && (error.code === "EXECUTION_ABORTED" || error.code === "EXECUTION_TIMED_OUT")) throw error;
  if (control && (control.signal.aborted || Date.now() >= control.deadlineAt)) throw stoppedError(control);
}

export function executionStopStatus(error: unknown, control = currentExecutionControl()): "ABORTED" | "TIMED_OUT" | null {
  if (error instanceof DomainInvariantError && error.code === "EXECUTION_TIMED_OUT") return "TIMED_OUT";
  if (error instanceof DomainInvariantError && error.code === "EXECUTION_ABORTED") return "ABORTED";
  if (control?.signal.reason instanceof DomainInvariantError && control.signal.reason.code === "EXECUTION_TIMED_OUT") return "TIMED_OUT";
  if (!control || (!control.signal.aborted && Date.now() < control.deadlineAt)) return null;
  return Date.now() >= control.deadlineAt ? "TIMED_OUT" : "ABORTED";
}

export function operationalFailureStatus(error: unknown): "ABORTED" | "TIMED_OUT" | "FAILED" {
  return executionStopStatus(error) ?? "FAILED";
}

export async function runWithExecutionControl<T>(
  input: ExecutionControlInput | undefined,
  run: (control: ExecutionControl) => Promise<T>,
  completion: ExecutionCompletionPolicy<T> = {},
): Promise<T> {
  const inherited = currentExecutionControl();
  if (inherited) {
    assertExecutionActive(inherited);
    const result = await run(inherited);
    if (!completion.acceptStoppedResult?.(result)) assertExecutionActive(inherited);
    return result;
  }

  const deadlineMs = boundedDeadline(input?.deadlineMs);
  const deadlineAt = Date.now() + deadlineMs;
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(input?.signal?.reason);
  if (input?.signal?.aborted) abortFromRequest();
  else input?.signal?.addEventListener("abort", abortFromRequest, { once: true });
  const timer = setTimeout(() => controller.abort(new DomainInvariantError("Workflow execution exceeded its bounded deadline", "EXECUTION_TIMED_OUT")), deadlineMs);
  timer.unref?.();
  const control = { signal: controller.signal, deadlineAt };

  try {
    return await executionScope.run(control, async () => {
      assertExecutionActive(control);
      const result = await run(control);
      if (!completion.acceptStoppedResult?.(result)) assertExecutionActive(control);
      return result;
    });
  } catch (error) {
    rethrowIfExecutionStopped(error, control);
    throw error;
  } finally {
    clearTimeout(timer);
    input?.signal?.removeEventListener("abort", abortFromRequest);
  }
}
