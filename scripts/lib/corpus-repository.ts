import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CorpusChunk, CorpusIndexManifest, CorpusSearchFilters, CorpusSearchResponse, CorpusSearchService, CorpusSourceStatus } from "../../src/corpus/types";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normaliseToken = (token: string) => token.toLowerCase().replace(/(?:ing|ed|es|s)$/u, "");
const tokens = (value: string) => value.normalize("NFKD").toLowerCase().split(/[^a-z0-9]+/u).filter((token) => token.length > 1).map(normaliseToken);
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

function sanitizeTraceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTraceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(?:authorization|api_?key|expectedLocalFilename|local_?path|source_?path)$/iu.test(key))
      .map(([key, item]) => [key, sanitizeTraceValue(item)]));
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/\bAuthorization\s*:\s*Bearer\s+\S+/giu, "[REDACTED]")
    .replace(/\bBearer\s+\S+/giu, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]")
    .replace(/(?:file:\/\/|\/(?:Users|home|private|var|tmp)\/)[^\s]+/gu, "[REDACTED]")
    .replace(/\S*private-sources[\\/]\S*/giu, "[REDACTED]");
}

interface LatestPointer { readonly indexVersion: string; readonly indexHash: string; readonly manifestPath: string }

interface ScoredChunk {
  readonly chunk: CorpusChunk;
  readonly rawLexicalScore: number;
  readonly sourceTypeBoost: number;
  readonly metadataBoost: number;
  readonly score: number;
}

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }

function matchesFilters(chunk: CorpusChunk, filters: CorpusSearchFilters): boolean {
  return (!filters.examBoard || chunk.examBoard === filters.examBoard)
    && (!filters.syllabusCode || chunk.syllabusCode === filters.syllabusCode)
    && (!filters.syllabusVersion || chunk.syllabusVersion === filters.syllabusVersion)
    && (!filters.level || chunk.level === filters.level || chunk.level === "AS_A")
    && (!filters.topic || chunk.topic.toLowerCase().includes(filters.topic.toLowerCase()))
    && (!filters.calculationFamilyId || Boolean(chunk.calculationFamilyIds?.includes(filters.calculationFamilyId)))
    && (!filters.learningOutcomeId || Boolean(chunk.learningOutcomeIds?.includes(filters.learningOutcomeId)))
    && (!filters.sourceType || chunk.sourceType === filters.sourceType)
    && (!filters.distributionScope || chunk.distributionScope === filters.distributionScope);
}

function scoreChunk(chunk: CorpusChunk, query: string, filters: CorpusSearchFilters): ScoredChunk {
  const queryTokens = unique(tokens(query));
  const titleTokens = tokens(chunk.title);
  const bodyTokens = tokens(`${chunk.text} ${chunk.contextualText ?? ""} ${chunk.topic}`);
  let rawLexicalScore = queryTokens.reduce((score, token) => score + (titleTokens.includes(token) ? 3 : 0) + Math.min(3, bodyTokens.filter((candidate) => candidate === token).length), 0);
  if (chunk.title.toLowerCase().includes(query.toLowerCase())) rawLexicalScore += 3;
  let sourceTypeBoost = 0;
  if (/syllabus|course|scope|required|learning outcome/iu.test(query) && chunk.sourceType === "OFFICIAL_SYLLABUS") sourceTypeBoost += 4;
  if (filters.calculationFamilyId && chunk.sourceType === "OFFICIAL_SYLLABUS") sourceTypeBoost += 4;
  if (/why|how|explain|decide|route|mistake/iu.test(query) && chunk.sourceType === "TEACHER_NOTE") sourceTypeBoost += 4;
  if (/worked|example|problem|practice/iu.test(query) && chunk.sourceType === "STRUCTURED_CASE") sourceTypeBoost += 4;
  let metadataBoost = 0;
  if (filters.learningOutcomeId && chunk.learningOutcomeIds?.includes(filters.learningOutcomeId)) metadataBoost += 8;
  if (filters.calculationFamilyId && chunk.calculationFamilyIds?.includes(filters.calculationFamilyId)) metadataBoost += 6;
  return { chunk, rawLexicalScore, sourceTypeBoost, metadataBoost, score: rawLexicalScore + sourceTypeBoost + metadataBoost };
}

function excerpt(text: string, query: string): string {
  const words = text.replace(/^#.*$/gmu, "").replace(/```[\s\S]*?```/gu, " ").replace(/[#>*|`]/gu, " ").split(/\s+/u).filter(Boolean);
  if (words.length <= 80) return words.join(" ");
  const queryTokens = unique(tokens(query));
  const index = words.findIndex((word) => queryTokens.includes(normaliseToken(word.replace(/[^a-z0-9]/giu, ""))));
  const start = Math.max(0, (index < 0 ? 0 : index) - 16);
  return `${start > 0 ? "… " : ""}${words.slice(start, start + 80).join(" ")}${start + 80 < words.length ? " …" : ""}`;
}

export class LegacyLexicalEvidenceSearch implements CorpusSearchService {
  private constructor(
    readonly rootDirectory: string,
    readonly manifest: CorpusIndexManifest,
    readonly chunks: readonly CorpusChunk[],
  ) {}

  static async open(rootDirectory = process.cwd()): Promise<LegacyLexicalEvidenceSearch> {
    const root = resolve(rootDirectory);
    const corpusDirectory = join(root, ".local-data/corpus");
    const latest = await readJson<LatestPointer>(join(corpusDirectory, "latest.json"));
    const manifest = await readJson<CorpusIndexManifest>(join(corpusDirectory, latest.manifestPath));
    if (manifest.indexHash !== latest.indexHash || manifest.indexVersion !== latest.indexVersion) throw new Error("CORPUS_INDEX_POINTER_INVALID: latest pointer does not match its immutable manifest.");
    const manifestDirectory = join(corpusDirectory, "indexes", manifest.indexVersion);
    const chunksText = await readFile(join(manifestDirectory, manifest.chunksFile), "utf8");
    if (sha256(chunksText) !== manifest.chunksHash) throw new Error("CORPUS_INDEX_HASH_MISMATCH: chunks do not match the immutable manifest.");
    return new LegacyLexicalEvidenceSearch(root, manifest, JSON.parse(chunksText) as readonly CorpusChunk[]);
  }

  async search(query: string, filters: CorpusSearchFilters, context: { readonly conversationId?: string; readonly conversationEvidenceHash?: string; readonly route?: string } = {}): Promise<CorpusSearchResponse> {
    const candidates = this.chunks.filter((chunk) => matchesFilters(chunk, filters)).map((chunk) => scoreChunk(chunk, query, filters));
    const ranked = candidates.filter((candidate) => candidate.score > 0 || Boolean(filters.calculationFamilyId || filters.learningOutcomeId)).sort((left, right) => right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId));
    const selected = ranked.slice(0, 5);
    const retrievalTraceId = `retrieval-trace-${randomUUID()}`;
    const result: CorpusSearchResponse = {
      retrievalTraceId,
      query,
      filters,
      results: selected.map(({ chunk, score }) => ({
        chunkId: chunk.chunkId,
        sourceId: chunk.documentId,
        sourceType: chunk.sourceType,
        distributionScope: chunk.distributionScope,
        title: chunk.title,
        excerpt: excerpt(chunk.text, query),
        syllabusCode: chunk.syllabusCode,
        ...(chunk.syllabusVersion ? { syllabusVersion: chunk.syllabusVersion } : {}),
        learningOutcomeIds: chunk.learningOutcomeIds ?? [],
        calculationFamilyIds: chunk.calculationFamilyIds ?? [],
        ...(chunk.printedPage ?? chunk.documentPage ? { page: chunk.printedPage ?? chunk.documentPage } : {}),
        ...(chunk.section ? { section: chunk.section } : {}),
        score,
      })),
    };
    const traceDirectory = join(this.rootDirectory, ".local-data/corpus/retrieval-traces");
    await mkdir(traceDirectory, { recursive: true });
    const trace = {
      schemaVersion: "1.0.0",
      retrievalTraceId,
      createdAt: new Date().toISOString(),
      query,
      filters,
      context,
      indexVersion: this.manifest.indexVersion,
      indexHash: this.manifest.indexHash,
      candidateChunkIds: candidates.map((candidate) => candidate.chunk.chunkId),
      scoring: candidates.map((candidate) => ({ chunkId: candidate.chunk.chunkId, rawLexicalScore: candidate.rawLexicalScore, sourceTypeBoost: candidate.sourceTypeBoost, metadataBoost: candidate.metadataBoost, total: candidate.score })),
      selectedChunkIds: selected.map((candidate) => candidate.chunk.chunkId),
      rejected: candidates.filter((candidate) => !selected.includes(candidate)).map((candidate) => ({ chunkId: candidate.chunk.chunkId, reason: candidate.score <= 0 ? "NO_LEXICAL_OR_METADATA_MATCH" : "OUTSIDE_TOP_FIVE" })),
    };
    await writeFile(join(traceDirectory, `${retrievalTraceId}.json`), `${JSON.stringify(sanitizeTraceValue(trace), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return result;
  }
}

export { LegacyLexicalEvidenceSearch as CorpusRepository };

export async function inspectCorpus(rootDirectory = process.cwd()): Promise<{ readonly sources: readonly CorpusSourceStatus[]; readonly indexVersion: string | null; readonly chunkCount: number; readonly chunkCounts: Readonly<Record<string, number>> }> {
  const root = resolve(rootDirectory);
  const sourceManifest = await readJson<{ readonly sources: readonly { readonly sourceId: string; readonly sourceType: string; readonly expectedLocalFilename: string }[] }>(join(root, "corpus/02_SOURCE_MANIFEST.json"));
  const sources = await Promise.all(sourceManifest.sources.map(async (source): Promise<CorpusSourceStatus> => {
    const path = join(root, "private-sources", source.expectedLocalFilename);
    let registered = false;
    try { registered = (await stat(path)).isFile(); } catch { registered = false; }
    return { sourceId: source.sourceId, sourceType: source.sourceType === "OFFICIAL_SYLLABUS" ? "OFFICIAL_SYLLABUS" : "SECONDARY_REFERENCE", distributionScope: "SCHOOL_INTERNAL", expectedLocalFilename: source.expectedLocalFilename, status: registered ? "REGISTERED" : "MISSING" };
  }));
  try {
    const repository = await LegacyLexicalEvidenceSearch.open(root);
    return { sources, indexVersion: repository.manifest.indexVersion, chunkCount: repository.manifest.chunkCount, chunkCounts: repository.manifest.chunkCounts };
  } catch {
    return { sources, indexVersion: null, chunkCount: 0, chunkCounts: {} };
  }
}

export async function listRetrievalTraceIds(rootDirectory = process.cwd()): Promise<readonly string[]> {
  const directory = join(resolve(rootDirectory), ".local-data/corpus/retrieval-traces");
  try { return (await readdir(directory)).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)).sort(); } catch { return []; }
}
