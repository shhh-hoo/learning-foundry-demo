import { BaseCheckpointSaver, END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema } from "@/domain/model";
import { captureAttempt, persistDiagnosticObservation, persistUnavailableObservation } from "@/application/commands";
import { executePersistedCapability } from "@/application/capabilities";
import { prepareAttemptForDiagnosis } from "@/application/attempt-interpreter";
import { compileAuthorizedContext } from "@/application/context-service";

export const DiagnosisState = new StateSchema({
  actor: ActorSchema,
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  capabilityId: z.string().uuid().optional(),
  capabilityPublicKey: z.string().optional(),
  fields: z.record(z.string(), z.string()).default({}),
  manualEntry: z.boolean().default(false),
  fileAssetId: z.string().uuid().optional(),
  prompt: z.string().min(1),
  response: z.string().min(1),
  structuredInput: z.record(z.string(), z.unknown()).optional(),
  capabilityInput: z.record(z.string(), z.unknown()).optional(),
  attemptStructuredInput: z.record(z.string(), z.unknown()).optional(),
  preparationStatus: z.string().optional(),
  preparationReason: z.string().optional(),
  contextCompilationId: z.string().uuid().optional(),
  contextSnapshotHash: z.string().optional(),
  contextCompilerVersion: z.string().optional(),
  sourceRefs: z.array(z.record(z.string(), z.string())).default([]),
  idempotencyKey: z.string().min(8),
  attemptId: z.string().uuid().optional(),
  diagnosisStatus: z.enum(["AVAILABLE", "UNAVAILABLE"]).optional(),
  observationId: z.string().uuid().optional(),
});

export type DiagnosisGraphDependencies = {
  compileContext: typeof compileAuthorizedContext;
  prepareAttempt: typeof prepareAttemptForDiagnosis;
  captureAttempt: typeof captureAttempt;
  executeCapability: typeof executePersistedCapability;
  persistObservation: typeof persistDiagnosticObservation;
  persistUnavailable: typeof persistUnavailableObservation;
};

const defaultDependencies: DiagnosisGraphDependencies = {
  compileContext: compileAuthorizedContext,
  prepareAttempt: prepareAttemptForDiagnosis,
  captureAttempt,
  executeCapability: executePersistedCapability,
  persistObservation: persistDiagnosticObservation,
  persistUnavailable: persistUnavailableObservation,
};

export function buildDiagnosisGraph(checkpointer?: BaseCheckpointSaver, dependencies: DiagnosisGraphDependencies = defaultDependencies) {
  return new StateGraph(DiagnosisState)
    .addNode("compile_context", async (state) => {
      const compiled = await dependencies.compileContext(state.actor, {
        taskId: state.taskId,
        episodeId: state.episodeId,
        consumer: "DIAGNOSIS",
      });
      return {
        contextCompilationId: compiled.id,
        contextSnapshotHash: compiled.snapshotHash,
        contextCompilerVersion: compiled.compilerVersion,
      };
    })
    .addNode("prepare_attempt", async (state) => {
      const preparation = await dependencies.prepareAttempt({
        actor: state.actor,
        taskId: state.taskId,
        episodeId: state.episodeId,
        prompt: state.prompt,
        response: state.response,
        capabilityPublicKey: state.capabilityPublicKey,
        fields: state.fields,
        manualEntry: state.manualEntry,
        trustedCapabilityId: state.capabilityId,
        trustedStructuredInput: state.structuredInput,
      });
      return {
        capabilityId: preparation.capabilityId,
        capabilityInput: preparation.capabilityInput,
        attemptStructuredInput: preparation.attemptStructuredInput,
        preparationStatus: preparation.status,
        preparationReason: preparation.reason,
      };
    })
    .addNode("capture_attempt", async (state) => {
      const attempt = await dependencies.captureAttempt(state.actor, {
        taskId: state.taskId,
        episodeId: state.episodeId,
        capabilityId: state.capabilityId,
        fileAssetId: state.fileAssetId,
        prompt: state.prompt,
        response: state.response,
        structuredInput: {
          ...(state.attemptStructuredInput ?? { responseType: "NATURAL_ATTEMPT", interpretation: { status: "INVALID", diagnosticClaim: false } }),
          contextSnapshot: {
            id: state.contextCompilationId,
            hash: state.contextSnapshotHash,
            compilerVersion: state.contextCompilerVersion,
          },
        },
        sourceRefs: state.sourceRefs,
        idempotencyKey: state.idempotencyKey,
      });
      return { attemptId: attempt.id };
    })
    .addNode("execute_capability", async (state) => {
      if (!state.attemptId) throw new Error("Attempt lineage is incomplete");
      if (!state.capabilityId || !state.capabilityInput) {
        const observation = await dependencies.persistUnavailable({ attemptId: state.attemptId, reason: state.preparationReason ?? "No validated deterministic Capability input is available." });
        return { observationId: observation.id, diagnosisStatus: "UNAVAILABLE" as const };
      }
      const execution = await dependencies.executeCapability({ taskId: state.taskId, capabilityId: state.capabilityId, structuredInput: state.capabilityInput });
      const observation = await dependencies.persistObservation({ attemptId: state.attemptId, capabilityVersionId: execution.version.id, capabilityId: execution.capability.id, result: execution.result });
      return { observationId: observation.id, diagnosisStatus: "AVAILABLE" as const };
    })
    .addEdge(START, "compile_context")
    .addEdge("compile_context", "prepare_attempt")
    .addEdge("prepare_attempt", "capture_attempt")
    .addEdge("capture_attempt", "execute_capability")
    .addEdge("execute_capability", END)
    .compile({ checkpointer });
}
