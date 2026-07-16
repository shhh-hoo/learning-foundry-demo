import { describe, expect, it } from "vitest";
import { enforceRoutePolicy } from "../src/agent/route-policy";
import type { AgentResponseEnvelope, AgentRunRequest, AgentToolCallRecord } from "../src/agent/types";

const request = (content: string, conversationId = "conversation-a"): AgentRunRequest => ({ conversationId, inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content }] });
const response = (value: Partial<AgentResponseEnvelope> = {}): AgentResponseEnvelope => ({ status: "ANSWERED", learnerMessage: "Grounded answer", sourceRefs: [], evidenceRefs: [], ...value });
const call = (name: string, resultRef = name): AgentToolCallRecord => ({ name, arguments: {}, resultRef, status: "SUCCEEDED" });

describe("application route policy", () => {
  it("rejects an ANSWERED course explanation without successful governed retrieval", () => {
    const course = request("Why do coefficients in a balanced equation give mole ratios?");
    expect(() => enforceRoutePolicy(course, response(), [], [])).toThrow("COURSE_EXPLANATION");
    expect(enforceRoutePolicy(course, response({ sourceRefs: ["TN-001"], evidenceRefs: ["retrieval-1"] }), [call("search_learning_resources", "retrieval-1")], [{ name: "search_learning_resources", data: { results: [{ sourceId: "TN-001", sourceType: "TEACHER_NOTE" }] } }])).toBe("COURSE_EXPLANATION");
  });

  it("requires a complete calculation attempt to resolve its governed Diagnosis trace", () => {
    const complete = request("Original problem: 2Mg + O2 -> 2MgO. Calculate mass MgO from 4.80 g Mg to 3 significant figures. Learner working: 4.80/24.0=0.200 mol, ratio 0.5, got 4.00 g. Diagnose my first mistake.");
    expect(() => enforceRoutePolicy(complete, response(), [], [])).toThrow("LEARNER_DIAGNOSIS_COMPLETE");
    expect(enforceRoutePolicy(complete, response({ diagnosisTraceId: "diagnosis-1", evidenceRefs: ["diagnosis-1"] }), [call("run_learner_diagnosis", "diagnosis-call")], [{ name: "run_learner_diagnosis", data: { traceId: "diagnosis-1" } }])).toBe("LEARNER_DIAGNOSIS_COMPLETE");
  });

  it("requires incomplete evidence to produce no Diagnosis", () => {
    const incomplete = request("Learner working only: 4.80/24.0=0.200; then ×0.5. Where is my first mistake?");
    expect(enforceRoutePolicy(incomplete, response({ status: "NEEDS_MORE_EVIDENCE", learnerMessage: "Provide the original problem, reaction conditions, target, answer requirement and complete working." }), [], [])).toBe("LEARNER_DIAGNOSIS_INCOMPLETE");
    expect(() => enforceRoutePolicy(incomplete, response({ status: "NEEDS_MORE_EVIDENCE" }), [call("run_learner_diagnosis")], [{ name: "run_learner_diagnosis", data: { traceId: "invented" } }])).toThrow("must not run Learner Diagnosis");
  });

  it("requires capability registry evidence before a capability gap", () => {
    const gap = request("Diagnose my entire multi-stage route, but the capability is unsupported.");
    expect(() => enforceRoutePolicy(gap, response({ status: "CAPABILITY_GAP", capabilityGapId: "gap-1", evidenceRefs: ["gap-1"] }), [call("record_capability_gap", "gap-1")], [{ name: "record_capability_gap", data: { id: "gap-1" } }])).toThrow("registry evidence");
    expect(enforceRoutePolicy(gap, response({ status: "CAPABILITY_GAP", capabilityGapId: "gap-1", evidenceRefs: ["cap-list", "gap-1"] }), [call("list_capabilities", "cap-list"), call("record_capability_gap", "gap-1")], [])).toBe("CAPABILITY_GAP");
  });

  it("keeps independent scenarios on independent conversation IDs", () => {
    const scenarios = ["A", "B", "C", "D", "diagnosis-01", "diagnosis-02"].map((caseId) => request("case", `checkpoint-${caseId}`));
    expect(new Set(scenarios.map((item) => item.conversationId)).size).toBe(scenarios.length);
  });
});
