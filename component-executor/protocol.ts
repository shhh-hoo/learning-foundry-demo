import { z } from "zod";

export const ComponentExecutorActorClaim = z.object({
  userId: z.string().uuid(),
  institutionId: z.string().uuid(),
  authMethod: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(200),
}).strict();

export const EvaluateWebComponentDraftCommand = z.object({
  command: z.literal("EVALUATE_WEB_COMPONENT_DRAFT"),
  actor: ComponentExecutorActorClaim,
  componentVersionId: z.string().uuid(),
  expectedContentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();

export const PreviewWebComponentDraftCommand = z.object({
  command: z.literal("PREVIEW_WEB_COMPONENT_DRAFT"),
  actor: ComponentExecutorActorClaim,
  componentId: z.string().uuid(),
  componentVersionId: z.string().uuid(),
  expectedContentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  selectedChoiceId: z.string().regex(/^[a-z0-9-]+$/),
  idempotencyKey: z.string().min(8).max(200),
}).strict();

export const ComponentEvaluationReceipt = z.object({
  evaluationId: z.string().uuid(),
  replayed: z.boolean(),
}).strict();

export const ComponentPreviewReceipt = z.object({
  previewId: z.string().uuid(),
  replayed: z.boolean(),
}).strict();

export type ExecutorActorClaim = z.infer<typeof ComponentExecutorActorClaim>;
export type EvaluateDraftCommand = z.infer<typeof EvaluateWebComponentDraftCommand>;
export type PreviewDraftCommand = z.infer<typeof PreviewWebComponentDraftCommand>;
