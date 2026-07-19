import { BaseCheckpointSaver, END, START, StateGraph, StateSchema, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema } from "@/domain/model";
import {
  captureAttempt,
  createRetry,
  persistUnavailableObservation,
  reviewRetryResult,
} from "@/application/commands";

const RetryAttemptResume = z.object({
  actor: ActorSchema,
  response: z.string().min(1),
  structuredInput: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8),
});
const RetryReviewBase = {
  actor: ActorSchema,
  teachingSupport: z.string().min(5),
  reviewIdempotencyKey: z.string().min(8),
};
const RetryOutcomeFields = {
  outcomeStatus: z.enum(["IMPROVED", "MASTERED", "NEEDS_SUPPORT"]),
  outcomeNarrative: z.string().min(5),
  outcomeIdempotencyKey: z.string().min(8),
};
export const RetryReviewResume = z.discriminatedUnion("decision", [
  z.object({ ...RetryReviewBase, decision: z.literal("ESCALATE") }).strict(),
  z.object({ ...RetryReviewBase, ...RetryOutcomeFields, decision: z.literal("ACCEPT") }).strict(),
  z.object({ ...RetryReviewBase, ...RetryOutcomeFields, decision: z.literal("CORRECT"), correction: z.string().trim().min(1) }).strict(),
  z.object({ ...RetryReviewBase, ...RetryOutcomeFields, decision: z.literal("SUPPLEMENT"), supplement: z.string().trim().min(1) }).strict(),
]);

export const RetryOutcomeState = new StateSchema({
  teacherActor: ActorSchema,
  observationId: z.string().uuid(),
  reviewId: z.string().uuid(),
  activityType: z.literal("RETRY"),
  assignmentIdempotencyKey: z.string().min(8),
  prompt: z.string().min(1),
  scheduledFor: z.string().datetime().optional(),
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  learnerId: z.string().uuid(),
  retryId: z.string().uuid().optional(),
  resultAttemptId: z.string().uuid().optional(),
  resultObservationId: z.string().uuid().optional(),
  resultReviewId: z.string().uuid().optional(),
  outcomeId: z.string().uuid().optional(),
});

export function buildRetryOutcomeGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(RetryOutcomeState)
    .addNode("assign_activity", async (state) => {
      const retry = await createRetry(state.teacherActor, {
        observationId: state.observationId,
        reviewId: state.reviewId,
        activityType: state.activityType,
        prompt: state.prompt,
        scheduledFor: state.scheduledFor ? new Date(state.scheduledFor) : undefined,
        idempotencyKey: state.assignmentIdempotencyKey,
      });
      return { retryId: retry.id };
    })
    .addNode("learner_retry_interrupt", async (state) => {
      if (!state.retryId) throw new Error("Retry assignment is missing");
      const resume = RetryAttemptResume.parse(interrupt({ type: "LEARNER_RETRY_REQUIRED", retryId: state.retryId, prompt: state.prompt, activityType: state.activityType }));
      const attempt = await captureAttempt(resume.actor, {
        taskId: state.taskId,
        episodeId: state.episodeId,
        prompt: state.prompt,
        response: resume.response,
        structuredInput: resume.structuredInput,
        idempotencyKey: resume.idempotencyKey,
      });
      const observation = await persistUnavailableObservation({ attemptId: attempt.id, reason: "No real Standard Trainer adapter is configured for the retry." });
      return { resultAttemptId: attempt.id, resultObservationId: observation.id };
    })
    .addNode("teacher_result_interrupt", async (state) => {
      if (!state.retryId || !state.resultAttemptId || !state.resultObservationId) throw new Error("Retry result lineage is incomplete");
      const resume = RetryReviewResume.parse(interrupt({ type: "RETRY_RESULT_REVIEW_REQUIRED", retryId: state.retryId, attemptId: state.resultAttemptId, observationId: state.resultObservationId }));
      const { actor, ...reviewCommand } = resume;
      const result = await reviewRetryResult(actor, {
        retryId: state.retryId,
        resultAttemptId: state.resultAttemptId,
        resultObservationId: state.resultObservationId,
        ...reviewCommand,
      });
      return { resultReviewId: result.reviewId, outcomeId: result.outcomeId, status: result.status };
    })
    .addEdge(START, "assign_activity")
    .addEdge("assign_activity", "learner_retry_interrupt")
    .addEdge("learner_retry_interrupt", "teacher_result_interrupt")
    .addEdge("teacher_result_interrupt", END)
    .compile({ checkpointer });
}
