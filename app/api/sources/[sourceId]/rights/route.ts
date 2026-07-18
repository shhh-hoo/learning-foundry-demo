import { z } from "zod";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { reviewSourceRights } from "@/application/file-intake";

const RightsDecision = z.object({
  decision: z.enum(["APPROVED", "DENIED"]),
  rights: z.string().trim().min(3).max(1_000),
  idempotencyKey: z.string().min(8),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const actor = await requireApiActor();
    const { sourceId } = await context.params;
    return Response.json(await reviewSourceRights(actor, { sourceId, ...RightsDecision.parse(await request.json()) }));
  } catch (error) {
    return errorResponse(error);
  }
}
