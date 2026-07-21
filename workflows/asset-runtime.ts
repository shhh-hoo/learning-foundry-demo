import { BaseCheckpointSaver, END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema } from "@/domain/model";
import { executeAssetStageResult, type AssetRuntimeDependencies } from "@/application/asset-runtime";

export const AssetRuntimeState = new StateSchema({
  actor: ActorSchema,
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  activityPlanProposalId: z.string().uuid(),
  retryOfDeliveryId: z.string().uuid().optional(),
  prompt: z.string().min(1).max(4_000),
  response: z.string().min(1).max(20_000),
  structuredInput: z.record(z.string(), z.unknown()),
  modality: z.enum(["TEXT", "STRUCTURED", "MULTIMODAL"]).default("STRUCTURED"),
  idempotencyKey: z.string().min(8).max(240),
  deadlineMs: z.number().int().positive().max(120_000).default(30_000),
  activityPlanId: z.string().uuid().optional(),
  runtimeDeliveryId: z.string().uuid().optional(),
  attemptId: z.string().uuid().optional(),
  runtimeStatus: z.enum(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]).optional(),
});

export function buildAssetRuntimeGraph(
  checkpointer?: BaseCheckpointSaver,
  dependencies?: AssetRuntimeDependencies,
) {
  return new StateGraph(AssetRuntimeState)
    .addNode("run_exact_asset_stage", async (state) => {
      const result = await executeAssetStageResult(state.actor, {
        taskId: state.taskId,
        episodeId: state.episodeId,
        activityPlanProposalId: state.activityPlanProposalId,
        retryOfDeliveryId: state.retryOfDeliveryId,
        prompt: state.prompt,
        response: state.response,
        structuredInput: state.structuredInput,
        modality: state.modality,
        idempotencyKey: state.idempotencyKey,
        deadlineMs: state.deadlineMs,
      }, dependencies);
      return {
        activityPlanId: result.delivery.activityPlanId,
        runtimeDeliveryId: result.delivery.id,
        attemptId: result.attempt.id,
        runtimeStatus: result.delivery.status as "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED",
      };
    })
    .addEdge(START, "run_exact_asset_stage")
    .addEdge("run_exact_asset_stage", END)
    .compile({ checkpointer });
}
