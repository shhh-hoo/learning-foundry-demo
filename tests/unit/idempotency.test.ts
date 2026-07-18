import { describe, expect, it } from "vitest";
import { commandRequestHash } from "@/application/commands";

describe("idempotency request identity", () => {
  const actor = { userId: "00000000-0000-4000-8000-000000000001" };
  const otherActor = { userId: "00000000-0000-4000-8000-000000000002" };

  it("is stable across object key order and changes with command or body", () => {
    expect(commandRequestHash(actor, "CREATE_TASK", { title: "A", goal: "B" })).toBe(commandRequestHash(actor, "CREATE_TASK", { goal: "B", title: "A" }));
    expect(commandRequestHash(actor, "CREATE_TASK", { title: "A", goal: "B" })).not.toBe(commandRequestHash(actor, "CREATE_TASK", { title: "A", goal: "C" }));
    expect(commandRequestHash(actor, "CREATE_TASK", { title: "A" })).not.toBe(commandRequestHash(actor, "OTHER", { title: "A" }));
    expect(commandRequestHash(actor, "CREATE_TASK", { title: "A" })).not.toBe(commandRequestHash(otherActor, "CREATE_TASK", { title: "A" }));
  });
});
