import type { RunPurpose } from "../agent/types";

export interface LearningCapabilityExecution {
  readonly capabilityId: string;
  readonly capabilityVersion?: string;
  readonly input: Record<string, unknown>;
  readonly runPurpose: RunPurpose;
}

export interface LearningCapabilityRuntime {
  execute(execution: LearningCapabilityExecution): Promise<{ readonly traceId: string; readonly result: Record<string, unknown> }>;
}

class LearningCapabilityRuntimeError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

export class LegacyTrainerCapabilityRuntime implements LearningCapabilityRuntime {
  constructor(
    private readonly diagnosisUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  async execute(execution: LearningCapabilityExecution): Promise<{ readonly traceId: string; readonly result: Record<string, unknown> }> {
    const response = await this.fetcher(this.diagnosisUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...execution.input, runPurpose: execution.runPurpose }),
    });
    const body = await response.json() as { readonly ok?: boolean; readonly result?: Record<string, unknown> & { readonly traceId?: string }; readonly error?: { readonly code?: string; readonly message?: string } };
    if (!response.ok || !body.ok || !body.result?.traceId) throw new Error(`${body.error?.code ?? "TRAINER_DIAGNOSIS_FAILED"}: ${body.error?.message ?? `HTTP ${response.status}`}`);

    const resolution = await this.fetcher(`${this.diagnosisUrl.replace(/\/diagnose\/?$/u, "")}/diagnoses/${encodeURIComponent(body.result.traceId)}`);
    const resolved = await resolution.json() as { readonly ok?: boolean; readonly diagnosis?: { readonly traceId?: string } };
    if (!resolution.ok || !resolved.ok || resolved.diagnosis?.traceId !== body.result.traceId) throw new LearningCapabilityRuntimeError("UNRESOLVABLE_DIAGNOSIS_TRACE", `Diagnosis trace ${body.result.traceId} did not resolve after persistence.`);
    return { traceId: body.result.traceId, result: body.result };
  }
}
