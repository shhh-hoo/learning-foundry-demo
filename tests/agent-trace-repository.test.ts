import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTraceRepository, PurposeSeparatedAgentTraceRepository } from "../scripts/lib/agent-trace-repository";
import type { ModelMessage } from "../src/agent/deepseek-client";
import type { AgentRunStart } from "../src/agent/trace-store";

const TEST_FIXTURE = "TEST_FIXTURE" as const;
const directories: string[] = [];
async function directory() { const value = await mkdtemp(join(tmpdir(), "lf-agent-runs-")); directories.push(value); return value; }
afterEach(async () => { await Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

describe("AgentTraceRepository", () => {
  it("accepts provider-neutral trace starts and observable messages", async () => {
    const root = await directory();
    const repository = new AgentTraceRepository(root);
    const start = {
      traceId: "candidate-trace",
      request: { conversationId: "candidate", inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", messages: [{ role: "user", content: "case" }] },
      provider: "candidate-shadow",
      model: "candidate-model",
      thinkingMode: "disabled",
      prompt: { version: "1", contentHash: "p" },
      capabilityRegistry: { version: "1", contentHash: "c" },
      toolDefinitions: { version: "1", contentHash: "t" },
      startedAt: "2026-07-16T09:00:00.000Z",
    } as const satisfies AgentRunStart;

    await repository.start(start);
    await repository.appendModelResponse("candidate-trace", { role: "assistant", content: "candidate response" });
    await expect(repository.get("candidate-trace")).resolves.toMatchObject({
      provider: "candidate-shadow",
      observableModelMessages: [{ role: "assistant", content: "candidate response" }],
    });
  });

  it("persists routes, completed model and tool observations across repository re-instantiation", async () => {
    expect(TEST_FIXTURE).toBe("TEST_FIXTURE");
    const root = await directory();
    const repository = new AgentTraceRepository(root);
    await repository.start({ traceId: "trace-1", request: { conversationId: "c-1", inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content: "question" }] }, initialRoute: "COURSE_EXPLANATION", provider: "deepseek", model: "configured", thinkingMode: "disabled", prompt: { version: "1.3.0", contentHash: "prompt-hash" }, capabilityRegistry: { version: "1", contentHash: "registry-hash" }, toolDefinitions: { version: "1", contentHash: "tools-hash" }, startedAt: "2026-07-16T10:00:00.000Z" });
    const providerMessage = { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "search_learning_resources", arguments: '{"query":"ratio"}' } }], reasoning_content: "must never persist" } as const satisfies ModelMessage;
    await repository.appendModelResponse("trace-1", providerMessage, { promptTokens: 10, completionTokens: 2, totalTokens: 12 });
    await repository.appendToolExecution("trace-1", { name: "search_learning_resources", arguments: { query: "ratio" }, resultRef: "resource-search-1", status: "SUCCEEDED", result: [{ sourceId: "source-1" }] });
    await repository.complete("trace-1", { status: "ANSWERED", learnerMessage: "answer", sourceRefs: ["source-1"] }, "2026-07-16T10:00:01.000Z", "COURSE_EXPLANATION", {
      applicationResponseDisposition: { status: "ANSWERED", reason: "Governed Evidence is sufficient." },
      toolPhase: { state: "CLOSED", closedAt: "2026-07-16T10:00:00.900Z", reason: "Plan requirements satisfied." },
      responseOnlyCorrectionCount: 0,
      deterministicFallbackUsed: false,
      finalTerminalCondition: "PLAN_REQUIREMENTS_SATISFIED",
    });

    const reloaded = await new AgentTraceRepository(root).get("trace-1");
    expect(reloaded).toMatchObject({
      status: "COMPLETED", traceId: "trace-1", initialRoute: "COURSE_EXPLANATION", route: "COURSE_EXPLANATION",
      finalResponse: { status: "ANSWERED" }, observableModelMessages: [{ role: "assistant", content: null }], toolExecutions: [{ result: [{ sourceId: "source-1" }] }],
      applicationResponseDisposition: { status: "ANSWERED" }, toolPhase: { state: "CLOSED" }, responseOnlyCorrectionCount: 0,
      deterministicFallbackUsed: false, finalTerminalCondition: "PLAN_REQUIREMENTS_SATISFIED",
    });
    const serialized = await readFile(join(root, "trace-1.json"), "utf8");
    expect(JSON.parse(serialized)).toMatchObject({ schemaVersion: "1.2.0" });
    expect(serialized).not.toMatch(/must never persist|authorization|api.?key/i);
  });

  it("reads terminal 1.0.0 records but writes only the current trace schema", async () => {
    const root = await directory();
    const legacy = {
      schemaVersion: "1.0.0",
      traceId: "legacy-trace",
      request: { conversationId: "legacy", inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content: "legacy" }] },
      provider: "deepseek", model: "legacy", thinkingMode: "disabled",
      prompt: { version: "1", contentHash: "p" }, capabilityRegistry: { version: "1", contentHash: "c" }, toolDefinitions: { version: "1", contentHash: "t" },
      startedAt: "2026-07-16T00:00:00.000Z", completedAt: "2026-07-16T00:00:01.000Z", updatedAt: "2026-07-16T00:00:01.000Z",
      status: "COMPLETED", observableModelMessages: [], toolExecutions: [], finalResponse: { status: "ANSWERED", learnerMessage: "legacy", sourceRefs: [] },
    };
    await writeFile(join(root, "legacy-trace.json"), JSON.stringify(legacy), "utf8");

    await expect(new AgentTraceRepository(root).get("legacy-trace")).resolves.toMatchObject({ schemaVersion: "1.0.0", traceId: "legacy-trace" });
  });

  it("keeps 1.1.0 Control Plane records readable after terminal disposition observability is added", async () => {
    const root = await directory();
    const prior = {
      schemaVersion: "1.1.0",
      traceId: "prior-control-plane-trace",
      request: { conversationId: "prior", inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content: "prior" }] },
      provider: "deepseek", model: "prior", thinkingMode: "disabled",
      prompt: { version: "1", contentHash: "p" }, capabilityRegistry: { version: "1", contentHash: "c" }, toolDefinitions: { version: "1", contentHash: "t" },
      startedAt: "2026-07-17T00:00:00.000Z", completedAt: "2026-07-17T00:00:01.000Z", updatedAt: "2026-07-17T00:00:01.000Z",
      status: "COMPLETED", observableModelMessages: [], toolExecutions: [], finalResponse: { status: "ANSWERED", learnerMessage: "prior", sourceRefs: [] },
    };
    await writeFile(join(root, "prior-control-plane-trace.json"), JSON.stringify(prior), "utf8");

    await expect(new AgentTraceRepository(root).get("prior-control-plane-trace")).resolves.toMatchObject({ schemaVersion: "1.1.0", traceId: "prior-control-plane-trace" });
  });

  it("persists partial failed runs and supports filtered queries", async () => {
    const root = await directory(); const repository = new AgentTraceRepository(root);
    await repository.start({ traceId: "trace-failed", request: { conversationId: "c-2", inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", messages: [{ role: "user", content: "working" }] }, initialRoute: "LEARNER_DIAGNOSIS_INCOMPLETE", provider: "deepseek", model: "configured", thinkingMode: "disabled", prompt: { version: "1.3.0", contentHash: "p" }, capabilityRegistry: { version: "1", contentHash: "c" }, toolDefinitions: { version: "1", contentHash: "t" }, startedAt: "2026-07-16T11:00:00.000Z" });
    await repository.fail("trace-failed", { code: "DEEPSEEK_API_ERROR", message: "provider unavailable" }, "2026-07-16T11:00:01.000Z", {
      budgetConsumption: [{ toolId: "list_capabilities", consumed: 1, maximum: 1 }],
      evidenceAssessments: [{ assessmentId: "assessment-1", toolId: "list_capabilities", toolCallIndex: 0, outcome: "EXECUTION_FAILED", topicalFit: "UNKNOWN", sourceAuthority: "UNKNOWN", coverage: "NONE", missingAspects: ["successful tool execution"], lineageComplete: false, contaminationRisk: "UNKNOWN", anotherCallJustified: false, continueOrStopReason: "Stop: tool failed." }],
      stopReason: "DEEPSEEK_API_ERROR: provider unavailable",
    });
    await expect(new AgentTraceRepository(root).get("trace-failed")).resolves.toMatchObject({ status: "FAILED", initialRoute: "LEARNER_DIAGNOSIS_INCOMPLETE", terminalError: { code: "DEEPSEEK_API_ERROR" }, budgetConsumption: [{ toolId: "list_capabilities", consumed: 1, maximum: 1 }], evidenceAssessments: [{ outcome: "EXECUTION_FAILED" }], stopReason: "DEEPSEEK_API_ERROR: provider unavailable" });
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
