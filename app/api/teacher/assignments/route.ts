import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { createTeacherAssignment } from "@/application/teacher-governance";
import { TeacherAssignmentCommand } from "@/domain/teacher-governance";

export async function POST(request: Request) {
  try {
    return await withApiActor(async (actor) => Response.json(
      await createTeacherAssignment(actor, TeacherAssignmentCommand.parse(await request.json())),
      { status: 201 },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
