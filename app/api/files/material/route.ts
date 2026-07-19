import { z } from "zod";
import { withApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { uploadLearningMaterial } from "@/application/file-intake";
import { MAX_MATERIAL_BYTES } from "@/domain/file-intake";
import { DomainInvariantError } from "@/domain/invariants";
import { runWithExecutionControl } from "@/application/execution-control";

export const runtime = "nodejs";

const Fields = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  rights: z.string().trim().min(3).max(1_000),
  idempotencyKey: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    return await withApiActor(async (actor) => {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new DomainInvariantError("A PDF or image file is required", "FILE_REQUIRED");
      if (file.size > MAX_MATERIAL_BYTES) throw new DomainInvariantError(`Learning material exceeds ${MAX_MATERIAL_BYTES} bytes`, "FILE_SIZE_INVALID");
      const fields = Fields.parse(Object.fromEntries(["taskId", "episodeId", "title", "rights", "idempotencyKey"].map((key) => [key, form.get(key)])));
      const result = await runWithExecutionControl({ signal: request.signal }, async () => uploadLearningMaterial(actor, {
        ...fields,
        bytes: new Uint8Array(await file.arrayBuffer()),
        declaredMediaType: file.type,
        originalName: file.name,
      }));
      return Response.json(result, { status: result.replayed ? 200 : 201 });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
