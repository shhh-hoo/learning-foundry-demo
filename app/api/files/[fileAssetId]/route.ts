import { requireApiActor } from "@/application/identity";
import { errorResponse } from "@/application/http";
import { authorizeFileRead } from "@/application/file-intake";
import { runWithExecutionControl } from "@/application/execution-control";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ fileAssetId: string }> }) {
  try {
    const actor = await requireApiActor();
    const { fileAssetId } = await context.params;
    const { asset, bytes } = await runWithExecutionControl({ signal: request.signal }, () => authorizeFileRead(actor, fileAssetId));
    const body = bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : Uint8Array.from(bytes).buffer;
    return new Response(body, {
      headers: {
        "content-type": asset.mediaType,
        "content-length": String(asset.byteSize),
        "content-disposition": `inline; filename="${asset.originalName.replace(/["\\]/g, "-")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
