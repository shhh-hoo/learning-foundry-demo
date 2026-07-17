import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildPublicSafeExport } from "../scripts/lib/corpus-ingestion";
import { LegacyLexicalEvidenceSearch } from "../scripts/lib/corpus-repository";
import type { CorpusChunk, CorpusIndexManifest } from "../src/corpus/types";

const executeFile = promisify(execFile);
const roots: string[] = [];
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function fixtureRepository(): Promise<{ readonly root: string; readonly repository: LegacyLexicalEvidenceSearch }> {
  const root = await mkdtemp(join(tmpdir(), "corpus-retrieval-"));
  roots.push(root);
  const chunks: CorpusChunk[] = [
    { chunkId: "TN-001::note", documentId: "TN-001-COEFFICIENTS-TO-MOLE-RATIOS", sourceType: "TEACHER_NOTE", distributionScope: "SCHOOL_INTERNAL", title: "Why balanced coefficients become mole ratios", text: "Coefficients describe a particle ratio. Scaling each count by the Avogadro constant preserves the mole ratio.", examBoard: "CAIE", syllabusCode: "9701", syllabusVersion: "2025-2027", level: "AS_A", topic: "Stoichiometry", calculationFamilyIds: ["CORE-001"], learningOutcomeIds: ["2.4.1"], section: "Teacher Note", rights: { publicExportAllowed: true }, contentHash: sha256("note") },
    { chunkId: "TN-003::note", documentId: "TN-003-LIMITING-REAGENT", sourceType: "TEACHER_NOTE", distributionScope: "SCHOOL_INTERNAL", title: "Limiting reagent", text: "Divide each available amount by its balanced-equation coefficient and choose the minimum reaction batches.", examBoard: "CAIE", syllabusCode: "9701", syllabusVersion: "2025-2027", level: "AS_A", topic: "Stoichiometry", calculationFamilyIds: ["STOICH-005"], learningOutcomeIds: ["2.4.1(d)"], section: "Teacher Note", rights: { publicExportAllowed: true }, contentHash: sha256("limiting") },
  ];
  const chunksText = `${JSON.stringify(chunks, null, 2)}\n`;
  const version = "v0.1-test";
  const directory = join(root, ".local-data/corpus/indexes", version);
  await mkdir(directory, { recursive: true });
  const manifest: CorpusIndexManifest = { schemaVersion: "1.0.0", corpusId: "test", indexVersion: version, indexHash: sha256("index"), createdAt: "2026-07-16T00:00:00.000Z", sourceManifestHash: sha256("sources"), chunksFile: "chunks.json", chunksHash: sha256(chunksText), chunkCount: chunks.length, chunkCounts: { "TEACHER_NOTE:SCHOOL_INTERNAL": 2 }, sources: [] };
  await writeFile(join(directory, "chunks.json"), chunksText);
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, ".local-data/corpus/latest.json"), `${JSON.stringify({ indexVersion: version, indexHash: manifest.indexHash, manifestPath: `indexes/${version}/manifest.json` }, null, 2)}\n`);
  return { root, repository: await LegacyLexicalEvidenceSearch.open(root) };
}

afterEach(() => { roots.length = 0; });

describe("governed corpus retrieval", () => {
  it("returns the current lexical Evidence Search response contract", async () => {
    const { repository } = await fixtureRepository();
    const result = await repository.search("limiting reagent", { calculationFamilyId: "STOICH-005" });

    expect(result).toMatchObject({
      retrievalTraceId: expect.stringMatching(/^retrieval-trace-/u),
      query: "limiting reagent",
      filters: { calculationFamilyId: "STOICH-005" },
      results: [{
        chunkId: "TN-003::note",
        sourceId: "TN-003-LIMITING-REAGENT",
        sourceType: "TEACHER_NOTE",
        distributionScope: "SCHOOL_INTERNAL",
        title: "Limiting reagent",
        excerpt: expect.stringContaining("balanced-equation coefficient"),
        syllabusCode: "9701",
        learningOutcomeIds: ["2.4.1(d)"],
        calculationFamilyIds: ["STOICH-005"],
        score: expect.any(Number),
      }],
    });
  });

  it("filters by board/version metadata and exact calculation family", async () => {
    const { repository } = await fixtureRepository();
    const match = await repository.search("limiting reagent", { examBoard: "CAIE", syllabusCode: "9701", syllabusVersion: "2025-2027", calculationFamilyId: "STOICH-005" });
    expect(match.results.map((item) => item.sourceId)).toEqual(["TN-003-LIMITING-REAGENT"]);
    await expect(repository.search("limiting reagent", { examBoard: "OTHER" as never, syllabusCode: "9701", syllabusVersion: "2025-2027" })).resolves.toMatchObject({ results: [] });
    await expect(repository.search("limiting reagent", { examBoard: "CAIE", syllabusCode: "9701", syllabusVersion: "2024" })).resolves.toMatchObject({ results: [] });
  });

  it("persists a retrieval trace without private chunk text or credentials", async () => {
    const { root, repository } = await fixtureRepository();
    const result = await repository.search("coefficients mole ratio", { examBoard: "CAIE", syllabusCode: "9701", calculationFamilyId: "CORE-001" }, { conversationId: "conversation-a", conversationEvidenceHash: sha256("learner input"), route: "COURSE_EXPLANATION" });
    const trace = await readFile(join(root, ".local-data/corpus/retrieval-traces", `${result.retrievalTraceId}.json`), "utf8");
    expect(trace).toContain("TN-001::note");
    expect(trace).not.toContain("Scaling each count");
    expect(trace).not.toMatch(/api.?key|authorization|Bearer|private-sources/iu);
  });

  it("redacts credentials from a retrieval query before trace persistence", async () => {
    const { root, repository } = await fixtureRepository();
    const result = await repository.search("coefficients Authorization: Bearer private-secret-value sk-private-secret-value", { examBoard: "CAIE", syllabusCode: "9701" });
    const trace = await readFile(join(root, ".local-data/corpus/retrieval-traces", `${result.retrievalTraceId}.json`), "utf8");

    expect(trace).not.toContain("private-secret-value");
    expect(trace).not.toMatch(/Authorization|Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}/iu);
    expect(trace).toContain("[REDACTED]");
  });

  it("keeps source PDFs and generated private chunks ignored", async () => {
    const root = resolve(".");
    const { stdout } = await executeFile("git", ["check-ignore", "private-sources/9701-2025-2027-syllabus.pdf", ".local-data/corpus/latest.json"], { cwd: root });
    expect(stdout).toContain("private-sources/9701-2025-2027-syllabus.pdf");
    expect(stdout).toContain(".local-data/corpus/latest.json");
  });

  it("builds a public-safe export from only source metadata and original notes/cases", async () => {
    const exported = await buildPublicSafeExport(resolve(".")) as Record<string, unknown>;
    expect(Object.keys(exported).sort()).toEqual(["cases", "corpusId", "policy", "schemaVersion", "sources", "teacherNotes"].sort());
    expect(exported.teacherNotes).toHaveLength(6);
    expect(exported.cases).toHaveLength(5);
    const serialised = JSON.stringify(exported);
    expect(serialised).not.toMatch(/expectedLocalFilename|private-sources|chunkId|contentHash/iu);
  });
});
