import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTraceRepository, PurposeSeparatedAgentTraceRepository } from "../scripts/lib/agent-trace-repository";

const TEST_FIXTURE = "TEST_FIXTURE" as const;
const directories: string[] = [];
async function directory() { const value = await mkdtemp(join(tmpdir(), "lf-agent-runs-")); directories.push(value); return value; }
afterEach(async () => { await Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

describe("AgentTraceRepository", () => {
  it("persists routes, completed model and tool observations across repository re-instantiation", async () => {
    expect(TEST_FIXTURE).toBe("TEST_FIXTURE");
    const root = await directory();
    const repository = new AgentTraceRepository(root);
    await repository.start({ traceId: "trace-1", request: { conversationId: "c-1", inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content: "question" }] }, initialRoute: "COURSE_EXPLANATION", provider: "deepseek", model: "configured", thinkingMode: "disabled", prompt: { version: "1.3.0", contentHash: "prompt-hash" }, capabilityRegistry: { version: "1", contentHash: "registry-hash" }, toolDefinitions: { version: "1", contentHash: "tools-hash" }, startedAt: "2026-07-16T10:00:00.000Z" });
    await repository.appendModelResponse("trace-1", { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "search_learning_resources", arguments: '{"query":"ratio"}' } }], reasoning_content: "must never persist" }, { promptTokens: 10, completionTokens: 2, totalTokens: 12 });
    await repository.appendToolExecution("trace-1", { name: "search_learning_resources", arguments: { query: "ratio" }, resultRef: "resource-search-1", status: "SUCCEEDED", result: [{ sourceId: "source-1" }] });
    await repository.complete("trace-1", { status: "ANSWERED", learnerMessage: "answer", sourceRefs: ["source-1"] }, "2026-07-16T10:00:01.000Z", "COURSE_EXPLANATION");

    const reloaded = await new AgentTraceRepository(root).get("trace-1");
    expect(reloaded).toMatchObject({ status: "COMPLETED", traceId: "trace-1", initialRoute: "COURSE_EXPLANATION", route: "COURSE_EXPLANATION", finalResponse: { status: "ANSWERED" }, observableModelMessages: [{ role: "assistant", content: null }], toolExecutions: [{ result: [{ sourceId: "source-1" }] }] });
    const serialized = await readFile(join(root, "trace-1.json"), "utf8");
    expect(serialized).not.toMatch(/must never persist|authorization|api.?key/i);
  });

  it("persists partial failed runs and supports filtered queries", async () => {
    const root = await directory(); const repository = new AgentTraceRepository(root);
    await repository.start({ traceId: "trace-failed", request: { conversationId: "c-2", inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", messages: [{ role: "user", content: "working" }] }, initialRoute: "LEARNER_DIAGNOSIS_INCOMPLETE", provider: "deepseek", model: "configured", thinkingMode: "disabled", prompt: { version: "1.3.0", contentHash: "p" }, capabilityRegistry: { version: "1", contentHash: "c" }, toolDefinitions: { version: "1", contentHash: "t" }, startedAt: "2026-07-16T11:00:00.000Z" });
    await repository.fail("trace-failed", { code: "DEEPSEEK_API_ERROR", message: "provider unavailable" }, "2026-07-16T11:00:01.000Z");
    await expect(new AgentTraceRepository(root).get("trace-failed")).resolves.toMatchObject({ status: "FAILED", initialRoute: "LEARNER_DIAGNOSIS_INCOMPLETE", terminalError: { code: "DEEPSEEK_API_ERROR" } });
    await expect(repository.query({ conversationId: "c-2", status: "FAILED", inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", startedFrom: "2026-07-16T10:59:00.000Z" })).resolves.toHaveLength(1);
  });

  it("clears the evidence store only through the explicit operation", async () => {
    const root = await directory(); const repository = new AgentTraceRepository(root);
    await repository.start({ traceId: "trace-clear", request: { conversationId: "c", inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content: "q" }] }, provider: "deepseek", model: "configured", thinkingMode: "disabled", prompt: { version: "1", contentHash: "p" }, capabilityRegistry: { version: "1", contentHash: "c" }, toolDefinitions: { version: "1", contentHash: "t" }, startedAt: "2026-07-16T00:00:00.000Z" });
    await repository.clear();
    await expect(repository.get("trace-clear")).resolves.toBeNull();
  });

  it("physically separates Product and AgentEval trace namespaces", async () => {
    const root = await directory();
    const repositories = new PurposeSeparatedAgentTraceRepository(join(root, "product-agent-runs"), join(root, "agent-eval-agent-runs"));
    const common = { provider: "deepseek" as const, model: "configured", thinkingMode: "disabled" as const, prompt: { version: "1", contentHash: "p" }, capabilityRegistry: { version: "1", contentHash: "c" }, toolDefinitions: { version: "1", contentHash: "t" }, startedAt: "2026-07-16T00:00:00.000Z" };
    await repositories.forPurpose("PRODUCT").start({ ...common, traceId: "product-trace", request: { conversationId: "product", inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content: "q" }] } });
    await repositories.forPurpose("AGENT_EVAL").start({ ...common, traceId: "agent-eval-trace", request: { conversationId: "case", inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", messages: [{ role: "user", content: "case" }] } });
    await expect(repositories.query({ runPurpose: "PRODUCT" })).resolves.toEqual([expect.objectContaining({ traceId: "product-trace" })]);
    await expect(repositories.query({ runPurpose: "AGENT_EVAL" })).resolves.toEqual([expect.objectContaining({ traceId: "agent-eval-trace" })]);
    await repositories.clear("AGENT_EVAL");
    await expect(repositories.get("product-trace")).resolves.not.toBeNull();
    await expect(repositories.get("agent-eval-trace")).resolves.toBeNull();
  });
});