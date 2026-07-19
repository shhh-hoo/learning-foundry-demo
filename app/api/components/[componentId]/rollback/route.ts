import { z } from "zod";
import { rollbackComponent } from "@/application/commands";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const Rollback = z.object({ targetVersionId: z.string().uuid(), expectedActiveVersionId: z.string().uuid(), rationale: z.string().trim().min(5), idempotencyKey: z.string().min(8) }).strict();

export async function POST(request: Request, context: { params: Promise<{ componentId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      const { componentId } = await context.params;
      return Response.json(await rollbackComponent(actor, { componentId, ...Rollback.parse(await request.json()) }));
    });
  } catch (error) { return errorResponse(error); }
}
