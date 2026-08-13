import { describe, expect, it } from "vitest";
import { parseFoundryComponentMessage } from "../src/runtime/protocol";

const base = {
  protocol: "foundry-component" as const,
  protocolVersion: "0.1" as const,
  messageId: "msg-1",
  runtimeSessionId: "runtime-1",
  timestamp: "2026-08-13T12:00:00.000Z",
};

describe("Foundry Component Runtime Protocol v0.1", () => {
  it("accepts domain-specific learning events without teaching Foundry their schema", () => {
    const message = parseFoundryComponentMessage({
      ...base,
      type: "LEARNING_EVENT",
      payload: { eventName: "particle_dragged", data: { particle: "A", x: 42 } },
    });
    expect(message.type).toBe("LEARNING_EVENT");
  });

  it("keeps Attempt payloads opaque to the transport contract", () => {
    const message = parseFoundryComponentMessage({
      ...base,
      type: "ATTEMPT_SUBMITTED",
      payload: { response: { ratio: "2:1" }, stateSnapshot: { step: 3 } },
    });
    expect(message.type).toBe("ATTEMPT_SUBMITTED");
  });

  it("rejects incompatible protocol versions", () => {
    expect(() => parseFoundryComponentMessage({
      ...base,
      protocolVersion: "9.0",
      type: "COMPONENT_READY",
      payload: { supportedProtocolVersions: ["9.0"] },
    })).toThrow();
  });
});
