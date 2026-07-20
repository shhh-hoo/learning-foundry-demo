import { GovernedFollowupStart } from "@/domain/governed-followup";
import { withApiActor } from "@/application/identity";
import { errorResponse, requireWorkflowHttpSuccess } from "@/application/http";
import { startWorkflow } from "@/application/workflow-service";

export async function POST(request: Request) {
  try {
    const result = await withApiActor(async (actor) => {
      const state = GovernedFollowupStart.parse(await request.json());
      return startWorkflow({
        kind: "GOVERNED_FOLLOWUP",
        actor,
        state,
        execution: { signal: request.signal },
      });
    });
    requireWorkflowHttpSuccess(result);
    return Response.json(result, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
