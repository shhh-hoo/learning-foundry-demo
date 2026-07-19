import { createHash } from "node:crypto";
import { getEncoding } from "js-tiktoken";
import type {
  CompiledContext,
  ContextConsumer,
  ContextExclusionReason,
  ContextInclusionReason,
  ContextItem,
  ContextProvenanceReference,
} from "@/domain/model";

export const CONTEXT_COMPILER_VERSION = "3.0.0";
export const CONTEXT_POLICY_VERSION = "cap-01.1";
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 4_000;
export const DEFAULT_CONTEXT_MODALITY_BUDGET: Record<string, number> = {
  TEXT: 24,
  TABLE: 4,
  FIGURE: 2,
  DIAGRAM: 2,
  IMAGE: 2,
  QUESTION: 4,
  MARK_SCHEME: 2,
  RUBRIC: 2,
  EXAMPLE: 4,
  STUDENT_WORK: 4,
  AUDIO: 1,
  VIDEO_SEGMENT: 1,
  INTERACTIVE_RESOURCE: 1,
};

const tokenizer = getEncoding("o200k_base");
const scopeRank: Record<string, number> = { PROFILE: 4, WORKSPACE: 3, TASK: 2, EPISODE: 1 };

export class ContextCompilationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ContextCompilationError";
  }
}

export function countContextTokens(content: string): number {
  return tokenizer.encode(content).length;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function stableContextJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableContextJson(value)).digest("hex")}`;
}

function deterministicUuid(hash: string): string {
  const raw = hash.replace(/^sha256:/, "").slice(0, 32).split("");
  raw[12] = "5";
  raw[16] = ((Number.parseInt(raw[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = raw.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function compareReferences(left: ContextProvenanceReference, right: ContextProvenanceReference): number {
  return `${left.type}|${left.id}|${left.version ?? ""}|${left.contentHash ?? ""}`
    .localeCompare(`${right.type}|${right.id}|${right.version ?? ""}|${right.contentHash ?? ""}`);
}

function normalizeReferences(item: ContextItem): ContextProvenanceReference[] {
  const supplied = item.provenanceRefs?.length
    ? item.provenanceRefs
    : [{ type: "CONTEXT_ITEM" as const, id: item.id }];
  const unique = new Map(supplied.map((reference) => [stableContextJson(reference), reference]));
  return [...unique.values()].sort(compareReferences);
}

function compareCandidates(left: ContextItem, right: ContextItem): number {
  return Number(Boolean(right.required)) - Number(Boolean(left.required))
    || (right.priority ?? 0) - (left.priority ?? 0)
    || (scopeRank[right.scope ?? "TASK"] ?? 0) - (scopeRank[left.scope ?? "TASK"] ?? 0)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function inclusionReason(item: ContextItem): ContextInclusionReason {
  if (item.inclusionReason) return item.inclusionReason;
  if (item.carryover || item.carryoverRelation) return "EXPLICIT_CARRYOVER";
  if (item.kind === "LEARNER_PROFILE") return "CURRENT_LEARNER_PROFILE";
  if (item.kind === "LEARNER_STRATEGY") return "CURRENT_LEARNER_STRATEGY";
  return item.scope === "EPISODE" ? "ACTIVE_EPISODE_SCOPE" : "ACTIVE_TASK_SCOPE";
}

function lifecycleExclusion(item: ContextItem, input: {
  activeTaskId: string;
  activeEpisodeId: string;
  effectiveAt: Date;
}): ContextExclusionReason | null {
  if (item.exclusionReason) return item.exclusionReason;
  if (item.stale || item.state === "STALE") return "STALE_TASK_ITEM";
  if (item.superseded || item.state === "SUPERSEDED") return "SUPERSEDED_FACT";
  if (item.state === "INVALIDATED") return "INVALIDATED_ITEM";
  if (item.validFrom && new Date(item.validFrom) > input.effectiveAt) return "NOT_YET_EFFECTIVE";
  if (item.validUntil && new Date(item.validUntil) <= input.effectiveAt) return "EXPIRED_ITEM";
  if (item.taskId !== input.activeTaskId) {
    if (!item.carryover && !item.carryoverRelation) return "UNRELATED_PRIOR_TASK_ENTITY";
    if (item.carryover && item.carryover.targetTaskId !== input.activeTaskId) return "UNJUSTIFIED_ENTITY_CARRYOVER";
  }
  if (item.scope === "EPISODE" && item.episodeId !== input.activeEpisodeId && !item.carryover) return "WRONG_EPISODE";
  return null;
}

function assertBudget(tokenBudget: number, modalityBudget: Record<string, number>): void {
  if (!Number.isInteger(tokenBudget) || tokenBudget <= 0) {
    throw new ContextCompilationError("Context token budget must be a positive integer", "CONTEXT_BUDGET_INVALID");
  }
  if (!Object.keys(modalityBudget).length || Object.entries(modalityBudget).some(([key, value]) => !key || !Number.isInteger(value) || value < 0)) {
    throw new ContextCompilationError("Context modality budgets must be non-negative integers", "CONTEXT_BUDGET_INVALID");
  }
}

export function compileContext(input: {
  activeTaskId: string;
  activeEpisodeId: string;
  consumer?: ContextConsumer;
  candidates: ContextItem[];
  tokenBudget?: number;
  modalityBudget?: Record<string, number>;
  effectiveAt?: Date;
}): CompiledContext {
  if (!input.activeTaskId || !input.activeEpisodeId) {
    throw new ContextCompilationError("Context requires an active Task and Episode", "CONTEXT_SCOPE_MISSING");
  }
  if (!input.candidates.length) {
    throw new ContextCompilationError("Context requires at least one authoritative candidate", "CONTEXT_REQUIRED_INPUT_MISSING");
  }

  const tokenBudget = input.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET;
  const modalityBudget = { ...(input.modalityBudget ?? DEFAULT_CONTEXT_MODALITY_BUDGET) };
  const effectiveAt = input.effectiveAt ?? new Date();
  assertBudget(tokenBudget, modalityBudget);
  if (Number.isNaN(effectiveAt.getTime())) {
    throw new ContextCompilationError("Context effective time is invalid", "CONTEXT_TIME_INVALID");
  }

  const seen = new Set<string>();
  const candidates = input.candidates.map((item) => {
    if (!item.id || !item.taskId || !item.kind || !item.content.trim()) {
      throw new ContextCompilationError("Context candidate identity, Task, kind and content are required", "CONTEXT_CANDIDATE_INVALID");
    }
    if (seen.has(item.id)) {
      throw new ContextCompilationError(`Duplicate Context candidate ${item.id}`, "CONTEXT_CANDIDATE_CONFLICT");
    }
    seen.add(item.id);
    const measuredTokens = countContextTokens(item.content);
    if (item.tokenCount !== undefined && item.tokenCount !== measuredTokens) {
      throw new ContextCompilationError(`Context candidate ${item.id} has a conflicting token count`, "CONTEXT_TOKEN_COUNT_CONFLICT");
    }
    const validFrom = item.validFrom ? new Date(item.validFrom) : null;
    const validUntil = item.validUntil ? new Date(item.validUntil) : null;
    if ((validFrom && Number.isNaN(validFrom.getTime())) || (validUntil && Number.isNaN(validUntil.getTime()))
      || (validFrom && validUntil && validUntil <= validFrom)) {
      throw new ContextCompilationError(`Context candidate ${item.id} has an invalid validity interval`, "CONTEXT_TIME_INVALID");
    }
    return {
      ...item,
      modality: item.modality ?? "TEXT",
      scope: item.scope ?? "TASK",
      state: item.state ?? "ACTIVE",
      tokenCount: measuredTokens,
      provenanceRefs: normalizeReferences(item),
    } satisfies ContextItem;
  }).sort(compareCandidates);

  const selectedItems: CompiledContext["selectedItems"] = [];
  const excludedItems: CompiledContext["excludedItems"] = [];
  const modalityUsage: Record<string, number> = {};
  let selectedTokenCount = 0;

  for (const item of candidates) {
    let reason = lifecycleExclusion(item, {
      activeTaskId: input.activeTaskId,
      activeEpisodeId: input.activeEpisodeId,
      effectiveAt,
    });
    const modality = item.modality ?? "TEXT";
    const tokenCount = item.tokenCount ?? 0;
    if (!reason && (modalityUsage[modality] ?? 0) >= (modalityBudget[modality] ?? 0)) reason = "OUTSIDE_MODALITY_BUDGET";
    if (!reason && selectedTokenCount + tokenCount > tokenBudget) reason = "OUTSIDE_TOKEN_BUDGET";

    if (reason) {
      if (item.required) {
        throw new ContextCompilationError(`Required Context candidate ${item.id} is ineligible: ${reason}`, "CONTEXT_REQUIRED_ITEM_INELIGIBLE");
      }
      excludedItems.push({
        ...item,
        reason,
        truncated: reason === "OUTSIDE_MODALITY_BUDGET" || reason === "OUTSIDE_TOKEN_BUDGET",
      });
      continue;
    }

    selectedItems.push({ ...item, inclusionReason: inclusionReason(item) });
    selectedTokenCount += tokenCount;
    modalityUsage[modality] = (modalityUsage[modality] ?? 0) + 1;
  }

  const consumer = input.consumer ?? "EVIDENCE_RETRIEVAL";
  const provenanceRefs = [...new Map(candidates.flatMap((item) => item.provenanceRefs ?? [])
    .map((reference) => [stableContextJson(reference), reference])).values()].sort(compareReferences);
  const referencedPriorTaskIds = [...new Set(candidates
    .filter((item) => item.taskId !== input.activeTaskId && (item.carryover || item.carryoverRelation))
    .map((item) => item.taskId))].sort();
  const eligibilityResolution = [
    ...selectedItems.map((item) => ({ id: item.id, included: item.inclusionReason })),
    ...excludedItems.map((item) => ({ id: item.id, excluded: item.reason, truncated: item.truncated })),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const inputHash = sha256({
    activeTaskId: input.activeTaskId,
    activeEpisodeId: input.activeEpisodeId,
    consumer,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyVersion: CONTEXT_POLICY_VERSION,
    tokenBudget,
    modalityBudget,
    candidates,
    // The exact wall-clock instant is deliberately excluded: replays remain
    // stable until a governed validity boundary actually changes eligibility.
    eligibilityResolution,
  });
  const snapshotBody = {
    activeTaskId: input.activeTaskId,
    activeEpisodeId: input.activeEpisodeId,
    consumer,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyVersion: CONTEXT_POLICY_VERSION,
    inputHash,
    selectedItems,
    excludedItems,
    tokenBudget,
    modalityBudget,
    selectedTokenCount,
    modalityUsage,
    provenanceRefs,
    referencedPriorTaskIds,
    tokenizer: "o200k_base" as const,
  };
  const snapshotHash = sha256(snapshotBody);

  return {
    id: deterministicUuid(snapshotHash),
    ...snapshotBody,
    candidateItems: candidates,
    snapshotHash,
    selectionPolicy: "AUTHORIZED_LIFECYCLE_CARRYOVER_AND_BUDGET_ENFORCED",
    tokenBudgetStatus: "ENFORCED",
    modalityBudgetStatus: "ENFORCED",
  };
}
