import { BaseCheckpointSaver, END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema } from "@/domain/model";
import { captureAttempt, persistDiagnosticObservation, persistUnavailableObservation } from "@/application/commands";
import { executePersistedCapability } from "@/application/capabilities";

export const DiagnosisState = new StateSchema({
  actor: ActorSchema,
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  capabilityId: z.string().uuid().optional(),
  fileAssetId: z.string().uuid().optional(),
  prompt: z.string().min(1),
  response: z.string().min(1),
  structuredInput: z.record(z.string(), z.unknown()),
  sourceRefs: z.array(z.record(z.string(), z.string())).default([]),
  idempotencyKey: z.string().min(8),
  attemptId: z.string().uuid().optional(),
  diagnosisStatus: z.enum(["AVAILABLE", "UNAVAILABLE"]).optional(),
  observationId: z.string().uuid().optional(),
});

export function buildDiagnosisGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(DiagnosisState)
    .addNode("capture_attempt", async (state) => {
      const attempt = await captureAttempt(state.actor, {
        taskId: state.taskId,
        episodeId: state.episodeId,
        capabilityId: state.capabilityId,
        fileAssetId: state.fileAssetId,
        prompt: state.prompt,
        response: state.response,
        structuredInput: state.structuredInput,
        sourceRefs: state.sourceRefs,
        idempotencyKey: state.idempotencyKey,
      });
      return { attemptId: attempt.id };
    })
    .addNode("execute_capability", async (state) => {
      if (!state.attemptId) throw new Error("Attempt lineage is incomplete");
      if (!state.capabilityId) {
        const observation = await persistUnavailableObservation({ attemptId: state.attemptId, reason: "No deterministic Capability was selected." });
        return { observationId: observation.id, diagnosisStatus: "UNAVAILABLE" as const };
      }
      const execution = await executePersistedCapability({ taskId: state.taskId, capabilityId: state.capabilityId, structuredInput: state.structuredInput });
      const observation = await persistDiagnosticObservation({ attemptId: state.attemptId, capabilityVersionId: execution.version.id, capabilityId: execution.capability.id, result: execution.result });
      return { observationId: observation.id, diagnosisStatus: "AVAILABLE" as const };
    })
    .addEdge(START, "capture_attempt")
    .addEdge("capture_attempt", "execute_capability")
    .addEdge("execute_capability", END)
    .compile({ checkpointer });
}
