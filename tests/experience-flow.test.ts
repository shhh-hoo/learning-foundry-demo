import { describe, expect, it } from "vitest";
import { createComponentCandidate, createInitialExperienceState, diagnoseStoichiometryConversation, promoteComponentCandidate } from "../src/experience/orchestration";

describe("product experience flow", () => {
  it("routes the learner attempt through the published component and returns a grounded ratio diagnosis", () => {
    const result = diagnoseStoichiometryConversation(createInitialExperienceState(), "2026-07-15T09:00:00.000Z");

    expect(result.conversation.messages[0]?.content).toContain("multiplied by 0.5");
    expect(result.conversation.selectedComponentId).toBe("stoichiometric-product-mass@1.0.0");
    expect(result.diagnosis?.stage).toBe("FORMULA");
    expect(result.diagnosis?.failureCode).toBe("WRONG_STOICHIOMETRIC_RATIO");
    expect(result.diagnosis?.groundedResponse).toContain("1:1—not 0.5");
    expect(result.diagnosis?.groundedResponse).toContain("8.00 g");
    expect(result.eventLog.map((event) => event.type)).toEqual(expect.arrayContaining([
      "LEARNER_ATTEMPT_SUBMITTED",
      "CAPABILITY_SELECTED",
      "LEARNER_DIAGNOSIS_COMPLETED",
      "EVIDENCE_PERSISTED",
      "RETRY_SCHEDULED",
      "PATTERN_THRESHOLD_REACHED",
    ]));
  });

  it("saves diagnostic evidence, a worked correction, and a delayed retry", () => {
    const result = diagnoseStoichiometryConversation(createInitialExperienceState(), "2026-07-15T09:00:00.000Z");

    expect(result.evidence.find((item) => item.id === "evidence-mgo-ratio-current")).toMatchObject({
        componentId: "stoichiometric-product-mass",
        componentVersion: "1.0.0",
        stage: "FORMULA",
        failureCode: "WRONG_STOICHIOMETRIC_RATIO",
        observedEvidence: { observedRatio: 0.5, expectedRatio: 1 },
      });
    expect(result.learningArtifacts[0]?.steps).toEqual([
      "4.80 g Mg",
      "0.200 mol Mg",
      "1:1 Mg:MgO",
      "0.200 mol MgO",
      "8.00 g MgO",
    ]);
    expect(result.schedule).toMatchObject([
      {
        title: "Retry: Stoichiometric product mass",
        dueAt: "2026-07-18T09:00:00.000Z",
        status: "SCHEDULED",
      },
    ]);
  });

  it("promotes the threshold reached by current evidence into a draft-only Foundry handoff", () => {
    const initial = createInitialExperienceState();
    const diagnosed = diagnoseStoichiometryConversation(initial, "2026-07-15T09:00:00.000Z");
    const candidateState = createComponentCandidate(diagnosed);
    const { state, handoff } = promoteComponentCandidate(candidateState);

    expect(candidateState.candidate?.pattern).toEqual({
      stage: "FORMULA",
      failureCode: "WRONG_STOICHIOMETRIC_RATIO",
      occurrenceCount: 3,
    });
    expect(state.candidate?.status).toBe("PROMOTED_TO_FOUNDRY");
    expect(handoff.component.status).toBe("DRAFT");
    expect(handoff.component.version).toBe("1.1.0");
    expect(handoff.evaluation).toBeNull();
    expect(handoff.candidateSource).toMatchObject({
      kind: "CONVERSATION_DERIVED",
      conversationIds: candidateState.candidate?.sourceConversationIds,
      evidenceIds: candidateState.candidate?.sourceEvidenceIds,
    });
  });
});
