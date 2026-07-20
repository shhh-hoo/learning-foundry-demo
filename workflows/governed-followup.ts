import { BaseCheckpointSaver, END, START, StateGraph, StateSchema, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema } from "@/domain/model";
import { GovernedFollowupAttempt, GovernedFollowupReview, GovernedFollowupStart } from "@/domain/governed-followup";
import {
  createGovernedFollowup,
  executeGovernedFollowup,
  governedFollowupInterruptType,
  reviewGovernedFollowupResult,
  type GovernedFollowupPlanningDependencies,
} from "@/application/governed-followup";

const LearnerResume = z.intersection(z.object({ actor: ActorSchema }), GovernedFollowupAttempt);
const TeacherResume = z.intersection(z.object({ actor: ActorSchema }), GovernedFollowupReview);

export const GovernedFollowupState = new StateSchema({
  teacherActor: ActorSchema,
  assignment: GovernedFollowupStart,
  taskId: z.string().uuid(),
  sourceEpisodeId: z.string().uuid(),
  learnerId: z.string().uuid(),
  activityId: z.string().uuid().optional(),
  targetEpisodeId: z.string().uuid().optional(),
  activityPlanProposalId: z.string().uuid().optional(),
  activityPlanId: z.string().uuid().optional(),
  runtimeDeliveryId: z.string().uuid().optional(),
  resultAttemptId: z.string().uuid().optional(),
  resultObservationId: z.string().uuid().optional(),
  resultReviewId: z.string().uuid().optional(),
  followupContract: z.record(z.string(), z.unknown()).optional(),
  activityStatus: z.enum(["ASSIGNED", "WAITING_FOR_REVIEW", "REVIEWED", "ESCALATED", "CANCELLED", "FAILED_RECOVERABLE", "FAILED_FINAL"]).optional(),
  failureCode: z.string().optional(),
  failureReason: z.string().optional(),
});

function terminalFact(activity: { failureState: Record<string, unknown> | null; cancellationState: Record<string, unknown> | null }) {
  const fact = activity.cancellationState ?? activity.failureState;
  return {
    failureCode: typeof fact?.code === "string" ? fact.code : undefined,
    failureReason: typeof fact?.reason === "string" ? fact.reason : undefined,
  };
}

export function buildGovernedFollowupGraph(
  checkpointer?: BaseCheckpointSaver,
  planningDependencies?: GovernedFollowupPlanningDependencies,
) {
  return new StateGraph(GovernedFollowupState)
    .addNode("assign_followup", async (state) => {
      const activity = await createGovernedFollowup(state.teacherActor, state.assignment, planningDependencies);
      if (!activity.targetEpisodeId) throw new Error("Governed follow-up successor Episode is missing");
      const sourceLineage = activity.sourceLineage as Record<string, unknown>;
      const followupContract = state.assignment.activityType === "TRANSFER" ? {
        activityType: "TRANSFER",
        source: sourceLineage.canonicalTransferSourceSignature,
        target: state.assignment.transfer.target,
        materialDifferenceRationale: state.assignment.transfer.materialDifferenceRationale,
        evidenceLimit: "TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN",
      } : state.assignment.activityType === "RETENTION" ? {
        activityType: "RETENTION",
        ...state.assignment.retention,
      } : { activityType: "RETRY" };
      return {
        activityId: activity.id,
        targetEpisodeId: activity.targetEpisodeId,
        activityPlanProposalId: activity.activityPlanProposalId ?? undefined,
        activityStatus: activity.status,
        followupContract,
        ...terminalFact(activity),
      };
    })
    .addNode("learner_followup_interrupt", async (state) => {
      if (!state.activityId || !state.targetEpisodeId) throw new Error("Governed follow-up assignment is incomplete");
      const resume = LearnerResume.parse(interrupt({
        type: governedFollowupInterruptType(state.assignment.activityType),
        activityId: state.activityId,
        activityType: state.assignment.activityType,
        targetEpisodeId: state.targetEpisodeId,
        prompt: state.assignment.prompt,
        scheduledFor: state.assignment.activityType === "RETENTION" ? state.assignment.retention.scheduledFor : undefined,
        immutableContract: state.followupContract,
      }));
      const { actor, ...attempt } = resume;
      const result = await executeGovernedFollowup(actor, { activityId: state.activityId, ...attempt });
      return {
        activityStatus: result.status,
        activityPlanId: result.delivery?.activityPlanId,
        runtimeDeliveryId: result.delivery?.id,
        resultAttemptId: result.attempt?.id,
        resultObservationId: "observation" in result ? result.observation?.id : undefined,
        ...terminalFact(result.activity),
      };
    })
    .addNode("teacher_result_interrupt", async (state) => {
      if (!state.activityId || !state.resultAttemptId || !state.resultObservationId) throw new Error("Governed follow-up result lineage is incomplete");
      const resume = TeacherResume.parse(interrupt({
        type: "FOLLOWUP_RESULT_REVIEW_REQUIRED",
        activityId: state.activityId,
        activityType: state.assignment.activityType,
        attemptId: state.resultAttemptId,
        observationId: state.resultObservationId,
        learningOutcomeCreated: false,
        masteryClaim: false,
        immutableContract: state.followupContract,
      }));
      const { actor, ...decision } = resume;
      const result = await reviewGovernedFollowupResult(actor, { activityId: state.activityId, ...decision });
      return { resultReviewId: result.reviewId, activityStatus: result.activity.status };
    })
    .addEdge(START, "assign_followup")
    .addConditionalEdges("assign_followup", (state) => state.activityStatus === "ASSIGNED" ? "READY" : "TERMINAL", {
      READY: "learner_followup_interrupt",
      TERMINAL: END,
    })
    .addConditionalEdges("learner_followup_interrupt", (state) => state.activityStatus === "WAITING_FOR_REVIEW" ? "REVIEW" : "TERMINAL", {
      REVIEW: "teacher_result_interrupt",
      TERMINAL: END,
    })
    .addEdge("teacher_result_interrupt", END)
    .compile({ checkpointer });
}
