import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { createTeacherIntervention } from "@/application/teacher-governance";
import { TeacherInterventionCommand } from "@/domain/teacher-governance";

export async function POST(request: Request) {
  try {
    return await withApiActor(async (actor) => Response.json(
      await createTeacherIntervention(actor, TeacherInterventionCommand.parse(await request.json())),
      { status: 201 },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
