import { createHash } from "node:crypto";
import { z } from "zod";
import { stableAssetRuntimeJson } from "@/domain/asset-runtime";

export const WEB_COMPONENT_ASSET_TEMPLATE = "foundry.web.pause-predict.v1";
export const WEB_COMPONENT_ASSET_RUNTIME_KIND = "TRUSTED_WEB_COMPONENT";
export const WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY = "foundry.web.pause-predict";
export const WEB_COMPONENT_ASSET_EXECUTOR_VERSION = "cap-07.shared-web-executor.v1";

const Choice = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().trim().min(1).max(240),
}).strict();

const PackageFields = {
  packageType: z.literal("DECLARATIVE_WEB_COMPONENT_ASSET"),
  templateKey: z.literal(WEB_COMPONENT_ASSET_TEMPLATE),
  title: z.string().trim().min(3).max(120),
  purpose: z.string().trim().min(10).max(600),
  instructions: z.string().trim().min(10).max(1_000),
  prompt: z.string().trim().min(5).max(1_000),
  choices: z.array(Choice).min(2).max(5),
  correctChoiceId: z.string().regex(/^[a-z0-9-]+$/),
  correctFeedback: z.string().trim().min(5).max(1_000),
  retryFeedback: z.string().trim().min(5).max(1_000),
  language: z.string().trim().min(2).max(35),
  interactionMode: z.literal("STATELESS_ONE_SHOT"),
  accessibility: z.object({
    keyboardOperable: z.literal(true),
    visibleLabels: z.literal(true),
    statusAnnouncement: z.literal(true),
    reducedMotionSafe: z.literal(true),
  }).strict(),
  eventContract: z.tuple([
    z.literal("COMPONENT_STARTED"),
    z.literal("LEARNER_RESPONSE_SUBMITTED"),
    z.literal("COMPONENT_COMPLETED"),
  ]),
  rights: z.object({ basis: z.literal("FOUNDRY_INTERNAL_TEMPLATE"), status: z.literal("NOT_REQUIRED") }).strict(),
  externalDependencies: z.tuple([]),
  provider: z.null(),
} as const;

function validateChoices(value: { choices: Array<{ id: string }>; correctChoiceId: string }, context: z.RefinementCtx) {
  const ids = value.choices.map((choice) => choice.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Choice ids must be unique", path: ["choices"] });
  if (!ids.includes(value.correctChoiceId)) context.addIssue({ code: "custom", message: "Correct choice must reference a declared choice", path: ["correctChoiceId"] });
}

export const SourceWebComponentAssetContract = z.object({
  contractType: z.literal("WEB_COMPONENT_ASSET"),
  contractVersion: z.literal("cap-07.1"),
  title: z.string().trim().min(3),
  purpose: z.string().trim().min(10),
  referencePackKey: z.string().trim().min(1),
  origin: z.literal("REVIEWED_REFERENCE_PACK"),
  templateKey: z.literal(WEB_COMPONENT_ASSET_TEMPLATE),
  implementationKey: z.literal(WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY),
  runtimeKind: z.literal(WEB_COMPONENT_ASSET_RUNTIME_KIND),
  arbitraryCodeAllowed: z.literal(false),
  availabilityScope: z.literal("INSTITUTION_COURSE_PRIVATE"),
}).strict();

export type SourceWebComponentAssetContract = z.infer<typeof SourceWebComponentAssetContract>;

export const SourceWebComponentAssetPackage = z.object({
  ...PackageFields,
  packageRole: z.literal("SOURCE"),
}).strict().superRefine(validateChoices);

export type SourceWebComponentAssetPackage = z.infer<typeof SourceWebComponentAssetPackage>;

const EmbeddedSource = z.object({
  componentVersionId: z.string().uuid(),
  contentHash: z.string().trim().min(8),
  contract: SourceWebComponentAssetContract,
  package: SourceWebComponentAssetPackage,
}).strict();

export const AdaptedWebComponentAssetPackage = z.object({
  ...PackageFields,
  packageRole: z.literal("ADAPTED"),
  adaptation: z.object({
    kind: z.literal("SOURCE_BEHAVIOR_WITH_DIAGNOSTIC_SCAFFOLD"),
    source: EmbeddedSource,
    correctFeedbackPrefix: z.string().trim().min(5).max(240),
    retryFeedbackPrefix: z.string().trim().min(5).max(240),
  }).strict(),
}).strict().superRefine((value, context) => {
  validateChoices(value, context);
  const source = value.adaptation.source.package;
  if (source.correctChoiceId !== value.correctChoiceId
    || JSON.stringify(source.choices) !== JSON.stringify(value.choices)) {
    context.addIssue({ code: "custom", message: "Adapted interaction must invoke the exact source choice behavior", path: ["adaptation", "source", "package"] });
  }
  if (webComponentAssetHash(value.adaptation.source.contract, source) !== value.adaptation.source.contentHash) {
    context.addIssue({ code: "custom", message: "Embedded source package does not match its exact ComponentAssetVersion hash", path: ["adaptation", "source", "contentHash"] });
  }
});

export const WebComponentAssetPackage = z.union([SourceWebComponentAssetPackage, AdaptedWebComponentAssetPackage]);
export type WebComponentAssetPackage = z.infer<typeof WebComponentAssetPackage>;

export const WebComponentAssetContract = z.object({
  contractType: z.literal("WEB_COMPONENT_ASSET"),
  contractVersion: z.literal("cap-07.1"),
  title: z.string().trim().min(3),
  purpose: z.string().trim().min(10),
  referencePackKey: z.string().trim().min(1),
  supplyStrategy: z.literal("ADAPT"),
  dataClassification: z.literal("DEIDENTIFIED_INSTRUCTIONAL"),
  adaptationSource: z.object({
    capabilityId: z.string().uuid(),
    capabilityVersionId: z.string().uuid(),
    capabilityVersion: z.string().trim().min(1),
    capabilityVersionContentHash: z.string().trim().min(8),
    capabilityKey: z.string().trim().min(1),
    componentAssetVersionId: z.string().uuid(),
    componentAssetVersionContentHash: z.string().trim().min(8),
    transformation: z.literal("SOURCE_BEHAVIOR_WITH_DIAGNOSTIC_SCAFFOLD"),
  }).strict(),
  templateKey: z.literal(WEB_COMPONENT_ASSET_TEMPLATE),
  implementationKey: z.literal(WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY),
  runtimeKind: z.literal(WEB_COMPONENT_ASSET_RUNTIME_KIND),
  arbitraryCodeAllowed: z.literal(false),
  learnerPreviewRequired: z.literal(true),
  humanConfirmationRequired: z.literal(true),
  availabilityScope: z.literal("INSTITUTION_COURSE_PRIVATE"),
  explicitNonClaims: z.tuple([
    z.literal("PREVIEW_IS_NOT_LEARNER_DELIVERY"),
    z.literal("RUNTIME_COMPLETION_IS_NOT_DIAGNOSIS"),
    z.literal("RUNTIME_COMPLETION_IS_NOT_LEARNING_OUTCOME"),
  ]),
}).strict();

export type WebComponentAssetContract = z.infer<typeof WebComponentAssetContract>;

export const WebComponentAdaptationSource = z.object({
  capabilityId: z.string().uuid(),
  capabilityVersionId: z.string().uuid(),
  capabilityVersion: z.string().trim().min(1),
  capabilityVersionContentHash: z.string().trim().min(8),
  capabilityKey: z.string().trim().min(1),
  capabilityName: z.string().trim().min(1),
  componentAssetVersionId: z.string().uuid(),
  componentAssetVersionContentHash: z.string().trim().min(8),
  componentAssetContract: SourceWebComponentAssetContract,
  componentAssetPackage: SourceWebComponentAssetPackage,
}).strict();

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Wraps one exact reviewed executable source package. The adapted executor
 * still invokes the embedded source behavior, then adds bounded feedback
 * scaffolding. No Task, Attempt, Diagnosis or learner prose enters this API.
 */
export function adaptCapabilityToWebComponentAsset(rawSource: unknown): z.infer<typeof AdaptedWebComponentAssetPackage> {
  const source = WebComponentAdaptationSource.parse(rawSource);
  if (webComponentAssetHash(source.componentAssetContract, source.componentAssetPackage) !== source.componentAssetVersionContentHash) {
    throw new Error("Exact source ComponentAssetVersion package/hash mismatch");
  }
  return AdaptedWebComponentAssetPackage.parse({
    ...source.componentAssetPackage,
    packageRole: "ADAPTED",
    title: bounded(`${source.capabilityName}: guided source interaction`, 120),
    purpose: bounded(`Adapt the reviewed ${source.capabilityName} Web ComponentAsset with explicit reasoning feedback while preserving its exact executable choice behavior.`, 600),
    instructions: "Complete the exact reviewed source interaction. The adapted wrapper adds an explicit verification cue to the source result; it does not replace the source behavior or save internal state.",
    correctFeedback: `Verified source behavior: ${source.componentAssetPackage.correctFeedback}`,
    retryFeedback: `Recheck the source relation before retrying: ${source.componentAssetPackage.retryFeedback}`,
    adaptation: {
      kind: "SOURCE_BEHAVIOR_WITH_DIAGNOSTIC_SCAFFOLD",
      source: {
        componentVersionId: source.componentAssetVersionId,
        contentHash: source.componentAssetVersionContentHash,
        contract: source.componentAssetContract,
        package: source.componentAssetPackage,
      },
      correctFeedbackPrefix: "Verified source behavior:",
      retryFeedbackPrefix: "Recheck the source relation before retrying:",
    },
  });
}

export const WebComponentAssetInput = z.object({
  selectedChoiceId: z.string().regex(/^[a-z0-9-]+$/),
}).strict();

export const WebComponentAssetDeliveryRequest = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  activityPlanProposalId: z.string().uuid(),
  retryOfDeliveryId: z.string().uuid().optional(),
  selectedChoiceId: z.string().regex(/^[a-z0-9-]+$/),
  idempotencyKey: z.string().min(8),
}).strict();

function executeSourcePackage(asset: SourceWebComponentAssetPackage, learnerInput: z.infer<typeof WebComponentAssetInput>) {
  const selected = asset.choices.find((choice) => choice.id === learnerInput.selectedChoiceId);
  if (!selected) throw new z.ZodError([{ code: "custom", message: "Selected choice is not part of this exact ComponentAssetVersion", path: ["selectedChoiceId"] }]);
  const correct = selected.id === asset.correctChoiceId;
  return {
    componentCompleted: true,
    correct,
    selectedChoiceId: selected.id,
    feedback: correct ? asset.correctFeedback : asset.retryFeedback,
    events: ["COMPONENT_STARTED", "LEARNER_RESPONSE_SUBMITTED", "COMPONENT_COMPLETED"],
    nonClaims: ["NOT_DIAGNOSIS", "NOT_LEARNING_OUTCOME"],
  };
}

export function executeWebComponentAsset(componentPackage: unknown, input: unknown) {
  const asset = WebComponentAssetPackage.parse(componentPackage);
  const learnerInput = WebComponentAssetInput.parse(input);
  if (asset.packageRole === "SOURCE") return executeSourcePackage(asset, learnerInput);
  const sourceOutput = executeSourcePackage(asset.adaptation.source.package, learnerInput);
  return {
    ...sourceOutput,
    feedback: sourceOutput.correct ? asset.correctFeedback : asset.retryFeedback,
    adaptationApplied: asset.adaptation.kind,
    sourceComponentAssetVersionId: asset.adaptation.source.componentVersionId,
    sourceComponentAssetVersionContentHash: asset.adaptation.source.contentHash,
  };
}

export function webComponentAssetHash(contract: unknown, componentPackage: unknown): string {
  return `sha256:${createHash("sha256").update(stableAssetRuntimeJson({ contract, componentPackage })).digest("hex")}`;
}

export function executeHashBoundWebComponentAsset(input: {
  componentVersionId: string;
  contentHash: string;
  contract: unknown;
  componentPackage: unknown;
  learnerInput: unknown;
  previewOnly: boolean;
}) {
  const contract = input.componentPackage && (input.componentPackage as { packageRole?: unknown }).packageRole === "SOURCE"
    ? SourceWebComponentAssetContract.parse(input.contract)
    : WebComponentAssetContract.parse(input.contract);
  const componentPackage = WebComponentAssetPackage.parse(input.componentPackage);
  if (webComponentAssetHash(contract, componentPackage) !== input.contentHash) {
    throw new Error("Web ComponentAsset contract/package does not match the exact immutable content hash");
  }
  const learnerInput = WebComponentAssetInput.parse(input.learnerInput);
  const runtimeOutput = executeWebComponentAsset(componentPackage, learnerInput);
  const eventTrace = runtimeOutput.events.map((eventType, index) => ({ sequence: index + 1, eventType, previewOnly: input.previewOnly }));
  const executorReceiptHash = `sha256:${createHash("sha256").update(JSON.stringify({
    executorVersion: WEB_COMPONENT_ASSET_EXECUTOR_VERSION,
    componentVersionId: input.componentVersionId,
    contentHash: input.contentHash,
    learnerInput,
    runtimeOutput,
    eventTrace,
  })).digest("hex")}`;
  return { learnerInput, runtimeOutput, eventTrace, executorReceiptHash, executorVersion: WEB_COMPONENT_ASSET_EXECUTOR_VERSION };
}
