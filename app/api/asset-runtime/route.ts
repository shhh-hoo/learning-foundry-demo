import { withApiActor } from "@/application/identity";
import { errorResponse, requireWorkflowHttpSuccess } from "@/application/http";
import { startWorkflow } from "@/application/workflow-service";
import { deriveWebComponentAssetRuntimeRequest } from "@/application/web-component-runtime";
import { DomainInvariantError } from "@/domain/invariants";
import { WebComponentAssetDeliveryRequest } from "@/domain/web-component-asset";

export async function POST(request: Request) {
  try {
    const result = await withApiActor(async (actor) => {
      const body = WebComponentAssetDeliveryRequest.parse(await request.json());
      const canonical = await deriveWebComponentAssetRuntimeRequest(actor, body);
      return startWorkflow({
        kind: "ASSET_RUNTIME",
        actor,
        taskId: body.taskId,
        episodeId: body.episodeId,
        state: canonical,
        execution: { signal: request.signal },
      });
    });
    requireWorkflowHttpSuccess(result);
    const runtime = result.result as { runtimeStatus?: string; runtimeDeliveryId?: string };
    if (runtime.runtimeStatus !== "SUCCEEDED") {
      throw new DomainInvariantError(`ComponentAsset delivery ended in ${runtime.runtimeStatus ?? "FAILED"}; the persisted delivery can be inspected and retried when allowed`, `ASSET_RUNTIME_${runtime.runtimeStatus ?? "FAILED"}`);
    }
    return Response.json(result, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
