import { createHash } from "node:crypto";
import { DomainInvariantError } from "@/domain/invariants";

export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;
export const MAX_ATTEMPT_IMAGE_BYTES = 10 * 1024 * 1024;

export type AcceptedMediaType = "application/pdf" | "image/png" | "image/jpeg" | "image/webp";

export type ValidatedUpload = {
  bytes: Uint8Array;
  mediaType: AcceptedMediaType;
  byteSize: number;
  contentHash: string;
  safeName: string;
  extension: "pdf" | "png" | "jpg" | "webp";
};

function detectedType(bytes: Uint8Array): AcceptedMediaType | null {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function safeFileName(value: string): string {
  const name = value.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "-").replace(/\s+/g, " ").trim();
  return (name || "upload").slice(0, 180);
}

export function validateUpload(input: {
  bytes: Uint8Array;
  declaredMediaType: string;
  originalName: string;
  purpose: "LEARNING_MATERIAL" | "LEARNER_ATTEMPT";
}): ValidatedUpload {
  const maxBytes = input.purpose === "LEARNING_MATERIAL" ? MAX_MATERIAL_BYTES : MAX_ATTEMPT_IMAGE_BYTES;
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > maxBytes) {
    throw new DomainInvariantError(`Upload must contain between 1 byte and ${maxBytes} bytes`, "FILE_SIZE_INVALID");
  }
  const actual = detectedType(input.bytes);
  if (!actual || actual !== input.declaredMediaType) {
    throw new DomainInvariantError("File content does not match an accepted PDF or image media type", "FILE_TYPE_INVALID");
  }
  if (input.purpose === "LEARNER_ATTEMPT" && actual === "application/pdf") {
    throw new DomainInvariantError("Learner Attempt uploads must be PNG, JPEG, or WebP images", "ATTEMPT_FILE_TYPE_INVALID");
  }
  const extension = actual === "application/pdf" ? "pdf" : actual === "image/png" ? "png" : actual === "image/jpeg" ? "jpg" : "webp";
  return {
    bytes: input.bytes,
    mediaType: actual,
    byteSize: input.bytes.byteLength,
    contentHash: createHash("sha256").update(input.bytes).digest("hex"),
    safeName: safeFileName(input.originalName),
    extension,
  };
}
