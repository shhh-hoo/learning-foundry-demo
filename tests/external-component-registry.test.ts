import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import resourceDocument from "../config/external-learning-components/resources.json";
import governanceSchema from "../config/external-learning-components/schema.json";
import {
  deriveExternalComponentRegistry,
  loadExternalComponentRegistry,
  parseReviewDecisionLog,
} from "../src/external-components/registry";
import type {
  ExternalComponentReviewDecision,
  ExternalLearningComponent,
} from "../src/external-components/types";

function reviewedLink(): ExternalLearningComponent {
  return {
    schemaVersion: "1.0.0",
    id: "reviewed-link",
    version: "1.0.0",
    provider: "Reviewed Provider",
    providerResourceId: "resource-1",
    title: "Reviewed resource",
    description: "Synthetic reviewed fixture.",
    subjects: ["Mathematics"],
    concepts: ["linear-functions"],
    curriculumAlignments: [],
    integrationMode: "LINK_ONLY",
    launch: { url: "https://example.edu/activity" },
    rights: {
      licenseId: "LicenseRef-Synthetic",
      termsEvidenceRef: "terms:reviewed-link:1",
      attribution: "Reviewed Provider",
      commercialUse: "REVIEW_REQUIRED",
      modification: "REVIEW_REQUIRED",
      redistribution: "REVIEW_REQUIRED",
    },
    privacy: {
      sendsLearnerData: true,
      dataCategories: ["NETWORK_METADATA"],
      destination: "example.edu",
      cookieOrTrackingStatus: "UNKNOWN",
      approvalStatus: "REVIEW_REQUIRED",
    },
    accessibilityNotes: ["Synthetic review fixture only."],
    evidence: { launchTrace: true, completionSignal: "NONE", outcomeEligible: false },
    status: "REVIEW_REQUIRED",
  };
}

function approval(): ExternalComponentReviewDecision {
  return {
    schemaVersion: "1.0.0",
    decisionId: "decision-reviewed-link-1",
    componentId: "reviewed-link",
    componentVersion: "1.0.0",
    reviewer: "synthetic-reviewer",
    reviewedAt: "2026-07-17T00:00:00.000Z",
    termsEvidence: {
      url: "https://example.edu/terms",
      evidenceRef: "terms:reviewed-link:1",
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    deploymentScope: "SYNTHETIC_TEST",
    rightsDecision: "APPROVED",
    privacyDecision: "APPROVED",
    trackingDecision: "APPROVED",
    accessibilityDecision: "APPROVED",
    status: "APPROVED_LINK_ONLY",
  };
}

describe("external component registry", () => {
  it("keeps the versioned Git snapshot valid against its published schema", () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(governanceSchema);
    expect(validate(resourceDocument), validate.errors?.map((error) => `${error.instancePath} ${error.message}`).join("; ")).toBe(true);
  });

  it("keeps every committed provider visible but non-launchable and Outcome-ineligible", () => {
    const registry = loadExternalComponentRegistry();

    expect(registry.components.length).toBeGreaterThanOrEqual(3);
    expect(registry.components.every((item) => item.evidence.outcomeEligible === false)).toBe(true);
    expect(registry.components.every((item) => item.currentStatus === "DISCOVERED" || item.currentStatus === "REVIEW_REQUIRED" || item.currentStatus === "DISABLED")).toBe(true);
    expect(registry.components.every((item) => item.authorizedDeploymentScopes.length === 0)).toBe(true);
  });

  it("keeps every real resource disabled when the review-decision log is empty", () => {
    const registry = deriveExternalComponentRegistry(resourceDocument.components, []);

    expect(registry.components.every((item) => !item.currentStatus.startsWith("APPROVED_"))).toBe(true);
    expect(registry.components.every((item) => item.authorizedDeploymentScopes.length === 0)).toBe(true);
  });

  it("derives a deployment-specific approved link only from a complete latest decision", () => {
    const registry = deriveExternalComponentRegistry([reviewedLink()], [approval()]);

    expect(registry.get("reviewed-link")?.currentStatus).toBe("APPROVED_LINK_ONLY");
    expect(registry.get("reviewed-link")?.authorizedDeploymentScopes).toEqual(["SYNTHETIC_TEST"]);
  });

  it("rejects duplicate or broken append-only review history", () => {
    const decision = approval();
    expect(() => deriveExternalComponentRegistry([reviewedLink()], [decision, decision])).toThrow(/duplicate decision/i);
    expect(() => parseReviewDecisionLog('{"decisionId":"broken"}\n')).toThrow(/review decision/i);
  });

  it("derives revocation from a later decision without deleting the approval record", () => {
    const approved = approval();
    const revoked: ExternalComponentReviewDecision = {
      ...approved,
      decisionId: "decision-reviewed-link-2",
      reviewedAt: "2026-07-17T01:00:00.000Z",
      rightsDecision: "REVIEW_REQUIRED",
      privacyDecision: "REVIEW_REQUIRED",
      trackingDecision: "REVIEW_REQUIRED",
      accessibilityDecision: "REVIEW_REQUIRED",
      status: "REVOKED",
      supersedesDecisionId: approved.decisionId,
    };
    const registry = deriveExternalComponentRegistry([reviewedLink()], [approved, revoked]);

    expect(registry.get("reviewed-link")?.currentStatus).toBe("DISABLED");
    expect(registry.get("reviewed-link")?.latestDecision?.decisionId).toBe(revoked.decisionId);
    expect(registry.get("reviewed-link")?.authorizedDeploymentScopes).toEqual([]);
  });

  it("does not accept an approval claim from the resource snapshot without a review decision", () => {
    expect(() => deriveExternalComponentRegistry([{ ...reviewedLink(), status: "APPROVED_LINK_ONLY" }], [])).toThrow(/review decision/i);
  });
});
