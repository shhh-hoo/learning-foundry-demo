import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RunPurpose } from "../../src/agent/types";
import { RUNTIME_EXECUTION_SCHEMA_VERSION, type RuntimeExecutionRecord, type RuntimeExecutionRecorder, type RuntimeExecutionRole } from "../../src/runtime/runtime-shadow";

export interface RuntimeShadowRecordWaitResult {
  readonly records: readonly RuntimeExecutionRecord[];
  readonly pendingAuthoritativeExecutionIds: readonly string[];
  readonly absentAuthoritativeExecutionIds: readonly string[];
}

function safeExecutionId(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/u.test(value)) throw new Error("INVALID_RUNTIME_EXECUTION_ID: Execution id contains unsafe characters.");
  return value;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(?:reasoning_content|hidden_reasoning|authorization|api_?key|local_?path|source_?path)$/iu.test(key))
      .map(([key, item]) => [key, sanitize(item)]));
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]")
    .replace(/(?:file:\/\/|\/(?:Users|home|private|var|tmp)\/)[^\s]+/gu, "[REDACTED]")
    .replace(/\S*private-sources[\\/]\S*/giu, "[REDACTED]");
}

function purposeNamespace(runPurpose: RunPurpose): "product" | "agent-eval" {
  return runPurpose === "PRODUCT" ? "product" : "agent-eval";
}

function roleNamespace(role: RuntimeExecutionRole): "authoritative" | "shadow" {
  return role === "AUTHORITATIVE" ? "authoritative" : "shadow";
}

export class PurposeAndRoleSeparatedFileRuntimeExecutionRecorder implements RuntimeExecutionRecorder {
  constructor(readonly rootDirectory: string) {}

  private directory(runPurpose: RunPurpose, role: RuntimeExecutionRole): string {
    return join(this.rootDirectory, purposeNamespace(runPurpose), roleNamespace(role));
  }

  async record(record: RuntimeExecutionRecord): Promise<void> {
    if (record.schemaVersion !== RUNTIME_EXECUTION_SCHEMA_VERSION) {
      throw new Error(`RUNTIME_EXECUTION_SCHEMA_WRITE_UNSUPPORTED: New records must use ${RUNTIME_EXECUTION_SCHEMA_VERSION}.`);
    }
    const directory = this.directory(record.runPurpose, record.role);
    await mkdir(directory, { recursive: true });
    const target = join(directory, `${safeExecutionId(record.executionId)}.json`);
    const temporary = join(directory, `.${basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(sanitize(record), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  async list(runPurpose: RunPurpose, role: RuntimeExecutionRole): Promise<readonly RuntimeExecutionRecord[]> {
    const directory = this.directory(runPurpose, role);
    await mkdir(directory, { recursive: true });
    const readRecords = async (source: string): Promise<readonly RuntimeExecutionRecord[]> => {
      let files: readonly string[];
      try { files = await readdir(source); }
      catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
        throw error;
      }
      return Promise.all(files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => parseRuntimeExecutionRecord(JSON.parse(await readFile(join(source, file), "utf8")))));
    };
    const legacyDirectory = join(this.rootDirectory, roleNamespace(role));
    const legacy = (await readRecords(legacyDirectory)).filter((record) => record.runPurpose === runPurpose && record.role === role);
    const current = (await readRecords(directory)).filter((record) => record.runPurpose === runPurpose && record.role === role);
    const byExecutionId = new Map([...legacy, ...current].map((record) => [record.executionId, record]));
    return [...byExecutionId.values()].sort((left, right) => left.executionId.localeCompare(right.executionId));
  }

  async waitForTerminalShadows(
    runPurpose: RunPurpose,
    authoritativeExecutionIds: readonly string[],
    options: { readonly timeoutMs: number; readonly pollIntervalMs?: number },
  ): Promise<RuntimeShadowRecordWaitResult> {
    const requested = [...new Set(authoritativeExecutionIds)].sort();
    const deadline = Date.now() + options.timeoutMs;
    const pollIntervalMs = options.pollIntervalMs ?? 50;
    while (true) {
      const records = (await this.list(runPurpose, "SHADOW")).filter((record) => record.parentAuthoritativeExecutionId && requested.includes(record.parentAuthoritativeExecutionId));
      const byParent = new Map(records.map((record) => [record.parentAuthoritativeExecutionId!, record]));
      const pendingAuthoritativeExecutionIds = requested.filter((executionId) => byParent.get(executionId)?.status === "RUNNING");
      const absentAuthoritativeExecutionIds = requested.filter((executionId) => !byParent.has(executionId));
      if (pendingAuthoritativeExecutionIds.length === 0 && absentAuthoritativeExecutionIds.length === 0 || Date.now() >= deadline) {
        return { records, pendingAuthoritativeExecutionIds, absentAuthoritativeExecutionIds };
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))));
    }
  }
}

function parseRuntimeExecutionRecord(value: unknown): RuntimeExecutionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RUNTIME_EXECUTION_RECORD");
  const record = value as Partial<RuntimeExecutionRecord>;
  if (record.schemaVersion !== "1.0.0" && record.schemaVersion !== "1.1.0" && record.schemaVersion !== "1.2.0" && record.schemaVersion !== RUNTIME_EXECUTION_SCHEMA_VERSION) {
    throw new Error("UNSUPPORTED_RUNTIME_EXECUTION_SCHEMA_VERSION");
  }
  if (record.runPurpose !== "PRODUCT" && record.runPurpose !== "AGENT_EVAL") throw new Error("INVALID_RUNTIME_EXECUTION_RUN_PURPOSE");
  if (record.role !== "AUTHORITATIVE" && record.role !== "SHADOW") throw new Error("INVALID_RUNTIME_EXECUTION_ROLE");
  if (typeof record.executionId !== "string" || !["RUNNING", "COMPLETED", "FAILED", "TIMED_OUT", "NOT_CONFIGURED"].includes(record.status ?? "")) {
    throw new Error("INVALID_RUNTIME_EXECUTION_RECORD");
  }
  if (record.schemaVersion === "1.0.0" && (record.status === "RUNNING" || typeof record.completedAt !== "string")) {
    throw new Error("INVALID_RUNTIME_EXECUTION_1_0_TERMINAL_RECORD");
  }
  if ((record.schemaVersion === "1.1.0" || record.schemaVersion === "1.2.0" || record.schemaVersion === RUNTIME_EXECUTION_SCHEMA_VERSION)
    && (record.status === "RUNNING" ? record.completedAt !== undefined : typeof record.completedAt !== "string")) {
    throw new Error("INVALID_RUNTIME_EXECUTION_LIFECYCLE_RECORD");
  }
  return record as RuntimeExecutionRecord;
}
