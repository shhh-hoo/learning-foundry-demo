import { z } from "zod";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { getTaskDetail } from "@/application/queries";
import { startWorkflow } from "@/application/workflow-service";

const Message = z.object({
  episodeId: z.string().uuid(),
  message: z.string().min(1).max(4_000),
  action: z.enum(["EXPLAIN", "LIBRARY", "STUDY_REVIEW"]).default("EXPLAIN"),
  idempotencyKey: z.string().min(8),
  scheduledFor: z.string().datetime().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      const { taskId } = await context.params;
      const body = Message.parse(await request.json());
      const detail = await getTaskDetail(actor, taskId);
      if (!detail) return Response.json({ error: "Task not found" }, { status: 404 });
      const result = await startWorkflow({
        kind: "LEARNER_TASK",
        actor,
        taskId,
        episodeId: body.episodeId,
        state: { taskId, episodeId: body.episodeId, courseId: detail.task.courseId, message: body.message, requestedAction: body.action, idempotencyKey: body.idempotencyKey, scheduledFor: body.scheduledFor },
        execution: { signal: request.signal },
      });
      return Response.json(result);
    });
  } catch (error) { return errorResponse(error); }
}
