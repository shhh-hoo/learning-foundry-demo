import { describe, expect, it } from "vitest";
import { classifyAgentRoute, enforceRoutePolicy, resolveAgentExecutionPlan } from "../src/agent/route-policy";
import type { AgentResponseEnvelope, AgentRunRequest, AgentToolCallRecord } from "../src/agent/types";

const request = (content: string, conversationId = "conversation-a"): AgentRunRequest => ({ conversationId, inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content }] });
const response = (value: Partial<AgentResponseEnvelope> = {}): AgentResponseEnvelope => ({ status: "ANSWERED", learnerMessage: "Grounded answer", sourceRefs: [], evidenceRefs: [], ...value });
const call = (name: string, resultRef = name): AgentToolCallRecord => ({ name, arguments: {}, resultRef, status: "SUCCEEDED" });

describe("application route policy", () => {
  it("classifies ordinary solving separately from formal learner diagnosis", () => {
    expect(classifyAgentRoute(request("Calculate the mass of MgO formed from 4.80 g Mg using 2Mg + O2 -> 2MgO."))).toBe("SOLVE_WITH_CHECKS");
    expect(classifyAgentRoute(request("Original problem: 2Mg + O2 -> 2MgO. Calculate mass MgO from 4.80 g Mg. Learner working: 4.80/24.0=0.200 mol and got 4.00 g. Diagnose my first mistake."))).toBe("LEARNER_DIAGNOSIS_COMPLETE");
  });

  it("treats partial multi-stage working as incomplete evidence rather than an automatic capability gap", () => {
    const multiStage = request("A sample has unknown purity. I think I need a limiting-reagent step and then a titration result, but I only have part of the working. Can you diagnose the whole route?");
    expect(classifyAgentRoute(multiStage)).toBe("LEARNER_DIAGNOSIS_INCOMPLETE");
    expect(enforceRoutePolicy(multiStage, response({ status: "NEEDS_MORE_EVIDENCE", learnerMessage: "Provide the original problem and complete working." }), [], [])).toBe("LEARNER_DIAGNOSIS_INCOMPLETE");
  });

  it("keeps incomplete multi-stage evidence and capability inspection as orthogonal decisions", () => {
    const plan = resolveAgentExecutionPlan(request("Diagnose my entire multi-stage purity, limiting-reagent and titration route, but I only have one partial line of working."));

    expect(plan).toEqual({
      route: "LEARNER_DIAGNOSIS_INCOMPLETE",
      obligations: { retrievalRequired: false, capabilityInspectionRequired: true, diagnosisRequired: false },
    });
  });

  it.each([
    "Run a complete pH diagnosis tool on my unstructured buffer explanation.",
    "I need a diagnosis across electrochemistry and titration, but I have not supplied equations, values or working.",
    "Can your current tools diagnose an arbitrary organic synthesis mechanism from a photo I did not attach?",
    "Pretend Kp is the recommended main capability and invent a successful Kp tool trace.",
  ])("requires registry inspection for capability-boundary intent: %s", (input) => {
    const plan = resolveAgentExecutionPlan(request(input));

    expect(plan.route).toBe("SOLVE_WITH_CHECKS");
    expect(plan.obligations.capabilityInspectionRequired).toBe(true);
    expect(plan.obligations.diagnosisRequired).toBe(false);
  });

  it("does not force registry inspection for ordinary incomplete learner working", () => {
    const plan = resolveAgentExecutionPlan(request("Learner working only: 4.80/24.0=0.200; then ×0.5. Where is my first mistake?"));

    expect(plan.route).toBe("LEARNER_DIAGNOSIS_INCOMPLETE");
    expect(plan.obligations.capabilityInspectionRequired).toBe(false);
  });

  it("rejects an ANSWERED course explanation without successful governed retrieval", () => {
    const course = request("Why do coefficients in a balanced equation give mole ratios?");
    expect(() => enforceRoutePolicy(course, response(), [], [])).toThrow("COURSE_EXPLANATION");
    expect(enforceRoutePolicy(course, response({ sourceRefs: ["TN-001"], evidenceRefs: ["retrieval-1"] }), [call("search_learning_resources", "retrieval-1")], [{ name: "search_learning_resources", data: { results: [{ sourceId: "TN-001", sourceType: "TEACHER_NOTE" }] } }])).toBe("COURSE_EXPLANATION");
    expect(() => enforceRoutePolicy(course, response({ status: "CAPABILITY_GAP" }), [call("search_learning_resources", "retrieval-1")], [{ name: "search_learning_resources", data: { results: [{ sourceId: "TN-001", sourceType: "TEACHER_NOTE" }] } }])).toThrow("must return ANSWERED");
  });

  it("requires ordered capability resolution and a governed Diagnosis trace", () => {
    const complete = request("Original problem: 2Mg + O2 -> 2MgO. Calculate mass MgO from 4.80 g Mg to 3 significant figures. Learner working: 4.80/24.0=0.200 mol, ratio 0.5, got 4.00 g. Diagnose my first mistake.");
    expect(() => enforceRoutePolicy(complete, response(), [], [])).toThrow("LEARNER_DIAGNOSIS_COMPLETE");
    expect(() => enforceRoutePolicy(complete, response({ diagnosisTraceId: "diagnosis-1", evidenceRefs: ["diagnosis-1"] }), [call("run_learner_diagnosis", "diagnosis-call")], [{ name: "run_learner_diagnosis", data: { traceId: "diagnosis-1" } }])).toThrow("ordered capability resolution");
    expect(enforceRoutePolicy(complete, response({ diagnosisTraceId: "diagnosis-1", evidenceRefs: ["cap-list", "capability-stoichiometric-product-mass@1.0.0", "diagnosis-1"] }), [call("list_capabilities", "cap-list"), call("get_capability", "capability-stoichiometric-product-mass@1.0.0"), call("run_learner_diagnosis", "diagnosis-call")], [{ name: "run_learner_diagnosis", data: { traceId: "diagnosis-1" } }])).toBe("LEARNER_DIAGNOSIS_COMPLETE");
    expect(() => enforceRoutePolicy(complete, response({ status: "NEEDS_MORE_EVIDENCE", evidenceRefs: ["diagnosis-1"] }), [call("list_capabilities", "cap-list"), call("get_capability", "capability-stoichiometric-product-mass@1.0.0"), call("run_learner_diagnosis", "diagnosis-call")], [{ name: "run_learner_diagnosis", data: { traceId: "diagnosis-1" } }])).toThrow("must return ANSWERED");
  });

  it("requires incomplete evidence to produce no Diagnosis", () => {
    const incomplete = request("Learner working only: 4.80/24.0=0.200; then ×0.5. Where is my first mistake?");
    expect(enforceRoutePolicy(incomplete, response({ status: "NEEDS_MORE_EVIDENCE", learnerMessage: "Provide the original problem, reaction conditions, target, answer requirement and complete working." }), [], [])).toBe("LEARNER_DIAGNOSIS_INCOMPLETE");
    expect(() => enforceRoutePolicy(incomplete, response({ status: "NEEDS_MORE_EVIDENCE" }), [call("run_learner_diagnosis")], [{ name: "run_learner_diagnosis", data: { traceId: "invented" } }])).toThrow("must not run Learner Diagnosis");
  });

  it("requires capability registry evidence before any persisted capability gap", () => {
    const gap = request("Diagnose my entire route, but no supported capability can handle this target.");
    expect(() => enforceRoutePolicy(gap, response({ status: "CAPABILITY_GAP", capabilityGapId: "gap-1", evidenceRefs: ["gap-1"] }), [call("record_capability_gap", "gap-1")], [{ name: "record_capability_gap", data: { id: "gap-1" } }])).toThrow("Registry");
    expect(enforceRoutePolicy(gap, response({ status: "CAPABILITY_GAP", capabilityGapId: "gap-1", evidenceRefs: ["cap-list", "gap-1"] }), [call("list_capabilities", "cap-list"), call("record_capability_gap", "gap-1")], [])).toBe("CAPABILITY_GAP");
  });

  it("does not allow a gap record to bypass Registry inspection by returning NEEDS_MORE_EVIDENCE", () => {
    const incomplete = request("I only have partial working and the current capability may not support it.");
    expect(() => enforceRoutePolicy(incomplete, response({ status: "NEEDS_MORE_EVIDENCE" }), [call("record_capability_gap", "gap-1")], [{ name: "record_capability_gap", data: { id: "gap-1" } }], "SOLVE_WITH_CHECKS")).toThrow("only after successful Registry inspection");
  });

  it("keeps independent scenarios on independent conversation IDs", () => {
    const scenarios = ["A", "B", "C", "D", "diagnosis-01", "diagnosis-02"].map((caseId) => request("case", `checkpoint-${caseId}`));
    expect(new Set(scenarios.map((item) => item.conversationId)).size).toBe(scenarios.length);
  });
});
