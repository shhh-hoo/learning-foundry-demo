import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RuntimeParityReport } from "../../src/runtime/runtime-parity";

function safeReportId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error("INVALID_RUNTIME_PARITY_REPORT_ID");
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

async function atomicWrite(directory: string, filename: string, value: unknown): Promise<void> {
  const target = join(directory, filename);
  const temporary = join(directory, `.${basename(filename)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(sanitize(value), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export class RuntimeParityArtifactRepository {
  constructor(readonly rootDirectory: string) {}

  async save(report: RuntimeParityReport): Promise<string> {
    const directory = join(this.rootDirectory, safeReportId(report.reportId));
    await mkdir(directory, { recursive: true });
    await Promise.all([
      atomicWrite(directory, "plan.json", report.plan),
      atomicWrite(directory, "authoritative.json", report.results.map((result) => ({ caseId: result.caseId, execution: result.authoritative }))),
      atomicWrite(directory, "candidate.json", report.results.map((result) => ({ caseId: result.caseId, execution: result.candidate }))),
      atomicWrite(directory, "differences.json", report.results.map((result) => ({ caseId: result.caseId, classification: result.classification, differences: result.differences }))),
      atomicWrite(directory, "report.json", report),
    ]);
    return directory;
  }
}
