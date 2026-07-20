import { z } from "zod";
import { withApiActor } from "@/application/identity";
import { errorResponse, requireWorkflowHttpSuccess } from "@/application/http";
import { resumeWorkflow } from "@/application/workflow-service";

const ResumePayload = z.record(z.string(), z.unknown());

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const result = await withApiActor(async (actor) => {
      const { threadId } = await context.params;
      return resumeWorkflow(actor, threadId, ResumePayload.parse(await request.json()), { execution: { signal: request.signal } });
    });
    requireWorkflowHttpSuccess(result);
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}
