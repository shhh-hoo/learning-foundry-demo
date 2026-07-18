import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/model";
import {
  prepareAttemptForDiagnosis,
  setAttemptInterpreterForTests,
  type AttemptInterpreter,
  type AttemptPreparationDependencies,
} from "@/application/attempt-interpreter";
import { buildDiagnosisGraph, type DiagnosisGraphDependencies } from "@/workflows/diagnosis";

const actor: Actor = {
  userId: "20000000-0000-4000-8000-000000000001",
  institutionId: "10000000-0000-4000-8000-000000000001",
  roles: ["LEARNER"],
  courseIds: ["40000000-0000-4000-8000-000000000001"],
  authMethod: "unit-test",
  sessionId: "attempt-interpreter-test",
};
const taskId = "80000000-0000-4000-8000-000000000001";
const episodeId = "80000000-0000-4000-8000-000000000002";
const capabilityId = "50000000-0000-4000-8000-000000000001";
const capabilityVersionId = "50000000-0000-4000-8000-000000000011";
const attemptId = "90000000-0000-4000-8000-000000000001";
const observationId = "90000000-0000-4000-8000-000000000002";
const activity = {
  publicKey: "chemistry-molar-concentration",
  name: "Molar concentration",
  purpose: "Check concentration from amount and volume.",
  fields: [
    { key: "amount", kind: "quantity" as const, unitOptions: ["mol", "mmol"] },
    { key: "volume", kind: "quantity" as const, unitOptions: ["L", "dm3", "cm3"] },
    { key: "learnerAnswer", kind: "number" as const },
  ],
};
const fields = { amount: "1", amountUnit: "mol", volume: "2", volumeUnit: "L", learnerAnswer: "0.5" };

afterEach(() => {
  setAttemptInterpreterForTests(undefined);
  vi.restoreAllMocks();
});

function fakeInterpreter(output: unknown, invoke = vi.fn()): AttemptInterpreter {
  return {
    provider: "FAKE",
    model: "fake-structured-model",
    async interpret() {
      invoke();
      if (output instanceof Error) throw output;
      return { output, usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 } };
    },
  };
}

function preparationDependencies(input: {
  interpreter: AttemptInterpreter | null;
  recordRun?: AttemptPreparationDependencies["recordRun"];
  rejectFields?: boolean;
}): AttemptPreparationDependencies {
  return {
    getCourseId: async () => actor.courseIds[0],
    listActivities: async () => [activity],
    getInterpreter: () => input.interpreter,
    recordRun: input.recordRun ?? (async () => undefined),
    resolveCapability: async (request) => {
      if (input.rejectFields || request.publicKey !== activity.publicKey || request.fields.learnerAnswer !== "0.5") {
        throw new Error("Capability input invalid");
      }
      return {
        capabilityId,
        structuredInput: {
          amount: { value: 1, unit: "mol" },
          volume: { value: 2, unit: "L" },
          learnerAnswer: 0.5,
        },
      };
    },
  };
}

const baseInput = {
  actor,
  taskId,
  episodeId,
  prompt: "Calculate the concentration of 1 mol in 2 L.",
  response: "I used c = n/V and obtained 0.5 mol/L.",
};

describe("bounded natural Attempt preparation", () => {
  it("uses manual Pack fields with zero interpreter calls", async () => {
    const invoke = vi.fn();
    const prepared = await prepareAttemptForDiagnosis({
      ...baseInput,
      capabilityPublicKey: activity.publicKey,
      fields,
      manualEntry: true,
    }, preparationDependencies({ interpreter: fakeInterpreter({}, invoke) }));

    expect(invoke).not.toHaveBeenCalled();
    expect(prepared.status).toBe("MATCHED");
    expect(prepared.capabilityId).toBe(capabilityId);
  });

  it("invokes once, records metrics without raw model content, and executes the rebound Capability in the graph", async () => {
    const invoke = vi.fn();
    const records: Record<string, unknown>[] = [];
    const prepDependencies = preparationDependencies({
      interpreter: fakeInterpreter({
        status: "MATCHED",
        capabilityPublicKey: activity.publicKey,
        fields,
        note: "Mapped explicit values and final answer.",
      }, invoke),
      recordRun: async (record) => { records.push(record as unknown as Record<string, unknown>); },
    });
    const capture = vi.fn(async () => ({ id: attemptId }));
    const execute = vi.fn(async () => ({
      capability: { id: capabilityId },
      version: { id: capabilityVersionId },
      result: { status: "CORRECT", failureCode: null, firstInvalidStep: null, summary: "The governed calculation check matched." },
    }));
    const persist = vi.fn(async () => ({ id: observationId }));
    const unavailable = vi.fn(async () => ({ id: observationId }));
    const graph = buildDiagnosisGraph(undefined, {
      prepareAttempt: (input: Parameters<typeof prepareAttemptForDiagnosis>[0]) => prepareAttemptForDiagnosis(input, prepDependencies),
      captureAttempt: capture,
      executeCapability: execute,
      persistObservation: persist,
      persistUnavailable: unavailable,
    } as unknown as DiagnosisGraphDependencies);

    const result = await graph.invoke({
      ...baseInput,
      fields: {},
      manualEntry: false,
      sourceRefs: [],
      idempotencyKey: "attempt:natural-match",
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(unavailable).not.toHaveBeenCalled();
    expect(result.diagnosisStatus).toBe("AVAILABLE");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ provider: "FAKE", model: "fake-structured-model", status: "SUCCEEDED", usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 } });
    expect(Object.keys(records[0])).not.toEqual(expect.arrayContaining(["prompt", "response", "output", "raw"]));
  });

  it.each([
    ["AMBIGUOUS", { status: "AMBIGUOUS", capabilityPublicKey: null, fields: {}, note: "More than one mapping is plausible." }, false],
    ["UNSUPPORTED", { status: "UNSUPPORTED", capabilityPublicKey: null, fields: {}, note: "No registered activity applies." }, false],
    ["unknown key", { status: "MATCHED", capabilityPublicKey: "chemistry-not-active", fields, note: "Unknown activity." }, false],
    ["invalid fields", { status: "MATCHED", capabilityPublicKey: activity.publicKey, fields: { learnerAnswer: "0.5" }, note: "Required values missing." }, true],
    ["malformed output", { status: "MATCHED", fields }, false],
    ["provider failure", new Error("provider failed"), false],
  ])("fails closed after one interpreter call for %s", async (_label, output, rejectFields) => {
    const invoke = vi.fn();
    const prepared = await prepareAttemptForDiagnosis(baseInput, preparationDependencies({
      interpreter: fakeInterpreter(output, invoke),
      rejectFields,
    }));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(prepared.capabilityId).toBeUndefined();
    expect(prepared.attemptStructuredInput).toMatchObject({ interpretation: { diagnosticClaim: false } });
  });

  it("uses zero model calls and fails closed when the provider is unavailable", async () => {
    const records: Record<string, unknown>[] = [];
    const prepared = await prepareAttemptForDiagnosis(baseInput, preparationDependencies({
      interpreter: null,
      recordRun: async (record) => { records.push(record as unknown as Record<string, unknown>); },
    }));

    expect(prepared.status).toBe("UNAVAILABLE");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "UNAVAILABLE", failureCode: "PROVIDER_NOT_CONFIGURED" });
  });

  it("does not lose the Attempt or Teacher-review path when the one recorder attempt fails", async () => {
    const invoke = vi.fn();
    const recordRun = vi.fn(async () => { throw new Error("operational store unavailable"); });
    const prepDependencies = preparationDependencies({ interpreter: fakeInterpreter(new Error("provider failed"), invoke), recordRun });
    const capture = vi.fn(async () => ({ id: attemptId }));
    const unavailable = vi.fn(async () => ({ id: observationId }));
    const graph = buildDiagnosisGraph(undefined, {
      prepareAttempt: (input: Parameters<typeof prepareAttemptForDiagnosis>[0]) => prepareAttemptForDiagnosis(input, prepDependencies),
      captureAttempt: capture,
      executeCapability: vi.fn(),
      persistObservation: vi.fn(),
      persistUnavailable: unavailable,
    } as unknown as DiagnosisGraphDependencies);

    const result = await graph.invoke({
      ...baseInput,
      fields: {},
      manualEntry: false,
      sourceRefs: [],
      idempotencyKey: "attempt:recording-failure",
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(result.diagnosisStatus).toBe("UNAVAILABLE");
  });
});
