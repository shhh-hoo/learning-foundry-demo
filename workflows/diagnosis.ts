import { BaseCheckpointSaver, END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema } from "@/domain/model";
import { captureAttempt, persistUnavailableObservation } from "@/application/commands";

export const DiagnosisState = new StateSchema({
  actor: ActorSchema,
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  capabilityId: z.string().uuid().optional(),
  prompt: z.string().min(1),
  response: z.string().min(1),
  structuredInput: z.record(z.string(), z.unknown()),
  sourceRefs: z.array(z.record(z.string(), z.string())).default([]),
  idempotencyKey: z.string().min(8),
  attemptId: z.string().uuid().optional(),
  diagnosisStatus: z.literal("UNAVAILABLE").optional(),
  observationId: z.string().uuid().optional(),
});

export function buildDiagnosisGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(DiagnosisState)
    .addNode("capture_attempt", async (state) => {
      const attempt = await captureAttempt(state.actor, {
        taskId: state.taskId,
        episodeId: state.episodeId,
        capabilityId: state.capabilityId,
        prompt: state.prompt,
        response: state.response,
        structuredInput: state.structuredInput,
        sourceRefs: state.sourceRefs,
        idempotencyKey: state.idempotencyKey,
      });
      return { attemptId: attempt.id };
    })
    .addNode("record_capability_unavailable", () => ({ diagnosisStatus: "UNAVAILABLE" as const }))
    .addNode("persist_review_required_observation", async (state) => {
      if (!state.attemptId) throw new Error("Attempt lineage is incomplete");
      const observation = await persistUnavailableObservation({ attemptId: state.attemptId, reason: "No real Standard Trainer adapter is configured." });
      return { observationId: observation.id };
    })
    .addEdge(START, "capture_attempt")
    .addEdge("capture_attempt", "record_capability_unavailable")
    .addEdge("record_capability_unavailable", "persist_review_required_observation")
    .addEdge("persist_review_required_observation", END)
    .compile({ checkpointer });
}
