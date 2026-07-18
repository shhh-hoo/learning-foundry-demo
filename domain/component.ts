import { z } from "zod";

export const ComponentContract = z.object({
  title: z.string().min(3),
  purpose: z.string().min(10),
  capabilityKey: z.string().regex(/^[a-z0-9-]+$/),
  referencePackKey: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  evidenceRequirements: z.array(z.string()).min(1),
  humanReviewRequired: z.literal(true),
});

export type ComponentContract = z.infer<typeof ComponentContract>;
