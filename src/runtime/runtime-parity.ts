import { requireNonEmptyAgentEvalSelection, type AgentEvalSelection } from "../agent/agenteval-suite";
import type { AgentEvalCase } from "../agent/agenteval";
import type { RuntimeExecutionRecord } from "./runtime-shadow";

export const RUNTIME_PARITY_SCHEMA_VERSION = "1.0.0" as const;

export type RuntimeParityClassification =
  | "EXACT_MATCH"
  | "REVIEW_REQUIRED"
  | "REGRESSION"
  | "NOT_EXECUTED"
  | "INFRASTRUCTURE_FAILURE";

export type RuntimeBehavioralEquivalence = "EXACT_MATCH" | "BEHAVIORAL_DIFFERENCE" | "NOT_EVALUATED";
export type RuntimeOperationalClassification = "OPERATIONAL_MATCH" | "OPERATIONAL_DIFFERENCE" | "NOT_EVALUATED";
export type RuntimeGovernedQualityClassification = "QUALITY_MATCH" | "CANDIDATE_REGRESSION" | "CANDIDATE_IMPROVEMENT" | "SHARED_QUALITY_FAILURE" | "NOT_EVALUATED";
export type RuntimeQualityCheckClassification = Exclude<RuntimeGovernedQualityClassification, "NOT_EVALUATED"> | "NOT_EVALUATED";

export interface RuntimeQualityCheckResult {
  readonly authoritativePassed: boolean | null;
  readonly candidatePassed: boolean | null;
  readonly classification: RuntimeQualityCheckClassification;
}

export interface RuntimeGovernedQualityResult {
  readonly classification: RuntimeGovernedQualityClassification;
  readonly checks: Readonly<Record<string, RuntimeQualityCheckResult>>;
}

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

export type RuntimeParityDifferenceSeverity = "BEHAVIORAL" | "OPERATIONAL" | "REGRESSION";

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
  readonly behavioralEquivalence: RuntimeBehavioralEquivalence;
  readonly governedQuality: RuntimeGovernedQualityResult;
  readonly operationalImpact: { readonly classification: RuntimeOperationalClassification };
  readonly reviewRequired: boolean;
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
  readonly behavioralCounts: Readonly<Record<RuntimeBehavioralEquivalence, number>>;
  readonly qualityCounts: Readonly<Record<RuntimeGovernedQualityClassification, number>>;
  readonly operationalCounts: Readonly<Record<RuntimeOperationalClassification, number>>;
  readonly reviewRequiredCases: number;
  readonly coverage: RuntimeParityCoverage;
  readonly fullSuiteCoverageComplete: boolean;
  readonly createdAt: string;
}

export interface RuntimeParityCommandDecision {
  readonly exitCode: 0 | 1 | 2 | 3 | 4 | 6;
  readonly message: string;
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
  return equal(authoritative, candidate) ? null : { field, severity: "OPERATIONAL", authoritative, candidate, message };
}

function regression(field: string, authoritative: unknown, candidate: unknown, message: string): RuntimeParityDifference | null {
  return equal(authoritative, candidate) ? null : { field, severity: "REGRESSION", authoritative, candidate, message };
}

function behavioralDifference(field: string, authoritative: unknown, candidate: unknown, message: string): RuntimeParityDifference | null {
  return equal(authoritative, candidate) ? null : { field, severity: "BEHAVIORAL", authoritative, candidate, message };
}

function toolShape(record: RuntimeExecutionRecord) {
  return record.toolCalls.map(({ order, name, status }) => ({ order, name, status }));
}

function evidenceClass(toolName: string): string {
  if (toolName === "search_learning_resources") return "SOURCE_RETRIEVAL";
  if (toolName === "run_learner_diagnosis") return "DIAGNOSTIC_OBSERVATION";
  if (toolName === "list_capabilities" || toolName === "get_capability") return "CAPABILITY_RESOLUTION";
  return "TOOL_RESULT";
}

function evidenceLineage(record: RuntimeExecutionRecord) {
  const callsByResult = new Map(record.toolCalls.map((call) => [call.resultRef, call]));
  return record.evidenceRefs.map((reference) => {
    const call = callsByResult.get(reference);
    return call
      ? { evidenceClass: evidenceClass(call.name), producingTool: call.name, toolOrder: call.order, toolStatus: call.status }
      : { evidenceClass: "UNRESOLVED", producingTool: null, toolOrder: null, toolStatus: null };
  }).sort((left, right) => (left.toolOrder ?? Number.MAX_SAFE_INTEGER) - (right.toolOrder ?? Number.MAX_SAFE_INTEGER)
    || left.evidenceClass.localeCompare(right.evidenceClass)
    || (left.producingTool ?? "").localeCompare(right.producingTool ?? ""));
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

function governedDiagnosis(value: unknown) {
  const result = objectValue(value);
  const diagnosis = objectValue(result?.diagnosis) ?? result;
  return {
    componentId: result?.componentId,
    componentVersion: result?.componentVersion,
    decision: diagnosis?.decision,
    failureCode: diagnosis?.failureCode,
    firstPedagogicalIssue: diagnosis?.firstPedagogicalIssue,
    recommendedSupport: result?.recommendedSupport,
  };
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

function governedQuality(testCase: RuntimeParityCase, authoritative: RuntimeParityExecution, candidate: RuntimeParityExecution): RuntimeGovernedQualityResult {
  const authoritativeChecks: Readonly<Record<string, boolean>> = {
    ...authoritative.graderChecks,
    requiredTools: requiredToolFailures(testCase, authoritative.record).length === 0,
    forbiddenTools: forbiddenToolFailures(testCase, authoritative.record).length === 0,
  };
  const candidateChecks: Readonly<Record<string, boolean>> = {
    ...candidate.graderChecks,
    requiredTools: requiredToolFailures(testCase, candidate.record).length === 0,
    forbiddenTools: forbiddenToolFailures(testCase, candidate.record).length === 0,
  };
  const names = [...new Set([...Object.keys(authoritativeChecks), ...Object.keys(candidateChecks)])].sort();
  const checks = Object.fromEntries(names.map((name) => {
    const authoritativePassed = authoritativeChecks[name] ?? null;
    const candidatePassed = candidateChecks[name] ?? null;
    const classification: RuntimeQualityCheckClassification = authoritativePassed === null || candidatePassed === null
      ? "NOT_EVALUATED"
      : authoritativePassed && candidatePassed
        ? "QUALITY_MATCH"
        : authoritativePassed
          ? "CANDIDATE_REGRESSION"
          : candidatePassed
            ? "CANDIDATE_IMPROVEMENT"
            : "SHARED_QUALITY_FAILURE";
    return [name, { authoritativePassed, candidatePassed, classification }];
  })) as Record<string, RuntimeQualityCheckResult>;
  const values = Object.values(checks).map((check) => check.classification);
  const classification: RuntimeGovernedQualityClassification = values.includes("CANDIDATE_REGRESSION")
    ? "CANDIDATE_REGRESSION"
    : values.includes("NOT_EVALUATED") || values.length === 0
      ? "NOT_EVALUATED"
      : values.includes("CANDIDATE_IMPROVEMENT")
        ? "CANDIDATE_IMPROVEMENT"
        : values.includes("SHARED_QUALITY_FAILURE")
          ? "SHARED_QUALITY_FAILURE"
          : "QUALITY_MATCH";
  return { classification, checks };
}

export function compareRuntimeParityCase(
  testCase: RuntimeParityCase,
  authoritative: RuntimeParityExecution | null,
  candidate: RuntimeParityExecution | null,
): RuntimeParityCaseResult {
  if (!authoritative || !candidate) {
    return { caseId: testCase.caseId, classification: "NOT_EXECUTED", authoritative, candidate, differences: [], behavioralEquivalence: "NOT_EVALUATED", governedQuality: { classification: "NOT_EVALUATED", checks: {} }, operationalImpact: { classification: "NOT_EVALUATED" }, reviewRequired: false };
  }
  if (authoritative.record.status !== "COMPLETED" || candidate.record.status !== "COMPLETED") {
    const differences = [
      regression("execution.status", authoritative.record.status, candidate.record.status, "Both executions must complete before behavioral parity can be evaluated."),
      regression("terminalError", authoritative.record.terminalError, candidate.record.terminalError, "Terminal errors are preserved as infrastructure evidence."),
      regression("failureStage", authoritative.record.failureStage, candidate.record.failureStage, "Failure stages are preserved as infrastructure evidence."),
    ].filter((item): item is RuntimeParityDifference => item !== null);
    return { caseId: testCase.caseId, classification: "INFRASTRUCTURE_FAILURE", authoritative, candidate, differences, behavioralEquivalence: "NOT_EVALUATED", governedQuality: { classification: "NOT_EVALUATED", checks: {} }, operationalImpact: { classification: "NOT_EVALUATED" }, reviewRequired: false };
  }

  const quality = governedQuality(testCase, authoritative, candidate);
  const outcomeDifference = quality.classification === "CANDIDATE_IMPROVEMENT" ? behavioralDifference : regression;
  const differences = [
    regression("caseId", authoritative.record.caseId, candidate.record.caseId, "Both records must belong to the same case."),
    regression("suiteVersion", authoritative.suiteVersion, candidate.suiteVersion, "Suite versions must match."),
    regression("selection", authoritative.selection, candidate.selection, "Selection modes and values must match."),
    regression("route", authoritative.record.route, candidate.record.route, "The candidate must preserve route behavior."),
    regression("obligations", authoritative.record.obligations, candidate.record.obligations, "The candidate must preserve policy obligations."),
    outcomeDifference("toolCalls", toolShape(authoritative.record), toolShape(candidate.record), "Tool order, names, and statuses differ; governed quality records whether the direction is improvement or regression."),
    regression("sourceRefs", authoritative.record.sourceRefs, candidate.record.sourceRefs, "Source references must match."),
    outcomeDifference("evidenceLineage", evidenceLineage(authoritative.record), evidenceLineage(candidate.record), "Evidence classes and producing tool lineage must match; execution-local result references are ignored."),
    outcomeDifference("diagnosisTracePresent", Boolean(authoritative.record.diagnosisTraceId), Boolean(candidate.record.diagnosisTraceId), "Diagnosis trace presence must match; trace identifiers are execution-local."),
    outcomeDifference("diagnosisResult", governedDiagnosis(authoritative.diagnosisResult ?? authoritative.record.diagnosisResult), governedDiagnosis(candidate.diagnosisResult ?? candidate.record.diagnosisResult), "Governed Diagnosis identity, decision, failure and pedagogical outcome must match; execution-local identifiers are ignored."),
    outcomeDifference("diagnosisFailureCode", authoritative.diagnosisFailureCode ?? authoritative.record.diagnosisFailureCode, candidate.diagnosisFailureCode ?? candidate.record.diagnosisFailureCode, "Diagnosis failure outcomes must match."),
    outcomeDifference("finalResponseStatus", authoritative.record.finalResponseStatus, candidate.record.finalResponseStatus, "Final response statuses must match."),
    regression("completeness", authoritative.record.completeness, candidate.record.completeness, "Trace, response, and tool-evidence completeness must match."),
    regression("terminalError", authoritative.record.terminalError, candidate.record.terminalError, "Terminal outcomes must match."),
    regression("failureStage", authoritative.record.failureStage, candidate.record.failureStage, "Failure stages must match."),
    operationalDifference("latencyMs", authoritative.record.latencyMs, candidate.record.latencyMs, "Latency is execution-specific and is reported without changing behavioral parity."),
    operationalDifference("tokenUsage", authoritative.record.tokenUsage, candidate.record.tokenUsage, "Usage is execution-specific and missing values remain explicit."),
    operationalDifference("estimatedCostUsd", authoritative.record.estimatedCostUsd, candidate.record.estimatedCostUsd, "Cost is execution-specific and missing values remain explicit."),
  ].filter((item): item is RuntimeParityDifference => item !== null);

  const regressionPresent = differences.some((item) => item.severity === "REGRESSION");
  const behavioralDifferencePresent = differences.some((item) => item.severity === "BEHAVIORAL");
  const operationalDifferencePresent = differences.some((item) => item.severity === "OPERATIONAL");
  const qualityRegression = quality.classification === "CANDIDATE_REGRESSION";
  const qualityReviewRequired = quality.classification !== "QUALITY_MATCH" && !qualityRegression;
  const classification = regressionPresent || qualityRegression
    ? "REGRESSION"
    : behavioralDifferencePresent || operationalDifferencePresent || qualityReviewRequired
      ? "REVIEW_REQUIRED"
      : "EXACT_MATCH";
  return {
    caseId: testCase.caseId,
    classification,
    authoritative,
    candidate,
    differences,
    behavioralEquivalence: regressionPresent || behavioralDifferencePresent ? "BEHAVIORAL_DIFFERENCE" : "EXACT_MATCH",
    governedQuality: quality,
    operationalImpact: { classification: operationalDifferencePresent ? "OPERATIONAL_DIFFERENCE" : "OPERATIONAL_MATCH" },
    reviewRequired: classification === "REVIEW_REQUIRED",
  };
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
  const classifications: readonly RuntimeParityClassification[] = ["EXACT_MATCH", "REVIEW_REQUIRED", "REGRESSION", "NOT_EXECUTED", "INFRASTRUCTURE_FAILURE"];
  const counts = Object.fromEntries(classifications.map((classification) => [classification, ordered.filter((result) => result.classification === classification).length])) as Record<RuntimeParityClassification, number>;
  const behavioralClassifications: readonly RuntimeBehavioralEquivalence[] = ["EXACT_MATCH", "BEHAVIORAL_DIFFERENCE", "NOT_EVALUATED"];
  const behavioralCounts = Object.fromEntries(behavioralClassifications.map((classification) => [classification, ordered.filter((result) => result.behavioralEquivalence === classification).length])) as Record<RuntimeBehavioralEquivalence, number>;
  const qualityClassifications: readonly RuntimeGovernedQualityClassification[] = ["QUALITY_MATCH", "CANDIDATE_REGRESSION", "CANDIDATE_IMPROVEMENT", "SHARED_QUALITY_FAILURE", "NOT_EVALUATED"];
  const qualityCounts = Object.fromEntries(qualityClassifications.map((classification) => [classification, ordered.filter((result) => result.governedQuality.classification === classification).length])) as Record<RuntimeGovernedQualityClassification, number>;
  const operationalClassifications: readonly RuntimeOperationalClassification[] = ["OPERATIONAL_MATCH", "OPERATIONAL_DIFFERENCE", "NOT_EVALUATED"];
  const operationalCounts = Object.fromEntries(operationalClassifications.map((classification) => [classification, ordered.filter((result) => result.operationalImpact.classification === classification).length])) as Record<RuntimeOperationalClassification, number>;
  const executed = ordered.filter((result) => result.classification !== "NOT_EXECUTED").length;
  const coverage = summarizeRuntimeParityCoverage(plan.cases.length, executed);
  return {
    schemaVersion: RUNTIME_PARITY_SCHEMA_VERSION,
    reportId,
    comparisonMode,
    plan,
    results: ordered,
    counts,
    behavioralCounts,
    qualityCounts,
    operationalCounts,
    reviewRequiredCases: ordered.filter((result) => result.reviewRequired).length,
    coverage,
    fullSuiteCoverageComplete: plan.selection.mode === "FULL" && coverage.coverageComplete,
    createdAt,
  };
}

export function decideRuntimeParityCommand(
  report: RuntimeParityReport,
  context: { readonly authoritativeAvailable: boolean; readonly candidateAvailable: boolean; readonly selfComparison: boolean },
): RuntimeParityCommandDecision {
  if (!context.authoritativeAvailable) return { exitCode: 3, message: "AUTHORITATIVE_EVIDENCE_UNAVAILABLE" };
  if (!context.selfComparison && !context.candidateAvailable) return { exitCode: 2, message: "CANDIDATE_RUNTIME_UNAVAILABLE" };
  if (report.counts.INFRASTRUCTURE_FAILURE > 0) return { exitCode: 4, message: "RUNTIME_PARITY_INFRASTRUCTURE_FAILURE" };
  if (report.counts.REGRESSION > 0 || report.counts.NOT_EXECUTED > 0) return { exitCode: 1, message: "RUNTIME_PARITY_REGRESSION" };
  if (report.counts.REVIEW_REQUIRED > 0) return { exitCode: 6, message: "RUNTIME_PARITY_REVIEW_REQUIRED" };
  return { exitCode: 0, message: context.selfComparison ? "LEGACY_SELF_COMPARISON_PASS (harness validation only; not candidate parity)." : "RUNTIME_PARITY_PASS" };
}
