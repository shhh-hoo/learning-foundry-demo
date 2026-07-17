import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BenchmarkEvidenceRepository,
  BenchmarkExecutionRecord,
  BenchmarkExecutionStart,
  BenchmarkRunSnapshot,
} from "./index";

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

