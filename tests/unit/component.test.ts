import { describe, expect, it } from "vitest";
import { ComponentContent, ComponentContract, ComponentHumanRubric, humanRubricPasses } from "@/domain/component";

describe("Component contract", () => {
  it("requires an explicit human review gate", () => {
    const valid = { title: "Reviewed support", purpose: "Reuse a teacher-reviewed support pattern.", capabilityId: "10000000-0000-4000-8000-000000000001", capabilityKey: "reviewed-support", referencePackKey: "chemistry-caie-9701", inputSchema: { type: "object" }, outputSchema: { type: "object" }, evidenceRequirements: ["DiagnosticObservation", "TeacherReview"], evidencePolicy: "NOT_REQUIRED_DETERMINISTIC_SCAFFOLD", humanReviewRequired: true };
    expect(ComponentContract.safeParse(valid).success).toBe(true);
    expect(ComponentContract.safeParse({ ...valid, humanReviewRequired: false }).success).toBe(false);
  });

  it("requires complete structured authoring and a separate expert rubric", () => {
    expect(ComponentContent.safeParse({ teachingSupport: "Use the reviewed unit-conversion scaffold.", scaffoldHint: "Track units.", workedExample: "Convert 500 mL to 0.500 L before calculating.", learnerAction: "Annotate each step.", evidenceRefs: [] }).success).toBe(true);
    const rubric = ComponentHumanRubric.parse({ domainCorrectness: "PASS", pedagogy: "PASS", safety: "PASS", reuseReadiness: "PASS", notes: "Reviewed against the course contract." });
    expect(humanRubricPasses(rubric)).toBe(true);
    expect(humanRubricPasses({ ...rubric, pedagogy: "FAIL" })).toBe(false);
  });
});
