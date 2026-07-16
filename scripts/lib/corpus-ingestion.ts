import Ajv2020 from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { CorpusChunk, CorpusIndexManifest, CorpusSourceStatus, CorpusSourceType } from "../../src/corpus/types";

interface RegisteredSource {
  readonly sourceId: string;
  readonly title: string;
  readonly sourceType: "OFFICIAL_SYLLABUS" | "SECONDARY_TEACHING_REFERENCE";
  readonly authority: string;
  readonly version?: string;
  readonly expectedLocalFilename: string;
  readonly publicExport: string;
}

interface SourceManifest {
  readonly schemaVersion: string;
  readonly corpusId: string;
  readonly distributionScope: "SCHOOL_INTERNAL";
  readonly sources: readonly RegisteredSource[];
}

interface CalculationFamily {
  readonly id: string;
  readonly level: "AS" | "A" | "AS/A";
  readonly name: string;
  readonly syllabusRefs: readonly string[];
  readonly route: string;
  readonly bookRef: string;
}

interface PdfPage { readonly page: number; readonly text: string }

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const normalise = (value: string) => value.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }

async function extractPdfPages(path: string): Promise<readonly PdfPage[]> {
  const bytes = new Uint8Array(await readFile(path));
  const document = await getDocument({ data: bytes, disableFontFace: true }).promise;
  const pages: PdfPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : " "}`;
    }
    pages.push({ page: pageNumber, text: normalise(text) });
  }
  return pages;
}

function familyIdsForOutcomes(families: readonly CalculationFamily[], outcomes: readonly string[]): string[] {
  return families.filter((family) => family.syllabusRefs.some((ref) => outcomes.some((outcome) => ref === outcome || ref.startsWith(`${outcome}(`) || outcome.startsWith(`${ref}(`)))).map((family) => family.id);
}

function familyIdsForBook(families: readonly CalculationFamily[], chapter: number, printedPage: number, text: string): string[] {
  const haystack = text.toLowerCase();
  return families.filter((family) => {
    const pageMatch = [...family.bookRef.matchAll(/printed pp?\.\s*(\d+)(?:[–-](\d+))?/giu)].some((match) => printedPage >= Number(match[1]) && printedPage <= Number(match[2] ?? match[1]));
    const chapterMatch = new RegExp(`\\bCh\\.?\\s*${chapter}\\b`, "iu").test(family.bookRef);
    const keywords = `${family.name} ${family.route}`.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 6);
    return pageMatch || (chapterMatch && keywords.some((word) => haystack.includes(word)));
  }).map((family) => family.id);
}

function makeChunk(value: Omit<CorpusChunk, "contentHash">): CorpusChunk {
  return { ...value, contentHash: sha256(normalise(value.text)) };
}

function parseSyllabus(pages: readonly PdfPage[], source: RegisteredSource, families: readonly CalculationFamily[]): CorpusChunk[] {
  const chunks: CorpusChunk[] = [];
  for (const page of pages) {
    const headings = [...page.text.matchAll(/^(\d+\.\d+)\s+([^\n]+)/gmu)];
    for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
      const heading = headings[headingIndex]!;
      const section = heading[1]!;
      const sectionTitle = normalise(heading[2]!);
      const start = heading.index! + heading[0].length;
      const end = headings[headingIndex + 1]?.index ?? page.text.length;
      const sectionBody = normalise(page.text.slice(start, end));
      const outcomesBody = sectionBody.split(/Candidates should be able to:/iu)[1];
      if (!outcomesBody) continue;
      const outcomes = [...outcomesBody.matchAll(/^(\d+)\s+([^\n][\s\S]*?)(?=^\d+\s+[^\n]|$)/gmu)];
      for (const outcome of outcomes) {
        const outcomeId = `${section}.${outcome[1]}`;
        const text = normalise(outcome[2]!);
        if (!text) continue;
        const subIds = [...text.matchAll(/^\s*\(([a-z])\)\s/gmu)].map((match) => `${outcomeId}(${match[1]})`);
        const learningOutcomeIds = [outcomeId, ...subIds];
        const calculationFamilyIds = familyIdsForOutcomes(families, learningOutcomeIds);
        chunks.push(makeChunk({
          chunkId: `${source.sourceId}::${outcomeId}`,
          documentId: source.sourceId,
          sourceType: "OFFICIAL_SYLLABUS",
          distributionScope: "SCHOOL_INTERNAL",
          title: `${outcomeId} ${sectionTitle}`,
          text,
          contextualText: `${section} ${sectionTitle}`,
          examBoard: "CAIE",
          syllabusCode: "9701",
          syllabusVersion: "2025-2027",
          level: Number(section.split(".")[0]) <= 22 ? "AS" : "A",
          topic: sectionTitle,
          calculationFamilyIds,
          learningOutcomeIds,
          documentPage: page.page,
          section,
          rights: { publicExportAllowed: true, maxQuoteWords: 25, attribution: source.title },
        }));
      }
    }
  }

  const practicalHeadings = new RegExp(`^(Introduction|Paper [35][^\\n]*|Expectations for each skill[^\\n]*|Manipulation, measurement and observation|Successful collection of data and observations|Quality of measurements or observations|Decisions relating to measurements or observations|Presentation of data and observations|Recording data and observations|Display of calculation and reasoning|Data layout|Analysis, conclusions and e${"valuation"}|Interpretation of data or observations|Drawing conclusions|Identifying sources of error and suggesting improvements|Practical procedures|Quantitative analysis|Titration experiments|Rates experiments|Gravimetric experiments|Thermometric experiments|Gas volume experiments)$`, "gimu");
  for (const page of pages.filter((item) => item.page >= 58 && item.page <= 74)) {
    const headings = [...page.text.matchAll(practicalHeadings)];
    for (let index = 0; index < headings.length; index += 1) {
      const heading = normalise(headings[index]![1]!);
      const start = headings[index]!.index! + headings[index]![0].length;
      const end = headings[index + 1]?.index ?? page.text.length;
      const text = normalise(page.text.slice(start, end));
      if (text.split(/\s+/).length < 8) continue;
      const outcomeId = `PRACTICAL-${slug(heading).toUpperCase()}`;
      const calculationFamilyIds = families.filter((family) => /practical|titr|gas|thermo|rate|gravimet/iu.test(`${heading} ${text}`) && family.syllabusRefs.some((ref) => /Practical/iu.test(ref))).map((family) => family.id);
      chunks.push(makeChunk({
        chunkId: `${source.sourceId}::${outcomeId}::p${page.page}`,
        documentId: source.sourceId,
        sourceType: "OFFICIAL_SYLLABUS",
        distributionScope: "SCHOOL_INTERNAL",
        title: `Practical assessment · ${heading}`,
        text,
        examBoard: "CAIE",
        syllabusCode: "9701",
        syllabusVersion: "2025-2027",
        level: "AS_A",
        topic: "Practical assessment",
        calculationFamilyIds: unique(calculationFamilyIds),
        learningOutcomeIds: [outcomeId],
        documentPage: page.page,
        section: heading,
        rights: { publicExportAllowed: true, maxQuoteWords: 25, attribution: source.title },
      }));
    }
  }
  return chunks;
}

const chapterStarts = [1, 19, 42, 55, 84, 123, 152, 183, 220, 241, 258];
const chapterTitles = [
  "Formulae, Equations and Oxidation States", "Basic Calculations Involving Formulae and Equations", "Basic Calculations Involving Gases", "Basic Calculations Involving Solutions", "Thermochemistry", "Orders of Reaction", "Chemical Equilibria", "Acid-Base Equilibria", "Other Equilibria", "Redox Equilibria", "Entropy and Free Energy",
];
const bookSectionTitles = [
  "Formulae", "Equations", "Redox reactions and oxidation states", "Relative atomic mass", "Relative formula mass", "The mole", "What is special about moles?", "Using moles to find formulae", "Calculations from equations", "Avogadro's law", "The molar volume of a gas", "The ideal gas equation", "How to work with solution concentrations", "Titration calculations", "Processing the results from thermochemistry experiments", "Hess's Law cycles", "Born–Haber cycles", "The effect of concentration on rates of reaction", "Explaining orders of reaction", "Finding orders of reaction from initial rate experiments", "Finding orders of reaction graphically", "The effect of temperature on rates", "Dynamic homogeneous equilibria", "Dynamic heterogeneous equilibria", "Defining pH", "The pH of strong acids", "The ionic product for water", "The pH of strong bases", "Calculating the pH of mixtures produced during titrations", "The pH of weak acids", "The pH of weak bases", "Buffer solutions", "Solubility product", "Partition coefficients", "Henry's Law", "Standard electrode potentials", "The electrochemical series", "Calculations involving E values", "Using E values to predict the feasibility of redox reactions", "Feasible and spontaneous reactions", "Entropy", "Free energy changes",
];
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function chapterForPrintedPage(page: number): number {
  let chapter = 1;
  chapterStarts.forEach((start, index) => { if (page >= start) chapter = index + 1; });
  return chapter;
}

function parseCalculationReference(pages: readonly PdfPage[], source: RegisteredSource, families: readonly CalculationFamily[]): CorpusChunk[] {
  const chunks: CorpusChunk[] = [];
  for (const page of pages) {
    const printedPage = page.page - 5;
    if (printedPage < 1 || printedPage > 275) continue;
    const chapter = chapterForPrintedPage(printedPage);
    const chapterTitle = chapterTitles[chapter - 1] ?? `Chapter ${chapter}`;
    const sectionPattern = bookSectionTitles.map(regexEscape).join("|");
    const boundaryPattern = new RegExp(`^(${sectionPattern}|Example(?:s)?\\s+[^\\n]*|End of chapter checklist|Revision problems|>\\s*[^\\n]+)$`, "gimu");
    const boundaries = [...page.text.matchAll(boundaryPattern)];
    const boundarySegments = boundaries.map((boundary, index) => ({
      heading: normalise(boundary[1]!),
      start: boundary.index! + boundary[0].length,
      end: boundaries[index + 1]?.index ?? page.text.length,
    }));
    const segments = boundaries.length
      ? [...(boundaries[0]!.index! > 0 ? [{ heading: chapterTitle, start: 0, end: boundaries[0]!.index! }] : []), ...boundarySegments]
      : [{ heading: chapterTitle, start: 0, end: page.text.length }];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const text = normalise(page.text.slice(segment.start, segment.end));
      if (text.split(/\s+/).length < 12) continue;
      const kind = /^Example/iu.test(segment.heading) ? "EXAMPLE" : /^End of chapter checklist/iu.test(segment.heading) ? "CHECKLIST" : /^Revision problems/iu.test(segment.heading) ? "PROBLEM" : /^>/u.test(segment.heading) ? "HINT" : "SECTION";
      const section = `Chapter ${chapter} · ${segment.heading.replace(/^>\s*/u, "")}`;
      const calculationFamilyIds = familyIdsForBook(families, chapter, printedPage, `${section} ${text}`);
      chunks.push(makeChunk({
        chunkId: `${source.sourceId}::ch${chapter}::p${printedPage}::${kind.toLowerCase()}-${index + 1}`,
        documentId: source.sourceId,
        sourceType: "SECONDARY_REFERENCE",
        distributionScope: "SCHOOL_INTERNAL",
        title: `${chapterTitle} · ${segment.heading.replace(/^>\s*/u, "")}`,
        text,
        contextualText: `${kind} in Chapter ${chapter}, printed page ${printedPage}`,
        examBoard: "CAIE",
        syllabusCode: "9701",
        syllabusVersion: "2025-2027",
        level: chapter <= 4 ? "AS" : "AS_A",
        topic: chapterTitle,
        calculationFamilyIds: unique(calculationFamilyIds),
        learningOutcomeIds: unique(families.filter((family) => calculationFamilyIds.includes(family.id)).flatMap((family) => family.syllabusRefs.filter((ref) => /^\d/iu.test(ref)))),
        documentPage: page.page,
        printedPage,
        section,
        rights: { publicExportAllowed: false, maxQuoteWords: 0, attribution: source.title },
      }));
    }
  }
  return chunks;
}

function parseFrontmatter(markdown: string): { readonly metadata: Record<string, unknown>; readonly body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u);
  if (!match) throw new Error("Teacher Note is missing YAML frontmatter.");
  const metadata: Record<string, unknown> = {};
  for (const line of match[1]!.split("\n")) {
    const split = line.indexOf(":");
    if (split < 0) continue;
    const key = line.slice(0, split).trim();
    const raw = line.slice(split + 1).trim();
    if (raw.startsWith("[") && raw.endsWith("]")) metadata[key] = raw.slice(1, -1).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    else metadata[key] = raw.replace(/^['"]|['"]$/g, "");
  }
  return { metadata, body: normalise(match[2]!) };
}

async function parseTeacherNotes(directory: string, families: readonly CalculationFamily[]): Promise<CorpusChunk[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".md")).sort();
  return Promise.all(files.map(async (file) => {
    const { metadata, body } = parseFrontmatter(await readFile(join(directory, file), "utf8"));
    const documentId = String(metadata.resourceId ?? "");
    if (!documentId) throw new Error(`${file} has no resourceId.`);
    const calculationFamilyIds = Array.isArray(metadata.calculationFamilyIds) ? metadata.calculationFamilyIds.map(String) : [];
    const learningOutcomeIds = Array.isArray(metadata.learningOutcomeIds) ? metadata.learningOutcomeIds.map(String) : [];
    const title = body.match(/^#\s+(.+)$/mu)?.[1] ?? basename(file, ".md");
    const topic = families.find((family) => calculationFamilyIds.includes(family.id))?.name ?? "Chemistry calculations";
    return makeChunk({
      chunkId: `${documentId}::note`,
      documentId,
      sourceType: "TEACHER_NOTE",
      distributionScope: "SCHOOL_INTERNAL",
      title,
      text: body,
      examBoard: "CAIE",
      syllabusCode: "9701",
      syllabusVersion: String(metadata.syllabusVersion ?? "2025-2027"),
      level: "AS_A",
      topic,
      calculationFamilyIds,
      learningOutcomeIds,
      section: "Teacher Note",
      rights: { publicExportAllowed: true, attribution: "Learning Foundry school-authored Teacher Note" },
    });
  }));
}

function countChunks(chunks: readonly CorpusChunk[]): Record<string, number> {
  return chunks.reduce<Record<string, number>>((counts, chunk) => {
    const key = `${chunk.sourceType}:${chunk.distributionScope}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export interface IngestCorpusOptions {
  readonly rootDirectory?: string;
  readonly now?: () => Date;
}

export async function ingestCorpus(options: IngestCorpusOptions = {}): Promise<CorpusIndexManifest> {
  const root = resolve(options.rootDirectory ?? process.cwd());
  const corpusDirectory = join(root, "corpus");
  const privateSourceDirectory = join(root, "private-sources");
  const outputDirectory = join(root, ".local-data/corpus");
  const manifestPath = join(corpusDirectory, "02_SOURCE_MANIFEST.json");
  const schemaPath = join(corpusDirectory, "04_RETRIEVAL_CHUNK_SCHEMA.json");
  const familyPath = join(corpusDirectory, "03_CALCULATION_FAMILIES.json");
  const [manifestText, sourceManifest, schema, familyRegistry] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readJson<SourceManifest>(manifestPath),
    readJson<Record<string, unknown>>(schemaPath),
    readJson<{ readonly families: readonly CalculationFamily[] }>(familyPath),
  ]);
  if (!sourceManifest.distributionScope) throw new Error("CORPUS_DISTRIBUTION_SCOPE_MISSING: source manifest must fail closed.");

  const chunks = await parseTeacherNotes(join(corpusDirectory, "teacher-notes"), familyRegistry.families);
  const sourceStatuses: CorpusSourceStatus[] = [];
  for (const source of sourceManifest.sources) {
    const path = join(privateSourceDirectory, source.expectedLocalFilename);
    let present = false;
    try { present = (await stat(path)).isFile(); } catch { present = false; }
    const mappedType: CorpusSourceType = source.sourceType === "OFFICIAL_SYLLABUS" ? "OFFICIAL_SYLLABUS" : "SECONDARY_REFERENCE";
    if (!present) {
      sourceStatuses.push({ sourceId: source.sourceId, sourceType: mappedType, distributionScope: "SCHOOL_INTERNAL", expectedLocalFilename: source.expectedLocalFilename, status: "MISSING" });
      continue;
    }
    const bytes = new Uint8Array(await readFile(path));
    sourceStatuses.push({ sourceId: source.sourceId, sourceType: mappedType, distributionScope: "SCHOOL_INTERNAL", expectedLocalFilename: source.expectedLocalFilename, status: "REGISTERED", contentHash: sha256(bytes) });
    const pages = await extractPdfPages(path);
    chunks.push(...(mappedType === "OFFICIAL_SYLLABUS" ? parseSyllabus(pages, source, familyRegistry.families) : parseCalculationReference(pages, source, familyRegistry.families)));
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  for (const chunk of chunks) {
    const chunkId = chunk.chunkId;
    if (!validate(chunk)) throw new Error(`CORPUS_CHUNK_SCHEMA_INVALID: ${chunkId}: ${ajv.errorsText(validate.errors)}`);
  }
  const orderedChunks = [...chunks].sort((left, right) => left.chunkId.localeCompare(right.chunkId));
  const chunksJson = `${JSON.stringify(orderedChunks, null, 2)}\n`;
  const chunksHash = sha256(chunksJson);
  const sourceManifestHash = sha256(manifestText);
  const indexHash = sha256(JSON.stringify({ corpusId: sourceManifest.corpusId, sourceManifestHash, chunksHash, sources: sourceStatuses }));
  const indexVersion = `v0.1-${indexHash.slice(0, 12)}`;
  const immutableDirectory = join(outputDirectory, "indexes", indexVersion);
  await mkdir(immutableDirectory, { recursive: true });
  const chunksFile = "chunks.json";
  const manifest: CorpusIndexManifest = {
    schemaVersion: "1.0.0",
    corpusId: sourceManifest.corpusId,
    indexVersion,
    indexHash,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    sourceManifestHash,
    chunksFile,
    chunksHash,
    chunkCount: orderedChunks.length,
    chunkCounts: countChunks(orderedChunks),
    sources: sourceStatuses,
  };
  const immutableManifestPath = join(immutableDirectory, "manifest.json");
  let existing: CorpusIndexManifest | null = null;
  try { existing = await readJson<CorpusIndexManifest>(immutableManifestPath); } catch { existing = null; }
  if (existing && (existing.indexHash !== indexHash || existing.chunksHash !== chunksHash)) throw new Error(`IMMUTABLE_INDEX_CONFLICT: ${indexVersion}`);
  if (!existing) {
    await writeFile(join(immutableDirectory, chunksFile), chunksJson, { encoding: "utf8", flag: "wx" });
    await writeFile(immutableManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeJsonAtomic(join(outputDirectory, "latest.json"), { indexVersion, indexHash, manifestPath: `indexes/${indexVersion}/manifest.json` });
  return existing ?? manifest;
}

export async function buildPublicSafeExport(rootDirectory = process.cwd()): Promise<unknown> {
  const root = resolve(rootDirectory);
  const corpusDirectory = join(root, "corpus");
  const sourceManifest = await readJson<SourceManifest>(join(corpusDirectory, "02_SOURCE_MANIFEST.json"));
  const noteFiles = (await readdir(join(corpusDirectory, "teacher-notes"))).filter((file) => file.endsWith(".md")).sort();
  const caseFiles = (await readdir(join(corpusDirectory, "cases"))).filter((file) => file.endsWith(".json")).sort();
  const teacherNotes = await Promise.all(noteFiles.map(async (file) => ({ file, content: await readFile(join(corpusDirectory, "teacher-notes", file), "utf8") })));
  const cases = await Promise.all(caseFiles.map(async (file) => ({ file, record: await readJson<unknown>(join(corpusDirectory, "cases", file)) })));
  return {
    schemaVersion: "1.0.0",
    corpusId: sourceManifest.corpusId,
    policy: "METADATA_AND_ORIGINAL_TEACHER_NOTES_ONLY",
    sources: sourceManifest.sources.map(({ expectedLocalFilename: _privateFilename, ...metadata }) => metadata),
    teacherNotes,
    cases,
  };
}
