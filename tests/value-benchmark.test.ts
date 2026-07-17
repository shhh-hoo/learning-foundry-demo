import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BENCHMARK_ARMS,
  BENCHMARK_SCENARIOS,
  buildBenchmarkExecutionPlan,
  createBalancedBenchmarkSchedule,
  createBlindPedagogyPacket,
  createBlindPedagogyReviewLock,
  createEvidenceAuditPacket,
  createEvidenceAuditReviewLock,
  createValueBenchmarkReport,
  executeBenchmarkFirstAttempts,
  executeBenchmarkInfrastructureReplacement,
  inspectBenchmarkAttemptStates,
  sanitizeBenchmarkAuditArtifact,
  type BenchmarkArmExecutor,
  type BenchmarkCase,
  type BenchmarkExecutionRecord,
  type BenchmarkExecutionStart,
  type BenchmarkEvidenceRepository,
  type BenchmarkReview,
  type BenchmarkRunSnapshot,
} from "../src/value-benchmark";
import { FileBenchmarkEvidenceRepository } from "../src/value-benchmark/file-repository";

const cases: readonly BenchmarkCase[] = BENCHMARK_SCENARIOS.flatMap((scenario, scenarioIndex) =>
  [1, 2, 3].map((variant) => ({
    schemaVersion: "1.0.0" as const,
    caseId: `${scenario.toLowerCase()}-${variant}`,
    scenario,
    variant,
    exposureClass: variant === 1 ? "KNOWN_FIT" as const : variant === 2 ? "NOVEL_GENERALIZATION" as const : "CAPABILITY_BOUNDARY" as const,
    input: `Frozen input ${scenarioIndex + 1}.${variant}\nSecond byte-stable line.`,
    messages: [{ role: "user" as const, content: `Frozen input ${scenarioIndex + 1}.${variant}\nSecond byte-stable line.` }],
  })),
);

class MemoryRepository implements BenchmarkEvidenceRepository {
  run: BenchmarkRunSnapshot | null = null;
  starts: BenchmarkExecutionStart[] = [];
  executions: BenchmarkExecutionRecord[] = [];

  async start(run: BenchmarkRunSnapshot): Promise<void> {
    if (this.run) throw new Error("BENCHMARK_RUN_ALREADY_EXISTS");
    this.run = structuredClone(run);
  }
  async getRun(runId: string): Promise<BenchmarkRunSnapshot | null> {
    return this.run?.runId === runId ? structuredClone(this.run) : null;
  }
  async listExecutions(runId: string): Promise<readonly BenchmarkExecutionRecord[]> {
    return structuredClone(this.executions.filter((record) => record.runId === runId));
  }
  async listExecutionStarts(runId: string): Promise<readonly BenchmarkExecutionStart[]> {
    return structuredClone(this.starts.filter((record) => record.runId === runId));
  }
  async appendExecutionStart(start: BenchmarkExecutionStart): Promise<void> {
    if (this.starts.some((item) => item.executionId === start.executionId)) throw new Error("DUPLICATE_BENCHMARK_EXECUTION_START");
    this.starts.push(structuredClone(start));
  }
  async appendExecution(record: BenchmarkExecutionRecord): Promise<void> {
    if (this.executions.some((item) => item.executionId === record.executionId)) throw new Error("DUPLICATE_BENCHMARK_EXECUTION");
    this.executions.push(structuredClone(record));
  }
}

function snapshot(runId = "benchmark-run-1"): BenchmarkRunSnapshot {
  return {
    schemaVersion: "1.0.0",
    runId,
    experimentVersion: "1.0.0",
    experimentManifestHash: "manifest-hash",
    caseFileHash: "case-file-hash",
    scheduleSeed: "foundry-value-2026-07-17",
    providerSeed: { status: "UNSUPPORTED_NOT_SENT", value: null },
    provider: "deepseek",
    model: "same-model",
    thinkingMode: "disabled",
    sampling: { temperature: null, topP: null, maxTokens: 1800, responseFormat: "json_object" },
    pricing: { cacheHitInputPerMillion: 0.1, cacheMissInputPerMillion: 1, outputPerMillion: 2, currency: "USD", source: "versioned-test-pricing" },
    startedAt: "2026-07-17T00:00:00.000Z",
  };
}

function executors(options: { infrastructureFailure?: string; modelFailure?: string } = {}): Readonly<Record<(typeof BENCHMARK_ARMS)[number], BenchmarkArmExecutor>> {
  const result = {} as Record<(typeof BENCHMARK_ARMS)[number], BenchmarkArmExecutor>;
  for (const arm of BENCHMARK_ARMS) result[arm] = {
    execute: async ({ execution }) => {
      if (execution.executionId === options.infrastructureFailure) throw Object.assign(new Error("provider unavailable"), { code: "DEEPSEEK_API_ERROR", httpStatus: 503 });
      if (execution.executionId === options.modelFailure) throw Object.assign(new Error("invalid structured answer"), { code: "MODEL_RESPONSE_INVALID" });
      return {
        answer: `Answer for ${execution.caseId}`,
        sourceRefs: arm === "C_FULL_FOUNDRY" ? ["source-1"] : [],
        evidenceRefs: arm === "C_FULL_FOUNDRY" ? ["evidence-1"] : [],
        toolTrajectory: arm === "C_FULL_FOUNDRY" ? [{ name: "search_learning_resources", status: "SUCCEEDED", resultRef: "evidence-1" }] : [],
        tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, promptCacheHitTokens: 3, promptCacheMissTokens: 7 },
        providerUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 3, prompt_cache_miss_tokens: 7 },
        systemPrompt: `${arm} exact prompt`,
        rawClientLatencyMs: 25,
      };
    },
  };
  return result;
}

describe("Foundry Value Benchmark", () => {
  it("creates a seeded balanced Latin-square schedule and 72 isolated executions", () => {
    const schedule = createBalancedBenchmarkSchedule(cases, "foundry-value-2026-07-17");
    const permutationCounts = new Map<string, number>();
    for (const assignment of schedule) permutationCounts.set(assignment.armOrder.join(""), (permutationCounts.get(assignment.armOrder.join("")) ?? 0) + 1);

    expect(schedule).toHaveLength(24);
    expect([...permutationCounts.values()].sort()).toEqual([4, 4, 4, 4, 4, 4]);
    expect(new Set(schedule.map((item) => item.caseId)).size).toBe(24);
    expect(createBalancedBenchmarkSchedule(cases, "foundry-value-2026-07-17")).toEqual(schedule);

    const plan = buildBenchmarkExecutionPlan("benchmark-run-1", cases, "foundry-value-2026-07-17");
    expect(plan).toHaveLength(72);
    expect(new Set(plan.map((item) => item.executionId)).size).toBe(72);
    expect(new Set(plan.map((item) => item.conversationId)).size).toBe(72);
    expect(plan.every((item) => item.attemptKind === "FIRST")).toBe(true);
  });

  it("persists exactly 72 first attempts and never resamples a model-quality failure", async () => {
    const repository = new MemoryRepository();
    const run = snapshot();
    const plan = buildBenchmarkExecutionPlan(run.runId, cases, run.scheduleSeed);
    const modelFailure = plan[7]!.executionId;

    await executeBenchmarkFirstAttempts({ run, cases, repository, executors: executors({ modelFailure }), now: (() => { let value = 0; return () => `2026-07-17T00:00:${String(value++).padStart(2, "0")}.000Z`; })() });

    const records = await repository.listExecutions(run.runId);
    expect(records).toHaveLength(72);
    expect(records.find((item) => item.executionId === modelFailure)).toMatchObject({ status: "MODEL_QUALITY_FAILURE" });
    expect(records.find((item) => item.executionId === modelFailure)).not.toHaveProperty("replacementFor");
    await expect(executeBenchmarkFirstAttempts({ run, cases, repository, executors: executors() })).resolves.toHaveLength(72);
    expect(repository.starts).toHaveLength(72);
    expect(repository.executions).toHaveLength(72);
    await expect(executeBenchmarkInfrastructureReplacement({ runId: run.runId, failedExecutionId: modelFailure, cases, repository, executors: executors() })).rejects.toThrow("BENCHMARK_REPLACEMENT_NOT_INFRASTRUCTURE_FAILURE");
  });

  it("allows one linked infrastructure replacement while retaining the original failure", async () => {
    const repository = new MemoryRepository();
    const run = snapshot("replacement-run");
    const failedExecutionId = buildBenchmarkExecutionPlan(run.runId, cases, run.scheduleSeed)[0]!.executionId;
    await executeBenchmarkFirstAttempts({ run, cases, repository, executors: executors({ infrastructureFailure: failedExecutionId }) });

    const replacement = await executeBenchmarkInfrastructureReplacement({ runId: run.runId, failedExecutionId, cases, repository, executors: executors() });
    expect(replacement).toMatchObject({ attemptKind: "INFRASTRUCTURE_REPLACEMENT", replacementFor: failedExecutionId, status: "COMPLETED" });
    expect(new Set((await repository.listExecutions(run.runId)).map((item) => item.conversationId)).size).toBe(73);
    await expect(executeBenchmarkInfrastructureReplacement({ runId: run.runId, failedExecutionId, cases, repository, executors: executors() })).rejects.toThrow("BENCHMARK_REPLACEMENT_ALREADY_EXISTS");
  });

  it("never retries a persisted start whose terminal outcome is unknown", async () => {
    const repository = new MemoryRepository();
    const run = snapshot("unknown-outcome-run");
    const first = buildBenchmarkExecutionPlan(run.runId, cases, run.scheduleSeed)[0]!;
    await repository.start(run);
    await repository.appendExecutionStart({ schemaVersion: "1.0.0", runId: run.runId, executionId: first.executionId, caseId: first.caseId, arm: first.arm, order: first.order, conversationId: first.conversationId, attemptKind: "FIRST", startedAt: run.startedAt });

    await executeBenchmarkFirstAttempts({ run, cases, repository, executors: executors() });

    expect(repository.starts).toHaveLength(72);
    expect(repository.executions).toHaveLength(71);
    expect(await inspectBenchmarkAttemptStates(repository, run.runId)).toContainEqual(expect.objectContaining({ executionId: first.executionId, state: "UNKNOWN_OUTCOME", requiresManualAdjudication: true }));
  });

  it("stores local evidence append-only with private permissions and fails closed on corruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-benchmark-"));
    const repository = new FileBenchmarkEvidenceRepository(root);
    const run = snapshot("file-run");
    const first = buildBenchmarkExecutionPlan(run.runId, cases, run.scheduleSeed)[0]!;
    await repository.start(run);
    await repository.appendExecutionStart({ schemaVersion: "1.0.0", runId: run.runId, executionId: first.executionId, caseId: first.caseId, arm: first.arm, order: first.order, conversationId: first.conversationId, attemptKind: "FIRST", startedAt: run.startedAt });
    await expect(repository.appendExecutionStart({ schemaVersion: "1.0.0", runId: run.runId, executionId: first.executionId, caseId: first.caseId, arm: first.arm, order: first.order, conversationId: first.conversationId, attemptKind: "FIRST", startedAt: run.startedAt })).rejects.toThrow("DUPLICATE_BENCHMARK_EXECUTION_START");
    expect((await stat(join(root, run.runId, "run.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, run.runId, "starts.jsonl"))).mode & 0o777).toBe(0o600);

    await writeFile(join(root, run.runId, "starts.jsonl"), `${await readFile(join(root, run.runId, "starts.jsonl"), "utf8")}not-json`, { mode: 0o600 });
    await expect(repository.listExecutionStarts(run.runId)).rejects.toThrow("BENCHMARK_EVIDENCE_CORRUPT");
  });

  it("redacts sensitive audit fields and preserves unknown cost instead of guessing", async () => {
    const sanitized = sanitizeBenchmarkAuditArtifact({ reasoning_content: "hidden", authorization: "Bearer token", nested: { localPath: "/Users/person/private.pdf", traceId: "trace-1", note: "Bearer secret" } });
    expect(JSON.stringify(sanitized)).not.toMatch(/hidden|authorization|\/Users|Bearer|localPath/i);
    expect(sanitized).toMatchObject({ nested: { traceId: "trace-1", note: "[redacted]" } });

    const repository = new MemoryRepository();
    const run = { ...snapshot("unknown-price-run"), pricing: null };
    await executeBenchmarkFirstAttempts({ run, cases, repository, executors: executors() });
    expect((await repository.listExecutions(run.runId)).every((record) => record.estimatedCostUsd === null)).toBe(true);
  });

  it("separates blind pedagogy review from arm-hidden Evidence audit", async () => {
    const repository = new MemoryRepository();
    const run = snapshot("review-run");
    await executeBenchmarkFirstAttempts({ run, cases, repository, executors: executors() });
    const records = await repository.listExecutions(run.runId);
    const preparation = createBlindPedagogyPacket(run, cases, records, "private-blinding-salt");
    const pedagogyReviews: BenchmarkReview[] = preparation.packet.map((item) => ({ schemaVersion: "1.0.0", phase: "BLIND_PEDAGOGY", blindId: item.blindId, reviewerId: "pedagogy-reviewer", reviewedAt: "2026-07-17T01:00:00.000Z", scores: { correctness: 4, clarity: 4, pedagogy: 4, contextFidelity: 4 }, reason: "Blind rationale." }));
    const pedagogyLock = createBlindPedagogyReviewLock(preparation, pedagogyReviews, "2026-07-17T02:00:00.000Z");
    const evidencePacket = createEvidenceAuditPacket({ cases, records, preparation, pedagogyReviews, pedagogyLock });

    expect(preparation.packet).toHaveLength(72);
    expect(evidencePacket).toHaveLength(72);
    expect(JSON.stringify(preparation.packet)).not.toMatch(/A_BARE|B_FOUNDRY|C_FULL|sourceRefs|evidenceRefs|toolTrajectory|tokenUsage|systemPrompt|executionId/);
    expect(JSON.stringify(evidencePacket)).not.toMatch(/A_BARE|B_FOUNDRY|C_FULL|systemPrompt|executionId/);
    expect(evidencePacket[0]).toHaveProperty("sourceRefs");
    expect(new Set(preparation.sealedMapping.entries.map((item) => item.blindId)).size).toBe(72);
    expect(preparation.packet).not.toHaveProperty("sealedMapping");
  });

  it("refuses to reveal arms until both review phases are complete and hash-locked", async () => {
    const repository = new MemoryRepository();
    const run = snapshot("report-run");
    await executeBenchmarkFirstAttempts({ run, cases, repository, executors: executors() });
    const records = await repository.listExecutions(run.runId);
    const preparation = createBlindPedagogyPacket(run, cases, records, "private-blinding-salt");
    const pedagogyReviews: BenchmarkReview[] = preparation.packet.map((item, index) => ({
      schemaVersion: "1.0.0", phase: "BLIND_PEDAGOGY", blindId: item.blindId, reviewerId: "pedagogy-reviewer", reviewedAt: "2026-07-17T01:00:00.000Z",
      scores: { correctness: 3 + index % 3, clarity: 4, pedagogy: 4, contextFidelity: 4 }, reason: "Blind teaching-quality rationale.",
    }));
    expect(() => createBlindPedagogyReviewLock(preparation, pedagogyReviews.slice(1), "2026-07-17T03:00:00.000Z")).toThrow("BENCHMARK_REVIEW_SET_INCOMPLETE");
    const pedagogyLock = createBlindPedagogyReviewLock(preparation, pedagogyReviews, "2026-07-17T03:00:00.000Z");
    const evidencePacket = createEvidenceAuditPacket({ cases, records, preparation, pedagogyReviews, pedagogyLock });
    const evidenceReviews: BenchmarkReview[] = evidencePacket.map((item) => ({
      schemaVersion: "1.0.0", phase: "EVIDENCE_AUDIT", blindId: item.blindId, reviewerId: "evidence-reviewer", reviewedAt: "2026-07-17T02:00:00.000Z",
      scores: { grounding: 4, authority: 4, provenance: 4, integrity: 4 }, reason: "Evidence rationale before unblinding.",
    }));

    const evidenceLock = createEvidenceAuditReviewLock({ evidencePacket, evidenceReviews, preparation, pedagogyLock, lockedAt: "2026-07-17T03:30:00.000Z" });
    const report = createValueBenchmarkReport({ run, cases, records, preparation, evidencePacket, pedagogyReviews, evidenceReviews, pedagogyLock, evidenceLock, generatedAt: "2026-07-17T04:00:00.000Z" });

    expect(report.cases).toHaveLength(24);
    expect(report.cases.every((item) => item.arms.length === 3)).toBe(true);
    expect(report.cases.every((item) => Boolean(item.winner) && Boolean(item.winnerReason))).toBe(true);
    expect(report.demonstratedLearningEffectiveness).toBe("NOT_MEASURED");
    expect(report.summary).toHaveProperty("answerQuality");
    expect(report.summary).toHaveProperty("productValue");

    const changedReviews = [...pedagogyReviews.slice(0, -1), { ...pedagogyReviews.at(-1)!, reason: "Changed after lock." }];
    expect(() => createValueBenchmarkReport({ run, cases, records, preparation, evidencePacket, pedagogyReviews: changedReviews, evidenceReviews, pedagogyLock, evidenceLock, generatedAt: "2026-07-17T04:00:00.000Z" })).toThrow("BENCHMARK_REVIEW_LOCK_MISMATCH");
  });
});
