import { z } from "zod";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { startDiagnosisWithTeacherReview } from "@/application/workflow-service";

const Attempt = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  capabilityId: z.string().uuid().optional(),
  prompt: z.string().min(1),
  response: z.string().min(1),
  structuredInput: z.record(z.string(), z.unknown()),
  sourceRefs: z.array(z.record(z.string(), z.string())).default([]),
  idempotencyKey: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor();
    const body = Attempt.parse(await request.json());
    return Response.json(await startDiagnosisWithTeacherReview(actor, body), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
