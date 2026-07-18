import type { AgentRunRequest } from "../types";
import type { ContextExclusionReason, ContextSelectionDecision } from "./execution-plan";
import { immutablePlan } from "./execution-plan";

/**
 * Bootstrap Context policy: lifecycle/task filtering only.
 *
 * It deliberately does not claim semantic relevance, Topic-shift detection or
 * token-budget selection. Those require canonical Context Items and a later
 * governed policy. The compatibility export below retains the contract name
 * while traces identify this narrower policy honestly.
 */
export class TaskLocalContextFilterV1 {
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
      contextPolicyId: "TASK_LOCAL_CONTEXT_FILTER" as const,
      semanticRelevance: "NOT_IMPLEMENTED" as const,
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

export { TaskLocalContextFilterV1 as ContextCompiler };
