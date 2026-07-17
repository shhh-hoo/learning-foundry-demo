import { describe, expect, it } from "vitest";
import { compareRuntimeParityCase, createRuntimeParityPlan, createRuntimeParityReport, decideRuntimeParityCommand, summarizeRuntimeParityCoverage, type RuntimeParityCase, type RuntimeParityExecution, type RuntimeParityPlan } from "../src/runtime/runtime-parity";
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
    evidenceRefs: ["diagnosis-1", `${role.toLowerCase()}-diagnosis-trace`],
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

  it("normalizes execution-local Evidence and Diagnosis identifiers before comparison", () => {
    const authoritativeRecord = record("AUTHORITATIVE", {
      toolCalls: record("AUTHORITATIVE").toolCalls.map((call) => ({ ...call, resultRef: `authoritative-${call.order}` })),
      evidenceRefs: ["authoritative-2", "trainer-trace-authoritative"],
      diagnosisTraceId: "trainer-trace-authoritative",
    });
    const candidateRecord = record("SHADOW", {
      toolCalls: record("SHADOW").toolCalls.map((call) => ({ ...call, resultRef: `candidate-${call.order}` })),
      evidenceRefs: ["candidate-2", "trainer-trace-candidate"],
      diagnosisTraceId: "trainer-trace-candidate",
    });
    const governedDiagnosis = {
      componentId: "stoichiometric-product-mass",
      componentVersion: "1.0.0",
      diagnosis: { decision: "DIAGNOSED", failureCode: "WRONG_STOICHIOMETRIC_RATIO", firstPedagogicalIssue: { stage: "MOLE_RATIO", code: "WRONG_RATIO" } },
      recommendedSupport: { kind: "HINT", stage: "MOLE_RATIO" },
    };

    const result = compareRuntimeParityCase(
      parityCase,
      execution("AUTHORITATIVE", { record: authoritativeRecord, diagnosisResult: { ...governedDiagnosis, traceId: "trainer-trace-authoritative", executionId: "diagnosis-authoritative" } }),
      execution("SHADOW", { record: candidateRecord, diagnosisResult: { ...governedDiagnosis, traceId: "trainer-trace-candidate", executionId: "diagnosis-candidate" } }),
    );

    expect(result.classification).toBe("EXACT_MATCH");
    expect(result.differences).toEqual([]);
  });

  it("rejects an unrelated evidence reference instead of treating it as a Diagnosis trace", () => {
    const authoritativeRecord = record("AUTHORITATIVE", {
      evidenceRefs: ["diagnosis-1", "authoritative-diagnosis-trace"],
      diagnosisTraceId: "authoritative-diagnosis-trace",
    });
    const candidateRecord = record("SHADOW", {
      evidenceRefs: ["diagnosis-1", "unrelated-candidate-reference"],
      diagnosisTraceId: "candidate-diagnosis-trace",
    });

    const result = compareRuntimeParityCase(
      parityCase,
      execution("AUTHORITATIVE", { record: authoritativeRecord }),
      execution("SHADOW", { record: candidateRecord }),
    );

    expect(result.classification).toBe("REGRESSION");
    expect(result.differences).toContainEqual(expect.objectContaining({ field: "evidenceIntegrity", severity: "REGRESSION" }));
  });

  it("treats object key order and source-reference order as semantically irrelevant", () => {
    const authoritativeDiagnosis = {
      componentId: "component-1",
      componentVersion: "1.0.0",
      diagnosis: { decision: "DIAGNOSED", firstPedagogicalIssue: { stage: "RATIO", code: "WRONG_RATIO" }, failureCode: "WRONG_RATIO" },
      recommendedSupport: { kind: "HINT", stage: "RATIO" },
    };
    const candidateDiagnosis = {
      componentVersion: "1.0.0",
      componentId: "component-1",
      recommendedSupport: { stage: "RATIO", kind: "HINT" },
      diagnosis: { failureCode: "WRONG_RATIO", firstPedagogicalIssue: { code: "WRONG_RATIO", stage: "RATIO" }, decision: "DIAGNOSED" },
    };
    const result = compareRuntimeParityCase(
      parityCase,
      execution("AUTHORITATIVE", { record: record("AUTHORITATIVE", { sourceRefs: ["source-a", "source-b"] }), diagnosisResult: authoritativeDiagnosis }),
      execution("SHADOW", {
        record: record("SHADOW", {
          obligations: { diagnosisRequired: true, capabilityInspectionRequired: true, retrievalRequired: false },
          sourceRefs: ["source-b", "source-a"],
          tokenUsage: { totalTokens: 15, completionTokens: 5, promptTokens: 10 },
        }),
        diagnosisResult: candidateDiagnosis,
      }),
    );

    expect(result.classification).toBe("EXACT_MATCH");
    expect(result.differences).toEqual([]);
  });

  it.each([
    ["route", { route: "CAPABILITY_GAP" }],
    ["obligations", { obligations: { retrievalRequired: true, capabilityInspectionRequired: true, diagnosisRequired: true } }],
    ["sourceRefs", { sourceRefs: ["different-source"] }],
    ["evidenceLineage", { evidenceRefs: ["different-evidence"] }],
    ["finalResponseStatus", { finalResponseStatus: "CAPABILITY_GAP" }],
    ["completeness", { completeness: { trace: true, finalResponse: false, toolEvidence: true } }],
  ] as const)("classifies a %s mismatch as a regression", (field, recordOverrides) => {
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", { record: record("SHADOW", recordOverrides) }));
    expect(result.classification).toBe("REGRESSION");
    expect(result.differences.map((difference) => difference.field)).toContain(field);
  });

  it("detects missing required tools", () => {
    const toolCalls = record("SHADOW").toolCalls.slice(0, 2);
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", { record: record("SHADOW", { toolCalls }), graderChecks: { requiredTools: false, diagnosisFidelity: true } }));
    expect(result.classification).toBe("REGRESSION");
    expect(result.governedQuality).toMatchObject({ classification: "CANDIDATE_REGRESSION", checks: { requiredTools: { classification: "CANDIDATE_REGRESSION" } } });
  });

  it("detects forbidden tools", () => {
    const toolCalls = [...record("SHADOW").toolCalls, { order: 3, name: "record_capability_gap", arguments: {}, resultRef: "gap-1", status: "SUCCEEDED" as const }];
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", { record: record("SHADOW", { toolCalls }), graderChecks: { requiredTools: true, forbiddenTools: false, diagnosisFidelity: true } }));
    expect(result.classification).toBe("REGRESSION");
    expect(result.governedQuality).toMatchObject({ classification: "CANDIDATE_REGRESSION", checks: { forbiddenTools: { classification: "CANDIDATE_REGRESSION" } } });
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
    expect(result.differences.map((difference) => difference.field)).toContain("diagnosisResult");
    expect(result.governedQuality).toMatchObject({ classification: "CANDIDATE_REGRESSION", checks: { diagnosisFidelity: { classification: "CANDIDATE_REGRESSION" } } });
  });

  it("recognizes a candidate quality improvement without requiring bug-for-bug equivalence", () => {
    const result = compareRuntimeParityCase(
      parityCase,
      execution("AUTHORITATIVE", { graderChecks: { requiredTools: true, diagnosisFidelity: false } }),
      execution("SHADOW", { graderChecks: { requiredTools: true, diagnosisFidelity: true } }),
    );

    expect(result).toMatchObject({
      classification: "REVIEW_REQUIRED",
      behavioralEquivalence: "EXACT_MATCH",
      governedQuality: {
        classification: "CANDIDATE_IMPROVEMENT",
        checks: {
          requiredTools: { classification: "QUALITY_MATCH" },
          diagnosisFidelity: { classification: "CANDIDATE_IMPROVEMENT" },
        },
      },
      operationalImpact: { classification: "OPERATIONAL_MATCH" },
      reviewRequired: true,
    });
    expect(result.differences.map((difference) => difference.field)).not.toContain("graderChecks");
  });

  it("treats a candidate repair of a Legacy required-tool failure as reviewable improvement", () => {
    const legacyToolCalls = record("AUTHORITATIVE").toolCalls.slice(0, 2);
    const result = compareRuntimeParityCase(
      parityCase,
      execution("AUTHORITATIVE", { record: record("AUTHORITATIVE", { toolCalls: legacyToolCalls, evidenceRefs: [], diagnosisTraceId: undefined }), graderChecks: { requiredTools: false, diagnosisFidelity: true } }),
      execution("SHADOW", { graderChecks: { requiredTools: true, diagnosisFidelity: true } }),
    );

    expect(result).toMatchObject({
      classification: "REVIEW_REQUIRED",
      behavioralEquivalence: "BEHAVIORAL_DIFFERENCE",
      governedQuality: { classification: "CANDIDATE_IMPROVEMENT", checks: { requiredTools: { classification: "CANDIDATE_IMPROVEMENT" } } },
      reviewRequired: true,
    });
    expect(result.differences.map((difference) => difference.field)).not.toContain("requiredTools");
  });

  it("keeps a shared governed quality failure separate from behavioral equivalence", () => {
    const sharedFailure = { requiredTools: true, diagnosisFidelity: false };
    const result = compareRuntimeParityCase(
      parityCase,
      execution("AUTHORITATIVE", { graderChecks: sharedFailure }),
      execution("SHADOW", { graderChecks: sharedFailure }),
    );

    expect(result).toMatchObject({
      classification: "REVIEW_REQUIRED",
      behavioralEquivalence: "EXACT_MATCH",
      governedQuality: { classification: "SHARED_QUALITY_FAILURE", checks: { diagnosisFidelity: { classification: "SHARED_QUALITY_FAILURE" } } },
      operationalImpact: { classification: "OPERATIONAL_MATCH" },
      reviewRequired: true,
    });
  });

  it.each([
    ["latencyMs", { latencyMs: 250 }],
    ["tokenUsage", { tokenUsage: undefined }],
    ["estimatedCostUsd", { estimatedCostUsd: undefined }],
  ] as const)("requires review for an operational %s difference without auto-accepting it", (field, recordOverrides) => {
    const result = compareRuntimeParityCase(parityCase, execution("AUTHORITATIVE"), execution("SHADOW", { record: record("SHADOW", recordOverrides) }));
    expect(result).toMatchObject({
      classification: "REVIEW_REQUIRED",
      behavioralEquivalence: "EXACT_MATCH",
      governedQuality: { classification: "QUALITY_MATCH" },
      operationalImpact: { classification: "OPERATIONAL_DIFFERENCE" },
      reviewRequired: true,
    });
    expect(result.differences).toContainEqual(expect.objectContaining({ field, severity: "OPERATIONAL" }));
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

  it("exits non-zero for review-required operational impact instead of emitting parity pass", () => {
    const operational = compareRuntimeParityCase(
      { ...parityCase, caseId: "case-a" },
      execution("AUTHORITATIVE"),
      execution("SHADOW", { record: record("SHADOW", { latencyMs: 100_000 }) }),
    );
    const report = createRuntimeParityReport("report-review", { ...plan, cases: [{ ...parityCase, caseId: "case-a" }] }, [operational]);

    expect(report).toMatchObject({
      counts: { REVIEW_REQUIRED: 1 },
      operationalCounts: { OPERATIONAL_DIFFERENCE: 1 },
      reviewRequiredCases: 1,
    });
    expect(decideRuntimeParityCommand(report, { authoritativeAvailable: true, candidateAvailable: true, selfComparison: false })).toEqual({
      exitCode: 6,
      message: "RUNTIME_PARITY_REVIEW_REQUIRED",
    });
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
