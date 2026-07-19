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

  it("binds ConversationEvent replay identity to actor, command, and exact payload", () => {
    const event = { taskId: "task-1", episodeId: "episode-1", actorType: "LEARNER", kind: "MESSAGE", content: "same", sourceRefs: [], evidenceRefs: [] };
    const hash = commandRequestHash(actor, "APPEND_CONVERSATION_EVENT", event);
    expect(commandRequestHash(actor, "APPEND_CONVERSATION_EVENT", { ...event, evidenceRefs: [], sourceRefs: [] })).toBe(hash);
    expect(commandRequestHash(actor, "APPEND_CONVERSATION_EVENT", { ...event, content: "changed" })).not.toBe(hash);
    expect(commandRequestHash(otherActor, "APPEND_CONVERSATION_EVENT", event)).not.toBe(hash);
    expect(commandRequestHash(actor, "OTHER_EVENT_COMMAND", event)).not.toBe(hash);
  });
});
