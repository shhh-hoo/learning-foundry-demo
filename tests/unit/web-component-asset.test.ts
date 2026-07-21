import { describe, expect, it } from "vitest";
import {
  adaptCapabilityToWebComponentAsset,
  executeHashBoundWebComponentAsset,
  executeWebComponentAsset,
  SourceWebComponentAssetContract,
  SourceWebComponentAssetPackage,
  WebComponentAssetContract,
  WebComponentAssetPackage,
  WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
  WEB_COMPONENT_ASSET_RUNTIME_KIND,
  WEB_COMPONENT_ASSET_TEMPLATE,
  webComponentAssetHash,
} from "@/domain/web-component-asset";

const sourceContract = SourceWebComponentAssetContract.parse({
  contractType: "WEB_COMPONENT_ASSET",
  contractVersion: "cap-07.1",
  title: "Reviewed equation source",
  purpose: "Execute the reviewed relationship check as a real source Web ComponentAsset.",
  referencePackKey: "chemistry-caie-9701",
  origin: "REVIEWED_REFERENCE_PACK",
  templateKey: WEB_COMPONENT_ASSET_TEMPLATE,
  implementationKey: WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
  runtimeKind: WEB_COMPONENT_ASSET_RUNTIME_KIND,
  arbitraryCodeAllowed: false,
  availabilityScope: "INSTITUTION_COURSE_PRIVATE",
});

const sourcePackage = SourceWebComponentAssetPackage.parse({
  packageType: "DECLARATIVE_WEB_COMPONENT_ASSET",
  packageRole: "SOURCE",
  templateKey: WEB_COMPONENT_ASSET_TEMPLATE,
  title: "Reviewed equation source",
  purpose: "Check the reviewed input-to-output relationship with one executable choice interaction.",
  instructions: "Choose the exact reviewed relationship that preserves the declared input-to-output behavior.",
  prompt: "Which relationship preserves the reviewed source behavior?",
  choices: [
    { id: "source-contract", label: "Check the declared inputs and apply the reviewed relation." },
    { id: "unsupported-answer", label: "Record an answer without checking the source relation." },
  ],
  correctChoiceId: "source-contract",
  correctFeedback: "The exact reviewed source relation was preserved.",
  retryFeedback: "Return to the exact reviewed source relation before answering.",
  language: "en",
  interactionMode: "STATELESS_ONE_SHOT",
  accessibility: { keyboardOperable: true, visibleLabels: true, statusAnnouncement: true, reducedMotionSafe: true },
  eventContract: ["COMPONENT_STARTED", "LEARNER_RESPONSE_SUBMITTED", "COMPONENT_COMPLETED"],
  rights: { basis: "FOUNDRY_INTERNAL_TEMPLATE", status: "NOT_REQUIRED" },
  externalDependencies: [],
  provider: null,
});

const sourceComponentVersionId = "10000000-0000-4000-8000-000000000003";
const sourceComponentVersionContentHash = webComponentAssetHash(sourceContract, sourcePackage);
const adaptationSource = {
  capabilityId: "10000000-0000-4000-8000-000000000001",
  capabilityVersionId: "10000000-0000-4000-8000-000000000002",
  capabilityVersion: "2.3.1",
  capabilityVersionContentHash: "sha256:reviewed-source-v2",
  capabilityKey: "reviewed-equation-check",
  capabilityName: "Reviewed equation checker",
  componentAssetVersionId: sourceComponentVersionId,
  componentAssetVersionContentHash: sourceComponentVersionContentHash,
  componentAssetContract: sourceContract,
  componentAssetPackage: sourcePackage,
} as const;

const componentPackage = adaptCapabilityToWebComponentAsset(adaptationSource);

function adaptedContract() {
  return WebComponentAssetContract.parse({
    contractType: "WEB_COMPONENT_ASSET",
    contractVersion: "cap-07.1",
    title: componentPackage.title,
    purpose: componentPackage.purpose,
    referencePackKey: "chemistry-caie-9701",
    supplyStrategy: "ADAPT",
    dataClassification: "DEIDENTIFIED_INSTRUCTIONAL",
    adaptationSource: {
      capabilityId: adaptationSource.capabilityId,
      capabilityVersionId: adaptationSource.capabilityVersionId,
      capabilityVersion: adaptationSource.capabilityVersion,
      capabilityVersionContentHash: adaptationSource.capabilityVersionContentHash,
      capabilityKey: adaptationSource.capabilityKey,
      componentAssetVersionId: sourceComponentVersionId,
      componentAssetVersionContentHash: sourceComponentVersionContentHash,
      transformation: "SOURCE_BEHAVIOR_WITH_DIAGNOSTIC_SCAFFOLD",
    },
    templateKey: WEB_COMPONENT_ASSET_TEMPLATE,
    implementationKey: WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
    runtimeKind: WEB_COMPONENT_ASSET_RUNTIME_KIND,
    arbitraryCodeAllowed: false,
    learnerPreviewRequired: true,
    humanConfirmationRequired: true,
    availabilityScope: "INSTITUTION_COURSE_PRIVATE",
    explicitNonClaims: ["PREVIEW_IS_NOT_LEARNER_DELIVERY", "RUNTIME_COMPLETION_IS_NOT_DIAGNOSIS", "RUNTIME_COMPLETION_IS_NOT_LEARNING_OUTCOME"],
  });
}

describe("CAP-07 declarative Web ComponentAsset", () => {
  it("materially adapts and still executes the exact source Web ComponentAsset behavior", () => {
    const parsed = WebComponentAssetPackage.parse(componentPackage);
    expect(parsed.packageRole).toBe("ADAPTED");
    if (parsed.packageRole !== "ADAPTED") throw new Error("Expected adapted package");
    expect(parsed.adaptation.source).toMatchObject({ componentVersionId: sourceComponentVersionId, contentHash: sourceComponentVersionContentHash, package: sourcePackage });
    expect(parsed.instructions).not.toBe(sourcePackage.instructions);
    expect(parsed.correctFeedback).not.toBe(sourcePackage.correctFeedback);
    expect(parsed.interactionMode).toBe("STATELESS_ONE_SHOT");
    expect(parsed).not.toHaveProperty("stateContract");

    const sourceResult = executeWebComponentAsset(sourcePackage, { selectedChoiceId: sourcePackage.correctChoiceId });
    const adaptedResult = executeWebComponentAsset(parsed, { selectedChoiceId: sourcePackage.correctChoiceId });
    expect(adaptedResult).toMatchObject({ componentCompleted: sourceResult.componentCompleted, correct: sourceResult.correct, selectedChoiceId: sourceResult.selectedChoiceId, sourceComponentAssetVersionId: sourceComponentVersionId });
    expect(adaptedResult.feedback).not.toBe(sourceResult.feedback);
    expect(adaptedResult.events).toEqual(sourcePackage.eventContract);
  });

  it("changes behavior only when the exact embedded source package changes", () => {
    const alternateSource = SourceWebComponentAssetPackage.parse({
      ...sourcePackage,
      prompt: "Which plotted relation preserves the reviewed signed gradient?",
      choices: [
        { id: "signed-gradient", label: "Use signed rise divided by signed run." },
        { id: "absolute-gradient", label: "Discard both signs before dividing." },
      ],
      correctChoiceId: "signed-gradient",
    });
    const alternate = adaptCapabilityToWebComponentAsset({
      ...adaptationSource,
      capabilityName: "Reviewed graph interpreter",
      componentAssetVersionContentHash: webComponentAssetHash(sourceContract, alternateSource),
      componentAssetPackage: alternateSource,
    });
    expect(alternate.prompt).toContain("signed gradient");
    expect(alternate.correctChoiceId).toBe("signed-gradient");
    expect(executeWebComponentAsset(alternate, { selectedChoiceId: "signed-gradient" })).toMatchObject({ correct: true });
  });

  it("uses one hash-bound executor for preview and delivery", () => {
    const contract = adaptedContract();
    const contentHash = webComponentAssetHash(contract, componentPackage);
    const preview = executeHashBoundWebComponentAsset({ componentVersionId: "10000000-0000-4000-8000-000000000004", contentHash, contract, componentPackage, learnerInput: { selectedChoiceId: sourcePackage.correctChoiceId }, previewOnly: true });
    const delivery = executeHashBoundWebComponentAsset({ componentVersionId: "10000000-0000-4000-8000-000000000004", contentHash, contract, componentPackage, learnerInput: { selectedChoiceId: sourcePackage.correctChoiceId }, previewOnly: false });
    expect(preview.runtimeOutput).toEqual(delivery.runtimeOutput);
    expect(preview.eventTrace.every((event) => event.previewOnly)).toBe(true);
    expect(delivery.eventTrace.every((event) => !event.previewOnly)).toBe(true);
    expect(preview.executorReceiptHash).not.toBe(delivery.executorReceiptHash);
    expect(() => executeHashBoundWebComponentAsset({ componentVersionId: "10000000-0000-4000-8000-000000000004", contentHash: `${contentHash}-changed`, contract, componentPackage, learnerInput: { selectedChoiceId: sourcePackage.correctChoiceId }, previewOnly: true })).toThrow(/exact immutable content hash/);
  });

  it("rejects undeclared choices, arbitrary fields and false reset/resume claims", () => {
    expect(() => executeWebComponentAsset(componentPackage, { selectedChoiceId: "injected" })).toThrow(/exact ComponentAssetVersion/);
    expect(() => WebComponentAssetPackage.parse({ ...componentPackage, script: "alert(1)" })).toThrow();
    expect(() => WebComponentAssetPackage.parse({ ...componentPackage, stateContract: { reset: true, resume: true } })).toThrow();
  });

  it("requires exact source ComponentAsset lineage, de-identification and explicit non-claims", () => {
    const contract = adaptedContract();
    expect(contract.adaptationSource).toMatchObject({ componentAssetVersionId: sourceComponentVersionId, componentAssetVersionContentHash: sourceComponentVersionContentHash });
    expect(() => WebComponentAssetContract.parse({ ...contract, supplyStrategy: "GENERATE" })).toThrow();
  });
});
