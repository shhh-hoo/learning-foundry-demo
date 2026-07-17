import type { AgentRunRequest } from "../types";
import type { ContextExclusionReason, ContextSelectionDecision } from "./execution-plan";
import { immutablePlan } from "./execution-plan";

/** Foundry-owned Context selection. It records indexes, never message content. */
export class ContextCompiler {
  compile(request: AgentRunRequest): ContextSelectionDecision {
    const candidateMessageIndexes = request.messages.map((_, index) => index);
    let latestUserIndex = -1;
    for (let index = request.messages.length - 1; index >= 0; index -= 1) {
      if (request.messages[index]?.role === "user") { latestUserIndex = index; break; }
    }
    const excludedContextItems: { messageIndex: number; reason: ContextExclusionReason }[] = [];
    for (const messageIndex of candidateMessageIndexes) {
      const metadata = request.messages[messageIndex]?.context;
      if (metadata?.lifecycle === "STALE") excludedContextItems.push({ messageIndex, reason: "STALE" });
      else if (metadata?.lifecycle === "SUPERSEDED") excludedContextItems.push({ messageIndex, reason: "SUPERSEDED" });
      else if (request.activeTaskId && metadata?.taskId && metadata.taskId !== request.activeTaskId) excludedContextItems.push({ messageIndex, reason: "OTHER_TASK" });
    }
    const excludedIndexes = new Set(excludedContextItems.map((item) => item.messageIndex));
    const selectedMessageIndexes = candidateMessageIndexes.filter((index) => !excludedIndexes.has(index));
    const selectionReasons = selectedMessageIndexes.map((messageIndex) => ({
      messageIndex,
      reason: messageIndex === latestUserIndex ? "CURRENT_REQUEST" as const : "TASK_LOCAL_HISTORY" as const,
    }));
    return immutablePlan({
      schemaVersion: "1.0.0" as const,
      candidateMessageIndexes,
      selectedMessageIndexes,
      excludedContextItems,
      selectionReasons,
      contextPolicyVersion: "1.0.0" as const,
      ...(request.activeTaskId ? { activeTaskId: request.activeTaskId } : {}),
      ...(request.activeEpisodeId ? { activeEpisodeId: request.activeEpisodeId } : {}),
    });
  }
}
