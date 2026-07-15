import { describe, expect, it } from "vitest";
import { gradeAgentCase, type AgentEvalCase } from "../src/agent/agenteval";
import type { AgentTrace } from "../src/agent/types";

const AGENT_EVAL_CASE = "AGENT_EVAL_CASE" as const;
const testCase: AgentEvalCase = { caseId: "case", category: "diagnosis", input: "input", inputOrigin: "USER_INPUT", expectedStatus: ["ANSWERED"], requiredTools: ["run_learner_diagnosis"], forbiddenTools: [], allowedCapabilities: ["stoichiometric-product-mass"], expectedFailureCode: "UNIT_ERROR", tags: [AGENT_EVAL_CASE] };
const trace: AgentTrace = { traceId: "trace", conversationId: "case", inputOrigin: "USER_INPUT", provider: "deepseek", model: "configured", thinkingMode: "disabled", promptVersion: "1", capabilityRegistryVersion: "1", startedAt: "2026-07-16T10:00:00.000Z", completedAt: "2026-07-16T10:00:01.000Z", toolCalls: [{ name: "run_learner_diagnosis", arguments: { componentId: "stoichiometric-product-mass" }, resultRef: "result", status: "SUCCEEDED" }], finalResponse: { status: "ANSWERED", learnerMessage: "Unit issue", sourceRefs: [], diagnosisTraceId: "trainer" }, latencyMs: 1000 };

describe("AgentEval deterministic graders", () => {
  it("passes faithful tool use and diagnosis output", () => { expect(gradeAgentCase(testCase, trace, [{ name: "run_learner_diagnosis", resultRef: "result", data: { diagnosis: { failureCode: "UNIT_ERROR" } } }]).passed).toBe(true); });
  it("fails altered diagnosis codes and unallowed capabilities", () => { const grade = gradeAgentCase(testCase, { ...trace, toolCalls: [{ ...trace.toolCalls[0]!, arguments: { componentId: "kp-from-equilibrium-moles" } }] }, [{ name: "run_learner_diagnosis", resultRef: "result", data: { diagnosis: { failureCode: "ARITHMETIC_ERROR" } } }]); expect(grade.errors).toEqual(expect.arrayContaining(["allowedCapability", "diagnosisFidelity"])); });
});
