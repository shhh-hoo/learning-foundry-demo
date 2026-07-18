import { BaseCheckpointSaver, END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema } from "@/domain/model";
import { compileAndPersistContext } from "@/application/context-service";
import { retrieveEvidence } from "@/application/retrieval";
import { explainWithEvidence } from "@/application/model";
import { appendConversationEvent } from "@/application/commands";

export const ExplanationState = new StateSchema({
  actor: ActorSchema,
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  question: z.string().min(1),
  context: z.array(z.string()).default([]),
  hits: z.array(z.record(z.string(), z.unknown())).default([]),
  citations: z.array(z.record(z.string(), z.unknown())).default([]),
  missingSignal: z.boolean().default(false),
  response: z.string().default(""),
  model: z.string().nullable().default(null),
  synthesisStatus: z.enum(["AVAILABLE", "UNAVAILABLE", "REVIEW_REQUIRED"]).optional(),
  responseEventId: z.string().uuid().optional(),
});

export function mapExplanationResult(result: Awaited<ReturnType<typeof explainWithEvidence>>) {
  return { response: result.text, model: result.model, synthesisStatus: result.status, citations: result.citations };
}

export function explanationEventInput(state: {
  taskId: string;
  episodeId: string;
  response: string;
  citations: Array<Record<string, unknown>>;
}) {
  return {
    taskId: state.taskId,
    episodeId: state.episodeId,
    actorType: "FOUNDRY",
    kind: "EXPLANATION",
    content: state.response,
    sourceRefs: state.citations.map((citation) => ({ sourceId: String(citation.sourceId), sourceVersion: String(citation.sourceVersion), locator: String(citation.locator) })),
    evidenceRefs: state.citations.map((citation) => ({ evidenceUnitId: String(citation.evidenceUnitId), kind: "RETRIEVAL" })),
  };
}

export function buildExplanationGraph(checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(ExplanationState)
    .addNode("compile_context", async (state) => {
      const compiled = await compileAndPersistContext(state.actor, { taskId: state.taskId, episodeId: state.episodeId });
      return { context: compiled.selectedItems.map((item) => item.content) };
    })
    .addNode("retrieve_evidence", async (state) => {
      const result = await retrieveEvidence({ actor: state.actor, taskId: state.taskId, query: state.question, purpose: "LEARNING" });
      return { hits: result.hits, citations: result.citations, missingSignal: result.missingSignal };
    })
    .addNode("synthesize", async (state) => mapExplanationResult(await explainWithEvidence({
      actor: state.actor,
      taskId: state.taskId,
      question: state.question,
      hits: state.hits as never,
      citations: state.citations as never,
      context: state.context,
    })))
    .addNode("persist_response", async (state) => {
      const event = await appendConversationEvent(state.actor, explanationEventInput(state));
      return { responseEventId: event.id };
    })
    .addEdge(START, "compile_context")
    .addEdge("compile_context", "retrieve_evidence")
    .addEdge("retrieve_evidence", "synthesize")
    .addEdge("synthesize", "persist_response")
    .addEdge("persist_response", END);
  return graph.compile({ checkpointer });
}
