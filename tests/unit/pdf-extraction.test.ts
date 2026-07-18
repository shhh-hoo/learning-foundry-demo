import { describe, expect, it } from "vitest";
import { extractPdfPages } from "@/application/pdf-extraction";
import { simplePdf } from "@/tests/helpers/files";

describe("PDF page extraction", () => {
  it("loads the server worker handler and extracts real page text with a stable page locator", async () => {
    const pages = await extractPdfPages(simplePdf("Titration evidence from a real PDF page"));
    expect(pages).toEqual([{ page: 1, locator: "page:1", text: "Titration evidence from a real PDF page" }]);
    expect((globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler?: unknown } }).pdfjsWorker?.WorkerMessageHandler).toBeDefined();
  });
});
