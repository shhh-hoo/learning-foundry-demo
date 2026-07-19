import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { startWorkflow } from "@/application/workflow-service";
import { getDb } from "@/db/client";
import { componentVersions, components } from "@/db/schema";
import { DomainInvariantError, requireRole } from "@/domain/invariants";

const Evaluation = z.object({ componentVersionId: z.string().uuid() }).strict();

export async function POST(request: Request, context: { params: Promise<{ componentId: string }> }) {
  try {
    return await withApiActor(async (actor) => {
      requireRole(actor, ["EXPERT", "ADMIN"]);
      const { componentId } = await context.params;
      const body = Evaluation.parse(await request.json());
      const [row] = await getDb().select({ version: componentVersions })
        .from(componentVersions)
        .innerJoin(components, eq(components.id, componentVersions.componentId))
        .where(and(eq(componentVersions.id, body.componentVersionId), eq(components.id, componentId), eq(components.institutionId, actor.institutionId)))
        .limit(1);
      if (!row) throw new DomainInvariantError("Component version is outside the active institution", "TENANT_ISOLATION");
      return Response.json(await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor, state: { componentId, componentVersionId: row.version.id }, execution: { signal: request.signal } }), { status: 201 });
    });
  } catch (error) { return errorResponse(error); }
}
