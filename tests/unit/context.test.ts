import { describe, expect, it } from "vitest";
import { compileContext, ContextCompilationError } from "@/domain/context";
import { contextItemsFromConversationEvents } from "@/application/context-service";
import type { ContextItem } from "@/domain/model";

const taskId = "80000000-0000-4000-8000-000000000001";
const episodeId = "80000000-0000-4000-8000-000000000002";
const priorTaskId = "80000000-0000-4000-8000-000000000099";
const effectiveAt = new Date("2030-01-01T00:00:00.000Z");

function item(id: string, overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id,
    taskId,
    kind: "TASK_FACT",
    scope: "TASK",
    state: "ACTIVE",
    content: id,
    provenanceRefs: [{ type: "CONTEXT_ITEM", id }],
    ...overrides,
  };
}

describe("Context Compiler", () => {
  it("is deterministic across candidate input order and records exact provenance", () => {
    const candidates = [
      item("b", { kind: "TASK_FACT", priority: 10 }),
      item("a", { kind: "LEARNER_PROFILE", scope: "PROFILE", priority: 20 }),
    ];
    const forward = compileContext({ activeTaskId: taskId, activeEpisodeId: episodeId, consumer: "DIAGNOSIS", candidates, effectiveAt });
    const reversed = compileContext({ activeTaskId: taskId, activeEpisodeId: episodeId, consumer: "DIAGNOSIS", candidates: [...candidates].reverse(), effectiveAt });

    expect(reversed).toEqual(forward);
    expect(forward.candidateItems.map((candidate) => candidate.id)).toEqual(["a", "b"]);
    expect(forward.selectedItems.map((candidate) => [candidate.id, candidate.inclusionReason])).toEqual([
      ["a", "CURRENT_LEARNER_PROFILE"],
      ["b", "ACTIVE_TASK_SCOPE"],
    ]);
    expect(forward.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(forward.snapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(forward.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(forward.provenanceRefs).toEqual([
      { type: "CONTEXT_ITEM", id: "a" },
      { type: "CONTEXT_ITEM", id: "b" },
    ]);
  });

  it("keeps replay hashes stable within a validity window and changes them only across its boundary", () => {
    const candidate = item("temporal", {
      validFrom: "2029-12-31T00:00:00.000Z",
      validUntil: "2030-01-03T00:00:00.000Z",
    });
    const first = compileContext({ activeTaskId: taskId, activeEpisodeId: episodeId, candidates: [candidate], effectiveAt });
    const sameWindow = compileContext({
      activeTaskId: taskId,
      activeEpisodeId: episodeId,
      candidates: [candidate],
      effectiveAt: new Date("2030-01-02T00:00:00.000Z"),
    });
    const expired = compileContext({
      activeTaskId: taskId,
      activeEpisodeId: episodeId,
      candidates: [candidate],
      effectiveAt: new Date("2030-01-04T00:00:00.000Z"),
    });

    expect(sameWindow).toEqual(first);
    expect(expired.inputHash).not.toBe(first.inputHash);
    expect(expired.snapshotHash).not.toBe(first.snapshotHash);
    expect(expired.excludedItems).toEqual([expect.objectContaining({ id: "temporal", reason: "EXPIRED_ITEM" })]);

    const notYetEffective = compileContext({
      activeTaskId: taskId,
      activeEpisodeId: episodeId,
      candidates: [item("future", { validFrom: "2030-02-01T00:00:00.000Z" })],
      effectiveAt,
    });
    expect(notYetEffective.excludedItems).toEqual([expect.objectContaining({ id: "future", reason: "NOT_YET_EFFECTIVE" })]);
  });

  it("excludes stale, superseded and unrelated Task facts while retaining exact carryover", () => {
    const result = compileContext({
      activeTaskId: taskId,
      activeEpisodeId: episodeId,
      candidates: [
        item("current"),
        item("stale", { state: "STALE" }),
        item("superseded", { state: "SUPERSEDED" }),
        item("other", { taskId: priorTaskId }),
        item("carry", {
          taskId: priorTaskId,
          carryover: {
            relationId: "carry-relation",
            relationType: "EXPLICIT_REFERENCE",
            sourceTaskId: priorTaskId,
            targetTaskId: taskId,
            actorUserId: "20000000-0000-4000-8000-000000000001",
            reason: "Learner explicitly referenced this item.",
          },
          provenanceRefs: [
            { type: "CONTEXT_ITEM", id: "carry" },
            { type: "CONTEXT_CARRYOVER_RELATION", id: "carry-relation" },
          ],
        }),
      ],
      effectiveAt,
    });

    expect(result.selectedItems.map((candidate) => candidate.id)).toEqual(["carry", "current"]);
    expect(Object.fromEntries(result.excludedItems.map((candidate) => [candidate.id, candidate.reason]))).toEqual({
      other: "UNRELATED_PRIOR_TASK_ENTITY",
      stale: "STALE_TASK_ITEM",
      superseded: "SUPERSEDED_FACT",
    });
    expect(result.selectedItems.find((candidate) => candidate.id === "carry")?.inclusionReason).toBe("EXPLICIT_CARRYOVER");
    expect(result.referencedPriorTaskIds).toEqual([priorTaskId]);
    expect(result.selectionPolicy).toBe("AUTHORIZED_LIFECYCLE_CARRYOVER_AND_BUDGET_ENFORCED");
  });

  it("records modality and token truncation without dropping required context", () => {
    const result = compileContext({
      activeTaskId: taskId,
      activeEpisodeId: episodeId,
      tokenBudget: 4,
      modalityBudget: { TEXT: 2, IMAGE: 0 },
      candidates: [
        item("selected", { content: "small", priority: 10 }),
        item("modality", { content: "image", modality: "IMAGE", priority: 9 }),
        item("tokens", { content: "This is a much longer context item", priority: 8 }),
      ],
      effectiveAt,
    });

    expect(result.selectedItems.map((candidate) => candidate.id)).toEqual(["selected"]);
    expect(Object.fromEntries(result.excludedItems.map((candidate) => [candidate.id, [candidate.reason, candidate.truncated]]))).toEqual({
      modality: ["OUTSIDE_MODALITY_BUDGET", true],
      tokens: ["OUTSIDE_TOKEN_BUDGET", true],
    });

    expect(() => compileContext({
      activeTaskId: taskId,
      activeEpisodeId: episodeId,
      tokenBudget: 1,
      candidates: [item("required", { content: "required context", required: true })],
      effectiveAt,
    })).toThrowError(expect.objectContaining({ code: "CONTEXT_REQUIRED_ITEM_INELIGIBLE" }));
  });

  it("fails closed on missing, duplicated or internally inconsistent candidates", () => {
    expect(() => compileContext({ activeTaskId: taskId, activeEpisodeId: episodeId, candidates: [] }))
      .toThrowError(expect.objectContaining({ code: "CONTEXT_REQUIRED_INPUT_MISSING" }));
    expect(() => compileContext({ activeTaskId: taskId, activeEpisodeId: episodeId, candidates: [item("duplicate"), item("duplicate")] }))
      .toThrowError(expect.objectContaining({ code: "CONTEXT_CANDIDATE_CONFLICT" }));
    expect(() => compileContext({ activeTaskId: taskId, activeEpisodeId: episodeId, candidates: [item("tokens", { tokenCount: 999 })] }))
      .toThrowError(expect.objectContaining({ code: "CONTEXT_TOKEN_COUNT_CONFLICT" }));
    expect(() => compileContext({ activeTaskId: taskId, activeEpisodeId: episodeId, candidates: [item("invalid-time", { validFrom: "not-a-time" })] }))
      .toThrowError(expect.objectContaining({ code: "CONTEXT_TIME_INVALID" }));
    expect(ContextCompilationError).toBeDefined();
  });

  it("keeps a correcting legacy Event eligible and excludes the Event it supersedes", () => {
    const oldEventId = "80000000-0000-4000-8000-000000000010";
    const correctionId = "80000000-0000-4000-8000-000000000011";
    const candidates = contextItemsFromConversationEvents([
      { id: correctionId, taskId, episodeId, content: "Corrected concentration is 0.20 mol/L.", supersedesEventId: oldEventId },
      { id: oldEventId, taskId, episodeId, content: "Concentration is 2.0 mol/L.", supersedesEventId: null },
    ]);

    const result = compileContext({ activeTaskId: taskId, activeEpisodeId: episodeId, candidates, effectiveAt });
    expect(result.selectedItems.map((candidate) => candidate.id)).toEqual([`conversation-event:${correctionId}`]);
    expect(result.selectedItems[0]?.content).toContain("0.20 mol/L");
    expect(result.selectedItems[0]?.inclusionReason).toBe("LEGACY_COMPATIBILITY");
    expect(result.excludedItems).toEqual([expect.objectContaining({ id: `conversation-event:${oldEventId}`, reason: "SUPERSEDED_FACT" })]);
  });
});
