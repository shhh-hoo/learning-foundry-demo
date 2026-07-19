import { z } from "zod";
import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { uploadImageAttempt } from "@/application/file-intake";
import { MAX_ATTEMPT_IMAGE_BYTES } from "@/domain/file-intake";
import { DomainInvariantError } from "@/domain/invariants";
import { runWithExecutionControl } from "@/application/execution-control";

export const runtime = "nodejs";

const Fields = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  prompt: z.string().trim().min(3).max(2_000),
  learnerNote: z.string().trim().max(4_000).optional(),
  idempotencyKey: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new DomainInvariantError("A PNG, JPEG, or WebP Attempt image is required", "FILE_REQUIRED");
    if (file.size > MAX_ATTEMPT_IMAGE_BYTES) throw new DomainInvariantError(`Attempt image exceeds ${MAX_ATTEMPT_IMAGE_BYTES} bytes`, "FILE_SIZE_INVALID");
    const fields = Fields.parse(Object.fromEntries(["taskId", "episodeId", "prompt", "learnerNote", "idempotencyKey"].map((key) => [key, form.get(key) || undefined])));
    const result = await runWithExecutionControl({ signal: request.signal }, async () => uploadImageAttempt(actor, {
      ...fields,
      bytes: new Uint8Array(await file.arrayBuffer()),
      declaredMediaType: file.type,
      originalName: file.name,
    }));
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
