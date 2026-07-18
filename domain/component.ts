import { z } from "zod";

export const ComponentContract = z.object({
  title: z.string().min(3),
  purpose: z.string().min(10),
  capabilityId: z.string().uuid(),
  capabilityKey: z.string().regex(/^[a-z0-9-]+$/),
  referencePackKey: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  evidenceRequirements: z.array(z.string()).min(1),
  evidencePolicy: z.enum(["REQUIRED", "NOT_REQUIRED_DETERMINISTIC_SCAFFOLD"]),
  humanReviewRequired: z.literal(true),
});

export type ComponentContract = z.infer<typeof ComponentContract>;

export const ComponentEvidenceAttribution = z.object({
  evidenceUnitId: z.string().uuid(),
  attribution: z.string().trim().min(3),
});

export const ComponentContent = z.object({
  teachingSupport: z.string().trim().min(10),
  scaffoldHint: z.string().trim().min(5),
  workedExample: z.string().trim().min(10),
  learnerAction: z.string().trim().min(5),
  evidenceRefs: z.array(ComponentEvidenceAttribution).default([]),
});

export type ComponentContent = z.infer<typeof ComponentContent>;

const RubricDecision = z.enum(["PASS", "FAIL"]);
export const ComponentHumanRubric = z.object({
  domainCorrectness: RubricDecision,
  pedagogy: RubricDecision,
  safety: RubricDecision,
  reuseReadiness: RubricDecision,
  notes: z.string().trim().min(5),
});

export type ComponentHumanRubric = z.infer<typeof ComponentHumanRubric>;

export function humanRubricPasses(rubric: ComponentHumanRubric): boolean {
  return rubric.domainCorrectness === "PASS"
    && rubric.pedagogy === "PASS"
    && rubric.safety === "PASS"
    && rubric.reuseReadiness === "PASS";
}
