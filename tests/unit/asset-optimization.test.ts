import { describe, expect, it } from "vitest";
import {
  ASSET_OPTIMIZATION_LIMITATIONS,
  ASSET_OPTIMIZATION_RULE,
  AssetOptimizationDecisionAction,
  assetOptimizationHash,
  assetOptimizationId,
  deriveAttemptDrivenAssetChange,
} from "@/domain/asset-optimization";

const exactPackage = {
  packageType: "DECLARATIVE_WEB_COMPONENT_ASSET",
  packageRole: "SOURCE",
  templateKey: "foundry.web.pause-predict.v1",
  title: "Exact relation check",
  purpose: "Check one exact relation without claiming a learning outcome.",
  instructions: "Choose the exact reviewed relation and inspect the returned feedback.",
  prompt: "Which relation is correct?",
  choices: [{ id: "correct", label: "Correct relation" }, { id: "inverse", label: "Inverse relation" }],
  correctChoiceId: "correct",
  correctFeedback: "Correct relation selected.",
  retryFeedback: "Recheck the numerator and denominator.",
  language: "en",
  interactionMode: "STATELESS_ONE_SHOT",
  accessibility: { keyboardOperable: true, visibleLabels: true, statusAnnouncement: true, reducedMotionSafe: true },
  eventContract: ["COMPONENT_STARTED", "LEARNER_RESPONSE_SUBMITTED", "COMPONENT_COMPLETED"],
  rights: { basis: "FOUNDRY_INTERNAL_TEMPLATE", status: "NOT_REQUIRED" },
  externalDependencies: [],
  provider: null,
} as const;

describe("CAP-08A Asset Optimization contract", () => {
  it("keeps deterministic evidence identity independent of object key order", () => {
    expect(assetOptimizationHash({ b: 2, a: { d: 4, c: 3 } })).toBe(assetOptimizationHash({ a: { c: 3, d: 4 }, b: 2 }));
    expect(assetOptimizationId("proposal", { deliveryId: "one" })).toMatch(/^[0-9a-f-]{36}$/);
    expect(assetOptimizationId("proposal", { deliveryId: "one" })).toBe(assetOptimizationId("proposal", { deliveryId: "one" }));
  });

  it("exposes only bounded human next actions and explicit non-claims", () => {
    expect(AssetOptimizationDecisionAction.options).toEqual(["REQUEST_SUCCESSOR", "KEEP_CURRENT"]);
    expect(ASSET_OPTIMIZATION_RULE).toMatchObject({ key: "cap08a.incorrect-attempt-distractor-feedback-review", version: "1.1.0", confidence: 0.35 });
    expect(ASSET_OPTIMIZATION_LIMITATIONS).toEqual(expect.arrayContaining(["ONE_ATTEMPT_ONLY", "NO_EFFECTIVENESS_CLAIM", "NO_ROUTING_OPTIMIZATION", "NO_LEARNING_STRATEGY_OPTIMIZATION", "CURRENT_VERSION_REMAINS_ACTIVE"]));
  });

  it("derives an exact-package change and rejects undeclared or correct choices", () => {
    expect(deriveAttemptDrivenAssetChange(exactPackage, "inverse")).toMatchObject({
      changeKind: "ADD_DISTRACTOR_SPECIFIC_RETRY_FEEDBACK",
      selectedChoiceId: "inverse",
      selectedChoiceLabel: "Inverse relation",
      currentRetryFeedback: exactPackage.retryFeedback,
      currentVersionRemainsActive: true,
    });
    expect(() => deriveAttemptDrivenAssetChange(exactPackage, "correct")).toThrow(/incorrect choice declared by the exact/);
    expect(() => deriveAttemptDrivenAssetChange(exactPackage, "not-declared")).toThrow(/incorrect choice declared by the exact/);
  });
});
