import { randomUUID } from "node:crypto";
import type { CompiledContext, ContextItem } from "@/domain/model";

export const CONTEXT_COMPILER_VERSION = "1.0.0";

export function compileContext(input: {
  activeTaskId: string;
  activeEpisodeId: string;
  candidates: ContextItem[];
  tokenBudget?: number;
  modalityBudget?: Record<string, number>;
}): CompiledContext {
  const selectedItems: ContextItem[] = [];
  const excludedItems: Array<ContextItem & { reason: string }> = [];

  for (const item of input.candidates) {
    if (item.stale) {
      excludedItems.push({ ...item, reason: "STALE" });
    } else if (item.superseded) {
      excludedItems.push({ ...item, reason: "SUPERSEDED" });
    } else if (item.taskId !== input.activeTaskId && !item.carryoverRelation) {
      excludedItems.push({ ...item, reason: "UNRELATED_TASK" });
    } else {
      selectedItems.push(item);
    }
  }

  return {
    id: randomUUID(),
    activeTaskId: input.activeTaskId,
    activeEpisodeId: input.activeEpisodeId,
    candidateItems: input.candidates,
    selectedItems,
    excludedItems,
    tokenBudget: input.tokenBudget ?? 4_000,
    modalityBudget: input.modalityBudget ?? { TEXT: 12, TABLE: 2, FIGURE: 1 },
    selectionPolicy: "LIFECYCLE_FILTERING_ONLY",
    tokenBudgetStatus: "NOT_ENFORCED",
    modalityBudgetStatus: "UNAVAILABLE",
    compilerVersion: CONTEXT_COMPILER_VERSION,
  };
}
