import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentEvalRepository, buildAgentEvalReport, compareAgentEvalReports, type PersistedAgentEvalRun } from "../scripts/lib/agent-eval-repository";

function run(evalRunId: string, passed: boolean): PersistedAgentEvalRun {
  return {
    schemaVersion: "1.0.0", evalRunId, runPurpose: "AGENT_EVAL", status: "COMPLETED", totalPlannedCases: 1, suiteVersion: "1.1.0", caseFileHash: "sha256-cases",
    provider: "deepseek", model: "deepseek-v4-flash", thinkingMode: "disabled",
    prompt: { version: "1.3.0", contentHash: "prompt" }, capabilityRegistry: { version: "1", contentHash: "capabilities" }, toolDefinitions: { version: "1", contentHash: "tools" },
    startedAt: "2026-07-16T00:00:00.000Z", completedAt: "2026-07-16T00:00:02.000Z",
    cases: [{ caseId: "diagnosis-01", category: "diagnosis", runPurpose: "AGENT_EVAL", agentTraceId: "agent-1", eligibility: { requiredTools: true, forbiddenTools: false, diagnosisFidelity: true, sourceGrounding: false }, passed, checks: { requiredTools: passed, forbiddenTools: true, diagnosisFidelity: passed }, errors: passed ? [] : ["diagnosisFidelity"], latencyMs: 2000, tokenUsage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 }, estimatedCostUsd: 0.001 }],
  };
}

describe("AgentEvalRepository", () => {
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
    expect(compareAgentEvalReports(baseline, candidate)).toMatchObject({ baselineEvalRunId: "run-a", candidateEvalRunId: "run-b", delta: { passRate: 1, diagnosisFidelity: 1 } });
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