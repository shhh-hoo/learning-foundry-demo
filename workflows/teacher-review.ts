import { BaseCheckpointSaver, END, START, StateGraph, StateSchema, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema, ReviewDecision } from "@/domain/model";
import { createTeacherReview } from "@/application/commands";

const ReviewResume = z.object({
  actor: ActorSchema,
  decision: ReviewDecision,
  correction: z.string().optional(),
  supplement: z.string().optional(),
  teachingSupport: z.string().min(5),
  idempotencyKey: z.string().min(8),
});

export const TeacherReviewState = new StateSchema({
  observationId: z.string().uuid(),
  taskId: z.string().uuid(),
  attemptId: z.string().uuid(),
  summary: z.string(),
  failureCode: z.string().nullable(),
  reviewId: z.string().uuid().optional(),
  decision: z.string().optional(),
});

export function buildTeacherReviewGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(TeacherReviewState)
    .addNode("teacher_interrupt", async (state) => {
      const resume = ReviewResume.parse(interrupt({
        type: "TEACHER_REVIEW_REQUIRED",
        observationId: state.observationId,
        attemptId: state.attemptId,
        summary: state.summary,
        failureCode: state.failureCode,
        allowedDecisions: ["ACCEPT", "CORRECT", "SUPPLEMENT", "ESCALATE"],
      }));
      const result = await createTeacherReview(resume.actor, {
        observationId: state.observationId,
        decision: resume.decision,
        correction: resume.correction,
        supplement: resume.supplement,
        teachingSupport: resume.teachingSupport,
        idempotencyKey: resume.idempotencyKey,
      });
      return { reviewId: result.reviewId, decision: resume.decision };
    })
    .addEdge(START, "teacher_interrupt")
    .addEdge("teacher_interrupt", END)
    .compile({ checkpointer });
}
