import { describe, expect, it } from "vitest";
import {
  aggregatePatternEvidence,
  createComponentCandidate,
  createInitialExperienceState,
  diagnoseStoichiometryConversation,
} from "../src/experience/orchestration";

describe("conversation to candidate causality", () => {
  it("requires the current learner evidence before a candidate can exist", () => {
    const initial = createInitialExperienceState();

    expect(initial.evidence.map((item) => item.id)).toEqual([
      "historical-case-001",
      "historical-case-002",
    ]);
    expect(aggregatePatternEvidence(initial.evidence)).toMatchObject({
      occurrenceCount: 2,
      threshold: 3,
      thresholdReached: false,
    });
    expect(initial.candidate).toBeNull();

    const diagnosed = diagnoseStoichiometryConversation(
      initial,
      "2026-07-16T09:00:00.000Z",
    );
    expect(diagnosed.evidence.map((item) => item.id)).toContain(
      "evidence-mgo-ratio-current",
    );
    expect(aggregatePatternEvidence(diagnosed.evidence)).toMatchObject({
      occurrenceCount: 3,
      thresholdReached: true,
    });
    expect(diagnosed.candidate).toBeNull();

    const withCandidate = createComponentCandidate(diagnosed);
    expect(withCandidate.candidate?.sourceEvidenceIds).toEqual([
      "historical-case-001",
      "historical-case-002",
      "evidence-mgo-ratio-current",
    ]);
  });
});
