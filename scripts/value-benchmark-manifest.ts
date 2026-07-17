import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildBenchmarkExecutionPlan, type BenchmarkCase } from "../src/value-benchmark/index.ts";
import { fingerprintFrozenAsset, type ValueBenchmarkExperimentManifest } from "../src/value-benchmark/experiment-manifest.ts";
import { createBenchmarkCaseComposition } from "../src/value-benchmark/preparation.ts";
import { registeredAgentCapabilities } from "../src/reference-packs/registry.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const casePath = "config/value-benchmark/cases.jsonl";
const criteriaPath = "config/value-benchmark/reviewer-criteria.jsonl";
const promptPath = "config/value-benchmark/experiment.json";
const outputPath = process.argv[2] ?? "config/value-benchmark/run-manifests/pr6-value-benchmark.json";
const bytes = (path: string) => readFile(resolve(root, path));
const text = async (path: string) => (await bytes(path)).toString("utf8");
const hash = (value: Uint8Array | string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const jsonLines = async <T>(path: string) => (await text(path)).trimEnd().split("\n").map((line) => JSON.parse(line) as T);
const prompts = JSON.parse(await text(promptPath)) as { readonly arms: { readonly B_FOUNDRY_POLICY_NO_TOOLS: { readonly systemPrompt: string } } };
const cases = await jsonLines<BenchmarkCase>(casePath);
const authoritativeBasePrompt = `${await text("config/agent/instructions.md")}\nResponse policy: ${await text("config/agent/response-policy.json")}`;
const directAnswerContract = "Return only one JSON object with exactly one non-empty string field named answer.";
const compositions = new Map(cases.map((testCase) => [testCase.caseId, createBenchmarkCaseComposition({ testCase, policyOnlyPrompt: prompts.arms.B_FOUNDRY_POLICY_NO_TOOLS.systemPrompt, directAnswerContract, authoritativeBasePrompt })]));
const runId = "foundry-value-benchmark-1.0.0-live-01";
const scheduleSeed = "learning-foundry-value-benchmark-1.0.0";
const implementationCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const snapshotPaths = {
  agentInstructions: "config/agent/instructions.md", responsePolicy: "config/agent/response-policy.json", toolDefinitions: "config/tools/tool-descriptions.json",
  corpusDeliveryPolicy: "config/corpus/delivery-policy.json", capabilityRegistry: "src/reference-packs/registry.ts", routePolicy: "src/agent/route-policy.ts",
  pricing: "agent-eval/pricing.json", agentEvalCases: "agent-eval/cases.jsonl",
  benchmarkRunner: "scripts/value-benchmark.ts", benchmarkReviewRunner: "scripts/value-benchmark-review.ts", benchmarkManifestGenerator: "scripts/value-benchmark-manifest.ts",
  benchmarkCore: "src/value-benchmark/index.ts", benchmarkExecutors: "src/value-benchmark/executors.ts", benchmarkRepository: "src/value-benchmark/file-repository.ts",
  benchmarkManifestVerifier: "src/value-benchmark/experiment-manifest.ts", benchmarkPreparation: "src/value-benchmark/preparation.ts",
  gatewayServer: "scripts/agent-gateway-server.ts", gateway: "src/agent/gateway.ts", agentLoop: "src/agent/run-agent.ts", deepSeekClient: "src/agent/deepseek-client.ts",
  runtimeCoordinator: "src/runtime/runtime-shadow.ts", toolExecutor: "src/agent/tool-executor.ts", corpusRepository: "scripts/lib/corpus-repository.ts",
} as const;
const policySnapshots = Object.fromEntries(await Promise.all(Object.entries(snapshotPaths).map(async ([name, path]) => [name, `${path}@${hash(await bytes(path))}`])));
const manifest: ValueBenchmarkExperimentManifest = {
  schemaVersion: "1.0.0", experimentId: "learning-foundry-value-benchmark", experimentVersion: "1.0.0",
  docsAuthority: "learning-foundry-docs@260747722e8040972deceed3290bce237676f225", implementationCommit, runId,
  encoding: { charset: "UTF-8", lineEnding: "LF", bom: false, finalNewline: true },
  assets: { cases: fingerprintFrozenAsset(casePath, await bytes(casePath)), reviewerCriteria: fingerprintFrozenAsset(criteriaPath, await bytes(criteriaPath)), prompts: fingerprintFrozenAsset(promptPath, await bytes(promptPath)) },
  execution: {
    scheduleSeed, scheduleAlgorithm: "SHA256_KEYED_SHUFFLE_BALANCED_SIX_PERMUTATIONS_V1", providerSeed: { status: "UNSUPPORTED_NOT_SENT", value: null },
    provider: "deepseek", model: "deepseek-chat", baseUrlOrigin: "https://api.deepseek.com", thinkingMode: "disabled",
    sampling: { temperature: null, topP: null, maxTokens: 1800, responseFormat: "json_object" }, runtimeAdapter: "LegacyGatewayAgentEvalTarget/1.0.0", firstAttemptCount: 72,
    plannedExecutions: buildBenchmarkExecutionPlan(runId, cases, scheduleSeed).map(({ executionId, caseId, arm, order, conversationId }) => ({ executionId, caseId, arm, order, conversationId })),
    caseCompositions: cases.map((testCase) => {
      const composition = compositions.get(testCase.caseId)!;
      return { caseId: testCase.caseId, executionPlanHash: composition.hashes.executionPlan, contextSelectionHash: composition.hashes.contextSelection, selectedProviderMessagesHash: composition.hashes.selectedProviderMessages, policyOnlySystemPromptHash: composition.hashes.policyOnlySystemPrompt, authoritativeSystemPromptHash: composition.hashes.authoritativeSystemPrompt };
    }),
  },
  policySnapshots: {
    ...policySnapshots,
    runtimeToolDefinitionsSemantic: hash(JSON.stringify(JSON.parse(await text("config/tools/tool-descriptions.json")))),
    runtimeCapabilityRegistrySemantic: hash(JSON.stringify(registeredAgentCapabilities)),
    governedCorpusIndex: process.env.VALUE_BENCHMARK_CORPUS_INDEX_VERSION?.trim() || "NOT_AVAILABLE_NO_LIVE_RUN", externalReviewerAuthorization: "REQUIRED_BEFORE_PACKET_DELIVERY", rawArtifacts: ".value-benchmark-results/ (mode 0600, ignored)",
  },
  livePolicy: {
    automaticRetry: false, infrastructureReplacementRequiresExplicitCommand: true, modelQualityResampling: false,
    permittedInfrastructureReplacements: ["NETWORK_TRANSPORT", "TIMEOUT", "HTTP_408", "HTTP_429", "HTTP_5XX", "REQUIRED_LOCAL_SERVICE_UNAVAILABLE"],
    requiredEnvironmentGates: ["DEEPSEEK_API_KEY", "AGENT_GATEWAY_HEALTH_MATCH", "GOVERNED_CORPUS_READY", "AGENT_EVAL_DELIVERY_AUTHORIZED", "PROVIDER_SEED_DISPOSITION_ACCEPTED"],
  },
};
await mkdir(dirname(resolve(root, outputPath)), { recursive: true });
await writeFile(resolve(root, outputPath), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
console.log(`${outputPath}\nimplementation=${implementationCommit}\nfirstAttempts=${manifest.execution.plannedExecutions.length}`);
