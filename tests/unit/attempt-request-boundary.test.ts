import { describe, expect, it } from "vitest";
import { LearnerAttemptRequest } from "@/application/attempt-request";

const validRequest = {
  taskId: "80000000-0000-4000-8000-000000000001",
  episodeId: "80000000-0000-4000-8000-000000000002",
  fileAssetId: "90000000-0000-4000-8000-000000000003",
  capabilityPublicKey: "chemistry-molar-concentration",
  fields: { amount: "1", amountUnit: "mol", volume: "2", volumeUnit: "L", learnerAnswer: "0.5" },
  manualEntry: true,
  prompt: "Calculate the molar concentration.",
  response: "I divided 1 mol by 2 L and obtained 0.5 mol/L.",
  idempotencyKey: "attempt:boundary",
};

describe("public Learner Attempt request boundary", () => {
  it("preserves optional multimodal file lineage on the safe request", () => {
    expect(LearnerAttemptRequest.parse(validRequest).fileAssetId).toBe(validRequest.fileAssetId);
  });

  it("rejects legacy browser Capability IDs and structured JSON input", () => {
    expect(LearnerAttemptRequest.safeParse({ ...validRequest, capabilityId: "50000000-0000-4000-8000-000000000001" }).success).toBe(false);
    expect(LearnerAttemptRequest.safeParse({ ...validRequest, structuredInput: { learnerAnswer: 0.5 } }).success).toBe(false);
  });

  it("rejects learner-authored source lineage", () => {
    expect(LearnerAttemptRequest.safeParse({ ...validRequest, sourceRefs: [{ sourceId: "fabricated" }] }).success).toBe(false);
  });

  it("requires fields to be empty when no calculation activity is selected", () => {
    const { capabilityPublicKey: _capabilityPublicKey, ...withoutCapability } = validRequest;
    void _capabilityPublicKey;
    expect(LearnerAttemptRequest.safeParse({ ...withoutCapability, fields: {}, manualEntry: false }).success).toBe(true);
    expect(LearnerAttemptRequest.safeParse(withoutCapability).success).toBe(false);
  });

  it("accepts manual typed fields only with explicit manual-entry mode", () => {
    expect(LearnerAttemptRequest.safeParse(validRequest).success).toBe(true);
    expect(LearnerAttemptRequest.safeParse({ ...validRequest, manualEntry: false }).success).toBe(false);
  });

  it("accepts automatic interpretation with either an empty hint or a selected hint", () => {
    expect(LearnerAttemptRequest.safeParse({ ...validRequest, capabilityPublicKey: undefined, fields: {}, manualEntry: false }).success).toBe(true);
    expect(LearnerAttemptRequest.safeParse({ ...validRequest, fields: {}, manualEntry: false }).success).toBe(true);
  });
});
