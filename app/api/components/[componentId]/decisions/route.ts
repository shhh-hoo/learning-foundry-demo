import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { DomainInvariantError, requireRole } from "@/domain/invariants";

export async function POST(request: Request, context: { params: Promise<{ componentId: string }> }) {
  try {
    requireRole(await requireApiActor(), ["EXPERT", "ADMIN"]);
    await request.json();
    await context.params;
    throw new DomainInvariantError("Publication decisions are accepted only by resuming the current LangGraph expert interrupt", "PUBLICATION_WORKFLOW_REQUIRED");
  } catch (error) { return errorResponse(error); }
}
