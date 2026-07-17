import { describe, expect, it } from "vitest";
import { ContextCompiler } from "../src/agent/control-plane/context-compiler";
import { ExecutionPlanner } from "../src/agent/control-plane/execution-planner";
import type { AgentRunRequest } from "../src/agent/types";

const request = (messages: AgentRunRequest["messages"]): AgentRunRequest => ({
  conversationId: "task-conversation",
  inputOrigin: "USER_INPUT",
  runPurpose: "PRODUCT",
  messages,
});

describe("Foundry Control Plane", () => {
  it("compiles a message-index decision and never copies message content into the Execution Plan", () => {
    const input = request([
      { role: "user", content: "Earlier task-local question" },
      { role: "assistant", content: "Earlier task-local answer" },
      { role: "user", content: "Why does this relationship hold?" },
    ]);
    const context = new ContextCompiler().compile(input);
    const plan = new ExecutionPlanner().plan(input, context);

    expect(context).toEqual({
      schemaVersion: "1.0.0",
      candidateMessageIndexes: [0, 1, 2],
      selectedMessageIndexes: [0, 1, 2],
      excludedContextItems: [],
      selectionReasons: [
        { messageIndex: 0, reason: "TASK_LOCAL_HISTORY" },
        { messageIndex: 1, reason: "TASK_LOCAL_HISTORY" },
        { messageIndex: 2, reason: "CURRENT_REQUEST" },
      ],
      contextPolicyVersion: "1.0.0",
    });
    expect(plan.schemaVersion).toBe("1.0.0");
    expect(plan.intent).toBe("OPEN_EXPLANATION");
    expect(plan.execution.mode).toBe("BOUNDED_AGENT");
    expect(plan.contextSelection).toEqual(context);
    expect(JSON.stringify(plan)).not.toContain("Earlier task-local question");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.toolPolicy.maximumCallsPerTool)).toBe(true);
  });

  it("excludes stale, superseded and other-Task Context before model execution", () => {
    const input: AgentRunRequest = {
      ...request([]),
      activeTaskId: "task-b",
      activeEpisodeId: "episode-b",
      messages: [
        { role: "user", content: "other task", context: { taskId: "task-a", lifecycle: "ACTIVE" } },
        { role: "assistant", content: "stale", context: { taskId: "task-b", lifecycle: "STALE" } },
        { role: "assistant", content: "corrected", context: { taskId: "task-b", lifecycle: "SUPERSEDED" } },
        { role: "user", content: "current request", context: { taskId: "task-b", episodeId: "episode-b", lifecycle: "ACTIVE" } },
      ],
    };

    expect(new ContextCompiler().compile(input)).toMatchObject({
      activeTaskId: "task-b",
      activeEpisodeId: "episode-b",
      selectedMessageIndexes: [3],
      excludedContextItems: [
        { messageIndex: 0, reason: "OTHER_TASK" },
        { messageIndex: 1, reason: "STALE" },
        { messageIndex: 2, reason: "SUPERSEDED" },
      ],
    });
  });
});
