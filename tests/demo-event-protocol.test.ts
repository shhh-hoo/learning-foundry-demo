import { describe, expect, it } from "vitest";
import {
  acceptDemoMessage,
  createDemoEvent,
  isDemoEvent,
} from "../src/demo/events";

describe("typed demo event protocol", () => {
  const event = createDemoEvent(
    "LEARNER_DIAGNOSIS_COMPLETED",
    "LEARNER",
    { stage: "FORMULA", failureCode: "WRONG_STOICHIOMETRIC_RATIO" },
    { eventId: "event-1", sessionId: "session-1", occurredAt: "2026-07-16T09:00:00.000Z" },
  );

  it("accepts only a validated event from the expected product frame and origin", () => {
    expect(isDemoEvent(event)).toBe(true);
    expect(
      acceptDemoMessage(
        { source: "learning-foundry-product", event },
        "http://127.0.0.1:4173",
        "http://127.0.0.1:4173",
        true,
      ),
    ).toEqual(event);

    expect(
      acceptDemoMessage(
        { source: "learning-foundry-product", event },
        "https://unknown.example",
        "http://127.0.0.1:4173",
        true,
      ),
    ).toBeNull();
    expect(
      acceptDemoMessage(
        { source: "learning-foundry-product", event },
        "http://127.0.0.1:4173",
        "http://127.0.0.1:4173",
        false,
      ),
    ).toBeNull();
    expect(isDemoEvent({ ...event, type: "UNKNOWN_EVENT" })).toBe(false);
    expect(isDemoEvent({ ...event, occurredAt: "not-a-date" })).toBe(false);
  });
});
