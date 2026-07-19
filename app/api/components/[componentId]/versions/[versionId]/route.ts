import { z } from "zod";
import { updateComponentVersion } from "@/application/commands";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const UpdateVersion = z.object({
  title: z.string().trim().min(3),
  purpose: z.string().trim().min(10),
  content: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ componentId: string; versionId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      const { componentId, versionId } = await context.params;
      return Response.json(await updateComponentVersion(actor, { componentId, componentVersionId: versionId, ...UpdateVersion.parse(await request.json()) }));
    });
  } catch (error) { return errorResponse(error); }
}
