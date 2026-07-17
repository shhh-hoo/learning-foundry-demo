import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildBenchmarkExecutionPlan, validateBenchmarkCases, type BenchmarkCase } from "./index";

export interface FrozenAssetDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly lines?: number;
  readonly lineSha256?: readonly string[];
}

export interface ValueBenchmarkExperimentManifest {
  readonly schemaVersion: "1.0.0";
  readonly experimentId: string;
  readonly experimentVersion: string;
  readonly docsAuthority: "learning-foundry-docs@260747722e8040972deceed3290bce237676f225";
  readonly implementationCommit: string;
  readonly runId: string;
  readonly encoding: { readonly charset: "UTF-8"; readonly lineEnding: "LF"; readonly bom: false; readonly finalNewline: true };
  readonly assets: {
    readonly cases: FrozenAssetDescriptor;
    readonly reviewerCriteria: FrozenAssetDescriptor;
    readonly prompts: FrozenAssetDescriptor;
  };
  readonly execution: {
    readonly scheduleSeed: string;
    readonly scheduleAlgorithm: "SHA256_KEYED_SHUFFLE_BALANCED_SIX_PERMUTATIONS_V1";
    readonly providerSeed: { readonly status: "UNSUPPORTED_NOT_SENT"; readonly value: null };
    readonly provider: string;
    readonly model: string;
    readonly baseUrlOrigin: string;
    readonly thinkingMode: string;
    readonly sampling: { readonly temperature: number | null; readonly topP: number | null; readonly maxTokens: number; readonly responseFormat: "json_object" };
    readonly runtimeAdapter: string;
    readonly firstAttemptCount: 72;
    readonly plannedExecutions: readonly { readonly executionId: string; readonly caseId: string; readonly arm: string; readonly order: number; readonly conversationId: string }[];
    readonly caseCompositions: readonly {
      readonly caseId: string;
      readonly executionPlanHash: string;
      readonly contextSelectionHash: string;
      readonly selectedProviderMessagesHash: string;
      readonly policyOnlySystemPromptHash: string;
      readonly authoritativeSystemPromptHash: string;
    }[];
  };
  readonly policySnapshots: Readonly<Record<string, string>>;
  readonly livePolicy: {
    readonly automaticRetry: false;
    readonly infrastructureReplacementRequiresExplicitCommand: true;
    readonly modelQualityResampling: false;
    readonly permittedInfrastructureReplacements?: readonly string[];
    readonly requiredEnvironmentGates?: readonly string[];
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fingerprintFrozenAsset(path: string, bytes: Uint8Array): FrozenAssetDescriptor {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error(`BENCHMARK_ASSET_BOM_FORBIDDEN: ${path}`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\r")) throw new Error(`BENCHMARK_ASSET_LINE_ENDING_INVALID: ${path}`);
  if (!text.endsWith("\n")) throw new Error(`BENCHMARK_ASSET_FINAL_NEWLINE_REQUIRED: ${path}`);
  const lineBytes = text.slice(0, -1).split("\n").map((line) => new TextEncoder().encode(`${line}\n`));
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes), lines: lineBytes.length, lineSha256: lineBytes.map(sha256) };
}

function assertDescriptor(expected: FrozenAssetDescriptor, actual: FrozenAssetDescriptor): void {
  if (expected.path !== actual.path || expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256
    || expected.lines !== actual.lines || JSON.stringify(expected.lineSha256) !== JSON.stringify(actual.lineSha256)) {
    throw new Error(`BENCHMARK_ASSET_HASH_MISMATCH: ${expected.path}`);
  }
}

function parseJsonLines<T>(path: string, bytes: Uint8Array): readonly T[] {
  fingerprintFrozenAsset(path, bytes);
  const text = new TextDecoder().decode(bytes);
  try {
    return text.slice(0, -1).split("\n").map((line) => JSON.parse(line) as T);
  } catch {
    throw new Error(`BENCHMARK_ASSET_JSON_INVALID: ${path}`);
  }
}

export async function loadAndVerifyValueBenchmarkExperiment(root: string, manifestPath: string): Promise<{
  readonly manifest: ValueBenchmarkExperimentManifest;
  readonly manifestBytes: Uint8Array;
  readonly cases: readonly BenchmarkCase[];
}> {
  const manifestBytes = await readFile(resolve(root, manifestPath));
  fingerprintFrozenAsset(manifestPath, manifestBytes);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ValueBenchmarkExperimentManifest;
  if (manifest.schemaVersion !== "1.0.0" || manifest.docsAuthority !== "learning-foundry-docs@260747722e8040972deceed3290bce237676f225") throw new Error("BENCHMARK_MANIFEST_AUTHORITY_INVALID");
  if (manifest.encoding.charset !== "UTF-8" || manifest.encoding.lineEnding !== "LF" || manifest.encoding.bom !== false || manifest.encoding.finalNewline !== true) throw new Error("BENCHMARK_MANIFEST_ENCODING_INVALID");
  const caseBytes = await readFile(resolve(root, manifest.assets.cases.path));
  const criteriaBytes = await readFile(resolve(root, manifest.assets.reviewerCriteria.path));
  const promptBytes = await readFile(resolve(root, manifest.assets.prompts.path));
  assertDescriptor(manifest.assets.cases, fingerprintFrozenAsset(manifest.assets.cases.path, caseBytes));
  assertDescriptor(manifest.assets.reviewerCriteria, fingerprintFrozenAsset(manifest.assets.reviewerCriteria.path, criteriaBytes));
  assertDescriptor(manifest.assets.prompts, fingerprintFrozenAsset(manifest.assets.prompts.path, promptBytes));
  const cases = parseJsonLines<BenchmarkCase>(manifest.assets.cases.path, caseBytes);
  validateBenchmarkCases(cases);
  const criteria = parseJsonLines<{ readonly caseId: string }>(manifest.assets.reviewerCriteria.path, criteriaBytes);
  if (criteria.length !== 24 || new Set(criteria.map((item) => item.caseId)).size !== 24 || cases.some((item) => !criteria.some((criterion) => criterion.caseId === item.caseId))) throw new Error("BENCHMARK_REVIEW_CRITERIA_SET_INVALID");
  JSON.parse(new TextDecoder().decode(promptBytes));
  const expectedPlan = buildBenchmarkExecutionPlan(manifest.runId, cases, manifest.execution.scheduleSeed).map(({ executionId, caseId, arm, order, conversationId }) => ({ executionId, caseId, arm, order, conversationId }));
  if (manifest.execution.firstAttemptCount !== 72 || JSON.stringify(expectedPlan) !== JSON.stringify(manifest.execution.plannedExecutions)) throw new Error("BENCHMARK_MANIFEST_EXECUTION_PLAN_MISMATCH");
  if (manifest.execution.caseCompositions.length !== 24 || new Set(manifest.execution.caseCompositions.map((item) => item.caseId)).size !== 24 || cases.some((item) => !manifest.execution.caseCompositions.some((composition) => composition.caseId === item.caseId))) throw new Error("BENCHMARK_MANIFEST_CASE_COMPOSITIONS_INVALID");
  return { manifest, manifestBytes, cases };
}

export interface BenchmarkGitSnapshotReader {
  readHead(path: string): Promise<Uint8Array>;
  readWorktree(path: string): Promise<Uint8Array>;
  status(paths: readonly string[]): Promise<string>;
  headCommit(): Promise<string>;
  isAncestor(commit: string): Promise<boolean>;
}

/** Network execution is forbidden unless every governed experiment byte equals committed HEAD. */
export async function verifyBenchmarkGitPreflight(options: {
  readonly manifestPath: string;
  readonly manifest: ValueBenchmarkExperimentManifest;
  readonly manifestBytes: Uint8Array;
  readonly git: BenchmarkGitSnapshotReader;
}): Promise<void> {
  const paths = [options.manifestPath, options.manifest.assets.cases.path, options.manifest.assets.reviewerCriteria.path, options.manifest.assets.prompts.path];
  await options.git.headCommit();
  if (!(await options.git.isAncestor(options.manifest.implementationCommit))) throw new Error("BENCHMARK_IMPLEMENTATION_COMMIT_MISMATCH");
  if ((await options.git.status(paths)).trim()) throw new Error("BENCHMARK_GOVERNED_ASSETS_DIRTY");
  for (const path of paths) {
    const current = path === options.manifestPath ? options.manifestBytes : await options.git.readWorktree(path);
    if (sha256(await options.git.readHead(path)) !== sha256(current)) throw new Error(`BENCHMARK_HEAD_BYTES_MISMATCH: ${path}`);
  }
}

export function assertNoAgentEvalInputDuplicates(cases: readonly BenchmarkCase[], agentEvalInputs: readonly string[]): void {
  const normalized = new Set(agentEvalInputs.map((item) => item.normalize("NFC")));
  const duplicate = cases.find((item) => normalized.has(item.input.normalize("NFC")));
  if (duplicate) throw new Error(`BENCHMARK_AGENT_EVAL_INPUT_DUPLICATE: ${duplicate.caseId}`);
}
