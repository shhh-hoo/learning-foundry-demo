export type ExtractedPdfPage = { page: number; locator: string; text: string };

type PdfJsWorkerGlobal = typeof globalThis & {
  pdfjsWorker?: { WorkerMessageHandler: unknown };
};

async function loadServerPdfJs() {
  // PDF.js runs its worker handler in-process on Node. Import it explicitly so
  // Next/Turbopack owns the dependency edge instead of PDF.js resolving the
  // default "./pdf.worker.mjs" relative to a generated server chunk.
  const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const workerGlobal = globalThis as PdfJsWorkerGlobal;
  workerGlobal.pdfjsWorker ??= workerModule;
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function extractPdfPages(bytes: Uint8Array): Promise<ExtractedPdfPage[]> {
  const { getDocument } = await loadServerPdfJs();
  const loadingTask = getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    const pages: ExtractedPdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => "str" in item && typeof item.str === "string" ? [item.str] : []).join(" ").replace(/\s+/g, " ").trim();
      pages.push({ page: pageNumber, locator: `page:${pageNumber}`, text });
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
