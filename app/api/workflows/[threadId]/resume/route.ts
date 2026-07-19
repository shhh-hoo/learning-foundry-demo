import { z } from "zod";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { resumeWorkflow } from "@/application/workflow-service";

const ResumePayload = z.record(z.string(), z.unknown());

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const actor = await requireApiActor();
    const { threadId } = await context.params;
    return Response.json(await resumeWorkflow(actor, threadId, ResumePayload.parse(await request.json())));
  } catch (error) { return errorResponse(error); }
}
