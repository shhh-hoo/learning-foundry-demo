import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { DomainInvariantError, requireRole } from "@/domain/invariants";

export async function POST(request: Request, context: { params: Promise<{ componentId: string }> }) {
  try {
    requireRole(await requireApiActor(), ["EXPERT", "ADMIN"]);
    await request.json();
    await context.params;
    throw new DomainInvariantError("Component publication is unavailable until a real evaluator exists", "COMPONENT_EVALUATOR_UNAVAILABLE");
  } catch (error) { return errorResponse(error); }
}
