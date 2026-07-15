import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gradeAgentCase, type AgentEvalCase, type AgentEvalToolResult } from "../src/agent/agenteval.ts";
import type { AgentTrace, TokenUsage } from "../src/agent/types.ts";
import { AgentEvalRepository, type PersistedAgentEvalCase, type PersistedAgentEvalRun } from "./lib/agent-eval-repository.ts";
import type { PersistedAgentRun } from "./lib/agent-trace-repository.ts";

interface Price { readonly cacheHitInput: number; readonly cacheMissInput: number; readonly output: number }
const gateway = process.env.AGENT_GATEWAY_URL ?? "http://127.0.0.1:4176";
const rootDirectory = path.resolve(process.env.AGENT_EVAL_STORE_DIR ?? ".local-data/agent-eval-runs");
const notExecuted = (message?: string) => { console.error("AgentEval live run not executed"); if (message) console.error(message); process.exitCode = 1; };
const estimateCost = (usage: TokenUsage | undefined, price: Price | undefined): number | null => {
  if (!usage || !price) return null;
  const hit = usage.promptCacheHitTokens ?? 0; const miss = usage.promptCacheMissTokens ?? Math.max(0, usage.promptTokens - hit);
  return (hit * price.cacheHitInput + miss * price.cacheMissInput + usage.completionTokens * price.output) / 1_000_000;
};

try {
  const healthResponse = await fetch(`${gateway}/health`);
  const health = await healthResponse.json() as { configured?: boolean; provider?: string; model?: string | null; thinkingMode?: string };
  if (!healthResponse.ok || !health.configured || !health.model) { notExecuted("Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL, then start the local services."); }
  else {
    const startedAt = new Date().toISOString();
    const evalRunId = `agenteval-${startedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const caseFile = await readFile(new URL("../agent-eval/cases.jsonl", import.meta.url), "utf8");
    const cases = caseFile.trim().split(/\r?\n/).map((line) => JSON.parse(line) as AgentEvalCase);
    const pricing = JSON.parse(await readFile(new URL("../agent-eval/pricing.json", import.meta.url), "utf8")) as { perMillionTokens: Readonly<Record<string, Price>> };
    const price = pricing.perMillionTokens[health.model];
    const results: PersistedAgentEvalCase[] = [];
    let configuration: Pick<PersistedAgentRun, "prompt" | "capabilityRegistry" | "toolDefinitions"> | null = null;
    for (const testCase of cases) {
      const caseStarted = Date.now();
      try {
        const response = await fetch(`${gateway}/agent/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: `${evalRunId}-${testCase.caseId}`, inputOrigin: testCase.inputOrigin, messages: [{ role: "user", content: testCase.input }] }) });
        const body = await response.json() as { ok?: boolean; trace?: AgentTrace; toolResults?: readonly AgentEvalToolResult[]; error?: { code?: string; message?: string } };
        if (!response.ok || !body.ok || !body.trace) {
          results.push({ caseId: testCase.caseId, category: testCase.category, passed: false, checks: {}, errors: [body.error?.code ?? "AGENT_RUN_FAILED"], latencyMs: Date.now() - caseStarted, estimatedCostUsd: null, terminalError: { code: body.error?.code ?? "AGENT_RUN_FAILED", message: body.error?.message ?? "Agent run did not return a trace." } });
          continue;
        }
        const grade = gradeAgentCase(testCase, body.trace, body.toolResults ?? []);
        const persistedResponse = await fetch(`${gateway}/agent/runs/${encodeURIComponent(body.trace.traceId)}`);
        if (persistedResponse.ok) {
          const persistedBody = await persistedResponse.json() as { trace?: PersistedAgentRun };
          if (persistedBody.trace) configuration ??= { prompt: persistedBody.trace.prompt, capabilityRegistry: persistedBody.trace.capabilityRegistry, toolDefinitions: persistedBody.trace.toolDefinitions };
        }
        results.push({ caseId: testCase.caseId, category: testCase.category, agentTraceId: body.trace.traceId, ...grade, latencyMs: body.trace.latencyMs, tokenUsage: body.trace.tokenUsage, estimatedCostUsd: estimateCost(body.trace.tokenUsage, price) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ caseId: testCase.caseId, category: testCase.category, passed: false, checks: {}, errors: ["AGENT_RUN_FAILED"], latencyMs: Date.now() - caseStarted, estimatedCostUsd: null, terminalError: { code: "AGENT_RUN_FAILED", message } });
      }
    }
    const unknown = { version: "UNKNOWN", contentHash: "UNAVAILABLE" } as const;
    const run: PersistedAgentEvalRun = {
      schemaVersion: "1.0.0", evalRunId, suiteVersion: "1.0.0", caseFileHash: createHash("sha256").update(caseFile).digest("hex"),
      provider: health.provider ?? "deepseek", model: health.model, thinkingMode: health.thinkingMode ?? "unknown",
      prompt: configuration?.prompt ?? unknown, capabilityRegistry: configuration?.capabilityRegistry ?? unknown, toolDefinitions: configuration?.toolDefinitions ?? unknown,
      startedAt, completedAt: new Date().toISOString(), cases: results,
    };
    await new AgentEvalRepository(rootDirectory).save(run);
    await mkdir(".agent-eval-results", { recursive: true });
    await writeFile(".agent-eval-results/latest.json", `${JSON.stringify({ evalRunId, persistedRunPath: path.join(rootDirectory, evalRunId, "run.json") }, null, 2)}\n`, "utf8");
    console.log(`AgentEval live run ${evalRunId} complete: ${results.filter((item) => item.passed).length}/${results.length} passed.`);
    if (results.some((item) => !item.passed)) process.exitCode = 1;
  }
} catch (error) { notExecuted(error instanceof Error ? error.message : String(error)); }
