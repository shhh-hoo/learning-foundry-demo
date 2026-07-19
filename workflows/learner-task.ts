import { BaseCheckpointSaver, END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema } from "@/domain/model";
import { buildExplanationGraph, type ExplanationFaultHooks } from "@/workflows/explanation";
import { buildDiagnosisGraph } from "@/workflows/diagnosis";
import { addLibraryItem, appendConversationEvent, scheduleStudyReview } from "@/application/commands";
import { retrieveEvidence } from "@/application/retrieval";

const Action = z.enum(["EXPLAIN", "ATTEMPT", "LIBRARY", "STUDY_REVIEW"]);

export const LearnerTaskState = new StateSchema({
  actor: ActorSchema,
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  courseId: z.string().uuid(),
  message: z.string().min(1),
  requestedAction: Action.optional(),
  action: Action.optional(),
  capabilityId: z.string().uuid().optional(),
  prompt: z.string().optional(),
  response: z.string().optional(),
  structuredInput: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(8),
  scheduledFor: z.string().datetime().optional(),
  result: z.record(z.string(), z.unknown()).default({}),
  observationId: z.string().uuid().optional(),
  learnerEventId: z.string().uuid().optional(),
});

export function classifyProductAction(state: typeof LearnerTaskState.State): z.infer<typeof Action> {
  if (state.requestedAction) return state.requestedAction;
  if (state.structuredInput || /my answer|attempt|i got|i calculated/i.test(state.message)) return "ATTEMPT";
  if (/save|library|bookmark/i.test(state.message)) return "LIBRARY";
  if (/schedule|remind|review later/i.test(state.message)) return "STUDY_REVIEW";
  return "EXPLAIN";
}

export type LearnerTaskFaultHooks = {
  afterLearnerEventPersisted?: (eventId: string) => Promise<void> | void;
  explanation?: ExplanationFaultHooks;
};

export function buildLearnerTaskGraph(checkpointer?: BaseCheckpointSaver, faultHooks: LearnerTaskFaultHooks = {}) {
  const explanation = buildExplanationGraph(undefined, faultHooks.explanation);
  const diagnosis = buildDiagnosisGraph();
  return new StateGraph(LearnerTaskState)
    .addNode("record_learner_input", async (state) => {
      const event = await appendConversationEvent(state.actor, { taskId: state.taskId, episodeId: state.episodeId, kind: "MESSAGE", content: state.message, actorType: "LEARNER", idempotencyKey: `${state.idempotencyKey}:conversation:learner` });
      await faultHooks.afterLearnerEventPersisted?.(event.id);
      return { learnerEventId: event.id };
    })
    .addNode("classify_product_action", (state) => ({ action: classifyProductAction(state) }))
    .addNode("explanation_subgraph", async (state) => {
      const result = await explanation.invoke({ actor: state.actor, taskId: state.taskId, episodeId: state.episodeId, question: state.message, eventIdempotencyKey: `${state.idempotencyKey}:conversation:foundry` });
      return { result: { response: result.response, citations: result.citations, learnerEventId: state.learnerEventId, responseEventId: result.responseEventId } };
    })
    .addNode("diagnosis_subgraph", async (state) => {
      if (!state.structuredInput || !state.response) throw new Error("Attempt action requires learner input and response");
      const result = await diagnosis.invoke({
        actor: state.actor,
        taskId: state.taskId,
        episodeId: state.episodeId,
        capabilityId: state.capabilityId,
        prompt: state.prompt ?? state.message,
        response: state.response,
        structuredInput: state.structuredInput,
        idempotencyKey: state.idempotencyKey,
      });
      return { observationId: result.observationId, result: { attemptId: result.attemptId, observationId: result.observationId, diagnosisStatus: result.diagnosisStatus, requiresTeacherReview: true } };
    })
    .addNode("library_action", async (state) => {
      const retrieval = await retrieveEvidence({ actor: state.actor, taskId: state.taskId, query: state.message, purpose: "LEARNING", limit: 1 });
      if (!retrieval.hits[0]) return { result: { saved: false, reason: "NO_AUTHORIZED_EVIDENCE" } };
      const hit = retrieval.hits[0];
      const item = await addLibraryItem(state.actor, { courseId: state.courseId, evidenceUnitId: hit.evidenceUnitId, title: hit.sourceTitle, reason: state.message, idempotencyKey: state.idempotencyKey });
      return { result: { saved: true, libraryItemId: item.id, replayed: item.replayed } };
    })
    .addNode("study_review_action", async (state) => {
      if (!state.scheduledFor) throw new Error("Study Review action requires an explicit due date");
      const dueAt = new Date(state.scheduledFor);
      const item = await scheduleStudyReview(state.actor, { taskId: state.taskId, dueAt, idempotencyKey: state.idempotencyKey });
      return { result: { scheduled: true, activityType: "STUDY_REVIEW", scheduleItemId: item.id, dueAt: dueAt.toISOString(), replayed: item.replayed } };
    })
    .addEdge(START, "record_learner_input")
    .addEdge("record_learner_input", "classify_product_action")
    .addConditionalEdges("classify_product_action", (state) => state.action ?? "EXPLAIN", {
      EXPLAIN: "explanation_subgraph",
      ATTEMPT: "diagnosis_subgraph",
      LIBRARY: "library_action",
      STUDY_REVIEW: "study_review_action",
    })
    .addEdge("explanation_subgraph", END)
    .addEdge("diagnosis_subgraph", END)
    .addEdge("library_action", END)
    .addEdge("study_review_action", END)
    .compile({ checkpointer });
}
