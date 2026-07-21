import { z } from "zod";
import { previewWebComponentAsset } from "@/application/capability-supply";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const Preview = z.object({ componentVersionId: z.string().uuid(), selectedChoiceId: z.string().regex(/^[a-z0-9-]+$/), idempotencyKey: z.string().min(8) }).strict();

export async function POST(request: Request, context: { params: Promise<{ componentId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      const { componentId } = await context.params;
      return Response.json(await previewWebComponentAsset(actor, { componentId, ...Preview.parse(await request.json()) }), { status: 201 });
    });
  } catch (error) { return errorResponse(error); }
}
