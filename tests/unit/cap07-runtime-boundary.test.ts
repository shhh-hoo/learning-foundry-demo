import { describe, expect, it } from "vitest";
import { WebComponentAssetDeliveryRequest } from "@/domain/web-component-asset";

const exactRequest = {
  taskId: "10000000-0000-4000-8000-000000000001",
  episodeId: "10000000-0000-4000-8000-000000000002",
  activityPlanProposalId: "10000000-0000-4000-8000-000000000003",
  selectedChoiceId: "verify-contract",
  idempotencyKey: "cap07-delivery:exact-command",
};

describe("CAP-07 learner runtime boundary", () => {
  it("accepts only exact IDs, the selected choice and a stable command key", () => {
    expect(WebComponentAssetDeliveryRequest.parse(exactRequest)).toEqual(exactRequest);
  });

  it("rejects caller-authored prompt and response strings", () => {
    expect(() => WebComponentAssetDeliveryRequest.parse({
      ...exactRequest,
      prompt: "forged prompt",
      response: "forged response",
    })).toThrow(/Unrecognized keys/);
  });
});
