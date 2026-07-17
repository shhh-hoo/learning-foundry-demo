import { describe, expect, it } from "vitest";
import { LegacyExperienceImporter } from "../src/product-state/legacy-experience-importer";
import { createInitialExperienceState } from "../src/experience/orchestration";
import { TestProductStateRepository } from "./support/product-state-repository";

describe("explicit Legacy showcase importer", () => {
  it("imports canonical message facts once and excludes runtime/checkpoint evidence", async () => {
    const repository = new TestProductStateRepository();
    const importer = new LegacyExperienceImporter(repository, { now: () => "2026-07-18T11:00:00.000Z" });
    const initial = createInitialExperienceState();
    const snapshot = {
      ...initial,
      conversationId: "legacy-conversation-1",
      messages: [
        { id: "message-1", role: "USER", content: "My original answer", inputOrigin: "USER_INPUT" },
        { id: "message-2", role: "AGENT", content: "A generated response", sourceRefs: ["legacy-source"] },
      ],
      agentTraces: [{ traceId: "runtime-trace-must-not-import" } as never],
      diagnoses: [{ traceId: "derived-diagnosis-must-not-import" } as never],
    };

    const first = await importer.import({
      snapshot,
      goal: "Continue the imported learning conversation",
      learnerId: "legacy-learner",
      importedBy: "migration-operator",
    });
    const second = await importer.import({
      snapshot,
      goal: "Continue the imported learning conversation",
      learnerId: "legacy-learner",
      importedBy: "migration-operator",
    });

    expect(first.status).toBe("IMPORTED");
    expect(second).toEqual({ status: "ALREADY_IMPORTED", receipt: first.receipt });
    const loop = await repository.getLearningLoop(first.receipt.taskId);
    expect(loop?.conversationEvents).toEqual([
      expect.objectContaining({ actor: "LEARNER", payload: { content: "My original answer", inputOrigin: "USER_INPUT" } }),
      expect.objectContaining({ actor: "FOUNDRY", payload: { content: "A generated response", legacySourceRefs: ["legacy-source"] } }),
    ]);
    expect(loop?.attempts).toEqual([]);
    expect(first.receipt.details).toMatchObject({ ignoredAgentTraceCount: 1, ignoredDiagnosisCount: 1 });
  });

  it("rejects changed bytes under an already imported source key", async () => {
    const repository = new TestProductStateRepository();
    const importer = new LegacyExperienceImporter(repository, { now: () => "2026-07-18T11:00:00.000Z" });
    const snapshot = { ...createInitialExperienceState(), conversationId: "legacy-conflict" };
    await importer.import({ snapshot, goal: "Original goal", learnerId: "legacy-learner", importedBy: "operator" });

    await expect(importer.import({
      snapshot: { ...snapshot, messages: [{ id: "changed", role: "USER", content: "Changed" }] },
      goal: "Original goal",
      learnerId: "legacy-learner",
      importedBy: "operator",
    })).rejects.toThrow("LEGACY_IMPORT_HASH_CONFLICT");
  });
});
