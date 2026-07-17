import { compareRuntimeParityCase, createRuntimeParityReport, type RuntimeParityExecution, type RuntimeParityPlan } from "../src/runtime/runtime-parity.ts";
import type { RuntimeExecutionRecord, RuntimeExecutionRole } from "../src/runtime/runtime-shadow.ts";
import { RuntimeParityArtifactRepository } from "./lib/runtime-parity-artifacts.ts";

const now = "2026-07-17T00:00:00.000Z";
const testCase = { caseId: "fixture-case", suiteVersion: "fixture-1.0.0", selection: { mode: "CHECKPOINT" as const }, requiredTools: ["fixture_tool"], forbiddenTools: ["forbidden_tool"] };
const plan: RuntimeParityPlan = { schemaVersion: "1.0.0", planId: "fixture-plan", suiteVersion: "fixture-1.0.0", selection: testCase.selection, cases: [testCase], createdAt: now };

function record(role: RuntimeExecutionRole): RuntimeExecutionRecord {
  return {
    schemaVersion: "1.1.0", executionId: `fixture-${role.toLowerCase()}`, ...(role === "SHADOW" ? { parentAuthoritativeExecutionId: "fixture-authoritative" } : {}), role,
    runPurpose: "AGENT_EVAL", conversationId: "fixture", caseId: testCase.caseId, agentTraceId: `fixture-${role.toLowerCase()}-trace`, runtimeAdapterId: role === "AUTHORITATIVE" ? "fixture-legacy" : "fixture-candidate", runtimeAdapterVersion: "1.0.0", providerId: "fixture", modelId: "fixture",
    route: "SOLVE_WITH_CHECKS", obligations: { retrievalRequired: false, capabilityInspectionRequired: false, diagnosisRequired: false },
    toolCalls: [{ order: 0, name: "fixture_tool", arguments: {}, resultRef: "fixture-result", status: "SUCCEEDED" }], sourceRefs: [], evidenceRefs: [],
    finalResponse: { status: "ANSWERED", learnerMessage: "Fixture", sourceRefs: [] }, finalResponseStatus: "ANSWERED", latencyMs: 1, tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, estimatedCostUsd: 0,
    startedAt: now, completedAt: now, status: "COMPLETED", completeness: { trace: true, finalResponse: true, toolEvidence: true },
  };
}

function execution(role: RuntimeExecutionRole): RuntimeParityExecution { return { suiteVersion: testCase.suiteVersion, selection: testCase.selection, record: record(role), graderChecks: { fixture: true } }; }

const result = compareRuntimeParityCase(testCase, execution("AUTHORITATIVE"), execution("SHADOW"));
const report = createRuntimeParityReport("runtime-parity-fixture", plan, [result], now);
await new RuntimeParityArtifactRepository(process.env.RUNTIME_PARITY_STORE_DIR ?? ".runtime-parity-results").save(report);
console.log(`Runtime parity fixture: ${result.classification}.`);
if (result.classification !== "EXACT_MATCH") process.exitCode = 1;
