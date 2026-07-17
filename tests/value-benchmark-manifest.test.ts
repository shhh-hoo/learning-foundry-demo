import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BENCHMARK_SCENARIOS, buildBenchmarkExecutionPlan, type BenchmarkCase } from "../src/value-benchmark";
import {
  assertNoAgentEvalInputDuplicates,
  createExecutableSourceSnapshot,
  fingerprintFrozenAsset,
  loadAndVerifyValueBenchmarkExperiment,
  verifyBenchmarkGitPreflight,
  type ValueBenchmarkExperimentManifest,
} from "../src/value-benchmark/experiment-manifest";

const cases: readonly BenchmarkCase[] = BENCHMARK_SCENARIOS.flatMap((scenario, scenarioIndex) => [1, 2, 3].map((variant) => ({
  schemaVersion: "1.0.0" as const,
  caseId: `VB-S${String(scenarioIndex + 1).padStart(2, "0")}-V${variant}`,
  scenario,
  variant,
  exposureClass: variant === 1 ? "KNOWN_FIT" as const : variant === 2 ? "NOVEL_GENERALIZATION" as const : "CAPABILITY_BOUNDARY" as const,
  input: `Exact case ${scenarioIndex + 1}.${variant}`,
  messages: [{ role: "user" as const, content: `Exact case ${scenarioIndex + 1}.${variant}` }],
})));

describe("value benchmark experiment manifest", () => {
  it("verifies the committed PR6 assets and preserves the 73-case AgentEval suite", async () => {
    const root = join(import.meta.dirname, "..");
    const loaded = await loadAndVerifyValueBenchmarkExperiment(root, "config/value-benchmark/run-manifests/pr6-value-benchmark.json");
    expect(loaded.manifest.schemaVersion).toBe("1.1.0");
    expect(loaded.cases.map((item) => item.caseId)).toEqual(BENCHMARK_SCENARIOS.flatMap((_, scenarioIndex) => [1, 2, 3].map((variant) => `VB-S${String(scenarioIndex + 1).padStart(2, "0")}-V${variant}`)));
    expect(loaded.manifest.execution.plannedExecutions).toHaveLength(72);
    expect(loaded.manifest.executableSnapshot.files.map((item) => item.path)).toEqual(expect.arrayContaining([
      "src/agent/agenteval-target.ts",
      "src/agent/control-plane/execution-planner.ts",
      "src/corpus/delivery-policy.ts",
      "src/runtime/learning-capability-runtime.ts",
    ]));
  });

  it("builds a deterministic transitive source closure and detects dependency drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "value-benchmark-source-closure-"));
    await writeFile(join(root, "entry.ts"), 'import { value } from "./dependency";\nexport const result = value;\n');
    await writeFile(join(root, "dependency.ts"), "export const value = 1;\n");
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');

    const first = await createExecutableSourceSnapshot(root, ["entry.ts"], ["package.json"]);
    expect(first.files.map((item) => item.path)).toEqual(["dependency.ts", "entry.ts", "package.json"]);

    await writeFile(join(root, "dependency.ts"), "export const value = 2;\n");
    const second = await createExecutableSourceSnapshot(root, ["entry.ts"], ["package.json"]);
    expect(second.closureSha256).not.toBe(first.closureSha256);

    await writeFile(join(root, "entry.ts"), 'const dependency = "./dependency";\nexport const result = import(dependency);\n');
    await expect(createExecutableSourceSnapshot(root, ["entry.ts"], ["package.json"])).rejects.toThrow("BENCHMARK_EXECUTABLE_DYNAMIC_IMPORT_NON_LITERAL");
  });

  it("freezes asset bytes, per-line hashes, authority, and all 72 planned executions", async () => {
    const root = await mkdtemp(join(tmpdir(), "value-benchmark-manifest-"));
    await mkdir(join(root, "config"), { recursive: true });
    const casePath = "config/cases.jsonl";
    const criteriaPath = "config/criteria.jsonl";
    const promptPath = "config/prompts.json";
    await writeFile(join(root, casePath), `${cases.map((item) => JSON.stringify(item)).join("\n")}\n`);
    await writeFile(join(root, criteriaPath), `${cases.map((item) => JSON.stringify({ caseId: item.caseId })).join("\n")}\n`);
    await writeFile(join(root, promptPath), `${JSON.stringify({ A: "prompt-a", B: "prompt-b" })}\n`);
    const descriptor = async (path: string) => fingerprintFrozenAsset(path, await readFile(join(root, path)));
    const runId = "pr6-frozen-run";
    const scheduleSeed = "seeded-schedule";
    await writeFile(join(root, "entry.ts"), "export const benchmark = true;\n");
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    const executableSnapshot = await createExecutableSourceSnapshot(root, ["entry.ts"], ["package.json"]);
    const manifest: ValueBenchmarkExperimentManifest = {
      schemaVersion: "1.1.0", experimentId: "foundry-value", experimentVersion: "1.0.0",
      docsAuthority: "learning-foundry-docs@260747722e8040972deceed3290bce237676f225", implementationCommit: "abc123", runId,
      encoding: { charset: "UTF-8", lineEnding: "LF", bom: false, finalNewline: true },
      assets: { cases: await descriptor(casePath), reviewerCriteria: await descriptor(criteriaPath), prompts: await descriptor(promptPath) },
      execution: {
        scheduleSeed, scheduleAlgorithm: "SHA256_KEYED_SHUFFLE_BALANCED_SIX_PERMUTATIONS_V1", providerSeed: { status: "UNSUPPORTED_NOT_SENT", value: null },
        provider: "deepseek", model: "deepseek-chat", baseUrlOrigin: "https://api.deepseek.com", thinkingMode: "disabled",
        sampling: { temperature: null, topP: null, maxTokens: 1800, responseFormat: "json_object" }, runtimeAdapter: "LegacyGatewayAgentEvalTarget", firstAttemptCount: 72,
        plannedExecutions: buildBenchmarkExecutionPlan(runId, cases, scheduleSeed).map(({ executionId, caseId, arm, order, conversationId }) => ({ executionId, caseId, arm, order, conversationId })),
        caseCompositions: cases.map((item) => ({ caseId: item.caseId, executionPlanHash: "plan", contextSelectionHash: "context", selectedProviderMessagesHash: "messages", policyOnlySystemPromptHash: "b-prompt", authoritativeSystemPromptHash: "c-prompt" })),
      },
      executableSnapshot,
      policySnapshots: { sourcePolicy: "sha256:test" },
      livePolicy: { automaticRetry: false, infrastructureReplacementRequiresExplicitCommand: true, modelQualityResampling: false },
    };
    const manifestPath = "config/manifest.json";
    await writeFile(join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
    const loaded = await loadAndVerifyValueBenchmarkExperiment(root, manifestPath, { verifyRepositoryPolicy: false });
    expect(loaded.cases).toHaveLength(24);
    expect(loaded.manifest.execution.plannedExecutions).toHaveLength(72);

    const files = new Map<string, Uint8Array>();
    for (const path of [manifestPath, casePath, criteriaPath, promptPath, ...executableSnapshot.files.map((item) => item.path)]) files.set(path, await readFile(join(root, path)));
    await expect(verifyBenchmarkGitPreflight({ manifestPath, manifest: loaded.manifest, manifestBytes: loaded.manifestBytes, git: {
      headCommit: async () => "manifest-commit", isAncestor: async (commit) => commit === "abc123", status: async () => "", readHead: async (path) => files.get(path)!, readWorktree: async (path) => files.get(path)!,
    } })).resolves.toBeUndefined();
    await expect(verifyBenchmarkGitPreflight({ manifestPath, manifest: loaded.manifest, manifestBytes: loaded.manifestBytes, git: {
      headCommit: async () => "manifest-commit", isAncestor: async () => true, status: async () => ` M ${casePath}`, readHead: async (path) => files.get(path)!, readWorktree: async (path) => files.get(path)!,
    } })).rejects.toThrow("BENCHMARK_GOVERNED_ASSETS_DIRTY");
  });

  it("rejects BOM, CRLF, missing final newline, and AgentEval input reuse", () => {
    expect(() => fingerprintFrozenAsset("bad.jsonl", Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a]))).toThrow("BENCHMARK_ASSET_BOM_FORBIDDEN");
    expect(() => fingerprintFrozenAsset("bad.jsonl", new TextEncoder().encode("{}\r\n"))).toThrow("BENCHMARK_ASSET_LINE_ENDING_INVALID");
    expect(() => fingerprintFrozenAsset("bad.jsonl", new TextEncoder().encode("{}"))).toThrow("BENCHMARK_ASSET_FINAL_NEWLINE_REQUIRED");
    expect(() => assertNoAgentEvalInputDuplicates(cases, [cases[5]!.input])).toThrow(`BENCHMARK_AGENT_EVAL_INPUT_DUPLICATE: ${cases[5]!.caseId}`);
  });

  it("rejects drift from exact case IDs, variants, and known-fit exposure limits", () => {
    expect(() => buildBenchmarkExecutionPlan("run", cases.map((item, index) => index === 0 ? { ...item, caseId: "renamed-case" } : item), "seed")).toThrow("BENCHMARK_CASE_ID_OR_VARIANT_INVALID");
    expect(() => buildBenchmarkExecutionPlan("run", cases.map((item) => item.scenario === "OPEN_EXPLANATION" && item.variant === 2 ? { ...item, exposureClass: "KNOWN_FIT" as const } : item), "seed")).toThrow("BENCHMARK_KNOWN_FIT_LIMIT_EXCEEDED");
  });
});
