import { ReviewDecision } from "@/domain/model";
import { DomainInvariantError } from "@/domain/invariants";

export type ReviewDecisionValue = "ACCEPT" | "CORRECT" | "SUPPLEMENT" | "ESCALATE";

export type ReviewDecisionInput = {
  decision: unknown;
  correction?: string | null;
  supplement?: string | null;
};

export function parseReviewDecision(input: ReviewDecisionInput): {
  decision: ReviewDecisionValue;
  correction?: string;
  supplement?: string;
} {
  const parsed = ReviewDecision.safeParse(input.decision);
  if (!parsed.success) throw new DomainInvariantError("Review decision is invalid", "REVIEW_DECISION_INVALID");
  const correction = input.correction?.trim() || undefined;
  const supplement = input.supplement?.trim() || undefined;
  if (parsed.data === "CORRECT" && !correction) {
    throw new DomainInvariantError("CORRECT requires a non-empty correction", "REVIEW_CORRECTION_REQUIRED");
  }
  if (parsed.data === "SUPPLEMENT" && !supplement) {
    throw new DomainInvariantError("SUPPLEMENT requires a non-empty supplement", "REVIEW_SUPPLEMENT_REQUIRED");
  }
  return { decision: parsed.data, correction, supplement };
}

export function requireEligibleReviewDecision(decision: unknown, transition: string): ReviewDecisionValue {
  const parsed = ReviewDecision.safeParse(decision);
  if (!parsed.success) throw new DomainInvariantError("Stored Review decision is invalid", "REVIEW_DECISION_INVALID");
  if (parsed.data === "ESCALATE") {
    throw new DomainInvariantError(`ESCALATE cannot authorize ${transition}`, "REVIEW_ESCALATED");
  }
  return parsed.data;
}

export function isEligibleReviewDecision(decision: unknown): boolean {
  const parsed = ReviewDecision.safeParse(decision);
  return parsed.success && parsed.data !== "ESCALATE";
}

export function hasVerifiedReviewProvenance(review: {
  teacherId: string;
  actorProvenance: { userId?: string; institutionId?: string; authMethod?: string; sessionId?: string } | null;
}, institutionId: string): boolean {
  const provenance = review.actorProvenance;
  return Boolean(
    provenance
    && provenance.userId === review.teacherId
    && provenance.institutionId === institutionId
    && provenance.authMethod
    && provenance.sessionId
    && !provenance.authMethod.startsWith("migrated-"),
  );
}

export function requireVerifiedReviewProvenance(review: {
  teacherId: string;
  actorProvenance: { userId?: string; institutionId?: string; authMethod?: string; sessionId?: string } | null;
}, institutionId: string): void {
  if (!hasVerifiedReviewProvenance(review, institutionId)) {
    throw new DomainInvariantError("Review lacks verified authenticated human provenance", "REVIEW_PROVENANCE_INVALID");
  }
}
