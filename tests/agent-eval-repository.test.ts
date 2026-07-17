import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentEvalRepository, buildAgentEvalReport, compareAgentEvalReports, type PersistedAgentEvalRun } from "../scripts/lib/agent-eval-repository";

function run(evalRunId: string, passed: boolean): PersistedAgentEvalRun {
  return {
    schemaVersion: "1.1.0", evalRunId, runPurpose: "AGENT_EVAL", status: "COMPLETED", totalPlannedCases: 1, selection: { mode: "FULL" },
    suitePlan: {
      layerCaseIds: { SMOKE: [], CORE_CONTRACT: ["diagnosis-01"], REFERENCE_PACK: [], GENERALIZATION: ["diagnosis-01"], ADVERSARIAL: [], LEARNING_LOOP: [] },
      dimensionCaseIds: { CONTEXT: [], RETRIEVAL: [], INTERPRETATION: ["diagnosis-01"], PEDAGOGY: [], COMPONENT: [], OUTCOME: [], CAPABILITY_BOUNDARY: [] },
    },
    suiteVersion: "1.1.0", caseFileHash: "sha256-cases",
    provider: "deepseek", model: "deepseek-v4-flash", thinkingMode: "disabled",
    prompt: { version: "1.3.0", contentHash: "prompt" }, capabilityRegistry: { version: "1", contentHash: "capabilities" }, toolDefinitions: { version: "1", contentHash: "tools" },
    startedAt: "2026-07-16T00:00:00.000Z", completedAt: "2026-07-16T00:00:02.000Z",
    cases: [{ caseId: "diagnosis-01", category: "diagnosis", suiteLayers: ["CORE_CONTRACT", "GENERALIZATION"], evaluationDimensions: ["INTERPRETATION"], runPurpose: "AGENT_EVAL", agentTraceId: "agent-1", eligibility: { requiredTools: true, forbiddenTools: false, diagnosisFidelity: true, sourceGrounding: false }, passed, checks: { requiredTools: passed, forbiddenTools: true, diagnosisFidelity: passed }, errors: passed ? [] : ["diagnosisFidelity"], latencyMs: 2000, tokenUsage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 }, estimatedCostUsd: 0.001 }],
  };
}

describe("AgentEvalRepository", () => {
  it("distinguishes partial layer coverage from a complete layer result", () => {
    const partial = {
      ...run("retrieval-subset", true),
      selection: { mode: "DIMENSION", value: "RETRIEVAL" },
      suitePlan: {
        layerCaseIds: {
          SMOKE: [],
          CORE_CONTRACT: Array.from({ length: 16 }, (_, index) => `contract-${index + 1}`),
          REFERENCE_PACK: [],
          GENERALIZATION: [],
          ADVERSARIAL: [],
          LEARNING_LOOP: [],
        },
        dimensionCaseIds: {},
      },
      totalPlannedCases: 5,
      cases: Array.from({ length: 5 }, (_, index) => ({
        ...run("case", true).cases[0]!,
        caseId: `contract-${index + 1}`,
        suiteLayers: ["CORE_CONTRACT"],
      })),
    } as unknown as PersistedAgentEvalRun;

    expect(buildAgentEvalReport(partial)).toMatchObject({
      selection: { mode: "DIMENSION", value: "RETRIEVAL" },
      layerMetrics: {
        CORE_CONTRACT: { plannedCases: 16, executedCases: 5, passedCases: 5, coverageComplete: false, rate: null, status: "PARTIAL" },
        LEARNING_LOOP: { plannedCases: 0, executedCases: 0, passedCases: 0, coverageComplete: false, rate: null, status: "UNPLANNED" },
      },
    });
  });

  it("reports supported-input generalization separately from boundary compliance", () => {
    const baseCase = run("case", true).cases[0]!;
    const separated = {
      ...run("generalization", true),
      suitePlan: {
        ...run("generalization", true).suitePlan,
        capabilityResolutionCaseIds: {
          FULL_MATCH: ["supported-input"],
          PARTIAL_MATCH: [],
          NO_MATCH: ["boundary-input"],
        },
      },
      totalPlannedCases: 2,
      cases: [
        { ...baseCase, caseId: "supported-input", expectedCapabilityResolution: "FULL_MATCH", passed: true },
        { ...baseCase, caseId: "boundary-input", expectedCapabilityResolution: "NO_MATCH", passed: false },
      ],
    } as unknown as PersistedAgentEvalRun;

    expect(buildAgentEvalReport(separated)).toMatchObject({
      supportedInputGeneralizationMetric: { plannedCases: 1, executedCases: 1, passedCases: 1, status: "COMPLETE", rate: 1 },
      capabilityBoundaryComplianceMetric: { plannedCases: 1, executedCases: 1, passedCases: 0, status: "COMPLETE", rate: 0 },
    });
  });

  it("checkpoints each completed case and preserves an interrupted partial run", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agent-eval-runs-"));
    const repository = new AgentEvalRepository(directory);
    await repository.start({
      schemaVersion: "1.0.0", evalRunId: "checkpoint-run", runPurpose: "AGENT_EVAL", suiteVersion: "1.1.0", caseFileHash: "sha256-cases", status: "RUNNING", totalPlannedCases: 18,
      provider: "deepseek", model: "deepseek-v4-flash", thinkingMode: "disabled", prompt: { version: "1.3.0", contentHash: "prompt" }, capabilityRegistry: { version: "1", contentHash: "capabilities" }, toolDefinitions: { version: "1", contentHash: "tools" }, startedAt: "2026-07-16T00:00:00.000Z", cases: [],
    });
    await repository.appendCase("checkpoint-run", { caseId: "diagnosis-01", category: "diagnosis", runPurpose: "AGENT_EVAL", agentTraceId: "agent-1", eligibility: { requiredTools: true, forbiddenTools: false, diagnosisFidelity: true, sourceGrounding: false }, passed: true, checks: {}, errors: [], latencyMs: 10, estimatedCostUsd: null });
    await expect(new AgentEvalRepository(directory).get("checkpoint-run")).resolves.toMatchObject({ status: "RUNNING", cases: [{ caseId: "diagnosis-01" }] });
    await repository.interrupt("checkpoint-run", { code: "NETWORK_ERROR", message: "connection lost" }, "2026-07-16T00:00:01.000Z");
    const partial = await repository.get("checkpoint-run");
    expect(partial).toMatchObject({ status: "INTERRUPTED", completedAt: "2026-07-16T00:00:01.000Z", terminalError: { code: "NETWORK_ERROR" } });
    expect(buildAgentEvalReport(partial!)).toMatchObject({ runStatus: "INTERRUPTED", isComplete: false, completedCases: 1, totalPlannedCases: 18 });
  });

  it("keeps immutable runs without overwriting one another", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agent-eval-runs-"));
    const repository = new AgentEvalRepository(directory);
    await repository.save(run("run-a", false));
    await repository.save(run("run-b", true));
    await expect(repository.save(run("run-a", true))).rejects.toThrow("EVAL_RUN_EXISTS");
    await expect(repository.get("run-a")).resolves.toEqual(run("run-a", false));
    await expect(repository.get("run-b")).resolves.toEqual(run("run-b", true));
  });

  it("regenerates reports offline and compares evidence", () => {
    const baseline = buildAgentEvalReport(run("run-a", false));
    const candidate = buildAgentEvalReport(run("run-b", true));
    expect(baseline.passRate).toBe(0);
    expect(candidate.passRate).toBe(1);
    expect(candidate.fullSuiteCoverageComplete).toBe(true);
    expect(candidate.layerMetrics).toMatchObject({
      SMOKE: { plannedCases: 0, executedCases: 0, passedCases: 0, rate: null, status: "UNPLANNED" },
      CORE_CONTRACT: { plannedCases: 1, executedCases: 1, passedCases: 1, rate: 1, status: "COMPLETE" },
      GENERALIZATION: { plannedCases: 1, executedCases: 1, passedCases: 1, rate: 1, status: "COMPLETE" },
    });
    expect(compareAgentEvalReports(baseline, candidate)).toMatchObject({ baselineEvalRunId: "run-a", candidateEvalRunId: "run-b", delta: { passRate: 1, diagnosisFidelity: 1 } });
  });

  it("distinguishes unplanned, not-run, partial and complete coverage", () => {
    const baseCase = run("coverage", true).cases[0]!;
    const report = buildAgentEvalReport({
      ...run("coverage", true),
      totalPlannedCases: 2,
      suitePlan: {
        layerCaseIds: {
          SMOKE: [],
          CORE_CONTRACT: ["executed"],
          REFERENCE_PACK: ["missing"],
          GENERALIZATION: ["executed", "missing"],
          ADVERSARIAL: [],
          LEARNING_LOOP: [],
        },
        dimensionCaseIds: {},
      },
      cases: [{ ...baseCase, caseId: "executed" }],
    } as unknown as PersistedAgentEvalRun);

    expect(report.layerMetrics).toMatchObject({
      SMOKE: { status: "UNPLANNED" },
      REFERENCE_PACK: { status: "NOT_RUN" },
      GENERALIZATION: { status: "PARTIAL" },
      CORE_CONTRACT: { status: "COMPLETE" },
    });
  });

  it("does not report a completed subset as complete full-suite coverage", () => {
    const subset: PersistedAgentEvalRun = {
      ...run("baseline-subset", true),
      selection: { mode: "BASELINE", value: "1.2.0" },
    };

    expect(buildAgentEvalReport(subset)).toMatchObject({
      isComplete: true,
      fullSuiteCoverageComplete: false,
      layerMetrics: {
        CORE_CONTRACT: { coverageComplete: false, status: "PARTIAL", rate: null },
        GENERALIZATION: { coverageComplete: false, status: "PARTIAL", rate: null },
      },
    });
  });

  it("uses only eligible cases for aggregate metrics and preserves partial cost evidence", () => {
    const mixed: PersistedAgentEvalRun = {
      ...run("mixed", true),
      totalPlannedCases: 3,
      cases: [
        { caseId: "required-pass", category: "retrieval", runPurpose: "AGENT_EVAL", eligibility: { requiredTools: true, forbiddenTools: false, diagnosisFidelity: false, sourceGrounding: true }, passed: true, checks: { requiredTools: true, sourceRefs: true }, errors: [], latencyMs: 10, estimatedCostUsd: 0.002 },
        { caseId: "required-fail", category: "retrieval", runPurpose: "AGENT_EVAL", eligibility: { requiredTools: true, forbiddenTools: false, diagnosisFidelity: false, sourceGrounding: true }, passed: false, checks: { requiredTools: false, sourceRefs: true }, errors: ["requiredTools"], latencyMs: 10, estimatedCostUsd: null },
        { caseId: "not-applicable", category: "diagnosis-missing-context", runPurpose: "AGENT_EVAL", eligibility: { requiredTools: false, forbiddenTools: true, diagnosisFidelity: false, sourceGrounding: false }, passed: true, checks: { requiredTools: true, forbiddenTools: true, diagnosisFidelity: true }, errors: [], latencyMs: 10, estimatedCostUsd: 0.001 },
      ],
    };
    const report = buildAgentEvalReport(mixed);
    expect(report.requiredToolMetric).toEqual({ eligibleCases: 2, passedCases: 1, rate: 0.5 });
    expect(report.diagnosisFidelityMetric).toEqual({ eligibleCases: 0, passedCases: 0, rate: 1 });
    expect(report.sourceGroundingMetric).toEqual({ eligibleCases: 2, passedCases: 2, rate: 1 });
    expect(report).toMatchObject({ estimatedCostUsd: null, knownEstimatedCostUsd: 0.003, pricedCases: 2, unpricedCases: 1, costCoverage: 2 / 3 });
  });
});
