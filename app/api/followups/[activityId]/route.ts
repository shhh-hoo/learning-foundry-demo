import { z } from "zod";
import { cancelGovernedFollowup } from "@/application/governed-followup";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const Cancellation = z.object({ reason: z.string().trim().min(5).max(1_000) }).strict();

export async function DELETE(request: Request, context: { params: Promise<{ activityId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      const { activityId } = await context.params;
      const { reason } = Cancellation.parse(await request.json());
      return Response.json(await cancelGovernedFollowup(actor, activityId, reason));
    });
  } catch (error) { return errorResponse(error); }
}
