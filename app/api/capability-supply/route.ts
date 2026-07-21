import { z } from "zod";
import { createWebComponentAssetProposal } from "@/application/capability-supply";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const Proposal = z.object({ capabilityResolutionId: z.string().uuid(), idempotencyKey: z.string().min(8) }).strict();

export async function POST(request: Request) {
  try {
    return await withApiActor(async (actor) => Response.json(await createWebComponentAssetProposal(actor, Proposal.parse(await request.json())), { status: 201 }));
  } catch (error) { return errorResponse(error); }
}
