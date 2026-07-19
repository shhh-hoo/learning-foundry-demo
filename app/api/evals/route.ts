import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { requireRole } from "@/domain/invariants";
import { runFrameworkContractChecks } from "@/evals/run";

export async function POST() {
  try {
    const actor = await requireApiActor();
    requireRole(actor, ["ENGINEER", "ADMIN"]);
    return Response.json(await runFrameworkContractChecks(actor));
  } catch (error) { return errorResponse(error); }
}
