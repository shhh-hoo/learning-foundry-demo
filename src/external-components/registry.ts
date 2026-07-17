import { z } from "zod";
import type { ExternalLearningComponent, ExternalLearningComponentRegistry } from "./types";

const integrationModeSchema = z.enum(["SELF_HOSTED_PACKAGE", "REMOTE_EMBED", "API_RENDERER", "EXTERNAL_LINK"]);
const statusSchema = z.enum(["DISCOVERED", "LICENSE_REVIEW_REQUIRED", "APPROVED_LINK_ONLY", "APPROVED_EMBED", "APPROVED_SELF_HOSTED", "REJECTED"]);

export const externalLearningComponentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  provider: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  subjects: z.array(z.string().min(1)).min(1),
  concepts: z.array(z.string().min(1)).min(1),
  curriculumAlignments: z.array(z.string().min(1)),
  integrationMode: integrationModeSchema,
  launch: z.object({
    url: z.string().url().refine((value) => new URL(value).protocol === "https:", "External component URL must use HTTPS.").optional(),
    packageRef: z.string().min(1).optional(),
    apiProvider: z.string().min(1).optional(),
  }).strict(),
  rights: z.object({
    licenseId: z.string().min(1),
    licenseUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "License URL must use HTTPS."),
    attribution: z.string().min(1),
    commercialUse: z.enum(["ALLOWED", "PROHIBITED", "LICENSE_REQUIRED", "REVIEW_REQUIRED"]),
    modification: z.enum(["ALLOWED", "PROHIBITED", "REVIEW_REQUIRED"]),
  }).strict(),
  privacy: z.object({
    sendsLearnerData: z.boolean(),
    destination: z.string().min(1).optional(),
    approvalStatus: z.enum(["APPROVED", "NOT_APPROVED", "REVIEW_REQUIRED"]),
  }).strict(),
  evidence: z.object({
    launchTrace: z.boolean(),
    completionSignal: z.enum(["NONE", "XAPI", "LTI", "PROVIDER_API", "CUSTOM"]),
    outcomeEligible: z.boolean(),
  }).strict(),
  status: statusSchema,
}).strict().superRefine((component, context) => {
  if (component.integrationMode === "EXTERNAL_LINK" && !component.launch.url) {
    context.addIssue({ code: "custom", path: ["launch", "url"], message: "External links require a launch URL." });
  }
  if (component.integrationMode === "SELF_HOSTED_PACKAGE" && !component.launch.packageRef) {
    context.addIssue({ code: "custom", path: ["launch", "packageRef"], message: "Self-hosted packages require a package reference." });
  }
  if (component.integrationMode === "API_RENDERER" && !component.launch.apiProvider) {
    context.addIssue({ code: "custom", path: ["launch", "apiProvider"], message: "API renderers require an API provider." });
  }
  if (component.evidence.outcomeEligible && component.evidence.completionSignal === "NONE") {
    context.addIssue({ code: "custom", path: ["evidence", "completionSignal"], message: "Outcome-eligible components require a validated completion signal." });
  }
  if (component.status === "APPROVED_LINK_ONLY" && component.integrationMode !== "EXTERNAL_LINK") {
    context.addIssue({ code: "custom", path: ["status"], message: "APPROVED_LINK_ONLY requires EXTERNAL_LINK integration." });
  }
  if (component.status === "APPROVED_EMBED" && component.integrationMode !== "REMOTE_EMBED" && component.integrationMode !== "API_RENDERER") {
    context.addIssue({ code: "custom", path: ["status"], message: "APPROVED_EMBED requires REMOTE_EMBED or API_RENDERER integration." });
  }
  if (component.status === "APPROVED_SELF_HOSTED" && component.integrationMode !== "SELF_HOSTED_PACKAGE") {
    context.addIssue({ code: "custom", path: ["status"], message: "APPROVED_SELF_HOSTED requires SELF_HOSTED_PACKAGE integration." });
  }
  if (component.status.startsWith("APPROVED_") && component.privacy.approvalStatus !== "APPROVED") {
    context.addIssue({ code: "custom", path: ["privacy", "approvalStatus"], message: "Approved launch status requires approved privacy handling." });
  }
  if (component.status.startsWith("APPROVED_") && component.evidence.outcomeEligible) {
    context.addIssue({ code: "custom", path: ["evidence", "outcomeEligible"], message: "Initial external components cannot write Learning Outcomes." });
  }
});

export const externalLearningComponentRegistrySchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  registryVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  reviewedAt: z.string().datetime(),
  deploymentScope: z.literal("NON_COMMERCIAL_PUBLIC_SHOWCASE"),
  components: z.array(externalLearningComponentSchema),
}).strict().superRefine((registry, context) => {
  const identities = new Set<string>();
  for (const [index, component] of registry.components.entries()) {
    const identity = `${component.id}@${component.version}`;
    if (identities.has(identity)) context.addIssue({ code: "custom", path: ["components", index, "id"], message: `Duplicate external component identity ${identity}.` });
    identities.add(identity);
  }
});

export function parseExternalComponentRegistry(value: unknown): ExternalLearningComponentRegistry {
  return externalLearningComponentRegistrySchema.parse(value) as ExternalLearningComponentRegistry;
}

export function canLaunchExternalComponent(component: ExternalLearningComponent): boolean {
  return (component.status === "APPROVED_LINK_ONLY" || component.status === "APPROVED_EMBED" || component.status === "APPROVED_SELF_HOSTED")
    && component.privacy.approvalStatus === "APPROVED"
    && Boolean(component.launch.url || component.launch.packageRef || component.launch.apiProvider);
}

export function listLaunchableExternalComponents(registry: ExternalLearningComponentRegistry): readonly ExternalLearningComponent[] {
  return registry.components.filter(canLaunchExternalComponent);
}
