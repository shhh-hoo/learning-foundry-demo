import type { AgentExecutionPlan, AgentObligations, AgentResponseEnvelope, AgentRoute, AgentRunRequest, AgentToolCallRecord, AgentTrace, RunPurpose, TokenUsage } from "../agent/types";
import type { EvidenceSufficiencyAssessment, GovernedWorkflowTrace, ToolBudgetConsumption } from "../agent/control-plane/observability";
import type { VersionedHash } from "../agent/trace-store";

export type RuntimeExecutionRole = "AUTHORITATIVE" | "SHADOW";
export type RuntimeExecutionStatus = "RUNNING" | "COMPLETED" | "FAILED" | "TIMED_OUT" | "NOT_CONFIGURED";
export type RuntimeFailureStage = "CONFIGURATION" | "EXECUTION" | "TIMEOUT";
export const RUNTIME_EXECUTION_SCHEMA_VERSION = "1.2.0" as const;
export type RuntimeExecutionSchemaVersion = "1.0.0" | "1.1.0" | typeof RUNTIME_EXECUTION_SCHEMA_VERSION;

export interface RuntimePolicySnapshot {
  readonly prompt: VersionedHash;
  readonly capabilityRegistry: VersionedHash;
  readonly toolDefinitions: VersionedHash;
}

export interface NormalizedRuntimeExecutionRequest {
  readonly request: AgentRunRequest;
  readonly executionPlan: AgentExecutionPlan;
  readonly policy: RuntimePolicySnapshot;
  readonly caseId?: string;
}

export interface RuntimeAdapterIdentity {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly providerId: string;
  readonly modelId: string;
}

export interface RuntimeExecutionResult {
  readonly trace: AgentTrace;
  readonly toolResults: readonly { readonly name: string; readonly resultRef: string; readonly data: unknown }[];
  readonly estimatedCostUsd?: number;
}

export interface RuntimeExecutor {
  readonly identity: RuntimeAdapterIdentity;
  execute(input: NormalizedRuntimeExecutionRequest, signal: AbortSignal): Promise<RuntimeExecutionResult>;
}

export interface NormalizedRuntimeToolCall extends AgentToolCallRecord {
  readonly order: number;
}

export interface RuntimeExecutionRecord {
  readonly schemaVersion: RuntimeExecutionSchemaVersion;
  readonly executionId: string;
  readonly parentAuthoritativeExecutionId?: string;
  readonly role: RuntimeExecutionRole;
  readonly runPurpose: RunPurpose;
  readonly conversationId: string;
  readonly caseId?: string;
  readonly agentTraceId?: string;
  readonly runtimeAdapterId: string;
  readonly runtimeAdapterVersion: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly route: AgentRoute;
  readonly obligations: AgentObligations;
  readonly executionPlan?: AgentExecutionPlan;
  readonly budgetConsumption?: readonly ToolBudgetConsumption[];
  readonly evidenceAssessments?: readonly EvidenceSufficiencyAssessment[];
  readonly stopReason?: string;
  readonly governedWorkflow?: GovernedWorkflowTrace;
  readonly toolCalls: readonly NormalizedRuntimeToolCall[];
  readonly sourceRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly diagnosisTraceId?: string;
  readonly diagnosisResult?: unknown;
  readonly diagnosisFailureCode?: string;
  readonly finalResponse?: AgentResponseEnvelope;
  readonly finalResponseStatus?: AgentResponseEnvelope["status"];
  readonly latencyMs?: number;
  readonly tokenUsage?: TokenUsage;
  readonly estimatedCostUsd?: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly status: RuntimeExecutionStatus;
  readonly terminalError?: { readonly code: string; readonly message: string };
  readonly failureStage?: RuntimeFailureStage;
  readonly completeness: {
    readonly trace: boolean;
    readonly finalResponse: boolean;
    readonly toolEvidence: boolean;
  };
}

export interface RuntimeExecutionRecorder {
  record(record: RuntimeExecutionRecord): Promise<void>;
}

export interface RuntimeShadowConfiguration {
  readonly enabled: boolean;
  readonly timeoutMs: number;
}

export function parseRuntimeShadowConfiguration(mode: string | undefined, timeout: string | undefined = undefined): RuntimeShadowConfiguration {
  const parsedTimeout = Number(timeout);
  return {
    enabled: mode === "enabled",
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5000,
  };
}

interface RuntimeShadowCoordinatorOptions {
  readonly shadowEnabled: boolean;
  readonly authoritativeExecutor: RuntimeExecutor;
  readonly shadowExecutor?: RuntimeExecutor;
  readonly recorder: RuntimeExecutionRecorder;
  readonly shadowTimeoutMs?: number;
  readonly createId?: () => string;
  readonly now?: () => string;
  readonly onRecorderError?: (error: unknown, record: RuntimeExecutionRecord) => void;
}

function completedRecord(
  executionId: string,
  role: RuntimeExecutionRole,
  input: NormalizedRuntimeExecutionRequest,
  executor: RuntimeExecutor,
  result: RuntimeExecutionResult,
  completedAt: string,
  parentAuthoritativeExecutionId?: string,
): RuntimeExecutionRecord {
  const diagnosisCall = [...result.trace.toolCalls].reverse().find((call) => call.name === "run_learner_diagnosis" && call.status === "SUCCEEDED");
  const diagnosisResult = diagnosisCall ? result.toolResults.find((item) => item.resultRef === diagnosisCall.resultRef)?.data : undefined;
  const diagnosisFailureCode = diagnosisResult && typeof diagnosisResult === "object" && "diagnosis" in diagnosisResult
    && diagnosisResult.diagnosis && typeof diagnosisResult.diagnosis === "object" && "failureCode" in diagnosisResult.diagnosis
    && typeof diagnosisResult.diagnosis.failureCode === "string" ? diagnosisResult.diagnosis.failureCode : undefined;
  return {
    schemaVersion: RUNTIME_EXECUTION_SCHEMA_VERSION,
    executionId,
    ...(parentAuthoritativeExecutionId ? { parentAuthoritativeExecutionId } : {}),
    role,
    runPurpose: input.request.runPurpose,
    conversationId: input.request.conversationId,
    ...(input.caseId ? { caseId: input.caseId } : {}),
    agentTraceId: result.trace.traceId,
    runtimeAdapterId: executor.identity.adapterId,
    runtimeAdapterVersion: executor.identity.adapterVersion,
    providerId: result.trace.provider,
    modelId: result.trace.model,
    route: result.trace.route ?? input.executionPlan.route,
    obligations: result.trace.obligations ?? input.executionPlan.obligations,
    executionPlan: input.executionPlan,
    ...(result.trace.budgetConsumption ? { budgetConsumption: result.trace.budgetConsumption } : {}),
    ...(result.trace.evidenceAssessments ? { evidenceAssessments: result.trace.evidenceAssessments } : {}),
    ...(result.trace.stopReason ? { stopReason: result.trace.stopReason } : {}),
    ...(result.trace.governedWorkflow ? { governedWorkflow: result.trace.governedWorkflow } : {}),
    toolCalls: result.trace.toolCalls.map((toolCall, order) => ({ ...toolCall, order })),
    sourceRefs: result.trace.finalResponse.sourceRefs,
    evidenceRefs: result.trace.finalResponse.evidenceRefs ?? [],
    ...(result.trace.finalResponse.diagnosisTraceId ? { diagnosisTraceId: result.trace.finalResponse.diagnosisTraceId } : {}),
    ...(diagnosisResult === undefined ? {} : { diagnosisResult }),
    ...(diagnosisFailureCode ? { diagnosisFailureCode } : {}),
    finalResponse: result.trace.finalResponse,
    finalResponseStatus: result.trace.finalResponse.status,
    latencyMs: result.trace.latencyMs,
    ...(result.trace.tokenUsage ? { tokenUsage: result.trace.tokenUsage } : {}),
    ...(result.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: result.estimatedCostUsd }),
    startedAt: result.trace.startedAt,
    completedAt,
    status: "COMPLETED",
    completeness: { trace: true, finalResponse: true, toolEvidence: true },
  };
}

function failedRecord(
  executionId: string,
  role: RuntimeExecutionRole,
  input: NormalizedRuntimeExecutionRequest,
  executor: RuntimeExecutor,
  status: RuntimeExecutionStatus,
  terminalError: { readonly code: string; readonly message: string },
  failureStage: RuntimeFailureStage,
  completedAt: string,
  parentAuthoritativeExecutionId?: string,
): RuntimeExecutionRecord {
  return {
    schemaVersion: RUNTIME_EXECUTION_SCHEMA_VERSION,
    executionId,
    ...(parentAuthoritativeExecutionId ? { parentAuthoritativeExecutionId } : {}),
    role,
    runPurpose: input.request.runPurpose,
    conversationId: input.request.conversationId,
    ...(input.caseId ? { caseId: input.caseId } : {}),
    runtimeAdapterId: executor.identity.adapterId,
    runtimeAdapterVersion: executor.identity.adapterVersion,
    providerId: executor.identity.providerId,
    modelId: executor.identity.modelId,
    route: input.executionPlan.route,
    obligations: input.executionPlan.obligations,
    executionPlan: input.executionPlan,
    toolCalls: [],
    sourceRefs: [],
    evidenceRefs: [],
    startedAt: completedAt,
    completedAt,
    status,
    terminalError,
    failureStage,
    completeness: { trace: false, finalResponse: false, toolEvidence: false },
  };
}

function runningRecord(
  executionId: string,
  input: NormalizedRuntimeExecutionRequest,
  executor: RuntimeExecutor,
  startedAt: string,
  parentAuthoritativeExecutionId: string,
): RuntimeExecutionRecord {
  return {
    schemaVersion: RUNTIME_EXECUTION_SCHEMA_VERSION,
    executionId,
    parentAuthoritativeExecutionId,
    role: "SHADOW",
    runPurpose: input.request.runPurpose,
    conversationId: input.request.conversationId,
    ...(input.caseId ? { caseId: input.caseId } : {}),
    runtimeAdapterId: executor.identity.adapterId,
    runtimeAdapterVersion: executor.identity.adapterVersion,
    providerId: executor.identity.providerId,
    modelId: executor.identity.modelId,
    route: input.executionPlan.route,
    obligations: input.executionPlan.obligations,
    executionPlan: input.executionPlan,
    toolCalls: [],
    sourceRefs: [],
    evidenceRefs: [],
    startedAt,
    status: "RUNNING",
    completeness: { trace: false, finalResponse: false, toolEvidence: false },
  };
}

function terminalError(error: unknown, fallbackCode: string): { readonly code: string; readonly message: string } {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : fallbackCode;
  return { code, message: error instanceof Error ? error.message : String(error) };
}

class ShadowExecutionTimeoutError extends Error {
  readonly code = "SHADOW_EXECUTION_TIMEOUT";
  constructor(readonly timeoutMs: number) { super(`Shadow execution exceeded ${timeoutMs}ms.`); }
}

function immutableExecutionSnapshot(input: NormalizedRuntimeExecutionRequest): NormalizedRuntimeExecutionRequest {
  const freeze = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) freeze(nested);
    return Object.freeze(value);
  };
  return freeze(structuredClone(input)) as NormalizedRuntimeExecutionRequest;
}

export function createRuntimeShadowCoordinator(options: RuntimeShadowCoordinatorOptions) {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const recordSafely = async (record: RuntimeExecutionRecord): Promise<void> => {
    try { await options.recorder.record(record); }
    catch (error) {
      try { options.onRecorderError?.(error, record); }
      catch { /* comparison observability must not affect the authoritative path */ }
    }
  };
  const executeShadow = async (input: NormalizedRuntimeExecutionRequest, authoritativeExecutionId: string): Promise<void> => {
    if (!options.shadowEnabled) return Promise.resolve();
    const shadowExecutionId = createId();
    if (!options.shadowExecutor) {
      const unavailableExecutor: RuntimeExecutor = {
        identity: { adapterId: "unconfigured-shadow", adapterVersion: "unavailable", providerId: "unavailable", modelId: "unavailable" },
        execute: async () => { throw new Error("Shadow executor is unavailable."); },
      };
      return recordSafely(failedRecord(
        shadowExecutionId,
        "SHADOW",
        input,
        unavailableExecutor,
        "NOT_CONFIGURED",
        { code: "SHADOW_EXECUTOR_UNAVAILABLE", message: "Shadow execution was enabled without a candidate executor." },
        "CONFIGURATION",
        now(),
        authoritativeExecutionId,
      ));
    }
    const timeoutMs = options.shadowTimeoutMs ?? 5000;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await recordSafely(runningRecord(shadowExecutionId, input, options.shadowExecutor, now(), authoritativeExecutionId));
    try {
      const shadowResult = await Promise.race([
        options.shadowExecutor.execute(input, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            const error = new ShadowExecutionTimeoutError(timeoutMs);
            controller.abort(error);
            reject(error);
          }, timeoutMs);
        }),
      ]);
      await recordSafely(completedRecord(shadowExecutionId, "SHADOW", input, options.shadowExecutor, shadowResult, now(), authoritativeExecutionId));
    } catch (error) {
      const timedOut = error instanceof ShadowExecutionTimeoutError;
      await recordSafely(failedRecord(shadowExecutionId, "SHADOW", input, options.shadowExecutor, timedOut ? "TIMED_OUT" : "FAILED", terminalError(error, "SHADOW_EXECUTION_FAILED"), timedOut ? "TIMEOUT" : "EXECUTION", now(), authoritativeExecutionId));
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  return {
    async execute(input: NormalizedRuntimeExecutionRequest): Promise<{ readonly authoritativeResult: RuntimeExecutionResult; readonly shadowCompletion: Promise<void> }> {
      const authoritativeExecutionId = createId();
      const authoritativeInput = immutableExecutionSnapshot(input);
      const shadowInput = immutableExecutionSnapshot(input);
      const authoritativeSignal = new AbortController().signal;
      let authoritativeResult: RuntimeExecutionResult;
      try {
        authoritativeResult = await options.authoritativeExecutor.execute(authoritativeInput, authoritativeSignal);
      } catch (error) {
        await recordSafely(failedRecord(authoritativeExecutionId, "AUTHORITATIVE", authoritativeInput, options.authoritativeExecutor, "FAILED", terminalError(error, "AUTHORITATIVE_EXECUTION_FAILED"), "EXECUTION", now()));
        throw error;
      }
      await recordSafely(completedRecord(authoritativeExecutionId, "AUTHORITATIVE", authoritativeInput, options.authoritativeExecutor, authoritativeResult, now()));
      const shadowCompletion = executeShadow(shadowInput, authoritativeExecutionId);
      return { authoritativeResult, shadowCompletion };
    },
  };
}
