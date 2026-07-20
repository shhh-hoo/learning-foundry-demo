import { z } from "zod";

export const GovernedFollowupType = z.enum(["RETRY", "TRANSFER", "RETENTION"]);
export type GovernedFollowupType = z.infer<typeof GovernedFollowupType>;

export const TransferSignature = z.object({
  context: z.string().trim().min(1).max(120),
  representation: z.string().trim().min(1).max(120),
  itemFamily: z.string().trim().min(1).max(120),
  problemStructure: z.string().trim().min(1).max(120),
}).strict();

function normalizedTransferDiscriminator(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export const TransferDeclaration = z.object({
  source: TransferSignature,
  target: TransferSignature,
  materialDifferenceRationale: z.string().trim().min(10).max(1_000),
  evidenceLimit: z.literal("TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN"),
}).strict().superRefine((value, context) => {
  if (normalizedTransferDiscriminator(value.source.context)
    === normalizedTransferDiscriminator(value.target.context)) {
    context.addIssue({
      code: "custom",
      path: ["target", "context"],
      message: "Transfer requires a materially different target context; wording-only change is rejected.",
    });
  }
  if (normalizedTransferDiscriminator(value.target.representation) !== "structured") {
    context.addIssue({
      code: "custom",
      path: ["target", "representation"],
      message: "The current governed Transfer runtime requires STRUCTURED representation.",
    });
  }
  if (normalizedTransferDiscriminator(value.source.itemFamily)
    !== normalizedTransferDiscriminator(value.target.itemFamily)) {
    context.addIssue({
      code: "custom",
      path: ["target", "itemFamily"],
      message: "The current governed Transfer runtime must keep the exact source Capability item family.",
    });
  }
  if (normalizedTransferDiscriminator(value.source.problemStructure)
    !== normalizedTransferDiscriminator(value.target.problemStructure)) {
    context.addIssue({
      code: "custom",
      path: ["target", "problemStructure"],
      message: "The current governed Transfer runtime must keep the exact source implementation structure.",
    });
  }
});

export const InterveningExposure = z.object({
  kind: z.enum(["NONE_DECLARED", "SAME_CONTENT", "RELATED_CONTENT", "UNKNOWN"]),
  detail: z.string().trim().min(1).max(1_000),
}).strict();

export const RetentionDeclaration = z.object({
  declaredDelaySeconds: z.number().int().positive().max(31_536_000),
  scheduledFor: z.string().datetime(),
  interveningExposure: InterveningExposure,
  contentEquivalence: z.object({
    kind: z.enum(["EXACT", "EQUIVALENT_FORM", "SAME_CONCEPT_DIFFERENT_ITEM"]),
    rationale: z.string().trim().min(5).max(1_000),
  }).strict(),
  assistancePolicy: z.object({
    kind: z.enum(["INDEPENDENT", "STANDARD_SUPPORT", "DECLARED_ASSISTANCE"]),
    allowed: z.string().trim().min(1).max(1_000),
  }).strict(),
}).strict();

const FollowupBase = {
  observationId: z.string().uuid(),
  reviewId: z.string().uuid(),
  prompt: z.string().trim().min(5).max(4_000),
  assignmentIdempotencyKey: z.string().min(8).max(240),
};

export const GovernedFollowupStart = z.discriminatedUnion("activityType", [
  z.object({ ...FollowupBase, activityType: z.literal("RETRY") }).strict(),
  z.object({
    ...FollowupBase,
    activityType: z.literal("TRANSFER"),
    transfer: z.object({
      target: TransferSignature,
      materialDifferenceRationale: z.string().trim().min(10).max(1_000),
    }).strict(),
  }).strict(),
  z.object({ ...FollowupBase, activityType: z.literal("RETENTION"), retention: RetentionDeclaration }).strict(),
]);
export type GovernedFollowupStart = z.infer<typeof GovernedFollowupStart>;

export const GovernedFollowupAttempt = z.object({
  response: z.string().trim().min(1).max(20_000),
  capabilityPublicKey: z.string().trim().min(1).max(100),
  fields: z.record(z.string().max(100), z.string().max(100)),
  idempotencyKey: z.string().min(8).max(240),
}).strict();

const FollowupReviewBase = {
  teachingSupport: z.string().trim().min(5).max(4_000),
  reviewIdempotencyKey: z.string().min(8).max(240),
  retentionExposure: InterveningExposure.optional(),
  transferContractConfirmed: z.boolean().optional(),
};

export const GovernedFollowupReview = z.discriminatedUnion("decision", [
  z.object({
    ...FollowupReviewBase,
    decision: z.literal("ACCEPT"),
  }).strict(),
  z.object({
    ...FollowupReviewBase,
    decision: z.literal("CORRECT"),
    correction: z.string().trim().min(1).max(4_000),
  }).strict(),
  z.object({
    ...FollowupReviewBase,
    decision: z.literal("SUPPLEMENT"),
    supplement: z.string().trim().min(1).max(4_000),
  }).strict(),
  z.object({
    ...FollowupReviewBase,
    decision: z.literal("ESCALATE"),
  }).strict(),
]);

export function transferChangedDimensions(declaration: z.infer<typeof TransferDeclaration>): string[] {
  const dimensions = ["context", "representation", "itemFamily", "problemStructure"] as const;
  return dimensions.filter((dimension) => normalizedTransferDiscriminator(declaration.source[dimension])
    !== normalizedTransferDiscriminator(declaration.target[dimension]));
}
