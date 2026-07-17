import { createHash } from "node:crypto";
import type { TokenUsage } from "../agent/types";

export const BENCHMARK_ARMS = [
  "A_BARE_LLM",
  "B_FOUNDRY_POLICY_NO_TOOLS",
  "C_FULL_FOUNDRY",
] as const;
export type BenchmarkArm = (typeof BENCHMARK_ARMS)[number];

export const BENCHMARK_SCENARIOS = [
  "OPEN_EXPLANATION",
  "CURRICULUM_NAVIGATION",
  "CONCRETE_CALCULATION",
  "SHORT_FOLLOW_UP",
  "TOPIC_SWITCH_CONTAMINATION",
  "COMPLETE_DIAGNOSIS",
  "INCOMPLETE_EVIDENCE",
  "UNSUPPORTED_CAPABILITY",
] as const;
export type BenchmarkScenario = (typeof BENCHMARK_SCENARIOS)[number];

export type BenchmarkExposureClass = "KNOWN_FIT" | "NOVEL_GENERALIZATION" | "CAPABILITY_BOUNDARY";

export interface BenchmarkCaseMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly context?: {
    readonly taskId?: string;
    readonly episodeId?: string;
    readonly lifecycle?: "ACTIVE" | "STALE" | "SUPERSEDED";
  };
}

export interface BenchmarkCase {
  readonly schemaVersion: "1.0.0";
  readonly caseId: string;
  readonly scenario: BenchmarkScenario;
  readonly variant: number;
  readonly exposureClass: BenchmarkExposureClass;
  readonly input: string;
  readonly messages: readonly BenchmarkCaseMessage[];
  readonly activeTaskId?: string;
  readonly activeEpisodeId?: string;
}

export interface BenchmarkPricingSnapshot {
  readonly cacheHitInputPerMillion: number;
  readonly cacheMissInputPerMillion: number;
  readonly outputPerMillion: number;
  readonly currency: "USD";
  readonly source: string;
}

export interface BenchmarkRunSnapshot {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly experimentVersion: string;
  readonly experimentManifestHash: string;
  readonly caseFileHash: string;
  readonly scheduleSeed: string;
  readonly providerSeed: { readonly status: "UNSUPPORTED_NOT_SENT"; readonly value: null };
  readonly provider: string;
  readonly model: string;
  readonly thinkingMode: string;
  readonly sampling: {
    readonly temperature: number | null;
    readonly topP: number | null;
    readonly maxTokens: number;
    readonly responseFormat: "json_object";
  };
  readonly pricing: BenchmarkPricingSnapshot | null;
  readonly startedAt: string;
}

const LATIN_SQUARE = [
  ["A_BARE_LLM", "B_FOUNDRY_POLICY_NO_TOOLS", "C_FULL_FOUNDRY"],
  ["B_FOUNDRY_POLICY_NO_TOOLS", "C_FULL_FOUNDRY", "A_BARE_LLM"],
  ["C_FULL_FOUNDRY", "A_BARE_LLM", "B_FOUNDRY_POLICY_NO_TOOLS"],
  ["A_BARE_LLM", "C_FULL_FOUNDRY", "B_FOUNDRY_POLICY_NO_TOOLS"],
  ["C_FULL_FOUNDRY", "B_FOUNDRY_POLICY_NO_TOOLS", "A_BARE_LLM"],
  ["B_FOUNDRY_POLICY_NO_TOOLS", "A_BARE_LLM", "C_FULL_FOUNDRY"],
] as const satisfies readonly (readonly BenchmarkArm[])[];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateBenchmarkCases(cases: readonly BenchmarkCase[]): void {
  if (cases.length !== 24) throw new Error(`BENCHMARK_CASE_COUNT_INVALID: expected 24, received ${cases.length}.`);
  const ids = new Set(cases.map((item) => item.caseId));
  if (ids.size !== cases.length) throw new Error("BENCHMARK_CASE_ID_DUPLICATE");
  for (const scenario of BENCHMARK_SCENARIOS) {
    const variants = cases.filter((item) => item.scenario === scenario);
    if (variants.length !== 3) throw new Error(`BENCHMARK_SCENARIO_COUNT_INVALID: ${scenario} must have three variants.`);
  }
  if (cases.some((item) => !item.input || item.input.includes("\r"))) throw new Error("BENCHMARK_INPUT_BYTES_INVALID");
  for (const item of cases) {
    if (item.messages.length === 0 || item.messages.at(-1)?.role !== "user" || item.messages.at(-1)?.content !== item.input) {
      throw new Error(`BENCHMARK_CURRENT_INPUT_MISMATCH: ${item.caseId}`);
    }
  }
}

export interface BenchmarkScheduleAssignment {
  readonly caseId: string;
  readonly armOrder: readonly BenchmarkArm[];
}

/** A keyed-hash ordering is a deterministic seeded shuffle without engine-specific PRNG behavior. */
export function createBalancedBenchmarkSchedule(cases: readonly BenchmarkCase[], seed: string): readonly BenchmarkScheduleAssignment[] {
  validateBenchmarkCases(cases);
  if (!seed.trim()) throw new Error("BENCHMARK_SEED_REQUIRED");
  return [...cases]
    .sort((left, right) => {
      const leftHash = sha256(`${seed}\u0000${left.caseId}`);
      const rightHash = sha256(`${seed}\u0000${right.caseId}`);
      return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0;
    })
    .map((item, index) => ({ caseId: item.caseId, armOrder: [...LATIN_SQUARE[Math.floor(index / 4)]!] }));
}

export interface BenchmarkPlannedExecution {
  readonly executionId: string;
  readonly caseId: string;
  readonly arm: BenchmarkArm;
  readonly order: number;
  readonly conversationId: string;
  readonly attemptKind: "FIRST";
}

export function buildBenchmarkExecutionPlan(runId: string, cases: readonly BenchmarkCase[], seed: string): readonly BenchmarkPlannedExecution[] {
  if (!runId.trim()) throw new Error("BENCHMARK_RUN_ID_REQUIRED");
  const schedule = createBalancedBenchmarkSchedule(cases, seed);
  let order = 0;
  return schedule.flatMap((assignment) => assignment.armOrder.map((arm) => {
    const executionId = `${runId}--${assignment.caseId}--${arm}`;
    const execution = {
      executionId,
      caseId: assignment.caseId,
      arm,
      order,
      conversationId: `${executionId}--conversation-first`,
      attemptKind: "FIRST" as const,
    };
    order += 1;
    return execution;
  }));
}

export interface BenchmarkToolStep {
  readonly name: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly resultRef: string;
}

export interface BenchmarkArmOutput {
  readonly answer: string;
  readonly sourceRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly toolTrajectory: readonly BenchmarkToolStep[];
  readonly tokenUsage?: TokenUsage;
  readonly providerUsage?: Readonly<Record<string, number>>;
  readonly systemPrompt: string;
  readonly rawClientLatencyMs: number;
  readonly runtimeEvidence?: BenchmarkRuntimeEvidence;
}

export interface BenchmarkRuntimeEvidence {
  readonly traceId?: string;
  readonly route?: string;
  readonly obligations?: unknown;
  readonly executionPlan?: unknown;
  readonly contextSelection?: unknown;
  readonly budgetConsumption?: unknown;
  readonly evidenceAssessments?: unknown;
  readonly stopReason?: string;
  readonly governedWorkflow?: unknown;
  readonly toolResults?: readonly unknown[];
}

export interface BenchmarkArmExecutor {
  execute(input: { readonly testCase: BenchmarkCase; readonly execution: BenchmarkPlannedExecution | BenchmarkReplacementExecution; readonly signal: AbortSignal }): Promise<BenchmarkArmOutput>;
}

export type BenchmarkExecutionStatus = "COMPLETED" | "INFRASTRUCTURE_FAILURE" | "MODEL_QUALITY_FAILURE" | "POLICY_FAILURE";

export interface BenchmarkExecutionRecord {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly executionId: string;
  readonly caseId: string;
  readonly arm: BenchmarkArm;
  readonly order: number;
  readonly conversationId: string;
  readonly attemptKind: "FIRST" | "INFRASTRUCTURE_REPLACEMENT";
  readonly replacementFor?: string;
  readonly status: BenchmarkExecutionStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly answer?: string;
  readonly sourceRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly toolTrajectory: readonly BenchmarkToolStep[];
  readonly tokenUsage?: TokenUsage;
  readonly providerUsage?: Readonly<Record<string, number>>;
  readonly rawClientLatencyMs: number;
  readonly estimatedCostUsd: number | null;
  readonly systemPrompt?: string;
  readonly systemPromptHash?: string;
  readonly runtimeEvidence?: BenchmarkRuntimeEvidence;
  readonly terminalError?: { readonly code: string; readonly message: string };
}

export interface BenchmarkExecutionStart {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly executionId: string;
  readonly caseId: string;
  readonly arm: BenchmarkArm;
  readonly order: number;
  readonly conversationId: string;
  readonly attemptKind: "FIRST" | "INFRASTRUCTURE_REPLACEMENT";
  readonly replacementFor?: string;
  readonly startedAt: string;
}

export interface BenchmarkEvidenceRepository {
  start(run: BenchmarkRunSnapshot): Promise<void>;
  getRun(runId: string): Promise<BenchmarkRunSnapshot | null>;
  listExecutionStarts(runId: string): Promise<readonly BenchmarkExecutionStart[]>;
  listExecutions(runId: string): Promise<readonly BenchmarkExecutionRecord[]>;
  appendExecutionStart(start: BenchmarkExecutionStart): Promise<void>;
  appendExecution(record: BenchmarkExecutionRecord): Promise<void>;
}

function estimateCost(usage: TokenUsage | undefined, pricing: BenchmarkPricingSnapshot | null): number | null {
  if (!usage || !pricing) return null;
  const hit = usage.promptCacheHitTokens ?? 0;
  const miss = usage.promptCacheMissTokens ?? Math.max(0, usage.promptTokens - hit);
  return (hit * pricing.cacheHitInputPerMillion + miss * pricing.cacheMissInputPerMillion + usage.completionTokens * pricing.outputPerMillion) / 1_000_000;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  const message = error instanceof Error ? error.message : String(error);
  const prefix = message.match(/^([A-Z][A-Z0-9_]+):/u)?.[1];
  return prefix ?? "BENCHMARK_EXECUTION_FAILED";
}

function errorHttpStatus(error: unknown): number | undefined {
  return error && typeof error === "object" && "httpStatus" in error && typeof error.httpStatus === "number" ? error.httpStatus : undefined;
}

function classifyFailure(code: string, httpStatus?: number): Exclude<BenchmarkExecutionStatus, "COMPLETED"> {
  if (httpStatus === 408 || httpStatus === 429 || Boolean(httpStatus && httpStatus >= 500)) return "INFRASTRUCTURE_FAILURE";
  if (/^(?:BENCHMARK_TIMEOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|REQUIRED_SERVICE_UNAVAILABLE)$/u.test(code)) return "INFRASTRUCTURE_FAILURE";
  if (/^(?:MODEL_RESPONSE_INVALID|INVALID_AGENT_RESPONSE|AGENT_UNSUPPORTED_CLAIM)$/u.test(code)) return "MODEL_QUALITY_FAILURE";
  return "POLICY_FAILURE";
}

function nowIso(now?: () => string): string {
  return now?.() ?? new Date().toISOString();
}

async function executeOne(
  run: BenchmarkRunSnapshot,
  testCase: BenchmarkCase,
  execution: BenchmarkPlannedExecution | BenchmarkReplacementExecution,
  executor: BenchmarkArmExecutor,
  now?: () => string,
  timeoutMs = 120_000,
  clockMs: () => number = () => performance.now(),
): Promise<BenchmarkExecutionRecord> {
  const startedAt = nowIso(now);
  const clockStarted = clockMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(Object.assign(new Error("Benchmark execution timed out."), { code: "BENCHMARK_TIMEOUT" })), timeoutMs);
  try {
    const output = await Promise.race([
      executor.execute({ testCase, execution, signal: controller.signal }),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })),
    ]);
    if (!output.answer.trim()) throw Object.assign(new Error("Structured benchmark answer is empty."), { code: "MODEL_RESPONSE_INVALID" });
    return {
      schemaVersion: "1.0.0", runId: run.runId, executionId: execution.executionId, caseId: execution.caseId, arm: execution.arm,
      order: execution.order, conversationId: execution.conversationId, attemptKind: execution.attemptKind,
      ...(execution.attemptKind === "INFRASTRUCTURE_REPLACEMENT" ? { replacementFor: execution.replacementFor } : {}),
      status: "COMPLETED", startedAt, completedAt: nowIso(now), answer: output.answer,
      sourceRefs: [...output.sourceRefs], evidenceRefs: [...output.evidenceRefs], toolTrajectory: structuredClone(output.toolTrajectory),
      ...(output.tokenUsage ? { tokenUsage: structuredClone(output.tokenUsage) } : {}),
      ...(output.providerUsage ? { providerUsage: structuredClone(output.providerUsage) } : {}),
      rawClientLatencyMs: output.rawClientLatencyMs, estimatedCostUsd: estimateCost(output.tokenUsage, run.pricing),
      systemPrompt: output.systemPrompt, systemPromptHash: sha256(output.systemPrompt),
      ...(output.runtimeEvidence ? { runtimeEvidence: structuredClone(output.runtimeEvidence) } : {}),
    };
  } catch (error) {
    const code = controller.signal.aborted ? "BENCHMARK_TIMEOUT" : errorCode(error);
    return {
      schemaVersion: "1.0.0", runId: run.runId, executionId: execution.executionId, caseId: execution.caseId, arm: execution.arm,
      order: execution.order, conversationId: execution.conversationId, attemptKind: execution.attemptKind,
      ...(execution.attemptKind === "INFRASTRUCTURE_REPLACEMENT" ? { replacementFor: execution.replacementFor } : {}),
      status: classifyFailure(code, errorHttpStatus(error)), startedAt, completedAt: nowIso(now), sourceRefs: [], evidenceRefs: [], toolTrajectory: [],
      rawClientLatencyMs: Math.max(0, clockMs() - clockStarted), estimatedCostUsd: null,
      terminalError: { code, message: error instanceof Error ? error.message : String(error) },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeBenchmarkFirstAttempts(options: {
  readonly run: BenchmarkRunSnapshot;
  readonly cases: readonly BenchmarkCase[];
  readonly repository: BenchmarkEvidenceRepository;
  readonly executors: Readonly<Record<BenchmarkArm, BenchmarkArmExecutor>>;
  readonly now?: () => string;
  readonly timeoutMs?: number;
  readonly clockMs?: () => number;
}): Promise<readonly BenchmarkExecutionRecord[]> {
  const existingRun = await options.repository.getRun(options.run.runId);
  if (existingRun && JSON.stringify(existingRun) !== JSON.stringify(options.run)) {
    throw new Error("BENCHMARK_RUN_SNAPSHOT_MISMATCH");
  }
  if (!existingRun) await options.repository.start(options.run);
  const starts = await options.repository.listExecutionStarts(options.run.runId);
  const terminals = await options.repository.listExecutions(options.run.runId);
  const startedIds = new Set(starts.map((item) => item.executionId));
  const terminalIds = new Set(terminals.map((item) => item.executionId));
  const byId = new Map(options.cases.map((item) => [item.caseId, item]));
  const results: BenchmarkExecutionRecord[] = [...terminals];
  for (const execution of buildBenchmarkExecutionPlan(options.run.runId, options.cases, options.run.scheduleSeed)) {
    if (terminalIds.has(execution.executionId) || startedIds.has(execution.executionId)) continue;
    const testCase = byId.get(execution.caseId);
    if (!testCase) throw new Error(`BENCHMARK_CASE_NOT_FOUND: ${execution.caseId}`);
    await options.repository.appendExecutionStart({ schemaVersion: "1.0.0", runId: options.run.runId, executionId: execution.executionId, caseId: execution.caseId, arm: execution.arm, order: execution.order, conversationId: execution.conversationId, attemptKind: "FIRST", startedAt: nowIso(options.now) });
    const record = await executeOne(options.run, testCase, execution, options.executors[execution.arm], options.now, options.timeoutMs, options.clockMs);
    await options.repository.appendExecution(record);
    results.push(record);
  }
  return results;
}

export interface BenchmarkAttemptState {
  readonly executionId: string;
  readonly state: "TERMINAL" | "UNKNOWN_OUTCOME";
  readonly start: BenchmarkExecutionStart;
  readonly terminal?: BenchmarkExecutionRecord;
  readonly requiresManualAdjudication: boolean;
}

/** A persisted start without a terminal record is never retried automatically. */
export async function inspectBenchmarkAttemptStates(
  repository: BenchmarkEvidenceRepository,
  runId: string,
): Promise<readonly BenchmarkAttemptState[]> {
  const starts = await repository.listExecutionStarts(runId);
  const terminals = new Map((await repository.listExecutions(runId)).map((record) => [record.executionId, record]));
  return starts.map((start) => {
    const terminal = terminals.get(start.executionId);
    return {
      executionId: start.executionId,
      state: terminal ? "TERMINAL" as const : "UNKNOWN_OUTCOME" as const,
      start,
      ...(terminal ? { terminal } : {}),
      requiresManualAdjudication: !terminal,
    };
  });
}

export interface BenchmarkReplacementExecution extends Omit<BenchmarkPlannedExecution, "attemptKind"> {
  readonly attemptKind: "INFRASTRUCTURE_REPLACEMENT";
  readonly replacementFor: string;
}

export async function executeBenchmarkInfrastructureReplacement(options: {
  readonly runId: string;
  readonly failedExecutionId: string;
  readonly cases: readonly BenchmarkCase[];
  readonly repository: BenchmarkEvidenceRepository;
  readonly executors: Readonly<Record<BenchmarkArm, BenchmarkArmExecutor>>;
  readonly now?: () => string;
  readonly timeoutMs?: number;
  readonly clockMs?: () => number;
}): Promise<BenchmarkExecutionRecord> {
  const run = await options.repository.getRun(options.runId);
  if (!run) throw new Error("BENCHMARK_RUN_NOT_FOUND");
  const records = await options.repository.listExecutions(options.runId);
  const starts = await options.repository.listExecutionStarts(options.runId);
  if (records.filter((item) => item.attemptKind === "FIRST").length !== 72 || starts.filter((item) => item.attemptKind === "FIRST").length !== 72) throw new Error("BENCHMARK_FIRST_ATTEMPTS_NOT_TERMINAL");
  const failed = records.find((item) => item.executionId === options.failedExecutionId && item.attemptKind === "FIRST");
  if (!failed || failed.status !== "INFRASTRUCTURE_FAILURE") throw new Error("BENCHMARK_REPLACEMENT_NOT_INFRASTRUCTURE_FAILURE");
  if (records.some((item) => item.replacementFor === failed.executionId)) throw new Error("BENCHMARK_REPLACEMENT_ALREADY_EXISTS");
  const testCase = options.cases.find((item) => item.caseId === failed.caseId);
  if (!testCase) throw new Error(`BENCHMARK_CASE_NOT_FOUND: ${failed.caseId}`);
  const execution: BenchmarkReplacementExecution = {
    executionId: `${failed.executionId}--infrastructure-replacement-1`, caseId: failed.caseId, arm: failed.arm, order: failed.order,
    conversationId: `${failed.executionId}--conversation-infrastructure-replacement-1`, attemptKind: "INFRASTRUCTURE_REPLACEMENT", replacementFor: failed.executionId,
  };
  await options.repository.appendExecutionStart({ schemaVersion: "1.0.0", runId: run.runId, executionId: execution.executionId, caseId: execution.caseId, arm: execution.arm, order: execution.order, conversationId: execution.conversationId, attemptKind: "INFRASTRUCTURE_REPLACEMENT", replacementFor: failed.executionId, startedAt: nowIso(options.now) });
  const replacement = await executeOne(run, testCase, execution, options.executors[execution.arm], options.now, options.timeoutMs, options.clockMs);
  await options.repository.appendExecution(replacement);
  return replacement;
}

function effectiveRecords(records: readonly BenchmarkExecutionRecord[]): readonly BenchmarkExecutionRecord[] {
  const replacements = new Map(records.filter((item) => item.replacementFor).map((item) => [item.replacementFor!, item]));
  return records.filter((item) => item.attemptKind === "FIRST").map((item) => replacements.get(item.executionId) ?? item);
}

export interface BlindPedagogyPacketItem {
  readonly blindId: string;
  readonly caseId: string;
  readonly scenario: BenchmarkScenario;
  readonly exposureClass: BenchmarkExposureClass;
  readonly input: string;
  readonly messages: readonly BenchmarkCaseMessage[];
  readonly blindedAnswer: string;
  readonly originalAnswerHash: string;
  readonly blindedAnswerHash: string;
  readonly transformVersion: "1.0.0";
}

export interface EvidenceAuditPacketItem {
  readonly blindId: string;
  readonly caseId: string;
  readonly scenario: BenchmarkScenario;
  readonly exposureClass: BenchmarkExposureClass;
  readonly input: string;
  readonly messages: readonly BenchmarkCaseMessage[];
  readonly answer: string;
  readonly originalAnswerHash: string;
  readonly sourceRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly toolTrajectory: readonly BenchmarkToolStep[];
  readonly runtimeEvidence?: BenchmarkRuntimeEvidence;
}

export interface BenchmarkBlindMapping {
  readonly blindId: string;
  readonly executionId: string;
}

export interface SealedBenchmarkMapping {
  readonly schemaVersion: "1.0.0";
  readonly mappingHash: string;
  readonly entries: readonly BenchmarkBlindMapping[];
}

export interface BlindPedagogyPreparation {
  readonly packet: readonly BlindPedagogyPacketItem[];
  readonly sealedMapping: SealedBenchmarkMapping;
}

function blindAnswer(answer: string, referenceIds: readonly string[]): string {
  let blinded = answer;
  for (const referenceId of [...new Set(referenceIds)].filter(Boolean).sort((left, right) => right.length - left.length)) {
    blinded = blinded.split(referenceId).join("[reference]");
  }
  return blinded.replace(/https?:\/\/[^\s)\]}]+/giu, "[reference-url]");
}

const SENSITIVE_KEY = /(?:reasoning|authorization|api.?key|secret|credential|message.?content|system.?prompt|local.?path|private.?path)/iu;
const LOCAL_OR_SECRET_VALUE = /(?:authorization\s*:|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|\/(?:Users|home|private|var\/folders)\/|[A-Z]:\\)/iu;

function sanitizeAuditValue(value: unknown): unknown {
  if (typeof value === "string") return LOCAL_OR_SECRET_VALUE.test(value) ? "[redacted]" : value;
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => SENSITIVE_KEY.test(key) ? [] : [[key, sanitizeAuditValue(item)]]));
}

export function sanitizeBenchmarkAuditArtifact<T>(value: T): T {
  return sanitizeAuditValue(structuredClone(value)) as T;
}

export function createBlindPedagogyPacket(run: BenchmarkRunSnapshot, cases: readonly BenchmarkCase[], records: readonly BenchmarkExecutionRecord[], blindingSalt: string): BlindPedagogyPreparation {
  validateBenchmarkCases(cases);
  if (!blindingSalt.trim()) throw new Error("BENCHMARK_BLINDING_SALT_REQUIRED");
  const effective = effectiveRecords(records);
  if (effective.length !== 72) throw new Error("BENCHMARK_FIRST_ATTEMPT_SET_INCOMPLETE");
  const byCase = new Map(cases.map((item) => [item.caseId, item]));
  const rows = effective.map((record) => {
    const testCase = byCase.get(record.caseId);
    if (!testCase) throw new Error(`BENCHMARK_CASE_NOT_FOUND: ${record.caseId}`);
    const blindId = `blind-${sha256(`${run.runId}\u0000${record.executionId}\u0000${blindingSalt}`).slice(0, 24)}`;
    const answer = record.answer ?? `[${record.status}: ${record.terminalError?.code ?? "NO_ANSWER"}]`;
    return { record, testCase, blindId, answer };
  }).sort((left, right) => left.blindId.localeCompare(right.blindId));
  const entries = rows.map(({ record, blindId }) => ({ blindId, executionId: record.executionId }));
  return {
    packet: rows.map(({ record, testCase, blindId, answer }) => {
      const blindedAnswer = blindAnswer(answer, [...record.sourceRefs, ...record.evidenceRefs]);
      return { blindId, caseId: testCase.caseId, scenario: testCase.scenario, exposureClass: testCase.exposureClass, input: testCase.input, messages: structuredClone(testCase.messages), blindedAnswer, originalAnswerHash: sha256(answer), blindedAnswerHash: sha256(blindedAnswer), transformVersion: "1.0.0" as const };
    }),
    sealedMapping: { schemaVersion: "1.0.0", mappingHash: sha256(JSON.stringify(entries)), entries },
  };
}

type PedagogyScores = { readonly correctness: number; readonly clarity: number; readonly pedagogy: number; readonly contextFidelity: number };
type EvidenceScores = { readonly grounding: number; readonly authority: number; readonly provenance: number; readonly integrity: number };
export type BenchmarkReview =
  | { readonly schemaVersion: "1.0.0"; readonly phase: "BLIND_PEDAGOGY"; readonly blindId: string; readonly reviewerId: string; readonly reviewedAt: string; readonly scores: PedagogyScores; readonly reason: string }
  | { readonly schemaVersion: "1.0.0"; readonly phase: "EVIDENCE_AUDIT"; readonly blindId: string; readonly reviewerId: string; readonly reviewedAt: string; readonly scores: EvidenceScores; readonly reason: string };

export interface BlindPedagogyReviewLock {
  readonly schemaVersion: "1.0.0";
  readonly lockedAt: string;
  readonly expectedReviews: 72;
  readonly packetHash: string;
  readonly reviewHash: string;
  readonly mappingHash: string;
}

export interface EvidenceAuditReviewLock {
  readonly schemaVersion: "1.0.0";
  readonly lockedAt: string;
  readonly expectedReviews: 72;
  readonly packetHash: string;
  readonly reviewHash: string;
  readonly mappingHash: string;
  readonly pedagogyLockHash: string;
}

function reviewHash(reviews: readonly BenchmarkReview[]): string {
  return sha256(JSON.stringify([...reviews].sort((left, right) => left.blindId.localeCompare(right.blindId))));
}

function validateReviewSet(expectedBlindIds: readonly string[], reviews: readonly BenchmarkReview[], phase: BenchmarkReview["phase"]): void {
  if (reviews.length !== expectedBlindIds.length || reviews.some((item) => item.phase !== phase)) throw new Error("BENCHMARK_REVIEW_SET_INCOMPLETE");
  const ids = reviews.map((item) => item.blindId);
  if (new Set(ids).size !== ids.length || [...ids].sort().join("\u0000") !== [...expectedBlindIds].sort().join("\u0000")) throw new Error("BENCHMARK_REVIEW_SET_INCOMPLETE");
  for (const review of reviews) {
    if (!review.reviewerId.trim() || !review.reason.trim() || Object.values(review.scores).some((score) => !Number.isInteger(score) || score < 1 || score > 5)) {
      throw new Error("BENCHMARK_REVIEW_INVALID");
    }
  }
}

function packetHash(packet: readonly unknown[]): string {
  return sha256(JSON.stringify(packet));
}

function lockHash(lock: BlindPedagogyReviewLock): string {
  return sha256(JSON.stringify(lock));
}

export function createBlindPedagogyReviewLock(preparation: BlindPedagogyPreparation, pedagogyReviews: readonly BenchmarkReview[], lockedAt: string): BlindPedagogyReviewLock {
  const expectedBlindIds = preparation.packet.map((item) => item.blindId);
  if (expectedBlindIds.length !== 72) throw new Error("BENCHMARK_REVIEW_SET_INCOMPLETE");
  if (sha256(JSON.stringify(preparation.sealedMapping.entries)) !== preparation.sealedMapping.mappingHash) throw new Error("BENCHMARK_MAPPING_HASH_MISMATCH");
  validateReviewSet(expectedBlindIds, pedagogyReviews, "BLIND_PEDAGOGY");
  return { schemaVersion: "1.0.0", lockedAt, expectedReviews: 72, packetHash: packetHash(preparation.packet), reviewHash: reviewHash(pedagogyReviews), mappingHash: preparation.sealedMapping.mappingHash };
}

function verifyPedagogyLock(preparation: BlindPedagogyPreparation, reviews: readonly BenchmarkReview[], lock: BlindPedagogyReviewLock): void {
  if (packetHash(preparation.packet) !== lock.packetHash || reviewHash(reviews) !== lock.reviewHash || preparation.sealedMapping.mappingHash !== lock.mappingHash || sha256(JSON.stringify(preparation.sealedMapping.entries)) !== lock.mappingHash) {
    throw new Error("BENCHMARK_REVIEW_LOCK_MISMATCH");
  }
}

export function createEvidenceAuditPacket(options: {
  readonly cases: readonly BenchmarkCase[];
  readonly records: readonly BenchmarkExecutionRecord[];
  readonly preparation: BlindPedagogyPreparation;
  readonly pedagogyReviews: readonly BenchmarkReview[];
  readonly pedagogyLock: BlindPedagogyReviewLock;
}): readonly EvidenceAuditPacketItem[] {
  verifyPedagogyLock(options.preparation, options.pedagogyReviews, options.pedagogyLock);
  const effective = new Map(effectiveRecords(options.records).map((item) => [item.executionId, item]));
  const byCase = new Map(options.cases.map((item) => [item.caseId, item]));
  return options.preparation.sealedMapping.entries.map(({ blindId, executionId }) => {
    const record = effective.get(executionId);
    if (!record) throw new Error(`BENCHMARK_EXECUTION_MISSING: ${executionId}`);
    const testCase = byCase.get(record.caseId);
    if (!testCase) throw new Error(`BENCHMARK_CASE_NOT_FOUND: ${record.caseId}`);
    const answer = record.answer ?? `[${record.status}: ${record.terminalError?.code ?? "NO_ANSWER"}]`;
    return sanitizeBenchmarkAuditArtifact({ blindId, caseId: testCase.caseId, scenario: testCase.scenario, exposureClass: testCase.exposureClass, input: testCase.input, messages: structuredClone(testCase.messages), answer, originalAnswerHash: sha256(answer), sourceRefs: record.sourceRefs, evidenceRefs: record.evidenceRefs, toolTrajectory: record.toolTrajectory, ...(record.runtimeEvidence ? { runtimeEvidence: record.runtimeEvidence } : {}) });
  });
}

export function createEvidenceAuditReviewLock(options: {
  readonly evidencePacket: readonly EvidenceAuditPacketItem[];
  readonly evidenceReviews: readonly BenchmarkReview[];
  readonly preparation: BlindPedagogyPreparation;
  readonly pedagogyLock: BlindPedagogyReviewLock;
  readonly lockedAt: string;
}): EvidenceAuditReviewLock {
  const expectedBlindIds = options.evidencePacket.map((item) => item.blindId);
  validateReviewSet(expectedBlindIds, options.evidenceReviews, "EVIDENCE_AUDIT");
  if (options.preparation.sealedMapping.mappingHash !== options.pedagogyLock.mappingHash) throw new Error("BENCHMARK_MAPPING_HASH_MISMATCH");
  return { schemaVersion: "1.0.0", lockedAt: options.lockedAt, expectedReviews: 72, packetHash: packetHash(options.evidencePacket), reviewHash: reviewHash(options.evidenceReviews), mappingHash: options.preparation.sealedMapping.mappingHash, pedagogyLockHash: lockHash(options.pedagogyLock) };
}

function score(review: BenchmarkReview): number {
  return Object.values(review.scores).reduce((total, value) => total + value, 0);
}

export function createValueBenchmarkReport(options: {
  readonly run: BenchmarkRunSnapshot;
  readonly cases: readonly BenchmarkCase[];
  readonly records: readonly BenchmarkExecutionRecord[];
  readonly preparation: BlindPedagogyPreparation;
  readonly evidencePacket: readonly EvidenceAuditPacketItem[];
  readonly pedagogyReviews: readonly BenchmarkReview[];
  readonly evidenceReviews: readonly BenchmarkReview[];
  readonly pedagogyLock: BlindPedagogyReviewLock;
  readonly evidenceLock: EvidenceAuditReviewLock;
  readonly generatedAt: string;
}) {
  verifyPedagogyLock(options.preparation, options.pedagogyReviews, options.pedagogyLock);
  if (packetHash(options.evidencePacket) !== options.evidenceLock.packetHash
    || reviewHash(options.evidenceReviews) !== options.evidenceLock.reviewHash
    || options.evidenceLock.mappingHash !== options.preparation.sealedMapping.mappingHash
    || options.evidenceLock.pedagogyLockHash !== lockHash(options.pedagogyLock)) throw new Error("BENCHMARK_REVIEW_LOCK_MISMATCH");
  validateReviewSet(options.preparation.packet.map((item) => item.blindId), options.pedagogyReviews, "BLIND_PEDAGOGY");
  validateReviewSet(options.evidencePacket.map((item) => item.blindId), options.evidenceReviews, "EVIDENCE_AUDIT");
  const mapping = new Map(options.preparation.sealedMapping.entries.map((item) => [item.executionId, item.blindId]));
  const pedagogy = new Map(options.pedagogyReviews.map((item) => [item.blindId, item]));
  const evidence = new Map(options.evidenceReviews.map((item) => [item.blindId, item]));
  const effective = effectiveRecords(options.records);
  const reportCases = options.cases.map((testCase) => {
    const arms = BENCHMARK_ARMS.map((arm) => {
      const record = effective.find((item) => item.caseId === testCase.caseId && item.arm === arm);
      if (!record) throw new Error(`BENCHMARK_EXECUTION_MISSING: ${testCase.caseId}/${arm}`);
      const blindId = mapping.get(record.executionId);
      const pedagogyReview = blindId ? pedagogy.get(blindId) : undefined;
      const evidenceReview = blindId ? evidence.get(blindId) : undefined;
      if (!blindId || !pedagogyReview || !evidenceReview) throw new Error("BENCHMARK_REVIEW_SET_INCOMPLETE");
      const attempts = options.records.filter((item) => item.executionId === record.executionId || item.executionId === record.replacementFor || item.replacementFor === record.executionId || item.replacementFor === record.replacementFor);
      return {
        arm, executionId: record.executionId, blindId, status: record.status, answer: record.answer,
        sourceRefs: record.sourceRefs, evidenceRefs: record.evidenceRefs, toolTrajectory: record.toolTrajectory,
        cacheHitTokens: record.tokenUsage ? record.tokenUsage.promptCacheHitTokens ?? null : null,
        cacheMissTokens: record.tokenUsage ? record.tokenUsage.promptCacheMissTokens ?? null : null,
        tokenUsage: record.tokenUsage, providerUsage: record.providerUsage, rawClientLatencyMs: record.rawClientLatencyMs,
        estimatedCostUsd: record.estimatedCostUsd, pedagogyScore: score(pedagogyReview), evidenceScore: score(evidenceReview),
        combinedScore: score(pedagogyReview) + score(evidenceReview), reviewerReasons: [pedagogyReview.reason, evidenceReview.reason], attempts,
      };
    });
    const best = Math.max(...arms.map((item) => item.combinedScore));
    const winners = arms.filter((item) => item.combinedScore === best);
    return {
      caseId: testCase.caseId, scenario: testCase.scenario, variant: testCase.variant, exposureClass: testCase.exposureClass, input: testCase.input, arms,
      winner: winners.length === 1 ? winners[0]!.arm : "TIE",
      winnerReason: winners.map((item) => `${item.arm}: ${item.reviewerReasons.join(" ")}`).join(" | "),
      demonstratedLearningEffectiveness: "NOT_MEASURED" as const,
    };
  });
  const armSummary = Object.fromEntries(BENCHMARK_ARMS.map((arm) => {
    const values = reportCases.flatMap((item) => item.arms.filter((candidate) => candidate.arm === arm));
    const average = (items: readonly number[]) => items.reduce((total, item) => total + item, 0) / items.length;
    return [arm, {
      averagePedagogyScore: average(values.map((item) => item.pedagogyScore)),
      averageEvidenceScore: average(values.map((item) => item.evidenceScore)),
      averageLatencyMs: average(values.map((item) => item.rawClientLatencyMs)),
      knownTokenSubtotal: values.reduce((total, item) => total + (item.tokenUsage?.totalTokens ?? 0), 0),
      tokenCoverage: values.filter((item) => item.tokenUsage).length,
      knownCostSubtotalUsd: values.reduce((total, item) => total + (item.estimatedCostUsd ?? 0), 0),
      totalEstimatedCostUsd: values.every((item) => item.estimatedCostUsd !== null) ? values.reduce((total, item) => total + item.estimatedCostUsd!, 0) : null,
      costCoverage: values.filter((item) => item.estimatedCostUsd !== null).length,
      wins: reportCases.filter((item) => item.winner === arm).length,
    }];
  })) as Readonly<Record<BenchmarkArm, { readonly averagePedagogyScore: number; readonly averageEvidenceScore: number; readonly averageLatencyMs: number; readonly knownTokenSubtotal: number; readonly tokenCoverage: number; readonly knownCostSubtotalUsd: number; readonly totalEstimatedCostUsd: number | null; readonly costCoverage: number; readonly wins: number }>>;
  const exposureStrata = Object.fromEntries((["KNOWN_FIT", "NOVEL_GENERALIZATION", "CAPABILITY_BOUNDARY"] as const).map((exposureClass) => [exposureClass, {
    cases: reportCases.filter((item) => item.exposureClass === exposureClass).length,
    wins: Object.fromEntries(BENCHMARK_ARMS.map((arm) => [arm, reportCases.filter((item) => item.exposureClass === exposureClass && item.winner === arm).length])),
  }]));
  return {
    schemaVersion: "1.0.0" as const, run: options.run, generatedAt: options.generatedAt,
    firstAttempts: options.records.filter((item) => item.attemptKind === "FIRST").length,
    infrastructureReplacements: options.records.filter((item) => item.attemptKind === "INFRASTRUCTURE_REPLACEMENT").length,
    reviewLocks: { pedagogy: options.pedagogyLock, evidence: options.evidenceLock }, cases: reportCases, armSummary, exposureStrata,
    summary: {
      answerQuality: Object.fromEntries(BENCHMARK_ARMS.map((arm) => [arm, armSummary[arm].averagePedagogyScore])),
      productValue: Object.fromEntries(BENCHMARK_ARMS.map((arm) => [arm, { evidenceScore: armSummary[arm].averageEvidenceScore, wins: armSummary[arm].wins, latencyMs: armSummary[arm].averageLatencyMs, costUsd: armSummary[arm].totalEstimatedCostUsd, knownCostSubtotalUsd: armSummary[arm].knownCostSubtotalUsd, costCoverage: armSummary[arm].costCoverage }])),
    },
    demonstratedLearningEffectiveness: "NOT_MEASURED" as const,
  };
}

export function createValueBenchmarkPublicationSummary(report: ReturnType<typeof createValueBenchmarkReport>) {
  return {
    schemaVersion: "1.0.0" as const,
    runId: report.run.runId,
    generatedAt: report.generatedAt,
    firstAttempts: report.firstAttempts,
    infrastructureReplacements: report.infrastructureReplacements,
    armSummary: report.armSummary,
    exposureStrata: report.exposureStrata,
    summary: report.summary,
    cases: report.cases.map(({ caseId, scenario, variant, exposureClass, winner, demonstratedLearningEffectiveness }) => ({ caseId, scenario, variant, exposureClass, winner, demonstratedLearningEffectiveness })),
    demonstratedLearningEffectiveness: "NOT_MEASURED" as const,
  };
}

export function benchmarkSha256(value: string): string {
  return sha256(value);
}
