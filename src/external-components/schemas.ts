import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "HTTPS is required");
const semver = z.string().regex(/^\d+\.\d+\.\d+$/, "semantic version required");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "SHA-256 required");

export const externalLearningComponentSchema = z.strictObject({
  schemaVersion: z.literal("1.0.0"),
  id: nonEmpty.regex(/^[a-z0-9][a-z0-9-]*$/),
  version: semver,
  provider: nonEmpty,
  providerResourceId: nonEmpty,
  title: nonEmpty,
  description: nonEmpty,
  subjects: z.array(nonEmpty).min(1),
  concepts: z.array(nonEmpty),
  curriculumAlignments: z.array(nonEmpty),
  integrationMode: z.enum(["LINK_ONLY", "IFRAME", "PROVIDER_API", "REVIEWED_PACKAGE", "LTI_OR_EQUIVALENT"]),
  launch: z.strictObject({
    url: httpsUrl.optional(),
    packageRef: nonEmpty.optional(),
    apiProvider: nonEmpty.optional(),
  }),
  rights: z.strictObject({
    licenseId: nonEmpty,
    termsEvidenceRef: nonEmpty,
    attribution: nonEmpty,
    commercialUse: z.enum(["ALLOWED", "PROHIBITED", "LICENSE_REQUIRED", "REVIEW_REQUIRED"]),
    modification: z.enum(["ALLOWED", "PROHIBITED", "REVIEW_REQUIRED"]),
    redistribution: z.enum(["ALLOWED", "PROHIBITED", "REVIEW_REQUIRED"]),
  }),
  privacy: z.strictObject({
    sendsLearnerData: z.boolean(),
    dataCategories: z.array(nonEmpty),
    destination: nonEmpty.optional(),
    cookieOrTrackingStatus: z.enum(["NONE_DECLARED", "PRESENT", "UNKNOWN"]),
    approvalStatus: z.enum(["APPROVED", "NOT_APPROVED", "REVIEW_REQUIRED"]),
  }),
  accessibilityNotes: z.array(nonEmpty),
  evidence: z.strictObject({
    launchTrace: z.boolean(),
    completionSignal: z.enum(["NONE", "XAPI", "LTI", "PROVIDER_API", "CUSTOM"]),
    outcomeEligible: z.literal(false),
  }),
  lastReviewedAt: z.iso.datetime().optional(),
  status: z.enum(["DISCOVERED", "REVIEW_REQUIRED", "APPROVED_LINK_ONLY", "APPROVED_EMBED", "APPROVED_PACKAGE", "DISABLED", "REJECTED"]),
});

export const externalComponentReviewDecisionSchema = z.strictObject({
  schemaVersion: z.literal("1.0.0"),
  decisionId: nonEmpty.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  componentId: nonEmpty,
  componentVersion: semver,
  reviewer: nonEmpty,
  reviewedAt: z.iso.datetime(),
  termsEvidence: z.strictObject({
    url: httpsUrl,
    evidenceRef: nonEmpty,
    sha256,
  }),
  deploymentScope: nonEmpty,
  rightsDecision: z.enum(["APPROVED", "NOT_APPROVED", "REVIEW_REQUIRED"]),
  privacyDecision: z.enum(["APPROVED", "NOT_APPROVED", "REVIEW_REQUIRED"]),
  trackingDecision: z.enum(["APPROVED", "NOT_APPROVED", "REVIEW_REQUIRED"]),
  accessibilityDecision: z.enum(["APPROVED", "NOT_APPROVED", "REVIEW_REQUIRED"]),
  status: z.enum(["REVIEW_REQUIRED", "APPROVED_LINK_ONLY", "APPROVED_EMBED", "APPROVED_PACKAGE", "DISABLED", "REJECTED", "REVOKED"]),
  supersedesDecisionId: nonEmpty.optional(),
  notes: nonEmpty.optional(),
});

export const externalLaunchTelemetryEventSchema = z.strictObject({
  schemaVersion: z.literal("1.0.0"),
  eventId: nonEmpty,
  requestId: nonEmpty,
  occurredAt: z.iso.datetime(),
  type: z.enum(["LAUNCH_REQUESTED", "WINDOW_CREATED", "POPUP_BLOCKED"]),
  componentId: nonEmpty,
  componentVersion: semver,
  providerResourceId: nonEmpty,
  deploymentScope: nonEmpty,
  outcomeEligible: z.literal(false),
});

export const externalComponentResourceDocumentSchema = z.strictObject({
  schemaVersion: z.literal("1.0.0"),
  generatedAt: z.iso.datetime(),
  components: z.array(externalLearningComponentSchema),
});
