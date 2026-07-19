import { BaseCheckpointSaver, END, START, StateGraph, StateSchema, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { runComponentEvaluation } from "@/application/component-evaluation";
import { decidePublication } from "@/application/commands";
import { ComponentHumanRubric } from "@/domain/component";
import { ActorSchema } from "@/domain/model";

const ExpertPublicationResume = z.object({
  actor: ActorSchema,
  action: z.enum(["APPROVE", "REJECT"]),
  rationale: z.string().trim().min(5),
  rubric: ComponentHumanRubric,
  idempotencyKey: z.string().min(8),
}).strict();

export const ComponentLifecycleState = new StateSchema({
  componentId: z.string().uuid(),
  componentVersionId: z.string().uuid(),
  workflowThreadId: z.string().min(1),
  actor: ActorSchema,
  evaluationId: z.string().uuid().optional(),
  systemStatus: z.enum(["PASSED", "BLOCKED"]).optional(),
  systemChecks: z.array(z.record(z.string(), z.unknown())).default([]),
  providerChecks: z.record(z.string(), z.unknown()).default({}),
  decisionId: z.string().uuid().optional(),
  decision: z.enum(["APPROVE", "REJECT"]).optional(),
});

export function buildComponentLifecycleGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(ComponentLifecycleState)
    .addNode("system_evaluation", async (state) => {
      const result = await runComponentEvaluation(state.actor, state.componentVersionId);
      return {
        evaluationId: result.evaluation.id,
        systemStatus: result.systemStatus,
        systemChecks: result.systemChecks,
        providerChecks: result.providerChecks,
      };
    })
    .addNode("expert_publication_interrupt", async (state) => {
      if (!state.evaluationId || !state.systemStatus) throw new Error("Component evaluation state is incomplete");
      const resume = ExpertPublicationResume.parse(interrupt({
        type: "EXPERT_PUBLICATION_REVIEW_REQUIRED",
        componentId: state.componentId,
        componentVersionId: state.componentVersionId,
        evaluationId: state.evaluationId,
        systemStatus: state.systemStatus,
        systemChecks: state.systemChecks,
        providerChecks: state.providerChecks,
        approvalAllowed: state.systemStatus === "PASSED",
        allowedDecisions: ["APPROVE", "REJECT"],
      }));
      const result = await decidePublication(resume.actor, {
        componentVersionId: state.componentVersionId,
        evaluationId: state.evaluationId,
        workflowThreadId: state.workflowThreadId,
        action: resume.action,
        rationale: resume.rationale,
        rubric: resume.rubric,
        idempotencyKey: resume.idempotencyKey,
      });
      return { decisionId: result.decisionId, decision: resume.action };
    })
    .addEdge(START, "system_evaluation")
    .addEdge("system_evaluation", "expert_publication_interrupt")
    .addEdge("expert_publication_interrupt", END)
    .compile({ checkpointer });
}
