import { describe, expect, it } from "vitest";
import { compileContext } from "@/domain/context";

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
    expect(result.selectionPolicy).toBe("LIFECYCLE_FILTERING_ONLY");
    expect(result.tokenBudgetStatus).toBe("NOT_ENFORCED");
    expect(result.modalityBudgetStatus).toBe("UNAVAILABLE");
  });
});
