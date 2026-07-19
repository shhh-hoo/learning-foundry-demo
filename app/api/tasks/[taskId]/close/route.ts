import { closeTask } from "@/application/commands";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      const { taskId } = await context.params;
      await closeTask(actor, taskId);
      return Response.json({ taskId, status: "CLOSED" });
    });
  } catch (error) { return errorResponse(error); }
}
