import { z } from "zod";

export const LearnerAttemptRequest = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  fileAssetId: z.string().uuid().optional(),
  capabilityPublicKey: z.string().min(1).max(100).optional(),
  fields: z.record(z.string().max(100), z.string().max(100)).default({}),
  manualEntry: z.boolean().default(false),
  prompt: z.string().min(1),
  response: z.string().min(1),
  idempotencyKey: z.string().min(8),
}).strict().superRefine((request, context) => {
  if (!request.capabilityPublicKey && (request.manualEntry || Object.keys(request.fields).length > 0)) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Calculation fields require a selected calculation activity",
    });
  }
  if (!request.manualEntry && Object.keys(request.fields).length > 0) {
    context.addIssue({ code: "custom", path: ["fields"], message: "Calculation fields require explicit manual-entry mode" });
  }
});
