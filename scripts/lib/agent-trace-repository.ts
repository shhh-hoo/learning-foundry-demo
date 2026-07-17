import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AgentResponseEnvelope, AgentRoute, RunPurpose, TokenUsage } from "../../src/agent/types";
import { AGENT_RUN_SCHEMA_VERSION, type AgentRunQuery, type AgentRunStart, type AgentTraceStore, type ObservableAgentMessage, type PersistedAgentRun, type PersistedToolExecution } from "../../src/agent/trace-store";

export type { AgentRunQuery, AgentRunStart, AgentTraceStore, ObservableAgentMessage, PersistedAgentRun, PersistedToolExecution } from "../../src/agent/trace-store";

function safeId(value: string): string { if (!/^[a-zA-Z0-9._-]+$/u.test(value)) throw new Error("INVALID_TRACE_ID: Trace id contains unsafe characters."); return value; }
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:reasoning_content|hidden_reasoning|authorization|api_?key)$/iu.test(key)).map(([key, item]) => [key, sanitize(item)]));
  if (typeof value === "string") return value.replace(/Bearer\s+[A-Za-z0-9._-]+/giu, "Bearer [REDACTED]").replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]");
  return value;
}
function addUsage(current: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  if (!next) return current;
  return { promptTokens: (current?.promptTokens ?? 0) + next.promptTokens, completionTokens: (current?.completionTokens ?? 0) + next.completionTokens, totalTokens: (current?.totalTokens ?? 0) + next.totalTokens, promptCacheHitTokens: (current?.promptCacheHitTokens ?? 0) + (next.promptCacheHitTokens ?? 0), promptCacheMissTokens: (current?.promptCacheMissTokens ?? 0) + (next.promptCacheMissTokens ?? 0) };
}

export class FileAgentTraceStore implements AgentTraceStore {
  constructor(readonly directory: string) {}
  private path(traceId: string) { return join(this.directory, `${safeId(traceId)}.json`); }
  private async write(record: PersistedAgentRun): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.path(record.traceId); const temporary = join(this.directory, `.${basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(sanitize(record), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }
  async start(input: AgentRunStart): Promise<void> { await this.write({ ...input, schemaVersion: AGENT_RUN_SCHEMA_VERSION, status: "RUNNING", observableModelMessages: [], toolExecutions: [], updatedAt: input.startedAt }); }
  async get(traceId: string): Promise<PersistedAgentRun | null> { try { return parseAgentRunRecord(JSON.parse(await readFile(this.path(traceId), "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
  private async mutate(traceId: string, update: (record: PersistedAgentRun) => PersistedAgentRun): Promise<void> { const record = await this.get(traceId); if (!record) throw new Error(`TRACE_NOT_FOUND: ${traceId}`); await this.write(update(record)); }
  async appendModelResponse(traceId: string, message: ObservableAgentMessage, usage?: TokenUsage): Promise<void> { await this.mutate(traceId, (record) => ({ ...record, observableModelMessages: [...record.observableModelMessages, sanitize(message) as ObservableAgentMessage], tokenUsage: addUsage(record.tokenUsage, usage), updatedAt: new Date().toISOString() })); }
  async appendToolExecution(traceId: string, execution: PersistedToolExecution): Promise<void> { await this.mutate(traceId, (record) => ({ ...record, toolExecutions: [...record.toolExecutions, sanitize(execution) as PersistedToolExecution], updatedAt: new Date().toISOString() })); }
  async complete(traceId: string, finalResponse: AgentResponseEnvelope, completedAt: string, route?: AgentRoute, observability: Parameters<AgentTraceStore["complete"]>[4] = {}): Promise<void> { await this.mutate(traceId, (record) => ({ ...record, status: "COMPLETED", finalResponse, ...(route ? { route } : {}), ...observability, completedAt, updatedAt: completedAt })); }
  async fail(traceId: string, terminalError: { readonly code: string; readonly message: string }, completedAt: string): Promise<void> { await this.mutate(traceId, (record) => ({ ...record, status: "FAILED", terminalError: sanitize(terminalError) as typeof terminalError, completedAt, updatedAt: completedAt })); }
  async query(query: AgentRunQuery = {}): Promise<readonly PersistedAgentRun[]> {
    await mkdir(this.directory, { recursive: true });
    const records = await Promise.all((await readdir(this.directory)).filter((file) => file.endsWith(".json")).map(async (file) => parseAgentRunRecord(JSON.parse(await readFile(join(this.directory, file), "utf8")))));
    return records.filter((record) => (!query.conversationId || record.request.conversationId === query.conversationId) && (!query.status || record.status === query.status) && (!query.inputOrigin || record.request.inputOrigin === query.inputOrigin) && (!query.runPurpose || record.request.runPurpose === query.runPurpose) && (!query.startedFrom || record.startedAt >= query.startedFrom) && (!query.startedTo || record.startedAt <= query.startedTo)).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }
  async clear(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await Promise.all((await readdir(this.directory)).filter((file) => file.endsWith(".json")).map((file) => unlink(join(this.directory, file))));
  }
}

function parseAgentRunRecord(value: unknown): PersistedAgentRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_AGENT_RUN_RECORD");
  const record = value as Partial<PersistedAgentRun>;
  if (record.schemaVersion !== "1.0.0" && record.schemaVersion !== AGENT_RUN_SCHEMA_VERSION) throw new Error("UNSUPPORTED_AGENT_RUN_SCHEMA_VERSION");
  if (!record.request || typeof record.traceId !== "string" || !["RUNNING", "COMPLETED", "FAILED"].includes(record.status ?? "")) throw new Error("INVALID_AGENT_RUN_RECORD");
  return record as PersistedAgentRun;
}

export { FileAgentTraceStore as AgentTraceRepository };

export class PurposeSeparatedAgentTraceRepository {
  private readonly product: AgentTraceStore;
  private readonly agentEval: AgentTraceStore;
  constructor(productDirectory: string, agentEvalDirectory: string) {
    this.product = new FileAgentTraceStore(productDirectory);
    this.agentEval = new FileAgentTraceStore(agentEvalDirectory);
  }
  forPurpose(runPurpose: RunPurpose): AgentTraceStore { return runPurpose === "PRODUCT" ? this.product : this.agentEval; }
  async get(traceId: string): Promise<PersistedAgentRun | null> { return await this.product.get(traceId) ?? await this.agentEval.get(traceId); }
  async query(query: AgentRunQuery = {}): Promise<readonly PersistedAgentRun[]> {
    if (query.runPurpose) return this.forPurpose(query.runPurpose).query(query);
    const records = await Promise.all([this.product.query(query), this.agentEval.query(query)]);
    return records.flat().sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }
  async clear(runPurpose: RunPurpose): Promise<void> { await this.forPurpose(runPurpose).clear(); }
}
