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
});
