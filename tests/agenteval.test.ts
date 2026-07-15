import { describe, expect, it } from "vitest";
import { gradeAgentCase, type AgentEvalCase } from "../src/agent/agenteval";
import type { AgentTrace } from "../src/agent/types";

const AGENT_EVAL_CASE = "AGENT_EVAL_CASE" as const;
const testCase: AgentEvalCase = { caseId: "case", category: "diagnosis", input: "A complete original problem prompt. Equation: 2Mg + O2 -> 2MgO. Given 4.8 g. Find mass MgO to 3 significant figures.", inputOrigin: "USER_INPUT", expectedStatus: ["ANSWERED"], requiredTools: ["run_learner_diagnosis"], forbiddenTools: [], allowedCapabilities: ["stoichiometric-product-mass"], expectedFailureCode: "UNIT_ERROR", tags: [AGENT_EVAL_CASE] };
const trace: AgentTrace = { traceId: "trace", conversationId: "case", inputOrigin: "USER_INPUT", runPurpose: "AGENT_EVAL", provider: "deepseek", model: "configured", thinkingMode: "disabled", promptVersion: "1", capabilityRegistryVersion: "1", startedAt: "2026-07-16T10:00:00.000Z", completedAt: "2026-07-16T10:00:01.000Z", toolCalls: [{ name: "run_learner_diagnosis", arguments: { componentId: "stoichiometric-product-mass", problemContext: { prompt: "A complete original problem prompt.", reactionEquation: "2Mg + O2 -> 2MgO", givenValues: [{ label: "mass", value: 4.8, unit: "g" }], targetQuantity: "mass MgO", answerRequirement: "3 significant figures" }, problemContextEvidence: { promptQuote: "A complete original problem prompt.", reactionEquationQuote: "2Mg + O2 -> 2MgO", givenValueQuotes: ["4.8 g"], targetQuantityQuote: "mass MgO", answerRequirementQuote: "3 significant figures" } }, resultRef: "result", status: "SUCCEEDED" }], finalResponse: { status: "ANSWERED", learnerMessage: "Unit issue", sourceRefs: [], diagnosisTraceId: "trainer" }, latencyMs: 1000 };

describe("AgentEval deterministic graders", () => {
  it("passes faithful tool use, complete context and diagnosis output", () => { expect(gradeAgentCase(testCase, trace, [{ name: "run_learner_diagnosis", resultRef: "result", data: { traceId: "trainer", diagnosis: { failureCode: "UNIT_ERROR" } } }]).passed).toBe(true); });
  it("fails altered diagnosis codes, unresolved trace ids and incomplete context", () => { const grade = gradeAgentCase(testCase, { ...trace, toolCalls: [{ ...trace.toolCalls[0]!, arguments: { componentId: "kp-from-equilibrium-moles" } }] }, [{ name: "run_learner_diagnosis", resultRef: "result", data: { traceId: "different", diagnosis: { failureCode: "ARITHMETIC_ERROR" } } }]); expect(grade.errors).toEqual(expect.arrayContaining(["allowedCapability", "diagnosisFidelity", "diagnosisProblemContext", "diagnosisTraceId"])); });

  it("requires missing-context cases to avoid diagnosis calls and traces", () => {
    const missingCase = { ...testCase, category: "diagnosis-missing-context", expectedStatus: ["NEEDS_MORE_EVIDENCE"], requiredTools: [], forbiddenTools: ["run_learner_diagnosis"], expectedFailureCode: undefined };
    const missingTrace = { ...trace, toolCalls: [], finalResponse: { status: "NEEDS_MORE_EVIDENCE" as const, learnerMessage: "Please provide the original problem, reaction conditions, target and answer requirement.", sourceRefs: [] } };
    expect(gradeAgentCase(missingCase, missingTrace, []).passed).toBe(true);
  });

  it("passes an invented-context case only when the ungrounded Diagnosis call is rejected without a trace", () => {
    const inventedCase = { ...testCase, category: "diagnosis-invented-context", input: "Learner working only: 4.80/24.0=0.200 mol.", expectedStatus: ["NEEDS_MORE_EVIDENCE"], requiredTools: [], forbiddenTools: ["run_learner_diagnosis"], expectedFailureCode: undefined };
    const inventedTrace: AgentTrace = { ...trace, toolCalls: [{ ...trace.toolCalls[0]!, status: "FAILED" }], finalResponse: { status: "NEEDS_MORE_EVIDENCE", learnerMessage: "Please provide the original problem context.", sourceRefs: [] } };
    const grade = gradeAgentCase(inventedCase, inventedTrace, []);
    expect(grade.passed).toBe(true);
    expect(grade.checks.inventedContextRejected).toBe(true);
  });

  it("rejects a sourced why-answer that states mole ratios without the particle-to-mole mechanism", () => {
    const whyCase: AgentEvalCase = { caseId: "retrieval-why", category: "retrieval", input: "Why do coefficients in a balanced equation give mole ratios?", inputOrigin: "PRESET_INPUT", expectedStatus: ["ANSWERED"], requiredTools: ["search_learning_resources"], forbiddenTools: ["run_learner_diagnosis"], allowedCapabilities: [], requiredSourceIds: ["CAIE-9701-STOICHIOMETRY-COEFFICIENTS"], tags: [AGENT_EVAL_CASE, "WHY_EXPLANATION"] };
    const whyTrace: AgentTrace = { ...trace, toolCalls: [{ name: "search_learning_resources", arguments: { query: "coefficients mole ratios" }, resultRef: "resource-search", status: "SUCCEEDED" }], finalResponse: { status: "ANSWERED", learnerMessage: "The coefficients represent the relative number of moles. Conservation of mass ensures the equation is balanced, so the coefficients give mole ratios.", sourceRefs: ["CAIE-9701-STOICHIOMETRY-COEFFICIENTS"] } };
    const grade = gradeAgentCase(whyCase, whyTrace, [{ name: "search_learning_resources", resultRef: "resource-search", data: [{ sourceId: "CAIE-9701-STOICHIOMETRY-COEFFICIENTS" }] }]);
    expect(grade.errors).toEqual(expect.arrayContaining(["whyMechanism", "whyMoleScaling", "whyConceptDistinctions", "whyConclusion", "whyCausalPriority"]));
  });

  it("accepts a sourced why-answer that connects particle ratios to mole ratios causally", () => {
    const whyCase: AgentEvalCase = { caseId: "retrieval-why", category: "retrieval", input: "Why do coefficients in a balanced equation give mole ratios?", inputOrigin: "PRESET_INPUT", expectedStatus: ["ANSWERED"], requiredTools: ["search_learning_resources"], forbiddenTools: ["run_learner_diagnosis"], allowedCapabilities: [], requiredSourceIds: ["CAIE-9701-STOICHIOMETRY-COEFFICIENTS"], tags: [AGENT_EVAL_CASE, "WHY_EXPLANATION"] };
    const learnerMessage = "At the particle level, the coefficients describe the particle ratio in one reaction pattern: two H2 molecules react with one O2 molecule. The equation must be balanced because it must show the same number of each type of atom on both sides; that explains atom accounting, not by itself why the ratio is a mole ratio. A mole is a fixed number of particles, Avogadro's constant. Scaling every particle count by Avogadro's constant preserves the ratio: (2 × N_A):(1 × N_A) is still 2:1, so the microscopic particle ratio becomes the macroscopic mole ratio. Therefore, the statement that equation coefficients give mole ratios is true because scaling each stoichiometric particle count by Avogadro's constant preserves the particle ratio.";
    const whyTrace: AgentTrace = { ...trace, toolCalls: [{ name: "search_learning_resources", arguments: { query: "coefficients mole ratios" }, resultRef: "resource-search", status: "SUCCEEDED" }], finalResponse: { status: "ANSWERED", learnerMessage, sourceRefs: ["CAIE-9701-STOICHIOMETRY-COEFFICIENTS"] } };
    expect(gradeAgentCase(whyCase, whyTrace, [{ name: "search_learning_resources", resultRef: "resource-search", data: [{ sourceId: "CAIE-9701-STOICHIOMETRY-COEFFICIENTS" }] }]).passed).toBe(true);
  });
});
