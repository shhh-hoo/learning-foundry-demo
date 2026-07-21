import { z } from "zod";
import { decideAssetOptimizationProposal } from "@/application/asset-optimization";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { AssetOptimizationDecisionAction } from "@/domain/asset-optimization";

const Decision = z.object({
  action: AssetOptimizationDecisionAction,
  rationale: z.string().trim().min(5),
  idempotencyKey: z.string().min(8),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      const { proposalId } = await context.params;
      return Response.json(await decideAssetOptimizationProposal(actor, { proposalId, ...Decision.parse(await request.json()) }), { status: 201 });
    });
  } catch (error) { return errorResponse(error); }
}
