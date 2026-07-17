import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RoleSeparatedFileRuntimeExecutionRecorder } from "../scripts/lib/runtime-execution-recorder";
import type { RuntimeExecutionRecord, RuntimeExecutionRole } from "../src/runtime/runtime-shadow";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function record(role: RuntimeExecutionRole): RuntimeExecutionRecord {
  return {
    schemaVersion: "1.0.0",
    executionId: `${role.toLowerCase()}-execution`,
    role,
    runPurpose: "AGENT_EVAL",
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

describe("role-separated runtime execution recording", () => {
  it("persists authoritative and shadow records in separate sanitized namespaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-executions-"));
    roots.push(root);
    const recorder = new RoleSeparatedFileRuntimeExecutionRecorder(root);

    await recorder.record(record("AUTHORITATIVE"));
    await recorder.record(record("SHADOW"));

    await expect(recorder.list("AUTHORITATIVE")).resolves.toEqual([expect.objectContaining({ role: "AUTHORITATIVE", runtimeAdapterId: "legacy" })]);
    await expect(recorder.list("SHADOW")).resolves.toEqual([expect.objectContaining({ role: "SHADOW", runtimeAdapterId: "candidate" })]);
    expect((await readdir(root)).sort()).toEqual(["authoritative", "shadow"]);
    const serialized = await readFile(join(root, "shadow", "shadow-execution.json"), "utf8");
    expect(serialized).not.toMatch(/secret-token|private-sources|hidden_reasoning|never persist|\/Users\//u);
  });

  it("waits for a delayed terminal shadow record within the bounded window", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-executions-"));
    roots.push(root);
    const recorder = new RoleSeparatedFileRuntimeExecutionRecorder(root);
    const shadow = { ...record("SHADOW"), parentAuthoritativeExecutionId: "authoritative-execution" };

    const waiting = recorder.waitForTerminalShadows(["authoritative-execution"], { timeoutMs: 500, pollIntervalMs: 10 });
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
    const recorder = new RoleSeparatedFileRuntimeExecutionRecorder(root);
    await recorder.record({
      ...record("SHADOW"),
      parentAuthoritativeExecutionId: "authoritative-pending",
      status: "RUNNING",
      completedAt: undefined,
      completeness: { trace: false, finalResponse: false, toolEvidence: false },
    });

    const result = await recorder.waitForTerminalShadows(
      ["authoritative-pending", "authoritative-absent"],
      { timeoutMs: 25, pollIntervalMs: 5 },
    );

    expect(result.pendingAuthoritativeExecutionIds).toEqual(["authoritative-pending"]);
    expect(result.absentAuthoritativeExecutionIds).toEqual(["authoritative-absent"]);
    expect(result.records).toEqual([expect.objectContaining({ status: "RUNNING" })]);
  });
});
