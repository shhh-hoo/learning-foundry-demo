import { describe, expect, it } from "vitest";
import { compileContext } from "@/domain/context";
import { contextItemsFromConversationEvents } from "@/application/context-service";

describe("Context Compiler", () => {
  it("excludes stale, superseded and unrelated Task facts while retaining explicit carryover", () => {
    const result = compileContext({
      activeTaskId: "80000000-0000-4000-8000-000000000001",
      activeEpisodeId: "80000000-0000-4000-8000-000000000002",
      candidates: [
        { id: "current", taskId: "80000000-0000-4000-8000-000000000001", kind: "EVENT", content: "current" },
        { id: "stale", taskId: "80000000-0000-4000-8000-000000000001", kind: "EVENT", content: "stale", stale: true },
        { id: "superseded", taskId: "80000000-0000-4000-8000-000000000001", kind: "OBSERVATION", content: "old", superseded: true },
        { id: "other", taskId: "80000000-0000-4000-8000-000000000099", kind: "EVENT", content: "unrelated" },
        { id: "carry", taskId: "80000000-0000-4000-8000-000000000099", kind: "EVIDENCE", content: "linked", carryoverRelation: "EXPLICIT_REFERENCE" },
      ],
    });
    expect(result.selectedItems.map((item) => item.id)).toEqual(["current", "carry"]);
    expect(Object.fromEntries(result.excludedItems.map((item) => [item.id, item.reason]))).toEqual({ stale: "STALE", superseded: "SUPERSEDED", other: "UNRELATED_TASK" });
    expect(result.candidateItems).toHaveLength(5);
    expect(result.selectionPolicy).toBe("LIFECYCLE_AND_BUDGET_ENFORCED");
    expect(result.tokenBudgetStatus).toBe("ENFORCED");
    expect(result.modalityBudgetStatus).toBe("ENFORCED");
    expect(result.selectedTokenCount).toBeGreaterThan(0);
  });

  it("excludes items that exceed model-token or modality budgets", () => {
    const result = compileContext({
      activeTaskId: "80000000-0000-4000-8000-000000000001",
      activeEpisodeId: "80000000-0000-4000-8000-000000000002",
      tokenBudget: 4,
      modalityBudget: { TEXT: 2, IMAGE: 0 },
      candidates: [
        { id: "selected", taskId: "80000000-0000-4000-8000-000000000001", kind: "EVENT", content: "small", modality: "TEXT" },
        { id: "modality", taskId: "80000000-0000-4000-8000-000000000001", kind: "ATTEMPT", content: "image", modality: "IMAGE" },
        { id: "tokens", taskId: "80000000-0000-4000-8000-000000000001", kind: "EVENT", content: "This is a much longer context item", modality: "TEXT" },
      ],
    });
    expect(result.selectedItems.map((item) => item.id)).toEqual(["selected"]);
    expect(Object.fromEntries(result.excludedItems.map((item) => [item.id, item.reason]))).toEqual({ modality: "MODALITY_BUDGET", tokens: "TOKEN_BUDGET" });
  });

  it("keeps a correcting event eligible and excludes the older event it supersedes", () => {
    const taskId = "80000000-0000-4000-8000-000000000001";
    const episodeId = "80000000-0000-4000-8000-000000000002";
    const oldEventId = "80000000-0000-4000-8000-000000000010";
    const correctionId = "80000000-0000-4000-8000-000000000011";
    const candidates = contextItemsFromConversationEvents([
      { id: correctionId, taskId, episodeId, content: "Corrected concentration is 0.20 mol/L.", supersedesEventId: oldEventId },
      { id: oldEventId, taskId, episodeId, content: "Concentration is 2.0 mol/L.", supersedesEventId: null },
    ]);

    expect(candidates.map((item) => item.id)).toEqual([correctionId, oldEventId]);
    const result = compileContext({ activeTaskId: taskId, activeEpisodeId: episodeId, candidates });
    expect(result.selectedItems.map((item) => item.id)).toEqual([correctionId]);
    expect(result.selectedItems[0]?.content).toContain("0.20 mol/L");
    expect(result.excludedItems).toEqual([expect.objectContaining({ id: oldEventId, reason: "SUPERSEDED" })]);
  });
});
