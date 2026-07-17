import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BlindPedagogyPacketItem,
  BlindPedagogyPreparation,
  BlindPedagogyReviewLock,
  BenchmarkEvidenceRepository,
  BenchmarkExecutionRecord,
  BenchmarkExecutionStart,
  BenchmarkRunSnapshot,
  BenchmarkReview,
  EvidenceAuditPacketItem,
  EvidenceAuditReviewLock,
  SealedBenchmarkMapping,
} from "./index";
import { createBlindPedagogyReviewLock, createEvidenceAuditPacket, createEvidenceAuditReviewLock } from "./index";

async function readJsonLines<T>(path: string): Promise<readonly T[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  if (!raw) return [];
  if (raw.includes("\r") || !raw.endsWith("\n")) throw new Error(`BENCHMARK_EVIDENCE_CORRUPT: ${path}`);
  try {
    return raw.slice(0, -1).split("\n").map((line) => JSON.parse(line) as T);
  } catch {
    throw new Error(`BENCHMARK_EVIDENCE_CORRUPT: ${path}`);
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  if (raw.includes("\r") || !raw.endsWith("\n")) throw new Error(`BENCHMARK_REVIEW_ARTIFACT_CORRUPT: ${path}`);
  try { return JSON.parse(raw) as T; }
  catch { throw new Error(`BENCHMARK_REVIEW_ARTIFACT_CORRUPT: ${path}`); }
}

async function writePrivateExclusive(path: string, value: unknown): Promise<void> {
  try {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new Error("BENCHMARK_REVIEW_ARTIFACT_IMMUTABLE");
    throw error;
  }
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  const handle = await open(path, "a", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.appendFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FileBenchmarkEvidenceRepository implements BenchmarkEvidenceRepository {
  constructor(private readonly root: string) {}

  private runDirectory(runId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(runId)) throw new Error("BENCHMARK_RUN_ID_INVALID");
    return join(this.root, runId);
  }

  private async ensureRunDirectory(runId: string): Promise<string> {
    const directory = this.runDirectory(runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async start(run: BenchmarkRunSnapshot): Promise<void> {
    const directory = await this.ensureRunDirectory(run.runId);
    try {
      await writeFile(join(directory, "run.json"), `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new Error("BENCHMARK_RUN_ALREADY_EXISTS");
      throw error;
    }
  }

  async getRun(runId: string): Promise<BenchmarkRunSnapshot | null> {
    try {
      const raw = await readFile(join(this.runDirectory(runId), "run.json"), "utf8");
      if (raw.includes("\r") || !raw.endsWith("\n")) throw new Error("BENCHMARK_EVIDENCE_CORRUPT");
      return JSON.parse(raw) as BenchmarkRunSnapshot;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      if (error instanceof SyntaxError) throw new Error("BENCHMARK_EVIDENCE_CORRUPT");
      throw error;
    }
  }

  async listExecutionStarts(runId: string): Promise<readonly BenchmarkExecutionStart[]> {
    const values = await readJsonLines<BenchmarkExecutionStart>(join(this.runDirectory(runId), "starts.jsonl"));
    if (new Set(values.map((item) => item.executionId)).size !== values.length) throw new Error("BENCHMARK_EVIDENCE_DUPLICATE_ID");
    return values;
  }

  async listExecutions(runId: string): Promise<readonly BenchmarkExecutionRecord[]> {
    const values = await readJsonLines<BenchmarkExecutionRecord>(join(this.runDirectory(runId), "terminals.jsonl"));
    if (new Set(values.map((item) => item.executionId)).size !== values.length) throw new Error("BENCHMARK_EVIDENCE_DUPLICATE_ID");
    return values;
  }

  async appendExecutionStart(start: BenchmarkExecutionStart): Promise<void> {
    const directory = await this.ensureRunDirectory(start.runId);
    if ((await this.listExecutionStarts(start.runId)).some((item) => item.executionId === start.executionId)) throw new Error("DUPLICATE_BENCHMARK_EXECUTION_START");
    await appendJsonLine(join(directory, "starts.jsonl"), start);
  }

  async appendExecution(record: BenchmarkExecutionRecord): Promise<void> {
    const directory = await this.ensureRunDirectory(record.runId);
    if (!(await this.listExecutionStarts(record.runId)).some((item) => item.executionId === record.executionId)) throw new Error("BENCHMARK_EXECUTION_START_REQUIRED");
    if ((await this.listExecutions(record.runId)).some((item) => item.executionId === record.executionId)) throw new Error("DUPLICATE_BENCHMARK_EXECUTION");
    await appendJsonLine(join(directory, "terminals.jsonl"), record);
  }
}

/**
 * Local review custody store. Reviewer packets and the arm mapping are written
 * to separate mode-0600 files; the mapping cannot be read through the reveal
 * method until both phase locks are immutable on disk.
 */
export class FileBenchmarkReviewRepository {
  constructor(private readonly root: string, private readonly runId: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(runId)) throw new Error("BENCHMARK_RUN_ID_INVALID");
  }

  private directory(): string { return join(this.root, this.runId, "review"); }
  private path(name: string): string { return join(this.directory(), name); }
  private async ensure(): Promise<void> { await mkdir(this.directory(), { recursive: true, mode: 0o700 }); }

  async storeBlindPreparation(preparation: BlindPedagogyPreparation): Promise<readonly BlindPedagogyPacketItem[]> {
    await this.ensure();
    await writePrivateExclusive(this.path("blind-packet.json"), preparation.packet);
    await writePrivateExclusive(this.path("sealed-arm-mapping.json"), preparation.sealedMapping);
    return structuredClone(preparation.packet);
  }

  async appendReview(review: BenchmarkReview): Promise<void> {
    await this.ensure();
    const phase = review.phase === "BLIND_PEDAGOGY" ? "pedagogy" : "evidence";
    const lockPath = this.path(`${phase}-lock.json`);
    try { await readFile(lockPath); throw new Error("BENCHMARK_REVIEW_PHASE_LOCKED"); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    const reviewsPath = this.path(`${phase}-reviews.jsonl`);
    const existing = await readJsonLines<BenchmarkReview>(reviewsPath);
    if (existing.some((item) => item.blindId === review.blindId)) throw new Error("BENCHMARK_REVIEW_DECISION_DUPLICATE");
    await appendJsonLine(reviewsPath, review);
  }

  async listReviews(phase: BenchmarkReview["phase"]): Promise<readonly BenchmarkReview[]> {
    return readJsonLines<BenchmarkReview>(this.path(phase === "BLIND_PEDAGOGY" ? "pedagogy-reviews.jsonl" : "evidence-reviews.jsonl"));
  }

  async lockPedagogy(lockedAt: string): Promise<BlindPedagogyReviewLock> {
    await this.ensure();
    const preparation = await this.loadPreparation();
    const reviews = await this.listReviews("BLIND_PEDAGOGY");
    const lock = createBlindPedagogyReviewLock(preparation, reviews, lockedAt);
    await writePrivateExclusive(this.path("pedagogy-lock.json"), lock);
    return lock;
  }

  async createAndStoreEvidencePacket(cases: readonly import("./index").BenchmarkCase[], records: readonly BenchmarkExecutionRecord[]): Promise<readonly EvidenceAuditPacketItem[]> {
    const pedagogyLock = await readJsonFile<BlindPedagogyReviewLock>(this.path("pedagogy-lock.json"));
    const preparation = await this.loadPreparation();
    const pedagogyReviews = await this.listReviews("BLIND_PEDAGOGY");
    const packet = createEvidenceAuditPacket({ cases, records, preparation, pedagogyReviews, pedagogyLock });
    const blindIds = (await readJsonFile<readonly BlindPedagogyPacketItem[]>(this.path("blind-packet.json"))).map((item) => item.blindId).sort();
    if (packet.length !== blindIds.length || packet.map((item) => item.blindId).sort().join("\u0000") !== blindIds.join("\u0000")) throw new Error("BENCHMARK_EVIDENCE_PACKET_SET_INVALID");
    await writePrivateExclusive(this.path("evidence-packet.json"), packet);
    return structuredClone(packet);
  }

  async lockEvidence(lockedAt: string): Promise<EvidenceAuditReviewLock> {
    await this.ensure();
    const pedagogyLock = await readJsonFile<BlindPedagogyReviewLock>(this.path("pedagogy-lock.json"));
    const preparation = await this.loadPreparation();
    const evidencePacket = await this.loadEvidencePacket();
    const evidenceReviews = await this.listReviews("EVIDENCE_AUDIT");
    const lock = createEvidenceAuditReviewLock({ evidencePacket, evidenceReviews, preparation, pedagogyLock, lockedAt });
    await writePrivateExclusive(this.path("evidence-lock.json"), lock);
    return lock;
  }

  private async loadPreparation(): Promise<BlindPedagogyPreparation> {
    return { packet: await readJsonFile<readonly BlindPedagogyPacketItem[]>(this.path("blind-packet.json")), sealedMapping: await readJsonFile<SealedBenchmarkMapping>(this.path("sealed-arm-mapping.json")) };
  }

  async loadBlindPacket(): Promise<readonly BlindPedagogyPacketItem[]> {
    return readJsonFile<readonly BlindPedagogyPacketItem[]>(this.path("blind-packet.json"));
  }

  async loadEvidencePacket(): Promise<readonly EvidenceAuditPacketItem[]> {
    return readJsonFile<readonly EvidenceAuditPacketItem[]>(this.path("evidence-packet.json"));
  }

  async revealArmMapping(): Promise<SealedBenchmarkMapping> {
    await readJsonFile<EvidenceAuditReviewLock>(this.path("evidence-lock.json"));
    return readJsonFile<SealedBenchmarkMapping>(this.path("sealed-arm-mapping.json"));
  }

  async loadLockedReviewState(): Promise<{
    readonly preparation: BlindPedagogyPreparation;
    readonly evidencePacket: readonly EvidenceAuditPacketItem[];
    readonly pedagogyReviews: readonly BenchmarkReview[];
    readonly evidenceReviews: readonly BenchmarkReview[];
    readonly pedagogyLock: BlindPedagogyReviewLock;
    readonly evidenceLock: EvidenceAuditReviewLock;
  }> {
    const evidenceLock = await readJsonFile<EvidenceAuditReviewLock>(this.path("evidence-lock.json"));
    return {
      preparation: await this.loadPreparation(), evidencePacket: await this.loadEvidencePacket(),
      pedagogyReviews: await this.listReviews("BLIND_PEDAGOGY"), evidenceReviews: await this.listReviews("EVIDENCE_AUDIT"),
      pedagogyLock: await readJsonFile<BlindPedagogyReviewLock>(this.path("pedagogy-lock.json")), evidenceLock,
    };
  }

  async storeReports(report: unknown, publicationSummary: unknown): Promise<void> {
    await readJsonFile<EvidenceAuditReviewLock>(this.path("evidence-lock.json"));
    await writePrivateExclusive(this.path("full-report.json"), report);
    await writePrivateExclusive(this.path("publication-summary.json"), publicationSummary);
  }
}
