import type {
  LearningCapabilityExecution,
  LearningCapabilityExecutionResult,
  LearningCapabilityRuntime,
} from "../core/ports/learning-capability-runtime";

export type {
  LearningCapabilityExecution,
  LearningCapabilityExecutionResult,
  LearningCapabilityRuntime,
} from "../core/ports/learning-capability-runtime";

class LearningCapabilityRuntimeError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

export class LegacyTrainerCapabilityRuntime implements LearningCapabilityRuntime {
  constructor(
    private readonly diagnosisUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  async execute(execution: LearningCapabilityExecution): Promise<LearningCapabilityExecutionResult> {
    const inputCapabilityId = execution.input.componentId;
    const inputCapabilityVersion = execution.input.componentVersion;
    if ((inputCapabilityId !== undefined && inputCapabilityId !== execution.capabilityId)
      || (inputCapabilityVersion !== undefined && inputCapabilityVersion !== execution.capabilityVersion)) {
      throw new LearningCapabilityRuntimeError(
        "CAPABILITY_IDENTITY_MISMATCH",
        "Trainer input identity must match the governed capability execution identity.",
      );
    }
    const { componentId: _inputComponentId, componentVersion: _inputComponentVersion, ...capabilityInput } = execution.input;
    const response = await this.fetcher(this.diagnosisUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...capabilityInput,
        componentId: execution.capabilityId,
        ...(execution.capabilityVersion === undefined ? {} : { componentVersion: execution.capabilityVersion }),
        runPurpose: execution.runPurpose,
      }),
    });
    const body = await response.json() as { readonly ok?: boolean; readonly result?: Record<string, unknown> & { readonly traceId?: string }; readonly error?: { readonly code?: string; readonly message?: string } };
    if (!response.ok || !body.ok || !body.result?.traceId) throw new Error(`${body.error?.code ?? "TRAINER_DIAGNOSIS_FAILED"}: ${body.error?.message ?? `HTTP ${response.status}`}`);

    const resolution = await this.fetcher(`${this.diagnosisUrl.replace(/\/diagnose\/?$/u, "")}/diagnoses/${encodeURIComponent(body.result.traceId)}`);
    const resolved = await resolution.json() as { readonly ok?: boolean; readonly diagnosis?: { readonly traceId?: string } };
    if (!resolution.ok || !resolved.ok || resolved.diagnosis?.traceId !== body.result.traceId) throw new LearningCapabilityRuntimeError("UNRESOLVABLE_DIAGNOSIS_TRACE", `Diagnosis trace ${body.result.traceId} did not resolve after persistence.`);
    return { traceId: body.result.traceId, result: body.result };
  }
}
