import { requireNonEmptyAgentEvalSelection, type AgentEvalSelection } from "../agent/agenteval-suite";
import type { AgentEvalCase } from "../agent/agenteval";
import type { RuntimeExecutionRecord } from "./runtime-shadow";

export const RUNTIME_PARITY_SCHEMA_VERSION = "1.0.0" as const;

export type RuntimeParityClassification =
  | "EXACT_MATCH"
  | "ACCEPTABLE_DOCUMENTED_DIFFERENCE"
  | "REGRESSION"
  | "NOT_EXECUTED"
  | "INFRASTRUCTURE_FAILURE";

export interface RuntimeParityCase {
  readonly caseId: string;
  readonly suiteVersion: string;
  readonly selection: AgentEvalSelection;
  readonly requiredTools: readonly string[];
  readonly forbiddenTools: readonly string[];
}

export interface RuntimeParityPlan {
  readonly schemaVersion: typeof RUNTIME_PARITY_SCHEMA_VERSION;
  readonly planId: string;
  readonly suiteVersion: string;
  readonly selection: AgentEvalSelection;
  readonly cases: readonly RuntimeParityCase[];
  readonly createdAt: string;
}

export interface RuntimeParityExecution {
  readonly suiteVersion: string;
  readonly selection: AgentEvalSelection;
  readonly record: RuntimeExecutionRecord;
  readonly diagnosisResult?: unknown;
  readonly diagnosisFailureCode?: string;
  readonly graderChecks?: Readonly<Record<string, boolean>>;
}

export type RuntimeParityDifferenceSeverity = "DOCUMENTED" | "REGRESSION";

export interface RuntimeParityDifference {
  readonly field: string;
  readonly severity: RuntimeParityDifferenceSeverity;
  readonly authoritative: unknown;
  readonly candidate: unknown;
  readonly message: string;
}

export interface RuntimeParityCaseResult {
  readonly caseId: string;
  readonly classification: RuntimeParityClassification;
  readonly authoritative: RuntimeParityExecution | null;
  readonly candidate: RuntimeParityExecution | null;
  readonly differences: readonly RuntimeParityDifference[];
}

export interface RuntimeParityCoverage {
  readonly plannedCases: number;
  readonly executedCases: number;
  readonly status: "UNPLANNED" | "NOT_RUN" | "PARTIAL" | "COMPLETE";
  readonly coverageComplete: boolean;
}

export interface RuntimeParityReport {
  readonly schemaVersion: typeof RUNTIME_PARITY_SCHEMA_VERSION;
  readonly reportId: string;
  readonly comparisonMode: "CANDIDATE_SHADOW" | "LEGACY_SELF_COMPARISON";
  readonly plan: RuntimeParityPlan;
  readonly results: readonly RuntimeParityCaseResult[];
  readonly counts: Readonly<Record<RuntimeParityClassification, number>>;
  readonly coverage: RuntimeParityCoverage;
  readonly fullSuiteCoverageComplete: boolean;
  readonly createdAt: string;
}

export function createRuntimeParityPlan(
  planId: string,
  suiteVersion: string,
  selection: AgentEvalSelection,
  selectedCases: readonly AgentEvalCase[],
  createdAt = new Date().toISOString(),
): RuntimeParityPlan {
  const cases = requireNonEmptyAgentEvalSelection(selection, selectedCases);
  return {
    schemaVersion: RUNTIME_PARITY_SCHEMA_VERSION,
    planId,
    suiteVersion,
    selection,
    cases: cases.map((testCase) => ({
      caseId: testCase.caseId,
      suiteVersion,
      selection,
      requiredTools: testCase.requiredTools,
      forbiddenTools: testCase.forbiddenTools,
    })),
    createdAt,
  };
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function operationalDifference(field: string, authoritative: unknown, candidate: unknown, message: string): RuntimeParityDifference | null {
  return equal(authoritative, candidate) ? null : { field, severity: "DOCUMENTED", authoritative, candidate, message };
}

function regression(field: string, authoritative: unknown, candidate: unknown, message: string): RuntimeParityDifference | null {
  return equal(authoritative, candidate) ? null : { field, severity: "REGRESSION", authoritative, candidate, message };
}

function toolShape(record: RuntimeExecutionRecord) {
  return record.toolCalls.map(({ order, name, status }) => ({ order, name, status }));
}

function successfulTools(record: RuntimeExecutionRecord): readonly string[] {
  return record.toolCalls.filter((call) => call.status === "SUCCEEDED").map((call) => call.name);
}

function requiredToolFailures(testCase: RuntimeParityCase, record: RuntimeExecutionRecord): readonly string[] {
  const actual = new Set(successfulTools(record));
  return testCase.requiredTools.filter((name) => !actual.has(name));
}

function forbiddenToolFailures(testCase: RuntimeParityCase, record: RuntimeExecutionRecord): readonly string[] {
  const actual = new Set(successfulTools(record));
  return testCase.forbiddenTools.filter((name) => actual.has(name));
}

export function compareRuntimeParityCase(
  testCase: RuntimeParityCase,
  authoritative: RuntimeParityExecution | null,
  candidate: RuntimeParityExecution | null,
): RuntimeParityCaseResult {
  if (!authoritative || !candidate) {
    return { caseId: testCase.caseId, classification: "NOT_EXECUTED", authoritative, candidate, differences: [] };
  }
  if (authoritative.record.status !== "COMPLETED" || candidate.record.status !== "COMPLETED") {
    const differences = [
      regression("execution.status", authoritative.record.status, candidate.record.status, "Both executions must complete before behavioral parity can be evaluated."),
      regression("terminalError", authoritative.record.terminalError, candidate.record.terminalError, "Terminal errors are preserved as infrastructure evidence."),
      regression("failureStage", authoritative.record.failureStage, candidate.record.failureStage, "Failure stages are preserved as infrastructure evidence."),
    ].filter((item): item is RuntimeParityDifference => item !== null);
    return { caseId: testCase.caseId, classification: "INFRASTRUCTURE_FAILURE", authoritative, candidate, differences };
  }

  const authoritativeRequired = requiredToolFailures(testCase, authoritative.record);
  const candidateRequired = requiredToolFailures(testCase, candidate.record);
  const authoritativeForbidden = forbiddenToolFailures(testCase, authoritative.record);
  const candidateForbidden = forbiddenToolFailures(testCase, candidate.record);
  const differences = [
    regression("caseId", authoritative.record.caseId, candidate.record.caseId, "Both records must belong to the same case."),
    regression("suiteVersion", authoritative.suiteVersion, candidate.suiteVersion, "Suite versions must match."),
    regression("selection", authoritative.selection, candidate.selection, "Selection modes and values must match."),
    regression("route", authoritative.record.route, candidate.record.route, "The candidate must preserve route behavior."),
    regression("obligations", authoritative.record.obligations, candidate.record.obligations, "The candidate must preserve policy obligations."),
    regression("requiredTools", authoritativeRequired, candidateRequired, "The candidate must satisfy the same required-tool contract."),
    regression("forbiddenTools", authoritativeForbidden, candidateForbidden, "The candidate must satisfy the same forbidden-tool contract."),
    regression("toolCalls", toolShape(authoritative.record), toolShape(candidate.record), "Tool order, names, and statuses must match."),
    regression("sourceRefs", authoritative.record.sourceRefs, candidate.record.sourceRefs, "Source references must match."),
    regression("evidenceRefs", authoritative.record.evidenceRefs, candidate.record.evidenceRefs, "Evidence references must match."),
    regression("diagnosisTracePresent", Boolean(authoritative.record.diagnosisTraceId), Boolean(candidate.record.diagnosisTraceId), "Diagnosis trace presence must match; trace identifiers are execution-local."),
    regression("diagnosisResult", authoritative.diagnosisResult ?? authoritative.record.diagnosisResult, candidate.diagnosisResult ?? candidate.record.diagnosisResult, "Diagnosis results must match."),
    regression("diagnosisFailureCode", authoritative.diagnosisFailureCode ?? authoritative.record.diagnosisFailureCode, candidate.diagnosisFailureCode ?? candidate.record.diagnosisFailureCode, "Diagnosis failure outcomes must match."),
    regression("finalResponseStatus", authoritative.record.finalResponseStatus, candidate.record.finalResponseStatus, "Final response statuses must match."),
    regression("graderChecks", authoritative.graderChecks, candidate.graderChecks, "The existing AgentEval grader map must match."),
    regression("completeness", authoritative.record.completeness, candidate.record.completeness, "Trace, response, and tool-evidence completeness must match."),
    regression("terminalError", authoritative.record.terminalError, candidate.record.terminalError, "Terminal outcomes must match."),
    regression("failureStage", authoritative.record.failureStage, candidate.record.failureStage, "Failure stages must match."),
    operationalDifference("latencyMs", authoritative.record.latencyMs, candidate.record.latencyMs, "Latency is execution-specific and is reported without changing behavioral parity."),
    operationalDifference("tokenUsage", authoritative.record.tokenUsage, candidate.record.tokenUsage, "Usage is execution-specific and missing values remain explicit."),
    operationalDifference("estimatedCostUsd", authoritative.record.estimatedCostUsd, candidate.record.estimatedCostUsd, "Cost is execution-specific and missing values remain explicit."),
  ].filter((item): item is RuntimeParityDifference => item !== null);

  const classification = differences.some((item) => item.severity === "REGRESSION")
    ? "REGRESSION"
    : differences.length
      ? "ACCEPTABLE_DOCUMENTED_DIFFERENCE"
      : "EXACT_MATCH";
  return { caseId: testCase.caseId, classification, authoritative, candidate, differences };
}

export function summarizeRuntimeParityCoverage(plannedCases: number, executedCases: number): RuntimeParityCoverage {
  const status = plannedCases === 0 ? "UNPLANNED" : executedCases === 0 ? "NOT_RUN" : executedCases < plannedCases ? "PARTIAL" : "COMPLETE";
  return { plannedCases, executedCases, status, coverageComplete: status === "COMPLETE" };
}

export function createRuntimeParityReport(
  reportId: string,
  plan: RuntimeParityPlan,
  results: readonly RuntimeParityCaseResult[],
  createdAt = new Date().toISOString(),
  comparisonMode: RuntimeParityReport["comparisonMode"] = "CANDIDATE_SHADOW",
): RuntimeParityReport {
  const ordered = [...results].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const classifications: readonly RuntimeParityClassification[] = ["EXACT_MATCH", "ACCEPTABLE_DOCUMENTED_DIFFERENCE", "REGRESSION", "NOT_EXECUTED", "INFRASTRUCTURE_FAILURE"];
  const counts = Object.fromEntries(classifications.map((classification) => [classification, ordered.filter((result) => result.classification === classification).length])) as Record<RuntimeParityClassification, number>;
  const executed = ordered.filter((result) => result.classification !== "NOT_EXECUTED").length;
  const coverage = summarizeRuntimeParityCoverage(plan.cases.length, executed);
  return {
    schemaVersion: RUNTIME_PARITY_SCHEMA_VERSION,
    reportId,
    comparisonMode,
    plan,
    results: ordered,
    counts,
    coverage,
    fullSuiteCoverageComplete: plan.selection.mode === "FULL" && coverage.coverageComplete,
    createdAt,
  };
}
