import { createHash } from "node:crypto";
import { z } from "zod";
import { DomainInvariantError } from "@/domain/invariants";

export const ASSET_RUNTIME_POLICY_VERSION = "cap-04.1";

export const AssetRuntimeRequest = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  activityPlanProposalId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(4_000),
  response: z.string().trim().min(1).max(20_000),
  structuredInput: z.record(z.string(), z.unknown()),
  modality: z.enum(["TEXT", "STRUCTURED", "MULTIMODAL"]).default("STRUCTURED"),
  idempotencyKey: z.string().trim().min(8).max(240),
  deadlineMs: z.number().int().positive().max(120_000).default(30_000),
}).strict();

export type AssetRuntimeRequest = z.infer<typeof AssetRuntimeRequest>;

export const AssetRuntimeStage = z.object({
  order: z.literal(1),
  kind: z.literal("CAPABILITY_ACTIVITY"),
  purpose: z.string().min(1),
  capabilityId: z.string().uuid(),
  capabilityVersionId: z.string().uuid(),
  capabilityVersion: z.string().min(1),
  capabilityVersionContentHash: z.string().min(8),
  inputs: z.object({
    taskId: z.string().uuid(),
    episodeId: z.string().uuid(),
    contextCompilationId: z.string().uuid(),
    contextSnapshotHash: z.string().min(8),
    diagnosticObservationId: z.string().uuid(),
    inputContract: z.unknown(),
  }).passthrough(),
  parameters: z.unknown(),
  expected: z.object({
    output: z.unknown(),
    events: z.array(z.string().min(1)).min(1),
    evidence: z.array(z.string().min(1)),
  }),
  successCondition: z.string().min(1),
  stopConditions: z.array(z.string().min(1)).min(1),
  transition: z.object({ onSuccess: z.string().min(1), onStop: z.string().min(1) }),
}).passthrough();

export type AssetRuntimeStage = z.infer<typeof AssetRuntimeStage>;

export type AssetRuntimeTerminalStatus = "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";

export type NormalizedRuntimeError = {
  code: string;
  message: string;
  retryable: boolean;
};

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

export function stableAssetRuntimeJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function assetRuntimeHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableAssetRuntimeJson(value)).digest("hex")}`;
}

export function assetRuntimeId(namespace: string, hash: string): string {
  const digest = createHash("sha256").update(`${namespace}:${hash}`).digest("hex");
  const raw = digest.slice(0, 32).split("");
  raw[12] = "5";
  raw[16] = ((Number.parseInt(raw[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = raw.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export function normalizeRuntimeError(error: unknown): NormalizedRuntimeError {
  if (error instanceof DomainInvariantError) {
    if (error.code === "EXECUTION_TIMED_OUT") {
      return { code: "ASSET_RUNTIME_TIMED_OUT", message: "Asset runtime exceeded its bounded deadline.", retryable: true };
    }
    if (error.code === "EXECUTION_ABORTED") {
      return { code: "ASSET_RUNTIME_CANCELLED", message: "Asset runtime was cancelled before completion.", retryable: true };
    }
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof z.ZodError) {
    return { code: "ASSET_RUNTIME_INPUT_INVALID", message: "Learner input did not satisfy the exact registered adapter contract.", retryable: true };
  }
  return {
    code: "ASSET_RUNTIME_ADAPTER_FAILED",
    message: "The registered Asset Runtime adapter failed.",
    retryable: true,
  };
}

export function terminalStatusForError(error: NormalizedRuntimeError): AssetRuntimeTerminalStatus {
  if (error.code === "ASSET_RUNTIME_TIMED_OUT") return "TIMED_OUT";
  if (error.code === "ASSET_RUNTIME_CANCELLED") return "CANCELLED";
  return "FAILED";
}
