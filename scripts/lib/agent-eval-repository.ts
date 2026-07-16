import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TokenUsage } from "../../src/agent/types";

interface VersionedHash { readonly version: string; readonly contentHash: string }
export interface AgentEvalEligibility {
  readonly requiredTools: boolean;
  readonly forbiddenTools: boolean;
  readonly diagnosisFidelity: boolean;
  readonly sourceGrounding: boolean;
}
export interface PersistedAgentEvalCase {
  readonly caseId: string;
  readonly category: string;
  readonly runPurpose: "AGENT_EVAL";
  readonly agentTraceId?: string;
  readonly eligibility?: AgentEvalEligibility;
  readonly passed: boolean;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly errors: readonly string[];
  readonly latencyMs: number;
  readonly tokenUsage?: TokenUsage;
  readonly estimatedCostUsd: number | null;
  readonly terminalError?: { readonly code: string; readonly message: string };
}
export interface PersistedAgentEvalRun {
  readonly schemaVersion: "1.0.0";
  readonly evalRunId: string;
  readonly runPurpose: "AGENT_EVAL";
  readonly status: "RUNNING" | "COMPLETED" | "INTERRUPTED";
  readonly totalPlannedCases: number;
  readonly suiteVersion: string;
  readonly caseFileHash: string;
  readonly provider: string;
  readonly model: string;
  readonly thinkingMode: string;
  readonly prompt: VersionedHash;
  readonly capabilityRegistry: VersionedHash;
  readonly toolDefinitions: VersionedHash;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly terminalError?: { readonly code: string; readonly message: string };
  readonly cases: readonly PersistedAgentEvalCase[];
}

export interface AgentEvalMetricSummary {
  readonly eligibleCases: number;
  readonly passedCases: number;
  readonly rate: number;
}

export interface AgentEvalReport {
  readonly evalRunId: string;
  readonly suiteVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly runStatus: PersistedAgentEvalRun["status"];
  readonly isComplete: boolean;
  readonly completedCases: number;
  readonly totalPlannedCases: number;
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly passRate: number;
  readonly requiredToolAccuracy: number;
  readonly requiredToolMetric: AgentEvalMetricSummary;
  readonly forbiddenToolRate: number;
  readonly forbiddenToolComplianceMetric: AgentEvalMetricSummary;
  readonly diagnosisFidelity: number;
  readonly diagnosisFidelityMetric: AgentEvalMetricSummary;
  readonly sourceGroundingMetric: AgentEvalMetricSummary;
  readonly latencyMs: number;
  readonly tokenUsage: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number };
  readonly estimatedCostUsd: number | null;
  readonly knownEstimatedCostUsd: number;
  readonly pricedCases: number;
  readonly unpricedCases: number;
  readonly costCoverage: number;
  readonly errors: readonly { readonly caseId: string; readonly error: string }[];
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error("INVALID_EVAL_RUN_ID");
  return value;
}

export class AgentEvalRepository {
  constructor(readonly directory: string) {}
  private runDirectory(evalRunId: string) { return path.join(this.directory, safeId(evalRunId)); }
  private async write(run: PersistedAgentEvalRun): Promise<void> {
    const runDirectory = this.runDirectory(run.evalRunId);
    const temporary = path.join(runDirectory, `.run.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path.join(runDirectory, "run.json"));
  }
  async start(run: PersistedAgentEvalRun): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const runDirectory = this.runDirectory(run.evalRunId);
    try { await mkdir(runDirectory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`EVAL_RUN_EXISTS: ${run.evalRunId}`); throw error; }
    await this.write(run);
  }
  async save(run: PersistedAgentEvalRun): Promise<void> { await this.start(run); }
  async get(evalRunId: string): Promise<PersistedAgentEvalRun | null> {
    try { return JSON.parse(await readFile(path.join(this.runDirectory(evalRunId), "run.json"), "utf8")) as PersistedAgentEvalRun; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  private async mutate(evalRunId: string, update: (run: PersistedAgentEvalRun) => PersistedAgentEvalRun): Promise<void> {
    const run = await this.get(evalRunId); if (!run) throw new Error(`EVAL_RUN_NOT_FOUND: ${evalRunId}`);
    await this.write(update(run));
  }
  async appendCase(evalRunId: string, result: PersistedAgentEvalCase): Promise<void> {
    await this.mutate(evalRunId, (run) => {
      if (run.status !== "RUNNING") throw new Error(`EVAL_RUN_TERMINAL: ${evalRunId}`);
      if (run.cases.some((item) => item.caseId === result.caseId)) throw new Error(`EVAL_CASE_EXISTS: ${result.caseId}`);
      return { ...run, cases: [...run.cases, result] };
    });
  }
  async complete(evalRunId: string, completedAt: string): Promise<void> {
    await this.mutate(evalRunId, (run) => {
      if (run.status !== "RUNNING") throw new Error(`EVAL_RUN_TERMINAL: ${evalRunId}`);
      if (run.cases.length !== run.totalPlannedCases) throw new Error(`EVAL_RUN_INCOMPLETE: ${run.cases.length}/${run.totalPlannedCases} cases are persisted.`);
      return { ...run, status: "COMPLETED", completedAt };
    });
  }
  async interrupt(evalRunId: string, terminalError: { readonly code: string; readonly message: string }, completedAt: string): Promise<void> {
    await this.mutate(evalRunId, (run) => run.status === "RUNNING" ? { ...run, status: "INTERRUPTED", terminalError, completedAt } : run);
  }
}

function metric(run: PersistedAgentEvalRun, check: string, eligibility: keyof AgentEvalEligibility, emptyValue = 1): AgentEvalMetricSummary {
  const relevant = run.cases.filter((item) => item.eligibility ? item.eligibility[eligibility] : check in item.checks);
  const passedCases = relevant.filter((item) => item.checks[check]).length;
  return { eligibleCases: relevant.length, passedCases, rate: relevant.length ? passedCases / relevant.length : emptyValue };
}

export function buildAgentEvalReport(run: PersistedAgentEvalRun): AgentEvalReport {
  const usage = run.cases.reduce((sum, item) => ({ promptTokens: sum.promptTokens + (item.tokenUsage?.promptTokens ?? 0), completionTokens: sum.completionTokens + (item.tokenUsage?.completionTokens ?? 0), totalTokens: sum.totalTokens + (item.tokenUsage?.totalTokens ?? 0) }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const priced = run.cases.map((item) => item.estimatedCostUsd).filter((value): value is number => value !== null);
  const requiredToolMetric = metric(run, "requiredTools", "requiredTools");
  const forbiddenToolComplianceMetric = metric(run, "forbiddenTools", "forbiddenTools");
  const diagnosisFidelityMetric = metric(run, "diagnosisFidelity", "diagnosisFidelity");
  const sourceGroundingMetric = metric(run, "sourceRefs", "sourceGrounding");
  const knownEstimatedCostUsd = priced.reduce((sum, value) => sum + value, 0);
  const pricedCases = priced.length;
  const unpricedCases = run.cases.length - pricedCases;
  return {
    evalRunId: run.evalRunId, suiteVersion: run.suiteVersion, provider: run.provider, model: run.model, startedAt: run.startedAt, completedAt: run.completedAt ?? null,
    runStatus: run.status, isComplete: run.status === "COMPLETED" && run.cases.length === run.totalPlannedCases, completedCases: run.cases.length, totalPlannedCases: run.totalPlannedCases,
    totalCases: run.cases.length, passedCases: run.cases.filter((item) => item.passed).length, failedCases: run.cases.filter((item) => !item.passed).length,
    passRate: run.cases.length ? run.cases.filter((item) => item.passed).length / run.cases.length : 0,
    requiredToolAccuracy: requiredToolMetric.rate, requiredToolMetric,
    forbiddenToolRate: 1 - forbiddenToolComplianceMetric.rate, forbiddenToolComplianceMetric,
    diagnosisFidelity: diagnosisFidelityMetric.rate, diagnosisFidelityMetric, sourceGroundingMetric,
    latencyMs: run.cases.reduce((sum, item) => sum + item.latencyMs, 0), tokenUsage: usage,
    estimatedCostUsd: unpricedCases === 0 ? knownEstimatedCostUsd : null,
    knownEstimatedCostUsd, pricedCases, unpricedCases, costCoverage: run.cases.length ? pricedCases / run.cases.length : 0,
    errors: run.cases.flatMap((item) => item.errors.map((error) => ({ caseId: item.caseId, error }))),
  };
}

export function compareAgentEvalReports(baseline: AgentEvalReport, candidate: AgentEvalReport) {
  return {
    baselineEvalRunId: baseline.evalRunId,
    candidateEvalRunId: candidate.evalRunId,
    delta: {
      passRate: candidate.passRate - baseline.passRate,
      requiredToolAccuracy: candidate.requiredToolAccuracy - baseline.requiredToolAccuracy,
      forbiddenToolRate: candidate.forbiddenToolRate - baseline.forbiddenToolRate,
      diagnosisFidelity: candidate.diagnosisFidelity - baseline.diagnosisFidelity,
      sourceGrounding: candidate.sourceGroundingMetric.rate - baseline.sourceGroundingMetric.rate,
      latencyMs: candidate.latencyMs - baseline.latencyMs,
      promptTokens: candidate.tokenUsage.promptTokens - baseline.tokenUsage.promptTokens,
      completionTokens: candidate.tokenUsage.completionTokens - baseline.tokenUsage.completionTokens,
      totalTokens: candidate.tokenUsage.totalTokens - baseline.tokenUsage.totalTokens,
      knownEstimatedCostUsd: candidate.knownEstimatedCostUsd - baseline.knownEstimatedCostUsd,
      costCoverage: candidate.costCoverage - baseline.costCoverage,
      estimatedCostUsd: baseline.estimatedCostUsd === null || candidate.estimatedCostUsd === null ? null : candidate.estimatedCostUsd - baseline.estimatedCostUsd,
    },
  };
}