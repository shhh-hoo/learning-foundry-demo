import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "@/domain/invariants";
import {
  AssetRuntimeRequest,
  assetRuntimeHash,
  assetRuntimeId,
  normalizeRuntimeError,
  stableAssetRuntimeJson,
  terminalStatusForError,
} from "@/domain/asset-runtime";
import { getAssetRuntimeAdapter } from "@/reference-packs/capability-runtime";

describe("CAP-04 Asset Runtime boundary", () => {
  it("binds stable replay identity to canonical input and a bounded deadline", () => {
    const first = assetRuntimeHash({ b: 2, a: { y: 1, x: [3, 4] } });
    const replay = assetRuntimeHash({ a: { x: [3, 4], y: 1 }, b: 2 });
    expect(first).toBe(replay);
    expect(stableAssetRuntimeJson({ b: 2, a: 1 })).toBe(stableAssetRuntimeJson({ a: 1, b: 2 }));
    expect(assetRuntimeId("delivery", first)).toBe(assetRuntimeId("delivery", replay));
    expect(AssetRuntimeRequest.safeParse({
      taskId: "10000000-0000-4000-8000-000000000001",
      episodeId: "20000000-0000-4000-8000-000000000001",
      activityPlanProposalId: "30000000-0000-4000-8000-000000000001",
      prompt: "Calculate the concentration.",
      response: "0.5 mol/L",
      structuredInput: { learnerAnswer: 0.5 },
      idempotencyKey: "asset-runtime:test",
      deadlineMs: 120_001,
    }).success).toBe(false);
  });

  it("allows only exact registered replay-safe deterministic adapters", () => {
    const adapter = getAssetRuntimeAdapter("chemistry.molar-concentration.v1", "TRUSTED_DETERMINISTIC_ADAPTER");
    expect(adapter).toMatchObject({
      implementationKey: "chemistry.molar-concentration.v1",
      runtimeKind: "TRUSTED_DETERMINISTIC_ADAPTER",
      replaySafe: true,
    });
    expect(getAssetRuntimeAdapter("chemistry.molar-concentration.v1", "TEXT_SUPPORT")).toBeNull();
    expect(getAssetRuntimeAdapter("unknown.runtime", "TRUSTED_DETERMINISTIC_ADAPTER")).toBeNull();
  });

  it("normalizes cancellation, timeout and adapter failure without fabricating success", () => {
    const timeout = normalizeRuntimeError(new DomainInvariantError("deadline", "EXECUTION_TIMED_OUT"));
    const cancelled = normalizeRuntimeError(new DomainInvariantError("abort", "EXECUTION_ABORTED"));
    const failed = normalizeRuntimeError(new Error("adapter failed"));
    expect(timeout).toMatchObject({ code: "ASSET_RUNTIME_TIMED_OUT", retryable: true });
    expect(cancelled).toMatchObject({ code: "ASSET_RUNTIME_CANCELLED", retryable: true });
    expect(failed).toEqual({
      code: "ASSET_RUNTIME_ADAPTER_FAILED",
      message: "The registered Asset Runtime adapter failed.",
      retryable: true,
    });
    expect(terminalStatusForError(timeout)).toBe("TIMED_OUT");
    expect(terminalStatusForError(cancelled)).toBe("CANCELLED");
    expect(terminalStatusForError(failed)).toBe("FAILED");
  });
});
