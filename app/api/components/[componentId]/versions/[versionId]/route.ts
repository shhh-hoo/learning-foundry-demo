import { z } from "zod";
import { updateComponentVersion } from "@/application/commands";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const UpdateVersion = z.object({
  contract: z.record(z.string(), z.unknown()),
  content: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8),
});

export async function PATCH(request: Request, context: { params: Promise<{ componentId: string; versionId: string }> }) {
  try {
    const actor = await requireApiActor();
    const { componentId, versionId } = await context.params;
    return Response.json(await updateComponentVersion(actor, { componentId, componentVersionId: versionId, ...UpdateVersion.parse(await request.json()) }));
  } catch (error) { return errorResponse(error); }
}
