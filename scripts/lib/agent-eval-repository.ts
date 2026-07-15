import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TokenUsage } from "../../src/agent/types";

interface VersionedHash { readonly version: string; readonly contentHash: string }
export interface PersistedAgentEvalCase {
  readonly caseId: string;
  readonly category: string;
  readonly agentTraceId?: string;
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
  readonly suiteVersion: string;
  readonly caseFileHash: string;
  readonly provider: string;
  readonly model: string;
  readonly thinkingMode: string;
  readonly prompt: VersionedHash;
  readonly capabilityRegistry: VersionedHash;
  readonly toolDefinitions: VersionedHash;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly cases: readonly PersistedAgentEvalCase[];
}

export interface AgentEvalReport {
  readonly evalRunId: string;
  readonly suiteVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly passRate: number;
  readonly requiredToolAccuracy: number;
  readonly forbiddenToolRate: number;
  readonly diagnosisFidelity: number;
  readonly latencyMs: number;
  readonly tokenUsage: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number };
  readonly estimatedCostUsd: number | null;
  readonly errors: readonly { readonly caseId: string; readonly error: string }[];
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error("INVALID_EVAL_RUN_ID");
  return value;
}

export class AgentEvalRepository {
  constructor(readonly directory: string) {}
  private runDirectory(evalRunId: string) { return path.join(this.directory, safeId(evalRunId)); }
  async save(run: PersistedAgentEvalRun): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const runDirectory = this.runDirectory(run.evalRunId);
    try { await mkdir(runDirectory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`EVAL_RUN_EXISTS: ${run.evalRunId}`); throw error; }
    const temporary = path.join(runDirectory, `.run.${process.pid}.tmp`);
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path.join(runDirectory, "run.json"));
  }
  async get(evalRunId: string): Promise<PersistedAgentEvalRun | null> {
    try { return JSON.parse(await readFile(path.join(this.runDirectory(evalRunId), "run.json"), "utf8")) as PersistedAgentEvalRun; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
}

function accuracy(run: PersistedAgentEvalRun, check: string, emptyValue = 1): number {
  const relevant = run.cases.filter((item) => check in item.checks);
  return relevant.length ? relevant.filter((item) => item.checks[check]).length / relevant.length : emptyValue;
}

export function buildAgentEvalReport(run: PersistedAgentEvalRun): AgentEvalReport {
  const usage = run.cases.reduce((sum, item) => ({ promptTokens: sum.promptTokens + (item.tokenUsage?.promptTokens ?? 0), completionTokens: sum.completionTokens + (item.tokenUsage?.completionTokens ?? 0), totalTokens: sum.totalTokens + (item.tokenUsage?.totalTokens ?? 0) }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const priced = run.cases.map((item) => item.estimatedCostUsd);
  return {
    evalRunId: run.evalRunId, suiteVersion: run.suiteVersion, provider: run.provider, model: run.model, startedAt: run.startedAt, completedAt: run.completedAt,
    totalCases: run.cases.length, passedCases: run.cases.filter((item) => item.passed).length, failedCases: run.cases.filter((item) => !item.passed).length,
    passRate: run.cases.length ? run.cases.filter((item) => item.passed).length / run.cases.length : 0,
    requiredToolAccuracy: accuracy(run, "requiredTools"),
    forbiddenToolRate: 1 - accuracy(run, "forbiddenTools"),
    diagnosisFidelity: accuracy(run, "diagnosisFidelity"),
    latencyMs: run.cases.reduce((sum, item) => sum + item.latencyMs, 0), tokenUsage: usage,
    estimatedCostUsd: priced.every((value) => value !== null) ? priced.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
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
      latencyMs: candidate.latencyMs - baseline.latencyMs,
      promptTokens: candidate.tokenUsage.promptTokens - baseline.tokenUsage.promptTokens,
      completionTokens: candidate.tokenUsage.completionTokens - baseline.tokenUsage.completionTokens,
      totalTokens: candidate.tokenUsage.totalTokens - baseline.tokenUsage.totalTokens,
      estimatedCostUsd: baseline.estimatedCostUsd === null || candidate.estimatedCostUsd === null ? null : candidate.estimatedCostUsd - baseline.estimatedCostUsd,
    },
  };
}
