import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { requireRole } from "@/domain/invariants";
import { runFrameworkContractChecks } from "@/evals/run";

export async function POST() {
  try {
    return await withApiActor(async (actor) => {
      requireRole(actor, ["ENGINEER", "ADMIN"]);
      return Response.json(await runFrameworkContractChecks(actor));
    });
  } catch (error) { return errorResponse(error); }
}
