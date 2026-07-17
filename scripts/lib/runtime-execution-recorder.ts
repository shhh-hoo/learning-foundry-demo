import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RunPurpose } from "../../src/agent/types";
import type { RuntimeExecutionRecord, RuntimeExecutionRecorder, RuntimeExecutionRole } from "../../src/runtime/runtime-shadow";

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
    const records = await Promise.all((await readdir(directory))
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => JSON.parse(await readFile(join(directory, file), "utf8")) as RuntimeExecutionRecord));
    return records.sort((left, right) => left.executionId.localeCompare(right.executionId));
  }
}
