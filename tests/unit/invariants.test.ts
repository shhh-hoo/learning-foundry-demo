import { describe, expect, it } from "vitest";
import { ActivityType, StudyReviewActivityType, type Actor } from "@/domain/model";
import { DomainInvariantError, hasRole, requireCourseAccess, requireHumanCommand } from "@/domain/invariants";
import { authorizeEvidence, authorizeEvidenceUnitInstitution, authorizePersistedEvidence, assertCitationIntegrity, evidenceAlignsToCourse } from "@/domain/evidence";

const actor: Actor = { userId: "20000000-0000-4000-8000-000000000002", institutionId: "10000000-0000-4000-8000-000000000001", roles: ["TEACHER"], courseIds: ["40000000-0000-4000-8000-000000000001"], authMethod: "test", sessionId: "test-session" };

describe("product invariants", () => {
  it("exposes governed Retry, Transfer and Retention separately from Study Review", () => {
    expect(ActivityType.parse("RETRY")).toBe("RETRY");
    expect(ActivityType.parse("TRANSFER")).toBe("TRANSFER");
    expect(ActivityType.parse("RETENTION")).toBe("RETENTION");
    expect(ActivityType.safeParse("STUDY_REVIEW").success).toBe(false);
    expect(StudyReviewActivityType.parse("STUDY_REVIEW")).toBe("STUDY_REVIEW");
    expect(StudyReviewActivityType.safeParse("RETRY").success).toBe(false);
  });

  it("requires institution and course scope", () => {
    expect(() => requireCourseAccess(actor, actor.institutionId, actor.courseIds[0])).not.toThrow();
    expect(() => requireCourseAccess(actor, "10000000-0000-4000-8000-000000000099", actor.courseIds[0])).toThrowError(DomainInvariantError);
  });

  it("uses authenticated actor provenance for human commands", () => {
    expect(() => requireHumanCommand(actor, ["TEACHER"])).not.toThrow();
    expect(() => requireHumanCommand({ ...actor, sessionId: "" }, ["TEACHER"])).toThrowError(/provenance/);
  });

  it("enforces Evidence rights, purpose and citation identity", () => {
    expect(() => authorizeEvidence(actor, { distributionScope: "INSTITUTION", institutionId: actor.institutionId, allowedPurposes: ["TEACHING"] }, "TEACHING")).not.toThrow();
    expect(() => authorizeEvidence(actor, { distributionScope: "PRIVATE", institutionId: "10000000-0000-4000-8000-000000000099", allowedPurposes: ["TEACHING"] }, "TEACHING")).toThrowError(/institution/);
    expect(() => authorizeEvidence(actor, { distributionScope: "PUBLIC", allowedPurposes: ["TEACHING"] }, "LEARNING")).toThrowError(/purpose/);
    expect(() => authorizePersistedEvidence(actor, { rightsAuthorizationStatus: "APPROVED", distributionScope: "PUBLIC", allowedPurposes: ["LEARNING"] }, "LEARNING")).not.toThrow();
    expect(() => authorizePersistedEvidence(actor, { rightsAuthorizationStatus: "REVIEW_REQUIRED", distributionScope: "PUBLIC", allowedPurposes: ["LEARNING"] }, "LEARNING")).toThrowError(/rights/);
    expect(() => authorizePersistedEvidence(actor, { rightsAuthorizationStatus: "DENIED", distributionScope: "PUBLIC", allowedPurposes: ["LEARNING"] }, "LEARNING")).toThrowError(/rights/);
    expect(() => authorizePersistedEvidence(actor, { rightsAuthorizationStatus: "UNKNOWN", distributionScope: "PUBLIC", allowedPurposes: ["LEARNING"] }, "LEARNING")).toThrowError(/rights/);
    expect(() => authorizePersistedEvidence(actor, { rightsAuthorizationStatus: "APPROVED", distributionScope: "UNKNOWN", allowedPurposes: ["LEARNING"] }, "LEARNING")).toThrowError(/scope/);
    expect(() => authorizeEvidenceUnitInstitution(actor, actor.institutionId)).not.toThrow();
    expect(() => authorizeEvidenceUnitInstitution(actor, "10000000-0000-4000-8000-000000000099")).toThrowError(/institution/);
    expect(evidenceAlignsToCourse({ courseIds: [actor.courseIds[0]] }, actor.courseIds[0], "pack-a")).toBe(true);
    expect(evidenceAlignsToCourse({ referencePackKey: "pack-a" }, actor.courseIds[0], "pack-a")).toBe(true);
    expect(evidenceAlignsToCourse({ reviewed: true }, actor.courseIds[0], "pack-a")).toBe(false);
    expect(evidenceAlignsToCourse({ courseIds: ["other-course"], referencePackKey: "other-pack" }, actor.courseIds[0], "pack-a")).toBe(false);
    expect(() => assertCitationIntegrity([{ sourceId: actor.institutionId, locator: "note#one" }])).not.toThrow();
    expect(() => assertCitationIntegrity([{ sourceId: actor.institutionId }])).toThrowError(/citation/);
  });

  it("distinguishes authorized workspace roles", () => {
    expect(hasRole(actor, ["TEACHER", "ADMIN"])).toBe(true);
    expect(hasRole(actor, ["LEARNER", "ADMIN"])).toBe(false);
  });
});
