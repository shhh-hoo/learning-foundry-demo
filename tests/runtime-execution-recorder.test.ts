import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PurposeAndRoleSeparatedFileRuntimeExecutionRecorder } from "../scripts/lib/runtime-execution-recorder";
import type { RunPurpose } from "../src/agent/types";
import type { RuntimeExecutionRecord, RuntimeExecutionRole } from "../src/runtime/runtime-shadow";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function record(runPurpose: RunPurpose, role: RuntimeExecutionRole): RuntimeExecutionRecord {
  return {
    schemaVersion: "1.1.0",
    executionId: `${runPurpose.toLowerCase()}-${role.toLowerCase()}-execution`,
    role,
    runPurpose,
    conversationId: "case-1",
    runtimeAdapterId: role === "AUTHORITATIVE" ? "legacy" : "candidate",
    runtimeAdapterVersion: "1.0.0",
    providerId: role === "AUTHORITATIVE" ? "deepseek" : "candidate-provider",
    modelId: "model",
    route: "COURSE_EXPLANATION",
    obligations: { retrievalRequired: true, capabilityInspectionRequired: false, diagnosisRequired: false },
    toolCalls: [{
      order: 0,
      name: "search_learning_resources",
      arguments: { authorization: "Bearer secret-token", localPath: "/Users/private/private-sources/source.pdf", hidden_reasoning: "never persist" },
      resultRef: "retrieval-1",
      status: "SUCCEEDED",
    }],
    sourceRefs: ["source-1"],
    evidenceRefs: ["retrieval-1"],
    finalResponseStatus: "ANSWERED",
    latencyMs: 10,
    startedAt: "2026-07-17T00:00:00.000Z",
    completedAt: "2026-07-17T00:00:00.010Z",
    status: "COMPLETED",
    completeness: { trace: true, finalResponse: true, toolEvidence: true },
  };
}

describe("purpose-and-role-separated runtime execution recording", () => {
  it("physically isolates PRODUCT and AGENT_EVAL before separating execution roles", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-executions-"));
    roots.push(root);
    const recorder = new PurposeAndRoleSeparatedFileRuntimeExecutionRecorder(root);

    await recorder.record(record("PRODUCT", "AUTHORITATIVE"));
    await recorder.record(record("PRODUCT", "SHADOW"));
    await recorder.record(record("AGENT_EVAL", "AUTHORITATIVE"));
    await recorder.record(record("AGENT_EVAL", "SHADOW"));

    await expect(recorder.list("PRODUCT", "AUTHORITATIVE")).resolves.toEqual([
      expect.objectContaining({ runPurpose: "PRODUCT", role: "AUTHORITATIVE", runtimeAdapterId: "legacy" }),
    ]);
    await expect(recorder.list("PRODUCT", "SHADOW")).resolves.toEqual([
      expect.objectContaining({ runPurpose: "PRODUCT", role: "SHADOW", runtimeAdapterId: "candidate" }),
    ]);
    await expect(recorder.list("AGENT_EVAL", "AUTHORITATIVE")).resolves.toEqual([
      expect.objectContaining({ runPurpose: "AGENT_EVAL", role: "AUTHORITATIVE", runtimeAdapterId: "legacy" }),
    ]);
    await expect(recorder.list("AGENT_EVAL", "SHADOW")).resolves.toEqual([
      expect.objectContaining({ runPurpose: "AGENT_EVAL", role: "SHADOW", runtimeAdapterId: "candidate" }),
    ]);
    expect((await readdir(root)).sort()).toEqual(["agent-eval", "product"]);
    expect((await readdir(join(root, "product"))).sort()).toEqual(["authoritative", "shadow"]);
    expect((await readdir(join(root, "agent-eval"))).sort()).toEqual(["authoritative", "shadow"]);
    const serialized = await readFile(join(root, "agent-eval", "shadow", "agent_eval-shadow-execution.json"), "utf8");
    expect(JSON.parse(serialized)).toMatchObject({ schemaVersion: "1.1.0", runPurpose: "AGENT_EVAL", role: "SHADOW" });
    expect(serialized).not.toMatch(/secret-token|private-sources|hidden_reasoning|never persist|\/Users\//u);
  });

  it("reads a terminal 1.0.0 record from the former flat namespace but never writes that schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-executions-"));
    roots.push(root);
    const recorder = new PurposeAndRoleSeparatedFileRuntimeExecutionRecorder(root);
    const legacyRecord = { ...record("AGENT_EVAL", "AUTHORITATIVE"), schemaVersion: "1.0.0" as const };
    const legacyDirectory = join(root, "authoritative");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(join(legacyDirectory, "legacy.json"), JSON.stringify(legacyRecord), "utf8");

    await expect(recorder.list("AGENT_EVAL", "AUTHORITATIVE")).resolves.toEqual([legacyRecord]);
    await expect(recorder.record(legacyRecord)).rejects.toThrow("RUNTIME_EXECUTION_SCHEMA_WRITE_UNSUPPORTED");
  });

  it("waits for a delayed terminal shadow record within the bounded window", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-executions-"));
    roots.push(root);
    const recorder = new PurposeAndRoleSeparatedFileRuntimeExecutionRecorder(root);
    const shadow = { ...record("AGENT_EVAL", "SHADOW"), parentAuthoritativeExecutionId: "authoritative-execution" };

    const waiting = recorder.waitForTerminalShadows("AGENT_EVAL", ["authoritative-execution"], { timeoutMs: 500, pollIntervalMs: 10 });
    const delayedWrite = new Promise<void>((resolve) => setTimeout(() => { void recorder.record(shadow).then(resolve); }, 25));
    const result = await waiting;
    await delayedWrite;

    expect(result.records).toEqual([expect.objectContaining({ parentAuthoritativeExecutionId: "authoritative-execution", status: "COMPLETED" })]);
    expect(result.pendingAuthoritativeExecutionIds).toEqual([]);
    expect(result.absentAuthoritativeExecutionIds).toEqual([]);
  });

  it("distinguishes a still-pending shadow from genuinely absent evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-executions-"));
    roots.push(root);
    const recorder = new PurposeAndRoleSeparatedFileRuntimeExecutionRecorder(root);
    await recorder.record({
      ...record("AGENT_EVAL", "SHADOW"),
      parentAuthoritativeExecutionId: "authoritative-pending",
      status: "RUNNING",
      completedAt: undefined,
      completeness: { trace: false, finalResponse: false, toolEvidence: false },
    });

    const result = await recorder.waitForTerminalShadows(
      "AGENT_EVAL",
      ["authoritative-pending", "authoritative-absent"],
      { timeoutMs: 25, pollIntervalMs: 5 },
    );

    expect(result.pendingAuthoritativeExecutionIds).toEqual(["authoritative-pending"]);
    expect(result.absentAuthoritativeExecutionIds).toEqual(["authoritative-absent"]);
    expect(result.records).toEqual([expect.objectContaining({ status: "RUNNING" })]);
  });
});
