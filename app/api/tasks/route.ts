import { z } from "zod";
import { createTask } from "@/application/commands";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { getLearnerWorkspace } from "@/application/queries";

const CreateTask = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(3).max(160),
  goal: z.string().min(5).max(500),
  idempotencyKey: z.string().min(8),
});

export async function GET() {
  try { return await withApiActor(async (actor) => Response.json(await getLearnerWorkspace(actor))); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    return await withApiActor(async (actor) => Response.json(await createTask(actor, CreateTask.parse(await request.json())), { status: 201 }));
  } catch (error) { return errorResponse(error); }
}
