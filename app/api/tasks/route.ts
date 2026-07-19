import { z } from "zod";
import { createTask } from "@/application/commands";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { getLearnerWorkspace } from "@/application/queries";

const CreateTask = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(3).max(160),
  goal: z.string().min(5).max(500),
  idempotencyKey: z.string().min(8),
});

export async function GET() {
  try { return Response.json(await getLearnerWorkspace(await requireApiActor())); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor();
    return Response.json(await createTask(actor, CreateTask.parse(await request.json())), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
