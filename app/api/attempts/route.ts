import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { startDiagnosisWithTeacherReview } from "@/application/workflow-service";
import { LearnerAttemptRequest } from "@/application/attempt-request";

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor();
    const body = LearnerAttemptRequest.parse(await request.json());
    return Response.json(await startDiagnosisWithTeacherReview(actor, { ...body, sourceRefs: [] }, { execution: { signal: request.signal } }), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
