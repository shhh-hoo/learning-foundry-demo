import { z } from "zod";
import { decideRoutingOptimizationProposal } from "@/application/routing-optimization";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { RoutingOptimizationDecisionAction } from "@/domain/routing-optimization";

const Decision = z.object({
  action: RoutingOptimizationDecisionAction,
  rationale: z.string().trim().min(5),
  idempotencyKey: z.string().min(8),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      const { proposalId } = await context.params;
      return Response.json(await decideRoutingOptimizationProposal(actor, { proposalId, ...Decision.parse(await request.json()) }), { status: 201 });
    });
  } catch (error) { return errorResponse(error); }
}
