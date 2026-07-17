import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { init, parse } from "es-module-lexer";
import { buildBenchmarkExecutionPlan, validateBenchmarkCases, type BenchmarkCase } from "./index";
import { createBenchmarkCaseComposition } from "./preparation";

export interface FrozenAssetDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly lines?: number;
  readonly lineSha256?: readonly string[];
}

export interface ExecutableSourceFileDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ExecutableSourceSnapshot {
  readonly schemaVersion: "1.0.0";
  readonly entrypoints: readonly string[];
  readonly supportFiles: readonly string[];
  readonly files: readonly ExecutableSourceFileDescriptor[];
  readonly closureSha256: string;
}

export const VALUE_BENCHMARK_EXECUTABLE_ENTRYPOINTS = [
  "scripts/agent-gateway-server.ts",
  "scripts/value-benchmark-manifest.ts",
  "scripts/value-benchmark-review.ts",
  "scripts/value-benchmark.ts",
] as const;

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
  readonly executableSnapshot: ExecutableSourceSnapshot;
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

function normalizedRepositoryPath(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, path);
  const repositoryRelative = relative(absoluteRoot, absolutePath);
  if (!repositoryRelative || repositoryRelative === ".." || repositoryRelative.startsWith(`..${sep}`) || isAbsolute(repositoryRelative)) {
    throw new Error(`BENCHMARK_EXECUTABLE_PATH_OUTSIDE_ROOT: ${path}`);
  }
  return repositoryRelative.split(sep).join("/");
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"] as const;

async function resolveLocalModule(root: string, importer: string, specifier: string): Promise<string> {
  const base = resolve(root, dirname(importer), specifier);
  const extension = extname(base);
  const candidates = extension
    ? [
      base,
      ...extension === ".js" ? [base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx"] : [],
      ...extension === ".mjs" ? [base.slice(0, -4) + ".mts"] : [],
      ...extension === ".cjs" ? [base.slice(0, -4) + ".cts"] : [],
    ]
    : [base, ...SOURCE_EXTENSIONS.map((candidateExtension) => `${base}${candidateExtension}`), ...SOURCE_EXTENSIONS.map((candidateExtension) => resolve(base, `index${candidateExtension}`))];
  for (const candidate of candidates) {
    const path = normalizedRepositoryPath(root, candidate);
    if (await isFile(resolve(root, path))) return path;
  }
  throw new Error(`BENCHMARK_EXECUTABLE_IMPORT_UNRESOLVED: ${importer} -> ${specifier}`);
}

async function localModuleSpecifiers(path: string, source: string): Promise<readonly string[]> {
  await init;
  const [imports] = parse(source, path);
  if (imports.some(({ d, n }) => d >= 0 && n === undefined)) throw new Error(`BENCHMARK_EXECUTABLE_DYNAMIC_IMPORT_NON_LITERAL: ${path}`);
  return [...new Set(imports.flatMap(({ n }) => n?.startsWith(".") ? [n] : []))].sort();
}

function canonicalExecutableSnapshotHash(snapshot: Omit<ExecutableSourceSnapshot, "closureSha256">): string {
  return sha256(new TextEncoder().encode(JSON.stringify(snapshot)));
}

/** Creates the exact deterministic local source closure for executable benchmark entrypoints. */
export async function createExecutableSourceSnapshot(root: string, entrypoints: readonly string[], supportFiles: readonly string[]): Promise<ExecutableSourceSnapshot> {
  const normalizedEntrypoints = [...new Set(entrypoints.map((path) => normalizedRepositoryPath(root, path)))].sort();
  const normalizedSupportFiles = [...new Set(supportFiles.map((path) => normalizedRepositoryPath(root, path)))].sort();
  const pending = [...normalizedEntrypoints];
  const closure = new Set<string>();
  while (pending.length > 0) {
    const path = pending.shift()!;
    if (closure.has(path)) continue;
    const absolutePath = resolve(root, path);
    if (!(await isFile(absolutePath))) throw new Error(`BENCHMARK_EXECUTABLE_FILE_MISSING: ${path}`);
    closure.add(path);
    if (extname(path) === ".json") continue;
    const source = await readFile(absolutePath, "utf8");
    const dependencies = await Promise.all((await localModuleSpecifiers(path, source)).map((specifier) => resolveLocalModule(root, path, specifier)));
    for (const dependency of dependencies.sort()) if (!closure.has(dependency)) pending.push(dependency);
    pending.sort();
  }
  for (const path of normalizedSupportFiles) {
    if (!(await isFile(resolve(root, path)))) throw new Error(`BENCHMARK_EXECUTABLE_FILE_MISSING: ${path}`);
    closure.add(path);
  }
  const files = await Promise.all([...closure].sort().map(async (path) => {
    const bytes = await readFile(resolve(root, path));
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
  }));
  const snapshot = { schemaVersion: "1.0.0" as const, entrypoints: normalizedEntrypoints, supportFiles: normalizedSupportFiles, files };
  return { ...snapshot, closureSha256: canonicalExecutableSnapshotHash(snapshot) };
}

export async function createValueBenchmarkExecutableSourceSnapshot(root: string): Promise<ExecutableSourceSnapshot> {
  const rootFiles = await readdir(root);
  const supportFiles = ["package.json", "package-lock.json", ...rootFiles.filter((path) => /^tsconfig.*\.json$/u.test(path))];
  return createExecutableSourceSnapshot(root, VALUE_BENCHMARK_EXECUTABLE_ENTRYPOINTS, supportFiles);
}

function assertExecutableSnapshot(expected: ExecutableSourceSnapshot, actual: ExecutableSourceSnapshot): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("BENCHMARK_EXECUTABLE_SNAPSHOT_MISMATCH");
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

export async function loadAndVerifyValueBenchmarkExperiment(root: string, manifestPath: string, options: { readonly verifyRepositoryPolicy?: boolean } = {}): Promise<{
  readonly manifest: ValueBenchmarkExperimentManifest;
  readonly manifestBytes: Uint8Array;
  readonly cases: readonly BenchmarkCase[];
}> {
  const manifestBytes = await readFile(resolve(root, manifestPath));
  fingerprintFrozenAsset(manifestPath, manifestBytes);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ValueBenchmarkExperimentManifest;
  if (manifest.schemaVersion !== "1.0.0" || manifest.docsAuthority !== "learning-foundry-docs@260747722e8040972deceed3290bce237676f225") throw new Error("BENCHMARK_MANIFEST_AUTHORITY_INVALID");
  if (manifest.encoding.charset !== "UTF-8" || manifest.encoding.lineEnding !== "LF" || manifest.encoding.bom !== false || manifest.encoding.finalNewline !== true) throw new Error("BENCHMARK_MANIFEST_ENCODING_INVALID");
  if (manifest.executableSnapshot?.schemaVersion !== "1.0.0" || !Array.isArray(manifest.executableSnapshot.entrypoints)
    || !Array.isArray(manifest.executableSnapshot.supportFiles) || !Array.isArray(manifest.executableSnapshot.files)) {
    throw new Error("BENCHMARK_EXECUTABLE_SNAPSHOT_INVALID");
  }
  const currentExecutableSnapshot = options.verifyRepositoryPolicy === false
    ? await createExecutableSourceSnapshot(root, manifest.executableSnapshot.entrypoints, manifest.executableSnapshot.supportFiles)
    : await createValueBenchmarkExecutableSourceSnapshot(root);
  assertExecutableSnapshot(manifest.executableSnapshot, currentExecutableSnapshot);
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
  const promptConfig = JSON.parse(new TextDecoder().decode(promptBytes)) as { readonly arms?: { readonly B_FOUNDRY_POLICY_NO_TOOLS?: { readonly systemPrompt?: string } } };
  const expectedPlan = buildBenchmarkExecutionPlan(manifest.runId, cases, manifest.execution.scheduleSeed).map(({ executionId, caseId, arm, order, conversationId }) => ({ executionId, caseId, arm, order, conversationId }));
  if (manifest.execution.firstAttemptCount !== 72 || JSON.stringify(expectedPlan) !== JSON.stringify(manifest.execution.plannedExecutions)) throw new Error("BENCHMARK_MANIFEST_EXECUTION_PLAN_MISMATCH");
  if (manifest.execution.caseCompositions.length !== 24 || new Set(manifest.execution.caseCompositions.map((item) => item.caseId)).size !== 24 || cases.some((item) => !manifest.execution.caseCompositions.some((composition) => composition.caseId === item.caseId))) throw new Error("BENCHMARK_MANIFEST_CASE_COMPOSITIONS_INVALID");
  if (options.verifyRepositoryPolicy !== false) {
    const policyOnlyPrompt = promptConfig.arms?.B_FOUNDRY_POLICY_NO_TOOLS?.systemPrompt;
    if (!policyOnlyPrompt) throw new Error("BENCHMARK_POLICY_ONLY_PROMPT_MISSING");
    const authoritativeBasePrompt = `${await readFile(resolve(root, "config/agent/instructions.md"), "utf8")}\nResponse policy: ${await readFile(resolve(root, "config/agent/response-policy.json"), "utf8")}`;
    const expectedCompositions = cases.map((testCase) => {
      const composition = createBenchmarkCaseComposition({ testCase, policyOnlyPrompt, directAnswerContract: "Return only one JSON object with exactly one non-empty string field named answer.", authoritativeBasePrompt });
      return { caseId: testCase.caseId, executionPlanHash: composition.hashes.executionPlan, contextSelectionHash: composition.hashes.contextSelection, selectedProviderMessagesHash: composition.hashes.selectedProviderMessages, policyOnlySystemPromptHash: composition.hashes.policyOnlySystemPrompt, authoritativeSystemPromptHash: composition.hashes.authoritativeSystemPrompt };
    });
    if (JSON.stringify(expectedCompositions) !== JSON.stringify(manifest.execution.caseCompositions)) throw new Error("BENCHMARK_MANIFEST_CASE_COMPOSITION_HASH_MISMATCH");
    const agentEvalBytes = await readFile(resolve(root, "agent-eval/cases.jsonl"));
    const agentEvalCases = parseJsonLines<{ readonly input: string }>("agent-eval/cases.jsonl", agentEvalBytes);
    if (agentEvalCases.length !== 73) throw new Error(`BENCHMARK_AGENT_EVAL_COUNT_CHANGED: ${agentEvalCases.length}`);
    assertNoAgentEvalInputDuplicates(cases, agentEvalCases.map((item) => item.input));
    for (const snapshot of Object.values(manifest.policySnapshots)) {
      const match = snapshot.match(/^(.+)@sha256:([a-f0-9]{64})$/u);
      if (!match) continue;
      const current = await readFile(resolve(root, match[1]!));
      if (sha256(current) !== match[2]) throw new Error(`BENCHMARK_POLICY_SNAPSHOT_MISMATCH: ${match[1]}`);
    }
  }
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
  const paths = [...new Set([
    options.manifestPath,
    options.manifest.assets.cases.path,
    options.manifest.assets.reviewerCriteria.path,
    options.manifest.assets.prompts.path,
    ...options.manifest.executableSnapshot.files.map((item) => item.path),
  ])].sort();
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
