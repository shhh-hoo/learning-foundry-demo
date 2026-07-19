import type { Actor } from "@/domain/model";
import { DomainInvariantError } from "@/domain/invariants";

export type DeliveryPolicy = {
  distributionScope: "PUBLIC" | "INSTITUTION" | "PRIVATE";
  allowedPurposes: string[];
  institutionId?: string | null;
};

export type EvidenceAlignment = {
  courseIds?: unknown;
  referencePackKey?: unknown;
  [key: string]: unknown;
};

export function authorizeEvidence(actor: Actor, policy: DeliveryPolicy, purpose: string): void {
  if (!policy.allowedPurposes.includes(purpose)) {
    throw new DomainInvariantError("Evidence purpose is not authorized", "EVIDENCE_PURPOSE_DENIED");
  }
  if (policy.distributionScope !== "PUBLIC" && policy.institutionId !== actor.institutionId) {
    throw new DomainInvariantError("Evidence is outside the actor's institution", "EVIDENCE_TENANT_DENIED");
  }
}

export function authorizePersistedEvidence(actor: Actor, policy: Omit<DeliveryPolicy, "distributionScope"> & { distributionScope: string; rightsAuthorizationStatus: string }, purpose: string): void {
  if (policy.rightsAuthorizationStatus !== "APPROVED") {
    throw new DomainInvariantError("Evidence rights are not explicitly approved", "EVIDENCE_RIGHTS_DENIED");
  }
  if (!(["PUBLIC", "INSTITUTION", "PRIVATE"] as const).includes(policy.distributionScope as DeliveryPolicy["distributionScope"])) {
    throw new DomainInvariantError("Evidence distribution scope is not recognized", "EVIDENCE_POLICY_INVALID");
  }
  authorizeEvidence(actor, policy as DeliveryPolicy, purpose);
}

export function evidenceAlignsToCourse(metadata: EvidenceAlignment, courseId: string, referencePackKey: string): boolean {
  const courseIds = Array.isArray(metadata.courseIds) ? metadata.courseIds.filter((value): value is string => typeof value === "string") : [];
  return courseIds.includes(courseId) || metadata.referencePackKey === referencePackKey;
}

export function authorizeEvidenceUnitInstitution(actor: Actor, institutionId?: string | null): void {
  if (institutionId && institutionId !== actor.institutionId) {
    throw new DomainInvariantError("Evidence Unit is outside the actor's institution", "EVIDENCE_TENANT_DENIED");
  }
}

export function assertCitationIntegrity(citations: Array<{ sourceId?: string; locator?: string }>): void {
  if (citations.some((citation) => !citation.sourceId || !citation.locator)) {
    throw new DomainInvariantError("Every citation must resolve to a source and locator", "INVALID_CITATION");
  }
}
