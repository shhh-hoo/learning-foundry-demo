import { describe, expect, it } from "vitest";
import {
  ROUTING_OPTIMIZATION_LIMITATIONS,
  ROUTING_OPTIMIZATION_RATIONALE,
  ROUTING_OPTIMIZATION_RULE,
  RoutingOptimizationDecisionAction,
  deriveTeacherOverrideRoutingChange,
  routingOptimizationHash,
  routingOptimizationId,
} from "@/domain/routing-optimization";

const candidate = {
  capabilityId: "50000000-0000-4000-8000-000000000001",
  capabilityKey: "chemistry-molar-concentration",
  capabilityName: "Molar concentration trainer",
  versionId: "50000000-0000-4000-8000-000000000011",
  version: "1.0.0",
  eligibility: "ELIGIBLE",
  exclusionReasons: [],
};

const resolution = {
  id: "10000000-0000-4000-8000-000000000001",
  policyVersion: "cap-02.1",
  decision: "EXISTING",
  selectedCapabilityId: candidate.capabilityId,
  selectedCapabilityVersionId: candidate.versionId,
  candidates: [candidate, { ...candidate, capabilityId: "50000000-0000-4000-8000-000000000002", versionId: "50000000-0000-4000-8000-000000000012", eligibility: "EXCLUDED", exclusionReasons: ["TEACHER_EXCLUDED"] }],
};

const signal = {
  interventionId: "20000000-0000-4000-8000-000000000001",
  actionType: "EXCLUDE_CAPABILITY",
  constraintCapabilityId: candidate.capabilityId,
  reason: "Use another modality before this exact trainer in the next cycle.",
};

describe("CAP-08B Routing Optimization contract", () => {
  it("keeps deterministic evidence identity independent of object key order", () => {
    expect(routingOptimizationHash({ b: 2, a: { d: 4, c: 3 } })).toBe(routingOptimizationHash({ a: { c: 3, d: 4 }, b: 2 }));
    expect(routingOptimizationId("proposal", { interventionId: "one" })).toMatch(/^[0-9a-f-]{36}$/);
    expect(routingOptimizationId("proposal", { interventionId: "one" })).toBe(routingOptimizationId("proposal", { interventionId: "one" }));
  });

  it("exposes only bounded human next actions and Routing-only non-claims", () => {
    expect(RoutingOptimizationDecisionAction.options).toEqual(["REQUEST_POLICY_REVIEW", "KEEP_CURRENT_POLICY"]);
    expect(ROUTING_OPTIMIZATION_RULE).toEqual({ key: "cap08b.teacher-exclusion-selected-route-review", version: "1.0.0", confidence: 0.55 });
    expect(ROUTING_OPTIMIZATION_RATIONALE).toContain("Attempt is lineage only");
    expect(ROUTING_OPTIMIZATION_LIMITATIONS).toEqual(expect.arrayContaining([
      "ATTEMPT_LINEAGE_NOT_ROUTING_VERDICT",
      "NO_ASSET_OPTIMIZATION",
      "NO_LEARNING_STRATEGY_OPTIMIZATION",
      "NO_AUTOMATIC_POLICY_CHANGE",
      "CURRENT_POLICY_REMAINS_ACTIVE",
    ]));
  });

  it("derives only from an exact selected-Capability teacher exclusion", () => {
    expect(deriveTeacherOverrideRoutingChange(signal, resolution)).toMatchObject({
      optimizationDomain: "ROUTING",
      changeKind: "REVIEW_SELECTION_POLICY_FOR_TEACHER_EXCLUSION",
      selectedCapabilityId: candidate.capabilityId,
      selectedCapabilityVersionId: candidate.versionId,
      teacherInterventionId: signal.interventionId,
      currentPolicyRemainsActive: true,
      rankingChanged: false,
      eligibilityRuleChanged: false,
    });
    expect(() => deriveTeacherOverrideRoutingChange({ ...signal, actionType: "REQUIRE_CAPABILITY" }, resolution)).toThrow(/explicit teacher exclusion/);
    expect(() => deriveTeacherOverrideRoutingChange({ ...signal, constraintCapabilityId: "50000000-0000-4000-8000-000000000002" }, resolution)).toThrow(/explicit teacher exclusion/);
    expect(() => deriveTeacherOverrideRoutingChange(signal, { ...resolution, candidates: [] })).toThrow(/exact eligible selected candidate/);
  });
});
