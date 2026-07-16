import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_EVAL_SUITE_VERSION, gradeAgentCase, type AgentEvalCase, type AgentEvalToolResult } from "../src/agent/agenteval.ts";
import { buildAgentEvalCheckpoint } from "../src/agent/agenteval-checkpoint.ts";
import { buildAgentEvalReliabilitySprint } from "../src/agent/agenteval-reliability.ts";
import { buildAgentEvalSuitePlan, parseAgentEvalDimension, parseAgentEvalLayer, selectAgentEvalBaseline, selectAgentEvalDimension, selectAgentEvalLayer, validateAgentEvalSuite, type AgentEvalBehaviorContract } from "../src/agent/agenteval-suite.ts";
import { AGENT_PROMPT_VERSION, buildAgentSystemPrompt } from "../src/agent/run-agent.ts";
import type { AgentTrace, TokenUsage } from "../src/agent/types.ts";
import { AgentEvalRepository, type AgentEvalEligibility, type AgentEvalRunSelection, type PersistedAgentEvalCase, type PersistedAgentEvalRun } from "./lib/agent-eval-repository.ts";

interface Price { readonly cacheHitInput: number; readonly cacheMissInput: number; readonly output: number }
const gateway = process.env.AGENT_GATEWAY_URL ?? "http://127.0.0.1:4176";
const rootDirectory = path.resolve(process.env.AGENT_EVAL_STORE_DIR ?? ".local-data/agent-eval-runs");
const repository = new AgentEvalRepository(rootDirectory);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const estimateCost = (usage: TokenUsage | undefined, price: Price | undefined): number | null => {
  if (!usage || !price) return null;
  const hit = usage.promptCacheHitTokens ?? 0; const miss = usage.promptCacheMissTokens ?? Math.max(0, usage.promptTokens - hit);
  return (hit * price.cacheHitInput + miss * price.cacheMissInput + usage.completionTokens * price.output) / 1_000_000;
};
const pointer = async (evalRunId: string) => {
  await mkdir(".agent-eval-results", { recursive: true });
  await writeFile(".agent-eval-results/latest.json", `${JSON.stringify({ evalRunId, persistedRunPath: path.join(rootDirectory, evalRunId, "run.json") }, null, 2)}\n`, "utf8");
};
const eligibilityFor = (testCase: AgentEvalCase): AgentEvalEligibility => ({
  requiredTools: testCase.requiredTools.length > 0,
  forbiddenTools: testCase.forbiddenTools.length > 0,
  diagnosisFidelity: testCase.expectedFailureCode !== undefined,
  sourceGrounding: (testCase.requiredSourceIds?.length ?? 0) > 0,
});

let activeEvalRunId: string | null = null;
try {
  const healthResponse = await fetch(`${gateway}/health`);
  const health = await healthResponse.json() as { configured?: boolean; provider?: string; model?: string | null; thinkingMode?: string };
  if (!healthResponse.ok || !health.configured || !health.model) throw new Error("AGENT_NOT_CONFIGURED: Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL, then start the local services.");

  const startedAt = new Date().toISOString();
  const evalRunId = `agenteval-${startedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const caseFile = await readFile(new URL("../agent-eval/cases.jsonl", import.meta.url), "utf8");
  const fullCases = caseFile.trim().split(/\r?\n/).map((line) => JSON.parse(line) as AgentEvalCase);
  validateAgentEvalSuite(fullCases);
  let selection: AgentEvalRunSelection = { mode: "FULL" };
  let cases: readonly AgentEvalCase[] = fullCases;
  if (process.env.AGENT_EVAL_CHECKPOINT === "1") {
    selection = { mode: "CHECKPOINT" };
    cases = buildAgentEvalCheckpoint(fullCases);
  } else if (process.env.AGENT_EVAL_BASELINE === "1") {
    selection = { mode: "BASELINE", value: "1.2.0" };
    const baselineText = await readFile(new URL("../agent-eval/baselines/1.2.0-contract.jsonl", import.meta.url), "utf8");
    const baseline = baselineText.trim().split(/\r?\n/).map((line) => JSON.parse(line) as AgentEvalBehaviorContract);
    cases = selectAgentEvalBaseline(fullCases, baseline);
  } else if (process.env.AGENT_EVAL_RELIABILITY === "1") {
    selection = { mode: "BASELINE", value: "1.2.0-reliability-sprint" };
    cases = buildAgentEvalReliabilitySprint(fullCases);
  } else if (process.env.AGENT_EVAL_LAYER) {
    const layer = parseAgentEvalLayer(process.env.AGENT_EVAL_LAYER);
    selection = { mode: "LAYER", value: layer };
    cases = selectAgentEvalLayer(fullCases, layer);
  } else if (process.env.AGENT_EVAL_DIMENSION) {
    const dimension = parseAgentEvalDimension(process.env.AGENT_EVAL_DIMENSION);
    selection = { mode: "DIMENSION", value: dimension };
    cases = selectAgentEvalDimension(fullCases, dimension);
  }
  const pricing = JSON.parse(await readFile(new URL("../agent-eval/pricing.json", import.meta.url), "utf8")) as { perMillionTokens: Readonly<Record<string, Price>> };
  const price = pricing.perMillionTokens[health.model];
  const instructions = await readFile(new URL("../config/agent/instructions.md", import.meta.url), "utf8");
  const responsePolicy = await readFile(new URL("../config/agent/response-policy.json", import.meta.url), "utf8");
  const capabilityText = await readFile(new URL("../config/capabilities/registry.json", import.meta.url), "utf8");
  const capability = JSON.parse(capabilityText) as { version: string };
  const toolText = await readFile(new URL("../config/tools/tool-descriptions.json", import.meta.url), "utf8");
  const tools = JSON.parse(toolText) as { version: string };
  const running: PersistedAgentEvalRun = {
    schemaVersion: "1.1.0", evalRunId, runPurpose: "AGENT_EVAL", status: "RUNNING", totalPlannedCases: cases.length, selection, suitePlan: buildAgentEvalSuitePlan(fullCases), suiteVersion: AGENT_EVAL_SUITE_VERSION, caseFileHash: hash(`${caseFile}\n${cases.map((item) => item.caseId).join(",")}`),
    provider: health.provider ?? "deepseek", model: health.model, thinkingMode: health.thinkingMode ?? "unknown",
    prompt: { version: AGENT_PROMPT_VERSION, contentHash: hash(buildAgentSystemPrompt(`${instructions}\nResponse policy: ${responsePolicy}`)) }, capabilityRegistry: { version: capability.version, contentHash: hash(capabilityText) }, toolDefinitions: { version: tools.version, contentHash: hash(toolText) },
    startedAt, cases: [],
  };
  await repository.start(running); activeEvalRunId = evalRunId; await pointer(evalRunId);

  const results: PersistedAgentEvalCase[] = [];
  for (const testCase of cases) {
    const caseStarted = Date.now();
    const eligibility = eligibilityFor(testCase);
    const caseMetadata = {
      caseId: testCase.caseId,
      ...(testCase.sourceCaseId ? { sourceCaseId: testCase.sourceCaseId } : {}),
      category: testCase.category,
      ...(testCase.suiteLayers ? { suiteLayers: testCase.suiteLayers } : {}),
      ...(testCase.evaluationDimensions ? { evaluationDimensions: testCase.evaluationDimensions } : {}),
      ...(testCase.retrievalVariant ? { retrievalVariant: testCase.retrievalVariant } : {}),
      ...(testCase.diagnosisDimensions ? { diagnosisDimensions: testCase.diagnosisDimensions } : {}),
      ...(testCase.expectedCapabilityResolution ? { expectedCapabilityResolution: testCase.expectedCapabilityResolution } : {}),
    };
    const response = await fetch(`${gateway}/agent/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: `${evalRunId}-${testCase.caseId}`, inputOrigin: testCase.inputOrigin, runPurpose: "AGENT_EVAL", messages: [{ role: "user", content: testCase.input }] }) });
    const body = await response.json() as { ok?: boolean; trace?: AgentTrace; toolResults?: readonly AgentEvalToolResult[]; error?: { code?: string; message?: string } };
    let result: PersistedAgentEvalCase;
    if (!response.ok || !body.ok || !body.trace) {
      result = { ...caseMetadata, runPurpose: "AGENT_EVAL", eligibility, passed: false, checks: {}, errors: [body.error?.code ?? "AGENT_RUN_FAILED"], latencyMs: Date.now() - caseStarted, estimatedCostUsd: null, terminalError: { code: body.error?.code ?? "AGENT_RUN_FAILED", message: body.error?.message ?? "Agent run did not return a trace." } };
    } else {
      const grade = gradeAgentCase(testCase, body.trace, body.toolResults ?? []);
      result = { ...caseMetadata, runPurpose: "AGENT_EVAL", agentTraceId: body.trace.traceId, eligibility, ...grade, latencyMs: body.trace.latencyMs, tokenUsage: body.trace.tokenUsage, estimatedCostUsd: estimateCost(body.trace.tokenUsage, price) };
    }
    await repository.appendCase(evalRunId, result); results.push(result);
  }
  await repository.complete(evalRunId, new Date().toISOString()); activeEvalRunId = null;
  console.log(`AgentEval live run ${evalRunId} complete: ${results.filter((item) => item.passed).length}/${results.length} passed.`);
  if (results.some((item) => !item.passed)) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (activeEvalRunId) await repository.interrupt(activeEvalRunId, { code: "AGENT_EVAL_INTERRUPTED", message }, new Date().toISOString()).catch(() => undefined);
  console.error(activeEvalRunId ? `AgentEval live run interrupted: ${activeEvalRunId}` : "AgentEval live run not executed");
  console.error(message); process.exitCode = 1;
}
