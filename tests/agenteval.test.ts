import { describe, expect, it } from "vitest";
import { gradeAgentCase, type AgentEvalCase } from "../src/agent/agenteval";
import type { AgentTrace } from "../src/agent/types";

const AGENT_EVAL_CASE = "AGENT_EVAL_CASE" as const;
const testCase: AgentEvalCase = { caseId: "case", category: "diagnosis", input: "input", inputOrigin: "USER_INPUT", expectedStatus: ["ANSWERED"], requiredTools: ["run_learner_diagnosis"], forbiddenTools: [], allowedCapabilities: ["stoichiometric-product-mass"], expectedFailureCode: "UNIT_ERROR", tags: [AGENT_EVAL_CASE] };
const trace: AgentTrace = { traceId: "trace", conversationId: "case", inputOrigin: "USER_INPUT", provider: "deepseek", model: "configured", thinkingMode: "disabled", promptVersion: "1", capabilityRegistryVersion: "1", startedAt: "2026-07-16T10:00:00.000Z", completedAt: "2026-07-16T10:00:01.000Z", toolCalls: [{ name: "run_learner_diagnosis", arguments: { componentId: "stoichiometric-product-mass", problemContext: { prompt: "A complete original problem prompt.", reactionEquation: "2Mg + O2 -> 2MgO", givenValues: [{ label: "mass", value: 4.8, unit: "g" }], targetQuantity: "mass MgO", answerRequirement: "3 significant figures" } }, resultRef: "result", status: "SUCCEEDED" }], finalResponse: { status: "ANSWERED", learnerMessage: "Unit issue", sourceRefs: [], diagnosisTraceId: "trainer" }, latencyMs: 1000 };

describe("AgentEval deterministic graders", () => {
  it("passes faithful tool use, complete context and diagnosis output", () => { expect(gradeAgentCase(testCase, trace, [{ name: "run_learner_diagnosis", resultRef: "result", data: { traceId: "trainer", diagnosis: { failureCode: "UNIT_ERROR" } } }]).passed).toBe(true); });
  it("fails altered diagnosis codes, unresolved trace ids and incomplete context", () => { const grade = gradeAgentCase(testCase, { ...trace, toolCalls: [{ ...trace.toolCalls[0]!, arguments: { componentId: "kp-from-equilibrium-moles" } }] }, [{ name: "run_learner_diagnosis", resultRef: "result", data: { traceId: "different", diagnosis: { failureCode: "ARITHMETIC_ERROR" } } }]); expect(grade.errors).toEqual(expect.arrayContaining(["allowedCapability", "diagnosisFidelity", "diagnosisProblemContext", "diagnosisTraceId"])); });

  it("requires missing-context cases to avoid diagnosis calls and traces", () => {
    const missingCase = { ...testCase, category: "diagnosis-missing-context", expectedStatus: ["NEEDS_MORE_EVIDENCE"], requiredTools: [], forbiddenTools: ["run_learner_diagnosis"], expectedFailureCode: undefined };
    const missingTrace = { ...trace, toolCalls: [], finalResponse: { status: "NEEDS_MORE_EVIDENCE" as const, learnerMessage: "Please provide the original problem, reaction conditions, target and answer requirement.", sourceRefs: [] } };
    expect(gradeAgentCase(missingCase, missingTrace, []).passed).toBe(true);
  });
});
