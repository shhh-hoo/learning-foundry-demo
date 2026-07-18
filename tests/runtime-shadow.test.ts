import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeShadowCoordinator,
  parseRuntimeShadowConfiguration,
  type NormalizedRuntimeExecutionRequest,
  type RuntimeExecutionRecord,
  type RuntimeExecutor,
} from "../src/runtime/runtime-shadow";
import { resolveAgentExecutionPlan } from "../src/agent/route-policy";

const shadowRequest = {
    conversationId: "shadow-case-1",
    inputOrigin: "PRESET_INPUT",
    runPurpose: "AGENT_EVAL",
    messages: [{ role: "user", content: "Explain the evidence." }],
  } as const;
const normalizedRequest: NormalizedRuntimeExecutionRequest = {
  request: shadowRequest,
  executionPlan: resolveAgentExecutionPlan(shadowRequest),
  policy: {
    prompt: { version: "1", contentHash: "prompt" },
    capabilityRegistry: { version: "1", contentHash: "capabilities" },
    toolDefinitions: { version: "1", contentHash: "tools" },
  },
};

function executor(adapterId: string, onExecute: () => void): RuntimeExecutor {
  return {
    identity: { adapterId, adapterVersion: "1.0.0", providerId: `${adapterId}-provider`, modelId: `${adapterId}-model` },
    async execute(input) {
      onExecute();
      return {
        trace: {
          traceId: `${adapterId}-trace`,
          conversationId: input.request.conversationId,
          inputOrigin: input.request.inputOrigin,
          runPurpose: input.request.runPurpose,
          initialRoute: input.executionPlan.route,
          route: input.executionPlan.route,
          obligations: input.executionPlan.obligations,
          applicationResponseDisposition: { status: "ANSWERED", reason: "Governed Evidence is sufficient." },
          toolPhase: { state: "CLOSED", closedAt: "2026-07-17T00:00:00.900Z", reason: "Plan requirements satisfied." },
          responseOnlyCorrectionCount: 0,
          deterministicFallbackUsed: false,
          finalTerminalCondition: "PLAN_REQUIREMENTS_SATISFIED",
          provider: `${adapterId}-provider`,
          model: `${adapterId}-model`,
          thinkingMode: "disabled",
          promptVersion: input.policy.prompt.version,
          capabilityRegistryVersion: input.policy.capabilityRegistry.version,
          startedAt: "2026-07-17T00:00:00.000Z",
          completedAt: "2026-07-17T00:00:01.000Z",
          toolCalls: [],
          finalResponse: { status: "ANSWERED", learnerMessage: `${adapterId} answer`, sourceRefs: [], evidenceRefs: [] },
          latencyMs: 1000,
        },
        toolResults: [],
      };
    },
  };
}

describe("candidate-neutral runtime shadow coordination", () => {
  it("fails closed to Legacy-only for absent or invalid shadow configuration", () => {
    expect(parseRuntimeShadowConfiguration(undefined)).toEqual({ enabled: false, timeoutMs: 5000 });
    expect(parseRuntimeShadowConfiguration("candidate-authoritative")).toEqual({ enabled: false, timeoutMs: 5000 });
    expect(parseRuntimeShadowConfiguration("enabled", "2500")).toEqual({ enabled: true, timeoutMs: 2500 });
  });

  it("executes only the authoritative runtime when shadow mode is disabled", async () => {
    let authoritativeCalls = 0;
    let shadowCalls = 0;
    const records: RuntimeExecutionRecord[] = [];
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: false,
      authoritativeExecutor: executor("legacy", () => { authoritativeCalls += 1; }),
      shadowExecutor: executor("candidate", () => { shadowCalls += 1; }),
      recorder: { record: async (record) => { records.push(record); } },
      createId: () => "authoritative-execution",
    });

    const execution = await coordinator.execute(normalizedRequest);
    await execution.shadowCompletion;

    expect(execution.authoritativeResult.trace.finalResponse.learnerMessage).toBe("legacy answer");
    expect(authoritativeCalls).toBe(1);
    expect(shadowCalls).toBe(0);
    expect(records).toEqual([expect.objectContaining({
      schemaVersion: "1.3.0", executionId: "authoritative-execution", role: "AUTHORITATIVE", runtimeAdapterId: "legacy", status: "COMPLETED",
      executionPlan: normalizedRequest.executionPlan, applicationResponseDisposition: { status: "ANSWERED", reason: "Governed Evidence is sufficient." },
      toolPhase: expect.objectContaining({ state: "CLOSED" }), responseOnlyCorrectionCount: 0, deterministicFallbackUsed: false,
      finalTerminalCondition: "PLAN_REQUIREMENTS_SATISFIED",
    })]);
  });

  it("runs an explicit shadow with the same plan while keeping the authoritative product result", async () => {
    const records: RuntimeExecutionRecord[] = [];
    const receivedPlans: unknown[] = [];
    const authoritative = executor("legacy", () => {});
    const candidate = executor("candidate", () => {});
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: true,
      authoritativeExecutor: { ...authoritative, execute: async (input, signal) => { receivedPlans.push(input.executionPlan); return authoritative.execute(input, signal); } },
      shadowExecutor: { ...candidate, execute: async (input, signal) => { receivedPlans.push(input.executionPlan); return candidate.execute(input, signal); } },
      recorder: { record: async (record) => { records.push(record); } },
      createId: (() => { const ids = ["authoritative-execution", "shadow-execution"]; return () => ids.shift()!; })(),
    });

    const execution = await coordinator.execute(normalizedRequest);
    await execution.shadowCompletion;

    expect(execution.authoritativeResult.trace.finalResponse.learnerMessage).toBe("legacy answer");
    expect(receivedPlans).toEqual([normalizedRequest.executionPlan, normalizedRequest.executionPlan]);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ schemaVersion: "1.3.0", executionId: "authoritative-execution", role: "AUTHORITATIVE", runtimeAdapterId: "legacy" }),
      expect.objectContaining({ schemaVersion: "1.3.0", executionId: "shadow-execution", parentAuthoritativeExecutionId: "authoritative-execution", role: "SHADOW", runtimeAdapterId: "candidate" }),
    ]));
  });

  it("isolates the authoritative input from synchronous nested candidate mutation", async () => {
    const authoritativeInputs: NormalizedRuntimeExecutionRequest[] = [];
    const authoritative = executor("legacy", () => {});
    const candidate = executor("candidate", () => {});
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: true,
      authoritativeExecutor: {
        ...authoritative,
        execute: async (input, signal) => {
          authoritativeInputs.push(input);
          return authoritative.execute(input, signal);
        },
      },
      shadowExecutor: {
        ...candidate,
        execute: async (input, signal) => {
          try { (input.executionPlan as { route: string }).route = "CAPABILITY_GAP"; } catch { /* immutable snapshot */ }
          try { (input.request.messages as { role: string; content: string }[])[0].content = "candidate mutation"; } catch { /* immutable snapshot */ }
          try { (input.policy.prompt as { version: string }).version = "candidate-policy"; } catch { /* immutable snapshot */ }
          return candidate.execute(input, signal);
        },
      },
      recorder: { record: async () => {} },
    });

    const execution = await coordinator.execute(normalizedRequest);
    await execution.shadowCompletion;

    expect(authoritativeInputs).toHaveLength(1);
    expect(authoritativeInputs[0]).toMatchObject({
      request: { messages: [{ content: "Explain the evidence." }] },
      executionPlan: { route: "COURSE_EXPLANATION" },
      policy: { prompt: { version: "1" } },
    });
    expect(Object.isFrozen(authoritativeInputs[0].request.messages)).toBe(true);
    expect(Object.isFrozen(authoritativeInputs[0].executionPlan.obligations)).toBe(true);
  });

  it("records and isolates a candidate failure from a successful authoritative execution", async () => {
    const records: RuntimeExecutionRecord[] = [];
    const candidate: RuntimeExecutor = {
      identity: { adapterId: "candidate", adapterVersion: "1.0.0", providerId: "candidate-provider", modelId: "candidate-model" },
      execute: async () => { throw Object.assign(new Error("candidate unavailable"), { code: "CANDIDATE_DOWN" }); },
    };
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: true,
      authoritativeExecutor: executor("legacy", () => {}),
      shadowExecutor: candidate,
      recorder: { record: async (record) => { records.push(record); } },
      createId: (() => { const ids = ["authoritative-execution", "shadow-execution"]; return () => ids.shift()!; })(),
      now: () => "2026-07-17T00:00:02.000Z",
    });

    const execution = await coordinator.execute(normalizedRequest);
    await expect(execution.shadowCompletion).resolves.toBeUndefined();

    expect(execution.authoritativeResult.trace.finalResponse.learnerMessage).toBe("legacy answer");
    expect(records).toContainEqual(expect.objectContaining({
      role: "SHADOW",
      status: "FAILED",
      failureStage: "EXECUTION",
      terminalError: { code: "CANDIDATE_DOWN", message: "candidate unavailable" },
    }));
  });

  it("records a pending shadow marker until candidate execution reaches a terminal state", async () => {
    const records: RuntimeExecutionRecord[] = [];
    const candidate = executor("candidate", () => {});
    let completeCandidate!: (result: Awaited<ReturnType<RuntimeExecutor["execute"]>>) => void;
    let candidateStarted!: () => void;
    const started = new Promise<void>((resolve) => { candidateStarted = resolve; });
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: true,
      authoritativeExecutor: executor("legacy", () => {}),
      shadowExecutor: {
        ...candidate,
        execute: async () => await new Promise((resolve) => { completeCandidate = resolve; candidateStarted(); }),
      },
      recorder: { record: async (record) => { records.push(record); } },
      createId: (() => { const ids = ["authoritative-execution", "shadow-execution"]; return () => ids.shift()!; })(),
    });

    const execution = await coordinator.execute(normalizedRequest);

    expect(records).toContainEqual(expect.objectContaining({
      executionId: "shadow-execution",
      parentAuthoritativeExecutionId: "authoritative-execution",
      role: "SHADOW",
      status: "RUNNING",
    }));

    await started;
    completeCandidate(await candidate.execute(normalizedRequest, new AbortController().signal));
    await execution.shadowCompletion;
    expect(records.at(-1)).toEqual(expect.objectContaining({ executionId: "shadow-execution", status: "COMPLETED" }));
  });

  it("bounds and records a candidate timeout without changing the authoritative result", async () => {
    vi.useFakeTimers();
    try {
      const records: RuntimeExecutionRecord[] = [];
      const slowCandidate: RuntimeExecutor = {
        identity: { adapterId: "candidate", adapterVersion: "1.0.0", providerId: "candidate-provider", modelId: "candidate-model" },
        execute: async (_input, signal) => await new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(executor("candidate", () => {}).execute(normalizedRequest, signal)), 1000);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        }),
      };
      const coordinator = createRuntimeShadowCoordinator({
        shadowEnabled: true,
        shadowTimeoutMs: 10,
        authoritativeExecutor: executor("legacy", () => {}),
        shadowExecutor: slowCandidate,
        recorder: { record: async (record) => { records.push(record); } },
        createId: (() => { const ids = ["authoritative-execution", "shadow-execution"]; return () => ids.shift()!; })(),
        now: () => "2026-07-17T00:00:10.000Z",
      });

      const execution = await coordinator.execute(normalizedRequest);
      await vi.advanceTimersByTimeAsync(10);
      await execution.shadowCompletion;

      expect(execution.authoritativeResult.trace.finalResponse.learnerMessage).toBe("legacy answer");
      expect(records).toContainEqual(expect.objectContaining({
        role: "SHADOW",
        status: "TIMED_OUT",
        failureStage: "TIMEOUT",
        terminalError: { code: "SHADOW_EXECUTION_TIMEOUT", message: "Shadow execution exceeded 10ms." },
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts timed-out candidate work before it can cross a tool or write boundary", async () => {
    vi.useFakeTimers();
    try {
      const records: RuntimeExecutionRecord[] = [];
      let observedSignal: AbortSignal | undefined;
      let boundaryCalls = 0;
      const candidate: RuntimeExecutor = {
        identity: { adapterId: "candidate", adapterVersion: "1.0.0", providerId: "candidate-provider", modelId: "candidate-model" },
        execute: async (_input, signal) => {
          observedSignal = signal;
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          if (!signal.aborted) boundaryCalls += 1;
          throw Object.assign(new Error("candidate aborted"), { code: "CANDIDATE_ABORTED" });
        },
      };
      const coordinator = createRuntimeShadowCoordinator({
        shadowEnabled: true,
        shadowTimeoutMs: 10,
        authoritativeExecutor: executor("legacy", () => {}),
        shadowExecutor: candidate,
        recorder: { record: async (record) => { records.push(record); } },
        createId: (() => { const ids = ["authoritative-execution", "shadow-execution"]; return () => ids.shift()!; })(),
      });

      const execution = await coordinator.execute(normalizedRequest);
      await vi.advanceTimersByTimeAsync(10);
      await execution.shadowCompletion;

      expect(observedSignal?.aborted).toBe(true);
      expect(boundaryCalls).toBe(0);
      expect(records).toContainEqual(expect.objectContaining({ role: "SHADOW", status: "TIMED_OUT", failureStage: "TIMEOUT" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start shadow execution when the authoritative execution fails", async () => {
    const records: RuntimeExecutionRecord[] = [];
    let shadowCalls = 0;
    const authoritative: RuntimeExecutor = {
      identity: { adapterId: "legacy", adapterVersion: "1.0.0", providerId: "deepseek", modelId: "legacy-model" },
      execute: async () => { throw Object.assign(new Error("authoritative failed"), { code: "AUTHORITATIVE_DOWN" }); },
    };
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: true,
      authoritativeExecutor: authoritative,
      shadowExecutor: executor("candidate", () => { shadowCalls += 1; }),
      recorder: { record: async (record) => { records.push(record); } },
      createId: (() => { const ids = ["authoritative-execution", "shadow-execution"]; return () => ids.shift()!; })(),
      now: () => "2026-07-17T00:00:20.000Z",
    });

    await expect(coordinator.execute(normalizedRequest)).rejects.toMatchObject({ code: "AUTHORITATIVE_DOWN" });

    expect(shadowCalls).toBe(0);
    expect(records.some((record) => record.role === "SHADOW")).toBe(false);
    expect(records).toContainEqual(expect.objectContaining({
      role: "AUTHORITATIVE",
      status: "FAILED",
      failureStage: "EXECUTION",
      terminalError: { code: "AUTHORITATIVE_DOWN", message: "authoritative failed" },
    }));
  });

  it("records an explicitly enabled but absent candidate instead of simulating it", async () => {
    const records: RuntimeExecutionRecord[] = [];
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: true,
      authoritativeExecutor: executor("legacy", () => {}),
      recorder: { record: async (record) => { records.push(record); } },
      createId: (() => { const ids = ["authoritative-execution", "shadow-execution"]; return () => ids.shift()!; })(),
      now: () => "2026-07-17T00:00:30.000Z",
    });

    const execution = await coordinator.execute(normalizedRequest);
    await execution.shadowCompletion;

    expect(records).toContainEqual(expect.objectContaining({
      executionId: "shadow-execution",
      role: "SHADOW",
      status: "NOT_CONFIGURED",
      failureStage: "CONFIGURATION",
      terminalError: { code: "SHADOW_EXECUTOR_UNAVAILABLE", message: "Shadow execution was enabled without a candidate executor." },
    }));
  });

  it("preserves ordered tool evidence and keeps source and internal evidence references separate", async () => {
    const records: RuntimeExecutionRecord[] = [];
    const baseCandidate = executor("candidate", () => {});
    const candidate: RuntimeExecutor = {
      ...baseCandidate,
      execute: async (input, signal) => {
        const result = await baseCandidate.execute(input, signal);
        return {
          ...result,
          trace: {
            ...result.trace,
            toolCalls: [
              { name: "search_learning_resources", arguments: { query: "evidence" }, resultRef: "retrieval-1", status: "SUCCEEDED" as const },
              { name: "run_learner_diagnosis", arguments: { componentId: "capability-1" }, resultRef: "diagnosis-1", status: "SUCCEEDED" as const },
            ],
            finalResponse: {
              ...result.trace.finalResponse,
              sourceRefs: ["source-1"],
              evidenceRefs: ["retrieval-1", "diagnosis-1"],
              diagnosisTraceId: "trainer-trace-1",
            },
          },
        };
      },
    };
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: true,
      authoritativeExecutor: executor("legacy", () => {}),
      shadowExecutor: candidate,
      recorder: { record: async (record) => { records.push(record); } },
      createId: (() => { const ids = ["authoritative-execution", "shadow-execution"]; return () => ids.shift()!; })(),
    });

    const execution = await coordinator.execute(normalizedRequest);
    await execution.shadowCompletion;
    const shadow = records.filter((record) => record.role === "SHADOW").at(-1)!;

    expect(shadow.toolCalls.map(({ name, order }) => [name, order])).toEqual([
      ["search_learning_resources", 0],
      ["run_learner_diagnosis", 1],
    ]);
    expect(shadow.sourceRefs).toEqual(["source-1"]);
    expect(shadow.evidenceRefs).toEqual(["retrieval-1", "diagnosis-1"]);
    expect(shadow.diagnosisTraceId).toBe("trainer-trace-1");
  });

  it("does not expose a canonical Product State writer to the candidate executor", async () => {
    const candidate = executor("candidate", () => {});
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: true,
      authoritativeExecutor: executor("legacy", () => {}),
      shadowExecutor: {
        ...candidate,
        execute: async (input, signal) => {
          expect(input).not.toHaveProperty("productState");
          expect(input).not.toHaveProperty("writeProductState");
          expect(input).not.toHaveProperty("traceStore");
          expect(input).not.toHaveProperty("authoritativeTraceRepository");
          return candidate.execute(input, signal);
        },
      },
      recorder: { record: async () => {} },
    });

    const execution = await coordinator.execute(normalizedRequest);
    await execution.shadowCompletion;
  });

  it("does not let comparison-recorder failure change the authoritative product result", async () => {
    const recorderErrors: string[] = [];
    const coordinator = createRuntimeShadowCoordinator({
      shadowEnabled: false,
      authoritativeExecutor: executor("legacy", () => {}),
      recorder: { record: async () => { throw new Error("comparison store unavailable"); } },
      onRecorderError: (error) => { recorderErrors.push(error instanceof Error ? error.message : String(error)); },
    });

    const execution = await coordinator.execute(normalizedRequest);

    expect(execution.authoritativeResult.trace.finalResponse.learnerMessage).toBe("legacy answer");
    expect(recorderErrors).toEqual(["comparison store unavailable"]);
  });
});
