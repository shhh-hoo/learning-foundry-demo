import { z } from "zod";
import { resolveCapabilityForDiagnosis } from "@/application/capability-resolution";
import { planActivityForResolution } from "@/application/activity-planning";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

const Request = z.object({ taskId: z.string().uuid(), episodeId: z.string().uuid(), diagnosticObservationId: z.string().uuid() }).strict();

export async function POST(request: globalThis.Request) {
  try {
    return await withApiActor(async (actor) => {
      const body = Request.parse(await request.json());
      const resolution = await resolveCapabilityForDiagnosis(actor, body);
      const plan = await planActivityForResolution(actor, { taskId: body.taskId, episodeId: body.episodeId, capabilityResolutionId: resolution.id });
      return Response.json({ resolution, plan }, { status: 201 });
    });
  } catch (error) { return errorResponse(error); }
}
