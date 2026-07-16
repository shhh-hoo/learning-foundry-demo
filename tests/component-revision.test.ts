import { describe, expect, it } from "vitest";
import { applyComponentRevision, hasSemanticComponentDiff, promoteComponentCandidate } from "../src/experience/orchestration";
import type { ExperienceState } from "../src/experience/types";
import { createInitialExperienceState } from "../src/experience/orchestration";

function candidateState(): ExperienceState {
  return {
    ...createInitialExperienceState(),
    candidate: {
      id: "candidate-1", source: "ACTUAL_AGENT_RUNS",
      sourceTraceIds: ["diagnosis-1", "diagnosis-2", "diagnosis-3"],
      sourceDiagnosisTraceIds: ["diagnosis-1", "diagnosis-2", "diagnosis-3"],
      sourceAgentTraceIds: ["agent-1", "agent-2", "agent-3"],
      pattern: { componentId: "stoichiometric-product-mass", failureCode: "WRONG_STOICHIOMETRIC_RATIO", occurrenceCount: 3 },
      proposedChange: "Strengthen governed support.", status: "CREATED",
    },
  };
}

describe("real component revision", () => {
  it("records a teacher-authored semantic change and its diagnosis provenance", () => {
    const { handoff } = promoteComponentCandidate(candidateState());
    expect(hasSemanticComponentDiff(handoff.baseComponent, handoff.component)).toBe(false);
    const hint = handoff.component.hintPolicy.hints[0]!;
    const revised = applyComponentRevision(handoff, hint.id, `${hint.text} Compare the 2:2 coefficients before calculating.`, "Three diagnoses show repeated ratio transfer errors.");
    expect(hasSemanticComponentDiff(revised.baseComponent, revised.component)).toBe(true);
    expect(revised.revision).toMatchObject({ baseComponentVersion: handoff.baseComponent.version, changedField: `hintPolicy.hints.${hint.id}.text`, beforeValue: hint.text, teacherRationale: "Three diagnoses show repeated ratio transfer errors.", sourceDiagnosisTraceIds: ["diagnosis-1", "diagnosis-2", "diagnosis-3"] });
  });

  it("rejects empty rationale and content-identical revisions", () => {
    const { handoff } = promoteComponentCandidate(candidateState());
    const hint = handoff.component.hintPolicy.hints[0]!;
    expect(() => applyComponentRevision(handoff, hint.id, hint.text, "No change")).toThrow(/semantic/i);
    expect(() => applyComponentRevision(handoff, hint.id, `${hint.text} New support.`, " ")).toThrow(/rationale/i);
  });
});
