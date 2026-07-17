import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AGENT_EVAL_SUITE_VERSION, gradeAgentCase, type AgentEvalCase } from "../src/agent/agenteval.ts";
import { buildAgentEvalCheckpoint } from "../src/agent/agenteval-checkpoint.ts";
import { parseAgentEvalDimension, parseAgentEvalLayer, selectAgentEvalBaseline, selectAgentEvalDimension, selectAgentEvalLayer, type AgentEvalBehaviorContract, type AgentEvalSelection } from "../src/agent/agenteval-suite.ts";
import type { AgentTrace } from "../src/agent/types.ts";
import { compareRuntimeParityCase, createRuntimeParityPlan, createRuntimeParityReport, decideRuntimeParityCommand, findRuntimeExecutionForEvalCase, type RuntimeParityExecution } from "../src/runtime/runtime-parity.ts";
import type { RuntimeExecutionRecord } from "../src/runtime/runtime-shadow.ts";
import { AgentEvalRepository } from "./lib/agent-eval-repository.ts";
import { PurposeAndRoleSeparatedFileRuntimeExecutionRecorder } from "./lib/runtime-execution-recorder.ts";
import { RuntimeParityArtifactRepository } from "./lib/runtime-parity-artifacts.ts";

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const selfComparison = args.includes("--self-comparison");
const selectionName = (process.env.RUNTIME_PARITY_SELECTION ?? "CHECKPOINT").toUpperCase();
const evalRoot = resolve(process.env.AGENT_EVAL_STORE_DIR ?? ".local-data/agent-eval-runs");
const executionRoot = resolve(process.env.RUNTIME_EXECUTION_STORE_DIR ?? ".local-data/runtime-executions");
const artifactRoot = resolve(process.env.RUNTIME_PARITY_STORE_DIR ?? ".runtime-parity-results");
const configuredShadowWaitMs = Number(process.env.RUNTIME_PARITY_SHADOW_WAIT_MS);
const shadowWaitMs = Number.isFinite(configuredShadowWaitMs) && configuredShadowWaitMs > 0 ? configuredShadowWaitMs : 5000;

async function loadCases(): Promise<{ readonly selection: AgentEvalSelection; readonly cases: readonly AgentEvalCase[] }> {
  const caseText = await readFile(new URL("../agent-eval/cases.jsonl", import.meta.url), "utf8");
  const fullCases = caseText.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as AgentEvalCase);
  if (selectionName === "CHECKPOINT") return { selection: { mode: "CHECKPOINT" }, cases: buildAgentEvalCheckpoint(fullCases) };
  if (selectionName === "BASELINE") {
    const baselineText = await readFile(new URL("../agent-eval/baselines/1.2.0-contract.jsonl", import.meta.url), "utf8");
    const baseline = baselineText.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as AgentEvalBehaviorContract);
    return { selection: { mode: "BASELINE", value: "1.2.0" }, cases: selectAgentEvalBaseline(fullCases, baseline) };
  }
  if (selectionName === "LAYER") {
    const layer = parseAgentEvalLayer(process.env.RUNTIME_PARITY_LAYER ?? process.env.AGENT_EVAL_LAYER ?? "");
    return { selection: { mode: "LAYER", value: layer }, cases: selectAgentEvalLayer(fullCases, layer) };
  }
  if (selectionName === "DIMENSION") {
    const dimension = parseAgentEvalDimension(process.env.RUNTIME_PARITY_DIMENSION ?? process.env.AGENT_EVAL_DIMENSION ?? "");
    return { selection: { mode: "DIMENSION", value: dimension }, cases: selectAgentEvalDimension(fullCases, dimension) };
  }
  throw new Error(`RUNTIME_PARITY_SELECTION_UNSUPPORTED: ${selectionName}`);
}

async function latestRunId(): Promise<string> {
  const pointer = JSON.parse(await readFile(resolve(".agent-eval-results/latest.json"), "utf8")) as { readonly evalRunId?: string };
  if (!pointer.evalRunId) throw new Error("AUTHORITATIVE_EVAL_RUN_UNAVAILABLE: latest AgentEval pointer has no run id.");
  return pointer.evalRunId;
}

function execution(record: RuntimeExecutionRecord, selected: AgentEvalSelection, graderChecks?: Readonly<Record<string, boolean>>): RuntimeParityExecution {
  return {
    suiteVersion: AGENT_EVAL_SUITE_VERSION,
    selection: selected,
    record,
    ...(record.diagnosisResult === undefined ? {} : { diagnosisResult: record.diagnosisResult }),
    ...(record.diagnosisFailureCode ? { diagnosisFailureCode: record.diagnosisFailureCode } : {}),
    ...(graderChecks ? { graderChecks } : {}),
  };
}

function gradeRecord(testCase: AgentEvalCase, record: RuntimeExecutionRecord): Readonly<Record<string, boolean>> | undefined {
  if (record.status !== "COMPLETED" || !record.finalResponse) return undefined;
  const trace: AgentTrace = {
    traceId: record.agentTraceId ?? record.executionId,
    conversationId: record.conversationId,
    inputOrigin: testCase.inputOrigin,
    runPurpose: "AGENT_EVAL",
    initialRoute: record.route,
    route: record.route,
    obligations: record.obligations,
    provider: record.providerId,
    model: record.modelId,
    thinkingMode: "disabled",
    promptVersion: "runtime-parity-observed",
    capabilityRegistryVersion: "runtime-parity-observed",
    startedAt: record.startedAt,
    completedAt: record.completedAt ?? record.startedAt,
    toolCalls: record.toolCalls,
    finalResponse: record.finalResponse,
    ...(record.tokenUsage ? { tokenUsage: record.tokenUsage } : {}),
    latencyMs: record.latencyMs ?? 0,
  };
  const diagnosisCall = [...record.toolCalls].reverse().find((call) => call.name === "run_learner_diagnosis" && call.status === "SUCCEEDED");
  const toolResults = diagnosisCall && record.diagnosisResult !== undefined ? [{ name: diagnosisCall.name, resultRef: diagnosisCall.resultRef, data: record.diagnosisResult }] : [];
  return gradeAgentCase(testCase, trace, toolResults).checks;
}

function selfReplay(record: RuntimeExecutionRecord): RuntimeExecutionRecord {
  return { ...record, executionId: `legacy-self-replay-${record.executionId}`, parentAuthoritativeExecutionId: record.executionId, role: "SHADOW", runtimeAdapterId: "legacy-self-replay" };
}

async function main(): Promise<void> {
  const runId = valueAfter("--run") ?? await latestRunId();
  const run = await new AgentEvalRepository(evalRoot).get(runId);
  if (!run) throw new Error(`AUTHORITATIVE_EVAL_RUN_UNAVAILABLE: ${runId}`);
  const selected = await loadCases();
  if (!isDeepStrictEqual(run.selection, selected.selection)) throw new Error(`EVAL_SELECTION_MISMATCH: run=${JSON.stringify(run.selection)} requested=${JSON.stringify(selected.selection)}`);

  const timestamp = new Date().toISOString();
  const reportId = `runtime-parity-${timestamp.replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
  const plan = createRuntimeParityPlan(`${reportId}-plan`, run.suiteVersion, selected.selection, selected.cases, timestamp);
  const records = new PurposeAndRoleSeparatedFileRuntimeExecutionRecorder(executionRoot);
  const authoritativeRecords = await records.list("AGENT_EVAL", "AUTHORITATIVE");
  const evalCaseById = new Map(run.cases.map((item) => [item.caseId, item]));
  const contractCaseById = new Map(selected.cases.map((item) => [item.caseId, item]));
  const authoritativeByCaseId = new Map(plan.cases.map((testCase) => {
    const evalCase = evalCaseById.get(testCase.caseId);
    const record = findRuntimeExecutionForEvalCase(authoritativeRecords, runId, testCase.caseId, evalCase?.agentTraceId);
    return [testCase.caseId, record] as const;
  }));
  const shadowWait = selfComparison
    ? { records: [], pendingAuthoritativeExecutionIds: [], absentAuthoritativeExecutionIds: [] }
    : await records.waitForTerminalShadows(
        "AGENT_EVAL",
        [...authoritativeByCaseId.values()].filter((record): record is RuntimeExecutionRecord => record !== null).map((record) => record.executionId),
        { timeoutMs: shadowWaitMs },
      );
  const shadowRecords = shadowWait.records;

  const results = plan.cases.map((testCase) => {
    const evalCase = evalCaseById.get(testCase.caseId);
    const authoritativeRecord = authoritativeByCaseId.get(testCase.caseId) ?? null;
    const authoritative = authoritativeRecord ? execution(authoritativeRecord, selected.selection, evalCase?.checks) : null;
    if (selfComparison) return compareRuntimeParityCase(testCase, authoritative, authoritativeRecord ? execution(selfReplay(authoritativeRecord), selected.selection, evalCase?.checks) : null);
    const shadowRecord = authoritativeRecord ? shadowRecords.find((record) => record.parentAuthoritativeExecutionId === authoritativeRecord.executionId) ?? null : null;
    const contractCase = contractCaseById.get(testCase.caseId);
    const candidate = shadowRecord ? execution(shadowRecord, selected.selection, contractCase ? gradeRecord(contractCase, shadowRecord) : undefined) : null;
    return compareRuntimeParityCase(testCase, authoritative, candidate);
  });

  const report = createRuntimeParityReport(reportId, plan, results, timestamp, selfComparison ? "LEGACY_SELF_COMPARISON" : "CANDIDATE_SHADOW");
  const directory = await new RuntimeParityArtifactRepository(artifactRoot).save(report);
  console.log(`Runtime parity report ${reportId} (${report.comparisonMode}) written to ${directory}.`);
  console.log(`Coverage ${report.coverage.status}: ${report.coverage.executedCases}/${report.coverage.plannedCases}; exact=${report.counts.EXACT_MATCH}, reviewRequired=${report.counts.REVIEW_REQUIRED}, regression=${report.counts.REGRESSION}, notExecuted=${report.counts.NOT_EXECUTED}, infrastructure=${report.counts.INFRASTRUCTURE_FAILURE}.`);
  console.log(`Quality: match=${report.qualityCounts.QUALITY_MATCH}, improvement=${report.qualityCounts.CANDIDATE_IMPROVEMENT}, candidateRegression=${report.qualityCounts.CANDIDATE_REGRESSION}, sharedFailure=${report.qualityCounts.SHARED_QUALITY_FAILURE}, notEvaluated=${report.qualityCounts.NOT_EVALUATED}.`);
  console.log(`Operational: match=${report.operationalCounts.OPERATIONAL_MATCH}, difference=${report.operationalCounts.OPERATIONAL_DIFFERENCE}, notEvaluated=${report.operationalCounts.NOT_EVALUATED}.`);
  if (!selfComparison) {
    const statusCount = (status: RuntimeExecutionRecord["status"]): number => shadowRecords.filter((record) => record.status === status).length;
    console.log(`Shadow evidence: completed=${statusCount("COMPLETED")}, pending=${statusCount("RUNNING")}, timedOut=${statusCount("TIMED_OUT")}, failed=${statusCount("FAILED")}, notConfigured=${statusCount("NOT_CONFIGURED")}, absent=${shadowWait.absentAuthoritativeExecutionIds.length}.`);
    if (shadowWait.pendingAuthoritativeExecutionIds.length > 0) console.error(`SHADOW_EVIDENCE_PENDING_TIMEOUT: ${shadowWait.pendingAuthoritativeExecutionIds.join(",")}`);
    if (shadowWait.absentAuthoritativeExecutionIds.length > 0) console.error(`CANDIDATE_EVIDENCE_ABSENT: ${shadowWait.absentAuthoritativeExecutionIds.join(",")}`);
  }

  const authoritativeAvailable = results.some((result) => result.authoritative !== null);
  const candidateAvailable = results.some((result) => result.candidate !== null);
  const decision = decideRuntimeParityCommand(report, { authoritativeAvailable, candidateAvailable, selfComparison });
  if (decision.exitCode === 0) console.log(decision.message);
  else { console.error(decision.message); process.exitCode = decision.exitCode; }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 5; });
