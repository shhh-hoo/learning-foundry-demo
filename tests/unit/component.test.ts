import { describe, expect, it } from "vitest";
import { ComponentContract } from "@/domain/component";

describe("Component contract", () => {
  it("requires an explicit human review gate", () => {
    const valid = { title: "Reviewed support", purpose: "Reuse a teacher-reviewed support pattern.", capabilityKey: "reviewed-support", referencePackKey: "chemistry-caie-9701", inputSchema: { type: "object" }, outputSchema: { type: "object" }, evidenceRequirements: ["DiagnosticObservation", "TeacherReview"], humanReviewRequired: true };
    expect(ComponentContract.safeParse(valid).success).toBe(true);
    expect(ComponentContract.safeParse({ ...valid, humanReviewRequired: false }).success).toBe(false);
  });
});
