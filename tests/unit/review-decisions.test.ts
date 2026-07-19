import { describe, expect, it } from "vitest";
import { isEligibleReviewDecision, parseReviewDecision, requireEligibleReviewDecision } from "@/domain/review";

describe("Review decision semantics", () => {
  it("accepts ACCEPT without corrective payload", () => {
    expect(parseReviewDecision({ decision: "ACCEPT" })).toEqual({ decision: "ACCEPT", correction: undefined, supplement: undefined });
    expect(isEligibleReviewDecision("ACCEPT")).toBe(true);
  });

  it("requires and normalizes a CORRECT correction", () => {
    expect(() => parseReviewDecision({ decision: "CORRECT", correction: "  " })).toThrowError(/non-empty correction/);
    expect(parseReviewDecision({ decision: "CORRECT", correction: "  Correct the unit conversion.  " }).correction).toBe("Correct the unit conversion.");
    expect(isEligibleReviewDecision("CORRECT")).toBe(true);
  });

  it("requires and normalizes a SUPPLEMENT supplement", () => {
    expect(() => parseReviewDecision({ decision: "SUPPLEMENT", supplement: "" })).toThrowError(/non-empty supplement/);
    expect(parseReviewDecision({ decision: "SUPPLEMENT", supplement: "  Add the missing evidence.  " }).supplement).toBe("Add the missing evidence.");
    expect(isEligibleReviewDecision("SUPPLEMENT")).toBe(true);
  });

  it("records ESCALATE but never treats it as transition authority", () => {
    expect(parseReviewDecision({ decision: "ESCALATE" }).decision).toBe("ESCALATE");
    expect(isEligibleReviewDecision("ESCALATE")).toBe(false);
    expect(() => requireEligibleReviewDecision("ESCALATE", "Retry")).toThrowError(/cannot authorize Retry/);
  });

  it("rejects decisions outside the domain enum", () => {
    expect(() => parseReviewDecision({ decision: "APPROVE" })).toThrowError(/invalid/);
  });
});
