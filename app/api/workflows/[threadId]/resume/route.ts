import { z } from "zod";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { resumeWorkflow } from "@/application/workflow-service";

const ResumePayload = z.record(z.string(), z.unknown());

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      const { threadId } = await context.params;
      return Response.json(await resumeWorkflow(actor, threadId, ResumePayload.parse(await request.json()), { execution: { signal: request.signal } }));
    });
  } catch (error) { return errorResponse(error); }
}
