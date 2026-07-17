import { createHash } from "node:crypto";
import type {
  LearningCapabilityExecution,
  LearningCapabilityExecutionResult,
  LearningCapabilityRuntime,
} from "../core/ports/learning-capability-runtime";

export interface LegacyTrainerRuntimeHealth {
  readonly diagnosisEndpointHash: string;
  readonly ready: boolean;
  readonly service: string | null;
  readonly governedCaseCount: number | null;
}

function normalizedTrainerDiagnosisUrl(diagnosisUrl: string): URL {
  const url = new URL(diagnosisUrl);
  if (!/\/diagnose\/?$/u.test(url.pathname)) throw new Error("TRAINER_DIAGNOSIS_URL_INVALID");
  return url;
}

export function trainerDiagnosisEndpointHash(diagnosisUrl: string): string {
  return createHash("sha256").update(normalizedTrainerDiagnosisUrl(diagnosisUrl).href).digest("hex");
}

export async function inspectLegacyTrainerRuntime(
  diagnosisUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<LegacyTrainerRuntimeHealth> {
  const diagnosisEndpoint = normalizedTrainerDiagnosisUrl(diagnosisUrl);
  const healthEndpoint = new URL(diagnosisEndpoint);
  healthEndpoint.pathname = healthEndpoint.pathname.replace(/\/diagnose\/?$/u, "/health");
  healthEndpoint.search = "";
  healthEndpoint.hash = "";
  const diagnosisEndpointHash = trainerDiagnosisEndpointHash(diagnosisEndpoint.href);
  try {
    const response = await fetcher(healthEndpoint, signal ? { signal } : undefined);
    const body = await response.json() as { readonly ok?: boolean; readonly service?: unknown; readonly governedCaseCount?: unknown };
    const service = typeof body.service === "string" ? body.service : null;
    const governedCaseCount = typeof body.governedCaseCount === "number" && Number.isInteger(body.governedCaseCount) && body.governedCaseCount >= 0 ? body.governedCaseCount : null;
    return { diagnosisEndpointHash, ready: response.ok && body.ok === true && service === "trainer-diagnosis-api", service, governedCaseCount };
  } catch {
    return { diagnosisEndpointHash, ready: false, service: null, governedCaseCount: null };
  }
}

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

  async execute(execution: LearningCapabilityExecution, signal?: AbortSignal): Promise<LearningCapabilityExecutionResult> {
    signal?.throwIfAborted();
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
      ...(signal ? { signal } : {}),
    });
    const body = await response.json() as { readonly ok?: boolean; readonly result?: Record<string, unknown> & { readonly traceId?: string }; readonly error?: { readonly code?: string; readonly message?: string } };
    if (!response.ok || !body.ok || !body.result?.traceId) throw new Error(`${body.error?.code ?? "TRAINER_DIAGNOSIS_FAILED"}: ${body.error?.message ?? `HTTP ${response.status}`}`);

    signal?.throwIfAborted();
    const resolution = await this.fetcher(`${this.diagnosisUrl.replace(/\/diagnose\/?$/u, "")}/diagnoses/${encodeURIComponent(body.result.traceId)}`, signal ? { signal } : undefined);
    const resolved = await resolution.json() as { readonly ok?: boolean; readonly diagnosis?: { readonly traceId?: string } };
    if (!resolution.ok || !resolved.ok || resolved.diagnosis?.traceId !== body.result.traceId) throw new LearningCapabilityRuntimeError("UNRESOLVABLE_DIAGNOSIS_TRACE", `Diagnosis trace ${body.result.traceId} did not resolve after persistence.`);
    signal?.throwIfAborted();
    return { traceId: body.result.traceId, result: body.result };
  }
}
