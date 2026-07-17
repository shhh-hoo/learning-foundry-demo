import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LegacyGatewayAgentEvalTarget } from "../src/agent/agenteval-target.ts";
import { executeBenchmarkFirstAttempts, executeBenchmarkInfrastructureReplacement, type BenchmarkPricingSnapshot, type BenchmarkRunSnapshot } from "../src/value-benchmark/index.ts";
import { createValueBenchmarkExecutors, type FrozenBenchmarkPrompts } from "../src/value-benchmark/executors.ts";
import { loadAndVerifyValueBenchmarkExperiment, verifyBenchmarkGitPreflight, type BenchmarkGitSnapshotReader } from "../src/value-benchmark/experiment-manifest.ts";
import { FileBenchmarkEvidenceRepository } from "../src/value-benchmark/file-repository.ts";
import { createBenchmarkCaseComposition } from "../src/value-benchmark/preparation.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const manifestPath = "config/value-benchmark/run-manifests/pr6-value-benchmark.json";
const command = process.argv[2] ?? "preflight";
const text = (path: string) => readFile(resolve(root, path), "utf8");
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

const git: BenchmarkGitSnapshotReader = {
  headCommit: async () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  isAncestor: async (commit) => {
    try { execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: root, stdio: "ignore" }); return true; }
    catch { return false; }
  },
  status: async () => execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }),
  readHead: async (path) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root }),
  readWorktree: async (path) => readFile(resolve(root, path)),
};

const loaded = await loadAndVerifyValueBenchmarkExperiment(root, manifestPath);
await verifyBenchmarkGitPreflight({ manifestPath, manifest: loaded.manifest, manifestBytes: loaded.manifestBytes, git });

const promptConfig = JSON.parse(await text("config/value-benchmark/experiment.json")) as {
  readonly arms: {
    readonly A_BARE_LLM: { readonly systemPrompt: string };
    readonly B_FOUNDRY_POLICY_NO_TOOLS: { readonly systemPrompt: string };
  };
};
const prompts: FrozenBenchmarkPrompts = {
  schemaVersion: "1.0.0", directAnswerContract: "Return only one JSON object with exactly one non-empty string field named answer.",
  arms: { A_BARE_LLM: { systemPrompt: promptConfig.arms.A_BARE_LLM.systemPrompt, tools: [] }, B_FOUNDRY_POLICY_NO_TOOLS: { systemPrompt: promptConfig.arms.B_FOUNDRY_POLICY_NO_TOOLS.systemPrompt, tools: [] } },
};
const authoritativeBasePrompt = `${await text("config/agent/instructions.md")}\nResponse policy: ${await text("config/agent/response-policy.json")}`;
const compositionByCase = new Map(loaded.cases.map((testCase) => [testCase.caseId, createBenchmarkCaseComposition({ testCase, policyOnlyPrompt: promptConfig.arms.B_FOUNDRY_POLICY_NO_TOOLS.systemPrompt, directAnswerContract: prompts.directAnswerContract, authoritativeBasePrompt })]));

if (command === "preflight") {
  console.log(JSON.stringify({ ok: true, runId: loaded.manifest.runId, cases: loaded.cases.length, firstAttempts: loaded.manifest.execution.plannedExecutions.length, providerSeed: loaded.manifest.execution.providerSeed, liveExecuted: false }, null, 2));
  process.exit(0);
}

const requiredGates = {
  VALUE_BENCHMARK_LIVE: "1",
  VALUE_BENCHMARK_PROVIDER_SEED_DISPOSITION: "UNSUPPORTED_ACCEPTED",
} as const;
for (const [name, expected] of Object.entries(requiredGates)) if (process.env[name] !== expected) throw new Error(`BENCHMARK_LIVE_GATE_UNSATISFIED: ${name} must equal ${expected}.`);
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) throw new Error("BENCHMARK_LIVE_GATE_UNSATISFIED: DEEPSEEK_API_KEY is required.");
const gatewayUrl = process.env.AGENT_GATEWAY_URL?.trim() || "http://127.0.0.1:4176";
const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || loaded.manifest.execution.baseUrlOrigin;
if (new URL(baseUrl).origin !== loaded.manifest.execution.baseUrlOrigin) throw new Error("BENCHMARK_PROVIDER_ORIGIN_MISMATCH");
const target = new LegacyGatewayAgentEvalTarget(gatewayUrl);
const health = await target.health();
if (health.provider !== loaded.manifest.execution.provider || health.model !== loaded.manifest.execution.model || health.thinkingMode !== loaded.manifest.execution.thinkingMode) throw new Error("BENCHMARK_GATEWAY_MODEL_CONFIGURATION_MISMATCH");
const snapshotHash = (name: string): string | undefined => loaded.manifest.policySnapshots[name]?.match(/sha256:([a-f0-9]{64})$/u)?.[1];
if (health.baseUrlOrigin !== loaded.manifest.execution.baseUrlOrigin
  || health.maxTokens !== loaded.manifest.execution.sampling.maxTokens
  || health.responseFormat !== loaded.manifest.execution.sampling.responseFormat
  || health.agentPromptHash !== snapshotHash("agentInstructions")
  || health.responsePolicyHash !== snapshotHash("responsePolicy")
  || `sha256:${health.toolDefinitionsHash}` !== loaded.manifest.policySnapshots.runtimeToolDefinitionsSemantic
  || `sha256:${health.capabilityRegistryHash}` !== loaded.manifest.policySnapshots.runtimeCapabilityRegistrySemantic
  || health.corpusDeliveryPolicyHash !== snapshotHash("corpusDeliveryPolicy")
  || health.authoritativeAdapterId !== "legacy-deepseek-agent"
  || health.runtimeAuthority !== "LEGACY_AUTHORITATIVE") throw new Error("BENCHMARK_GATEWAY_POLICY_SNAPSHOT_MISMATCH");
if (!health.corpusReady || !health.corpusIndexVersion || !health.corpusChunkCount) throw new Error("BENCHMARK_GOVERNED_CORPUS_NOT_READY");
if (loaded.manifest.policySnapshots.governedCorpusIndex !== health.corpusIndexVersion) throw new Error("BENCHMARK_CORPUS_SNAPSHOT_NOT_FROZEN");
if (!health.agentEvalDeliveryAuthorized) throw new Error("BENCHMARK_AGENT_EVAL_DELIVERY_NOT_AUTHORIZED");
const trainerUrl = process.env.TRAINER_DIAGNOSIS_URL?.trim();
if (!trainerUrl) throw new Error("BENCHMARK_TRAINER_READINESS_URL_REQUIRED");
const trainerHealth = await fetch(`${trainerUrl.replace(/\/diagnose\/?$/u, "")}/health`, { signal: AbortSignal.timeout(5_000) });
if (!trainerHealth.ok) throw new Error("BENCHMARK_TRAINER_NOT_READY");
const executors = createValueBenchmarkExecutors({
  prompts,
  model: {
    apiKey, baseUrl, model: loaded.manifest.execution.model, thinkingMode: loaded.manifest.execution.thinkingMode === "enabled" ? "enabled" : "disabled",
    temperature: loaded.manifest.execution.sampling.temperature, topP: loaded.manifest.execution.sampling.topP, maxTokens: loaded.manifest.execution.sampling.maxTokens,
  },
  target,
  policyOnlyPreparation: (testCase) => {
    const composition = compositionByCase.get(testCase.caseId)!;
    return { systemPrompt: composition.policyOnlySystemPrompt, messages: composition.selectedMessages };
  },
  fullFoundrySystemPromptForCase: (testCase) => compositionByCase.get(testCase.caseId)!.authoritativeSystemPrompt,
});
const pricingConfig = JSON.parse(await text("agent-eval/pricing.json")) as { readonly source: string; readonly perMillionTokens: Readonly<Record<string, { readonly cacheHitInput: number; readonly cacheMissInput: number; readonly output: number }>> };
const price = pricingConfig.perMillionTokens[loaded.manifest.execution.model];
const pricing: BenchmarkPricingSnapshot | null = price ? { cacheHitInputPerMillion: price.cacheHitInput, cacheMissInputPerMillion: price.cacheMissInput, outputPerMillion: price.output, currency: "USD", source: pricingConfig.source } : null;
const repository = new FileBenchmarkEvidenceRepository(resolve(root, ".value-benchmark-results"));
const existingRun = await repository.getRun(loaded.manifest.runId);
const proposedRun: BenchmarkRunSnapshot = {
  schemaVersion: "1.0.0", runId: loaded.manifest.runId, experimentVersion: loaded.manifest.experimentVersion, experimentManifestHash: sha256(loaded.manifestBytes), caseFileHash: loaded.manifest.assets.cases.sha256,
  scheduleSeed: loaded.manifest.execution.scheduleSeed, providerSeed: loaded.manifest.execution.providerSeed, provider: loaded.manifest.execution.provider, model: loaded.manifest.execution.model,
  thinkingMode: loaded.manifest.execution.thinkingMode, sampling: loaded.manifest.execution.sampling, pricing, startedAt: new Date().toISOString(),
};
const run = existingRun ?? proposedRun;
if (existingRun && (existingRun.experimentManifestHash !== proposedRun.experimentManifestHash || existingRun.caseFileHash !== proposedRun.caseFileHash || existingRun.model !== proposedRun.model || JSON.stringify(existingRun.sampling) !== JSON.stringify(proposedRun.sampling))) throw new Error("BENCHMARK_EXISTING_RUN_CONTRACT_MISMATCH");

if (command === "run") {
  const records = await executeBenchmarkFirstAttempts({ run, cases: loaded.cases, repository, executors });
  console.log(JSON.stringify({ runId: run.runId, firstAttemptStarts: (await repository.listExecutionStarts(run.runId)).filter((item) => item.attemptKind === "FIRST").length, terminalFirstAttempts: records.filter((item) => item.attemptKind === "FIRST").length, replacements: 0 }, null, 2));
} else if (command === "replace") {
  const failedExecutionId = process.argv[3];
  if (!failedExecutionId) throw new Error("BENCHMARK_FAILED_EXECUTION_ID_REQUIRED");
  const replacement = await executeBenchmarkInfrastructureReplacement({ runId: run.runId, failedExecutionId, cases: loaded.cases, repository, executors });
  console.log(JSON.stringify(replacement, null, 2));
} else {
  throw new Error(`BENCHMARK_COMMAND_UNKNOWN: ${command}`);
}
