import { BaseCheckpointSaver, END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { ActorSchema } from "@/domain/model";
import { runComponentStructuralPreflight } from "@/application/component-preflight";

export const ComponentLifecycleState = new StateSchema({
  componentId: z.string().uuid(),
  componentVersionId: z.string().uuid(),
  actor: ActorSchema,
  contract: z.record(z.string(), z.unknown()).default({}),
  validation: z.record(z.string(), z.unknown()).default({}),
  evalResult: z.record(z.string(), z.unknown()).default({}),
  status: z.string().default("CANDIDATE"),
});

export function buildComponentLifecycleGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(ComponentLifecycleState)
    .addNode("structural_preflight", async (state) => {
      const result = await runComponentStructuralPreflight(state.actor, state.componentVersionId);
      return { validation: result.validation, evalResult: result.evalResult, status: result.status };
    })
    .addEdge(START, "structural_preflight")
    .addEdge("structural_preflight", END)
    .compile({ checkpointer });
}
