import { readFile, writeFile } from "node:fs/promises";
import type { AgentTrace } from "../src/agent/types.ts";

interface Price { readonly cacheHitInput: number; readonly cacheMissInput: number; readonly output: number }
const raw = JSON.parse(await readFile(".agent-eval-results/latest.json", "utf8")) as { executedAt: string; provider: string; model: string; thinkingMode: string; cases: readonly { passed: boolean; errors: readonly string[]; trace?: AgentTrace }[] };
const pricing = JSON.parse(await readFile(new URL("../agent-eval/pricing.json", import.meta.url), "utf8")) as { perMillionTokens: Readonly<Record<string, Price>> };
const price = pricing.perMillionTokens[raw.model];
const traces = raw.cases.flatMap((item) => item.trace ? [item.trace] : []);
const estimatedCostUsd = price ? traces.reduce((sum, trace) => {
  const usage = trace.tokenUsage; if (!usage) return sum;
  const hit = usage.promptCacheHitTokens ?? 0; const miss = usage.promptCacheMissTokens ?? Math.max(0, usage.promptTokens - hit);
  return sum + (hit * price.cacheHitInput + miss * price.cacheMissInput + usage.completionTokens * price.output) / 1_000_000;
}, 0) : null;
const report = {
  executedAt: raw.executedAt, provider: raw.provider, model: raw.model, thinkingMode: raw.thinkingMode,
  promptVersion: traces[0]?.promptVersion ?? null, capabilityRegistryVersion: traces[0]?.capabilityRegistryVersion ?? null, toolDefinitionsVersion: "1.0.0",
  totalCases: raw.cases.length, passedCases: raw.cases.filter((item) => item.passed).length, failedCases: raw.cases.filter((item) => !item.passed).length,
  errors: raw.cases.flatMap((item, index) => item.errors.map((error) => ({ caseIndex: index, error }))),
  diagnosisFidelityFailures: raw.cases.filter((item) => item.errors.includes("diagnosisFidelity")).length,
  latencyMs: traces.reduce((sum, trace) => sum + trace.latencyMs, 0),
  tokenUsage: traces.reduce((total, trace) => ({ promptTokens: total.promptTokens + (trace.tokenUsage?.promptTokens ?? 0), completionTokens: total.completionTokens + (trace.tokenUsage?.completionTokens ?? 0), totalTokens: total.totalTokens + (trace.tokenUsage?.totalTokens ?? 0) }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  estimatedCostUsd, rawTraceFile: ".agent-eval-results/latest.json",
};
await writeFile(".agent-eval-results/report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
