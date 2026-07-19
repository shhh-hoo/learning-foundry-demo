import { z } from "zod";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { startWorkflow } from "@/application/workflow-service";

const StartRetry = z.object({
  observationId: z.string().uuid(),
  reviewId: z.string().uuid(),
  activityType: z.literal("RETRY"),
  prompt: z.string().min(1),
  scheduledFor: z.string().datetime().optional(),
  assignmentIdempotencyKey: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    return await withApiActor(async (actor) => {
      const state = StartRetry.parse(await request.json());
      return Response.json(await startWorkflow({ kind: "RETRY_OUTCOME", actor, state, execution: { signal: request.signal } }), { status: 201 });
    });
  } catch (error) { return errorResponse(error); }
}
