import { z } from "zod";
import { rollbackComponent } from "@/application/commands";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const Rollback = z.object({ targetVersionId: z.string().uuid(), rationale: z.string().min(5), idempotencyKey: z.string().min(8) });

export async function POST(request: Request, context: { params: Promise<{ componentId: string }> }) {
  try {
    const actor = await requireApiActor();
    const { componentId } = await context.params;
    return Response.json(await rollbackComponent(actor, { componentId, ...Rollback.parse(await request.json()) }));
  } catch (error) { return errorResponse(error); }
}
