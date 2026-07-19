import { describe, expect, it } from "vitest";
import { RetryReviewResume } from "@/workflows/retry-outcome";

const actor = {
  userId: "20000000-0000-4000-8000-000000000002",
  institutionId: "10000000-0000-4000-8000-000000000001",
  roles: ["TEACHER" as const],
  courseIds: ["40000000-0000-4000-8000-000000000001"],
  authMethod: "unit-test",
  sessionId: "unit-test-session",
};
const base = { actor, teachingSupport: "Inspect the reviewed retry result.", reviewIdempotencyKey: "review:key" };
const outcome = { outcomeStatus: "IMPROVED" as const, outcomeNarrative: "The reviewed retry improved.", outcomeIdempotencyKey: "outcome:key" };

describe("retry-result resume boundary", () => {
  it("accepts terminal ESCALATE only without Outcome fields", () => {
    expect(RetryReviewResume.safeParse({ ...base, decision: "ESCALATE" }).success).toBe(true);
    expect(RetryReviewResume.safeParse({ ...base, ...outcome, decision: "ESCALATE" }).success).toBe(false);
  });

  it("requires complete Outcome fields for ACCEPT", () => {
    expect(RetryReviewResume.safeParse({ ...base, decision: "ACCEPT" }).success).toBe(false);
    expect(RetryReviewResume.safeParse({ ...base, ...outcome, decision: "ACCEPT" }).success).toBe(true);
  });

  it("requires correction and Outcome fields for CORRECT", () => {
    expect(RetryReviewResume.safeParse({ ...base, ...outcome, decision: "CORRECT" }).success).toBe(false);
    expect(RetryReviewResume.safeParse({ ...base, ...outcome, decision: "CORRECT", correction: "Correct the unit conversion." }).success).toBe(true);
  });

  it("requires supplement and Outcome fields for SUPPLEMENT", () => {
    expect(RetryReviewResume.safeParse({ ...base, ...outcome, decision: "SUPPLEMENT" }).success).toBe(false);
    expect(RetryReviewResume.safeParse({ ...base, ...outcome, decision: "SUPPLEMENT", supplement: "Add the missing evidence." }).success).toBe(true);
  });
});
