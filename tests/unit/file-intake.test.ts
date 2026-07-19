import { describe, expect, it } from "vitest";
import { validateUpload } from "@/domain/file-intake";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

describe("governed file intake", () => {
  it("uses content signatures and SHA-256 rather than trusting filename or MIME alone", () => {
    const result = validateUpload({ bytes: png, declaredMediaType: "image/png", originalName: "../handwritten\u0000 work.png", purpose: "LEARNER_ATTEMPT" });
    expect(result.mediaType).toBe("image/png");
    expect(result.extension).toBe("png");
    expect(result.safeName).not.toMatch(/[\\/\u0000]/);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects declared types that do not match bytes", () => {
    expect(() => validateUpload({ bytes: png, declaredMediaType: "image/jpeg", originalName: "fake.jpg", purpose: "LEARNING_MATERIAL" })).toThrow(/does not match/);
  });

  it("rejects PDFs as learner image Attempts", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n");
    expect(() => validateUpload({ bytes: pdf, declaredMediaType: "application/pdf", originalName: "attempt.pdf", purpose: "LEARNER_ATTEMPT" })).toThrow(/must be PNG, JPEG, or WebP/);
  });
});
