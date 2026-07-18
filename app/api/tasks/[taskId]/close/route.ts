import { closeTask } from "@/application/commands";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    await closeTask(await requireApiActor(), taskId);
    return Response.json({ taskId, status: "CLOSED" });
  } catch (error) { return errorResponse(error); }
}
