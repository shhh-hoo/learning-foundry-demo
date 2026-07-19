import { performance } from "node:perf_hooks";
import { ChatDeepSeek } from "@langchain/deepseek";
import { z } from "zod";
import type { Actor } from "@/domain/model";
import { getDb } from "@/db/client";
import { modelRuns } from "@/db/schema";
import { requireTaskEpisodeScope } from "@/application/task-scope";
import { getLearnerCapabilitiesForCourse } from "@/application/queries";
import { resolveLearnerCapabilityInput } from "@/application/capabilities";
import { assertExecutionActive, currentExecutionControl, executionStopStatus, rethrowIfExecutionStopped, type ExecutionControl } from "@/application/execution-control";

export const AttemptInterpretationOutput = z.object({
  status: z.enum(["MATCHED", "AMBIGUOUS", "UNSUPPORTED"]),
  capabilityPublicKey: z.string().max(100).nullable(),
  fields: z.record(z.string().max(100), z.string().max(100)),
  note: z.string().max(240),
}).strict();

export type AttemptInterpretation = z.infer<typeof AttemptInterpretationOutput>;
export type AttemptInterpreterActivity = {
  publicKey: string;
  name: string;
  purpose: string;
  fields: Array<{ key: string; kind: "number" | "quantity"; unitOptions?: string[] }>;
};
export type AttemptInterpreterResult = {
  output: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

export interface AttemptInterpreter {
  readonly provider: string;
  readonly model: string;
  interpret(input: {
    problem: string;
    working: string;
    capabilityHint?: string;
    activities: AttemptInterpreterActivity[];
  }, control?: ExecutionControl): Promise<AttemptInterpreterResult>;
}

export const DEEPSEEK_ATTEMPT_INTERPRETER_MODEL_KWARGS = {
  thinking: { type: "disabled" },
} as const;

const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function splitExplicitQuantity(raw: string, unitOptions: string[]): { value: string; unit: string } | null {
  const text = raw.trim();
  for (const unit of [...unitOptions].sort((left, right) => right.length - left.length)) {
    if (!text.endsWith(unit)) continue;
    const value = text.slice(0, -unit.length).trim();
    if (NUMERIC_TEXT.test(value)) return { value, unit };
  }
  return null;
}

export function normalizeAttemptInterpretation(
  interpretation: AttemptInterpretation,
  activities: AttemptInterpreterActivity[],
): AttemptInterpretation {
  if (interpretation.status !== "MATCHED") {
    return { ...interpretation, capabilityPublicKey: null, fields: {} };
  }
  const activity = activities.find((candidate) => candidate.publicKey === interpretation.capabilityPublicKey);
  if (!activity) return interpretation;

  const fields: Record<string, string> = {};
  for (const field of activity.fields) {
    const rawValue = interpretation.fields[field.key]?.trim();
    if (!rawValue) continue;
    if (field.kind === "number") {
      if (NUMERIC_TEXT.test(rawValue)) fields[field.key] = rawValue;
      continue;
    }

    const unitKey = `${field.key}Unit`;
    const suppliedUnit = interpretation.fields[unitKey]?.trim();
    if (NUMERIC_TEXT.test(rawValue) && suppliedUnit && field.unitOptions?.includes(suppliedUnit)) {
      fields[field.key] = rawValue;
      fields[unitKey] = suppliedUnit;
      continue;
    }
    const split = splitExplicitQuantity(rawValue, field.unitOptions ?? []);
    if (split) {
      fields[field.key] = split.value;
      fields[unitKey] = split.unit;
    }
  }
  return { ...interpretation, fields };
}

class DeepSeekAttemptInterpreter implements AttemptInterpreter {
  readonly provider = "DEEPSEEK";
  readonly model: string;
  private readonly structured;

  constructor(apiKey: string, modelName: string) {
    this.model = modelName;
    const client = new ChatDeepSeek({
      apiKey,
      model: modelName,
      temperature: 0,
      maxRetries: 0,
      // DeepSeek enables thinking by default. Its thinking mode rejects the
      // forced tool choice used by LangChain structured output, so this
      // bounded extraction call must explicitly disable it.
      modelKwargs: DEEPSEEK_ATTEMPT_INTERPRETER_MODEL_KWARGS,
      configuration: { baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com" },
    });
    this.structured = client.withStructuredOutput(AttemptInterpretationOutput, { name: "attempt_interpretation", includeRaw: true });
  }

  async interpret(input: Parameters<AttemptInterpreter["interpret"]>[0], control?: ExecutionControl): Promise<AttemptInterpreterResult> {
    assertExecutionActive(control);
    const activities = input.activities.map((activity) => ({
      publicKey: activity.publicKey,
      name: activity.name,
      purpose: activity.purpose,
      fields: activity.fields.map((field) => field.kind === "quantity"
        ? { valueKey: field.key, unitKey: `${field.key}Unit`, kind: field.kind, allowedUnits: field.unitOptions ?? [] }
        : { valueKey: field.key, kind: field.kind }),
    }));
    const result = await this.structured.invoke([
      { role: "system", content: "You extract typed calculation inputs for Learning Foundry. This is not grading, Evidence, feedback, or pedagogical diagnosis. Select only an activity in the supplied list. Copy only values explicitly present in the problem or working; never invent or convert a missing fact. In fields, use the exact valueKey and unitKey names supplied: every value is a numeric string without a unit, and every quantity unit is a separate allowed-unit string. Do not return extra field names. Return AMBIGUOUS when more than one mapping remains plausible or a required field is missing; return UNSUPPORTED when no activity applies. For AMBIGUOUS or UNSUPPORTED, capabilityPublicKey must be JSON null and fields must be empty. The note must be a short non-pedagogical extraction summary without hidden reasoning." },
      { role: "user", content: `Activity hint: ${input.capabilityHint ?? "none"}\nLearner-safe activities: ${JSON.stringify(activities)}\nProblem: ${input.problem}\nLearner working and answer: ${input.working}` },
    ], { signal: control?.signal });
    assertExecutionActive(control);
    const usage = (result.raw as { usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage_metadata;
    const parsed = AttemptInterpretationOutput.safeParse(result.parsed);
    return {
      output: parsed.success ? normalizeAttemptInterpretation(parsed.data, input.activities) : result.parsed,
      usage: { inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, totalTokens: usage?.total_tokens },
    };
  }
}

let interpreterOverride: AttemptInterpreter | null | undefined;
let configuredInterpreter: AttemptInterpreter | null | undefined;

export function getAttemptInterpreter(): AttemptInterpreter | null {
  if (interpreterOverride !== undefined) return interpreterOverride;
  if (configuredInterpreter !== undefined) return configuredInterpreter;
  if (!process.env.DEEPSEEK_API_KEY) return configuredInterpreter = null;
  return configuredInterpreter = new DeepSeekAttemptInterpreter(process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_MODEL ?? "deepseek-chat");
}

export function setAttemptInterpreterForTests(interpreter: AttemptInterpreter | null | undefined): void {
  interpreterOverride = interpreter;
}

type InterpretationRunRecord = {
  actor: Actor;
  taskId: string;
  provider: string;
  model: string;
  status: string;
  latencyMs: number;
  usage?: AttemptInterpreterResult["usage"];
  failureCode?: string;
};

async function recordInterpretationRun(input: InterpretationRunRecord): Promise<void> {
  await getDb().insert(modelRuns).values({
    institutionId: input.actor.institutionId,
    taskId: input.taskId,
    callType: "ATTEMPT_INTERPRETATION",
    provider: input.provider,
    model: input.model,
    status: input.status,
    inputTokens: input.usage?.inputTokens,
    outputTokens: input.usage?.outputTokens,
    totalTokens: input.usage?.totalTokens,
    latencyMs: input.latencyMs,
    evidenceUnitIds: [],
    failureCode: input.failureCode,
  });
}

export type AttemptPreparation = {
  capabilityId?: string;
  capabilityInput?: Record<string, unknown>;
  attemptStructuredInput: Record<string, unknown>;
  status: "MATCHED" | "AMBIGUOUS" | "UNSUPPORTED" | "UNAVAILABLE" | "INVALID" | "TRUSTED_INTERNAL";
  reason: string;
};

export type AttemptPreparationDependencies = {
  getCourseId: (input: { actor: Actor; taskId: string; episodeId: string }) => Promise<string>;
  listActivities: (actor: Actor, courseId: string) => Promise<AttemptInterpreterActivity[]>;
  resolveCapability: typeof resolveLearnerCapabilityInput;
  getInterpreter: () => AttemptInterpreter | null;
  recordRun: (record: InterpretationRunRecord) => Promise<void>;
};

const defaultDependencies: AttemptPreparationDependencies = {
  async getCourseId(input) {
    const scope = await requireTaskEpisodeScope(input.actor, { taskId: input.taskId, episodeId: input.episodeId, learnerOriginated: true });
    return scope.task.courseId;
  },
  listActivities: getLearnerCapabilitiesForCourse,
  resolveCapability: resolveLearnerCapabilityInput,
  getInterpreter: getAttemptInterpreter,
  recordRun: recordInterpretationRun,
};

async function safelyRecordInterpretationRun(
  dependencies: AttemptPreparationDependencies,
  record: InterpretationRunRecord,
): Promise<void> {
  try {
    await dependencies.recordRun(record);
  } catch {
    // Operational recording is best-effort and gets exactly one attempt. It must
    // never trigger another model call or block canonical Attempt capture.
  }
}

function unavailablePreparation(status: AttemptPreparation["status"], method: "MODEL" | "MANUAL", reason: string, note?: string): AttemptPreparation {
  return {
    status,
    reason,
    attemptStructuredInput: {
      responseType: "NATURAL_ATTEMPT",
      interpretation: { status, method, note: note ?? reason, diagnosticClaim: false },
    },
  };
}

export async function prepareAttemptForDiagnosis(input: {
  actor: Actor;
  taskId: string;
  episodeId: string;
  prompt: string;
  response: string;
  capabilityPublicKey?: string;
  fields?: Record<string, string>;
  manualEntry?: boolean;
  trustedCapabilityId?: string;
  trustedStructuredInput?: Record<string, unknown>;
}, dependencies: AttemptPreparationDependencies = defaultDependencies): Promise<AttemptPreparation> {
  const control = currentExecutionControl();
  assertExecutionActive(control);
  if (input.trustedStructuredInput !== undefined) {
    return {
      capabilityId: input.trustedCapabilityId,
      capabilityInput: input.trustedCapabilityId ? input.trustedStructuredInput : undefined,
      attemptStructuredInput: input.trustedStructuredInput,
      status: "TRUSTED_INTERNAL",
      reason: input.trustedCapabilityId ? "Trusted internal Capability input." : "Trusted internal review-only Attempt.",
    };
  }

  if (input.manualEntry) {
    if (!input.capabilityPublicKey) return unavailablePreparation("INVALID", "MANUAL", "Manual calculation values require a selected activity.");
    try {
      const resolved = await dependencies.resolveCapability({ actor: input.actor, taskId: input.taskId, episodeId: input.episodeId, publicKey: input.capabilityPublicKey, fields: input.fields ?? {} });
      return {
        ...resolved,
        capabilityInput: resolved.structuredInput,
        attemptStructuredInput: { capabilityInput: resolved.structuredInput, interpretation: { status: "MATCHED", method: "MANUAL", capabilityPublicKey: input.capabilityPublicKey } },
        status: "MATCHED",
        reason: "Learner-entered calculation values were validated by the active Reference Pack.",
      };
    } catch (error) {
      rethrowIfExecutionStopped(error, control);
      return unavailablePreparation("INVALID", "MANUAL", "The entered calculation values did not validate for the active course activity.");
    }
  }

  const courseId = await dependencies.getCourseId({ actor: input.actor, taskId: input.taskId, episodeId: input.episodeId });
  const activities = await dependencies.listActivities(input.actor, courseId);
  if (!activities.length) return unavailablePreparation("UNSUPPORTED", "MODEL", "No active learner calculation activity is available for this Task course.");
  const interpreter = dependencies.getInterpreter();
  if (!interpreter) {
    await safelyRecordInterpretationRun(dependencies, { actor: input.actor, taskId: input.taskId, provider: "DEEPSEEK", model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat", status: "UNAVAILABLE", latencyMs: 0, failureCode: "PROVIDER_NOT_CONFIGURED" });
    return unavailablePreparation("UNAVAILABLE", "MODEL", "Attempt interpretation provider is unavailable.");
  }

  const started = performance.now();
  try {
    const interpretationResult = await interpreter.interpret({ problem: input.prompt, working: input.response, capabilityHint: input.capabilityPublicKey, activities }, control);
    assertExecutionActive(control);
    const parsed = AttemptInterpretationOutput.safeParse(interpretationResult.output);
    if (!parsed.success) {
      await safelyRecordInterpretationRun(dependencies, { actor: input.actor, taskId: input.taskId, provider: interpreter.provider, model: interpreter.model, status: "VALIDATION_FAILED", latencyMs: performance.now() - started, usage: interpretationResult.usage, failureCode: "OUTPUT_SCHEMA_INVALID" });
      return unavailablePreparation("INVALID", "MODEL", "The interpretation output did not match the governed typed boundary.");
    }
    const interpretation = parsed.data;
    if (interpretation.status !== "MATCHED") {
      await safelyRecordInterpretationRun(dependencies, { actor: input.actor, taskId: input.taskId, provider: interpreter.provider, model: interpreter.model, status: "SUCCEEDED", latencyMs: performance.now() - started, usage: interpretationResult.usage, failureCode: interpretation.status });
      return unavailablePreparation(interpretation.status, "MODEL", `Attempt interpretation returned ${interpretation.status}.`, interpretation.note);
    }
    if (!interpretation.capabilityPublicKey || !activities.some((activity) => activity.publicKey === interpretation.capabilityPublicKey)) {
      await safelyRecordInterpretationRun(dependencies, { actor: input.actor, taskId: input.taskId, provider: interpreter.provider, model: interpreter.model, status: "VALIDATION_FAILED", latencyMs: performance.now() - started, usage: interpretationResult.usage, failureCode: "CAPABILITY_NOT_ACTIVE_FOR_COURSE" });
      return unavailablePreparation("INVALID", "MODEL", "The interpreted activity is not active for this Task course.", interpretation.note);
    }
    try {
      const resolved = await dependencies.resolveCapability({ actor: input.actor, taskId: input.taskId, episodeId: input.episodeId, publicKey: interpretation.capabilityPublicKey, fields: interpretation.fields });
      await safelyRecordInterpretationRun(dependencies, { actor: input.actor, taskId: input.taskId, provider: interpreter.provider, model: interpreter.model, status: "SUCCEEDED", latencyMs: performance.now() - started, usage: interpretationResult.usage });
      return {
        ...resolved,
        capabilityInput: resolved.structuredInput,
        attemptStructuredInput: { capabilityInput: resolved.structuredInput, interpretation: { status: "MATCHED", method: "MODEL", capabilityPublicKey: interpretation.capabilityPublicKey, note: interpretation.note } },
        status: "MATCHED",
        reason: "One provider interpretation was validated and rebound to the active course Capability.",
      };
    } catch (error) {
      rethrowIfExecutionStopped(error, control);
      await safelyRecordInterpretationRun(dependencies, { actor: input.actor, taskId: input.taskId, provider: interpreter.provider, model: interpreter.model, status: "VALIDATION_FAILED", latencyMs: performance.now() - started, usage: interpretationResult.usage, failureCode: "CAPABILITY_INPUT_INVALID" });
      return unavailablePreparation("INVALID", "MODEL", "The interpreted fields failed active Pack validation.", interpretation.note);
    }
  } catch (error) {
    const stopped = executionStopStatus(error, control);
    if (stopped) {
      await safelyRecordInterpretationRun(dependencies, { actor: input.actor, taskId: input.taskId, provider: interpreter.provider, model: interpreter.model, status: stopped, latencyMs: performance.now() - started, failureCode: stopped === "TIMED_OUT" ? "EXECUTION_TIMED_OUT" : "EXECUTION_ABORTED" });
    }
    rethrowIfExecutionStopped(error, control);
    await safelyRecordInterpretationRun(dependencies, { actor: input.actor, taskId: input.taskId, provider: interpreter.provider, model: interpreter.model, status: "FAILED", latencyMs: performance.now() - started, failureCode: error instanceof Error ? error.name : "INTERPRETER_FAILURE" });
    return unavailablePreparation("UNAVAILABLE", "MODEL", "Attempt interpretation failed; Teacher Review is required.");
  }
}
