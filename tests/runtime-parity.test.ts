import { describe, expect, it } from "vitest";
import { compareRuntimeParityCase, createRuntimeParityPlan, createRuntimeParityReport, summarizeRuntimeParityCoverage, type RuntimeParityCase, type RuntimeParityExecution, type RuntimeParityPlan } from "../src/runtime/runtime-parity";
import type { RuntimeExecutionRecord, RuntimeExecutionRole } from "../src/runtime/runtime-shadow";

function record(role: RuntimeExecutionRole, overrides: Partial<RuntimeExecutionRecord> = {}): RuntimeExecutionRecord {
  return {
    schemaVersion: "1.0.0",
    executionId: `${role.toLowerCase()}-execution`,
    role,
    runPurpose: "AGENT_EVAL",
    conversationId: "parity-run-case-1",
    caseId: "case-1",
    agentTraceId: `${role.toLowerCase()}-trace`,
    runtimeAdapterId: role === "AUTHORITATIVE" ? "legacy" : "candidate",
    runtimeAdapterVersion: "1.0.0",
    providerId: role === "AUTHORITATIVE" ? "deepseek" : "candidate-provider",
    modelId: "model",
    route: "LEARNER_DIAGNOSIS_COMPLETE",
    obligations: { retrievalRequired: false, capabilityInspectionRequired: true, diagnosisRequired: true },
    toolCalls: [
      { order: 0, name: "list_capabilities", arguments: {}, resultRef: "list-1", status: "SUCCEEDED" },
      { order: 1, name: "get_capability", arguments: { id: "capability-1" }, resultRef: "get-1", status: "SUCCEEDED" },
      { order: 2, name: "run_learner_diagnosis", arguments: { componentId: "capability-1" }, resultRef: "diagnosis-1", status: "SUCCEEDED" },
    ],
    sourceRefs: ["source-1"],
    evidenceRefs: ["diagnosis-1"],
    diagnosisTraceId: `${role.toLowerCase()}-diagnosis-trace`,
    finalResponseStatus: "ANSWERED",
    latencyMs: 100,
    tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    estimatedCostUsd: 0.001,
    startedAt: "2026-07-17T00:00:00.000Z",
    completedAt: "2026-07-17T00:00:00.100Z",
    status: "COMPLETED",
    completeness: { trace: true, finalResponse: true, toolEvidence: true },
    ...overrides,
  };
}

const parityCase: RuntimeParityCase = {
  caseId: "case-1",
  suiteVersion: "2.0.0",
  selection: { mode: "CHECKPOINT" },
  requiredTools: ["list_capabilities", "get_capability", "run_learner_diagnosis"],
  forbiddenTools: ["record_capability_gap"],
};

function execution(role: RuntimeExecutionRole, overrides: Partial<RuntimeParityExecution> = {}): RuntimeParityExecution {
  return {
    suiteVersion: "2.0.0",
    selection: { mode: "CHECKPOINT" },
    record: record(role),
    diagnosisResult: { failureCode: "WRONG_STOICHIOMETRIC_RATIO" },
    graderChecks: { requiredTools: true, diagnosisFidelity: true },
    ...overrides,
  };
}

describe("case-level runtime parity", () => {
  it("classifies equivalent complete executions as an exact match", () => {
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW"));

    expect(result).toMatchObject({
      caseId: "case-1",
      classification: "EXACT_MATCH",
      differences: [],
      authoritative: { record: { role: "AUTHORITATIVE" } },
      candidate: { record: { role: "SHADOW" } },
    });
  });

  it.each([
    ["route", { route: "CAPABILITY_GAP" }],
    ["obligations", { obligations: { retrievalRequired: true, capabilityInspectionRequired: true, diagnosisRequired: true } }],
    ["sourceRefs", { sourceRefs: ["different-source"] }],
    ["evidenceRefs", { evidenceRefs: ["different-evidence"] }],
    ["finalResponseStatus", { finalResponseStatus: "CAPABILITY_GAP" }],
    ["completeness", { completeness: { trace: true, finalResponse: false, toolEvidence: true } }],
  ] as const)("classifies a %s mismatch as a regression", (field, recordOverrides) => {
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", { record: record("SHADOW", recordOverrides) }));
    expect(result.classification).toBe("REGRESSION");
    expect(result.differences.map((difference) => difference.field)).toContain(field);
  });

  it("detects missing required tools", () => {
    const toolCalls = record("SHADOW").toolCalls.slice(0, 2);
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", { record: record("SHADOW", { toolCalls }) }));
    expect(result.classification).toBe("REGRESSION");
    expect(result.differences.map((difference) => difference.field)).toContain("requiredTools");
  });

  it("detects forbidden tools", () => {
    const toolCalls = [...record("SHADOW").toolCalls, { order: 3, name: "record_capability_gap", arguments: {}, resultRef: "gap-1", status: "SUCCEEDED" as const }];
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", { record: record("SHADOW", { toolCalls }) }));
    expect(result.classification).toBe("REGRESSION");
    expect(result.differences.map((difference) => difference.field)).toContain("forbiddenTools");
  });

  it("detects tool order and status changes", () => {
    const calls = [...record("SHADOW").toolCalls].reverse().map((call, order) => ({ ...call, order }));
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", { record: record("SHADOW", { toolCalls: calls }) }));
    expect(result.classification).toBe("REGRESSION");
    expect(result.differences.map((difference) => difference.field)).toContain("toolCalls");
  });

  it("detects diagnosis result and grader-map changes", () => {
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", {
      diagnosisResult: { failureCode: null },
      graderChecks: { requiredTools: true, diagnosisFidelity: false },
    }));
    expect(result.classification).toBe("REGRESSION");
    expect(result.differences.map((difference) => difference.field)).toEqual(expect.arrayContaining(["diagnosisResult", "graderChecks"]));
  });

  it.each([
    ["latencyMs", { latencyMs: 250 }],
    ["tokenUsage", { tokenUsage: undefined }],
    ["estimatedCostUsd", { estimatedCostUsd: undefined }],
  ] as const)("documents an operational %s difference without calling it exact", (field, recordOverrides) => {
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", { record: record("SHADOW", recordOverrides) }));
    expect(result.classification).toBe("ACCEPTABLE_DOCUMENTED_DIFFERENCE");
    expect(result.differences).toContainEqual(expect.objectContaining({ field, severity: "DOCUMENTED" }));
  });

  it("does not call a missing candidate parity", () => {
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), null);
    expect(result.classification).toBe("NOT_EXECUTED");
    expect(result.candidate).toBeNull();
  });

  it.each([
    ["candidate timeout", execution("SHADOW", { record: record("SHADOW", { status: "TIMED_OUT", failureStage: "TIMEOUT", terminalError: { code: "SHADOW_EXECUTION_TIMEOUT", message: "timeout" } }) })],
    ["candidate infrastructure failure", execution("SHADOW", { record: record("SHADOW", { status: "FAILED", failureStage: "EXECUTION", terminalError: { code: "CANDIDATE_FAILED", message: "failed" } }) })],
    ["authoritative failure", execution("SHADOW")],
  ] as const)("classifies %s separately from behavioral regression", (label, candidate) => {
    const authoritative = label === "authoritative failure"
      ? execution("AUTHORITATIVE", { record: record("AUTHORITATIVE", { status: "FAILED", failureStage: "EXECUTION", terminalError: { code: "LEGACY_FAILED", message: "failed" } }) })
      : execution("AUTHORITATIVE");
    const result = compareRuntimeParityCase(parityCase, authoritative, candidate);
    expect(result.classification).toBe("INFRASTRUCTURE_FAILURE");
    expect(result.authoritative).toBe(authoritative);
  });
});

describe("runtime parity reporting", () => {
  const plan: RuntimeParityPlan = {
    schemaVersion: "1.0.0",
    planId: "plan-1",
    suiteVersion: "2.0.0",
    selection: { mode: "CHECKPOINT" },
    cases: [{ ...parityCase, caseId: "case-b" }, { ...parityCase, caseId: "case-a" }],
    createdAt: "2026-07-17T00:00:00.000Z",
  };

  it.each([
    [0, 0, "UNPLANNED"],
    [2, 0, "NOT_RUN"],
    [2, 1, "PARTIAL"],
    [2, 2, "COMPLETE"],
  ] as const)("preserves %s/%s coverage as %s", (planned, executed, status) => {
    expect(summarizeRuntimeParityCoverage(planned, executed)).toMatchObject({ status, coverageComplete: status === "COMPLETE" });
  });

  it("serializes results in deterministic case order and does not claim subset coverage is full", () => {
    const first = compareRuntimeParityCase({ ...parityCase, caseId: "case-b" }, execution("AUTHORITATIVE"), null);
    const second = compareRuntimeParityCase({ ...parityCase, caseId: "case-a" }, execution("AUTHORITATIVE"), execution("SHADOW"));
    const report = createRuntimeParityReport("report-1", plan, [first, second], "2026-07-17T00:01:00.000Z");
    expect(report.results.map((result) => result.caseId)).toEqual(["case-a", "case-b"]);
    expect(report.coverage).toMatchObject({ status: "PARTIAL", plannedCases: 2, executedCases: 1 });
    expect(report.fullSuiteCoverageComplete).toBe(false);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("allows full-suite coverage only for a complete FULL selection", () => {
    const fullPlan = { ...plan, selection: { mode: "FULL" as const }, cases: [{ ...parityCase, caseId: "case-a" }] };
    const result = compareRuntimeParityCase(fullPlan.cases[0], execution("AUTHORITATIVE"), execution("SHADOW"));
    expect(createRuntimeParityReport("report-2", fullPlan, [result]).fullSuiteCoverageComplete).toBe(true);
  });

  it.each(["CHECKPOINT", "BASELINE", "LAYER", "DIMENSION"] as const)("builds a %s plan from the existing AgentEval selection contract", (mode) => {
    const selection = mode === "LAYER" ? { mode, value: "CORE_CONTRACT" } : mode === "DIMENSION" ? { mode, value: "RETRIEVAL" } : { mode };
    const cases = [{ caseId: "case-1", category: "test", input: "input", inputOrigin: "USER_INPUT", expectedStatus: ["ANSWERED"], requiredTools: ["tool-a"], forbiddenTools: ["tool-b"], allowedCapabilities: [], tags: [] }] as const;
    expect(createRuntimeParityPlan("plan", "2.0.0", selection, cases, "2026-07-17T00:00:00.000Z")).toMatchObject({ selection, cases: [{ caseId: "case-1", requiredTools: ["tool-a"], forbiddenTools: ["tool-b"] }] });
  });

  it("preserves the explicit empty layer/dimension selection failure", () => {
    expect(() => createRuntimeParityPlan("plan", "2.0.0", { mode: "DIMENSION", value: "PEDAGOGY" }, [])).toThrow("AGENT_EVAL_SELECTION_EMPTY: DIMENSION PEDAGOGY selected 0 cases");
  });
});
