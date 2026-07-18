import { randomUUID } from "node:crypto";
import { getEncoding } from "js-tiktoken";
import type { CompiledContext, ContextItem } from "@/domain/model";

export const CONTEXT_COMPILER_VERSION = "2.0.0";
const tokenizer = getEncoding("o200k_base");

export function countContextTokens(content: string): number {
  return tokenizer.encode(content).length;
}

export function compileContext(input: {
  activeTaskId: string;
  activeEpisodeId: string;
  candidates: ContextItem[];
  tokenBudget?: number;
  modalityBudget?: Record<string, number>;
}): CompiledContext {
  const selectedItems: ContextItem[] = [];
  const excludedItems: Array<ContextItem & { reason: string }> = [];
  const tokenBudget = input.tokenBudget ?? 4_000;
  const modalityBudget = input.modalityBudget ?? { TEXT: 12, TABLE: 2, FIGURE: 1, IMAGE: 1 };
  const modalityUsage: Record<string, number> = {};
  let selectedTokenCount = 0;

  for (const item of input.candidates) {
    const modality = item.modality ?? "TEXT";
    const tokenCount = item.tokenCount ?? countContextTokens(item.content);
    const measured = { ...item, modality, tokenCount };
    if (item.stale) {
      excludedItems.push({ ...measured, reason: "STALE" });
    } else if (item.superseded) {
      excludedItems.push({ ...measured, reason: "SUPERSEDED" });
    } else if (item.taskId !== input.activeTaskId && !item.carryoverRelation) {
      excludedItems.push({ ...measured, reason: "UNRELATED_TASK" });
    } else if ((modalityUsage[modality] ?? 0) >= (modalityBudget[modality] ?? 0)) {
      excludedItems.push({ ...measured, reason: "MODALITY_BUDGET" });
    } else if (selectedTokenCount + tokenCount > tokenBudget) {
      excludedItems.push({ ...measured, reason: "TOKEN_BUDGET" });
    } else {
      selectedItems.push(measured);
      selectedTokenCount += tokenCount;
      modalityUsage[modality] = (modalityUsage[modality] ?? 0) + 1;
    }
  }

  return {
    id: randomUUID(),
    activeTaskId: input.activeTaskId,
    activeEpisodeId: input.activeEpisodeId,
    candidateItems: input.candidates,
    selectedItems,
    excludedItems,
    tokenBudget,
    modalityBudget,
    selectedTokenCount,
    modalityUsage,
    tokenizer: "o200k_base",
    selectionPolicy: "LIFECYCLE_AND_BUDGET_ENFORCED",
    tokenBudgetStatus: "ENFORCED",
    modalityBudgetStatus: "ENFORCED",
    compilerVersion: CONTEXT_COMPILER_VERSION,
  };
}
