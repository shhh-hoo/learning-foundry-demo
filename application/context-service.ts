import { desc, eq } from "drizzle-orm";
import { compileContext } from "@/domain/context";
import type { ContextItem } from "@/domain/model";
import { getDb } from "@/db/client";
import { contextCompilations, conversationEvents, learnerAttempts } from "@/db/schema";
import type { Actor } from "@/domain/model";
import { requireTaskEpisodeScope } from "@/application/task-scope";

type ContextConversationEvent = Pick<typeof conversationEvents.$inferSelect, "id" | "taskId" | "episodeId" | "content" | "supersedesEventId">;

export function contextItemsFromConversationEvents(events: ContextConversationEvent[]): ContextItem[] {
  const supersededEventIds = new Set(events.flatMap((event) => event.supersedesEventId ? [event.supersedesEventId] : []));
  return events.map((event) => ({
    id: event.id,
    taskId: event.taskId,
    episodeId: event.episodeId,
    kind: "EVENT" as const,
    content: event.content,
    modality: "TEXT" as const,
    superseded: supersededEventIds.has(event.id),
  }));
}

export async function compileAndPersistContext(actor: Actor, input: {
  taskId: string;
  episodeId: string;
  carryoverItems?: ContextItem[];
}) {
  await requireTaskEpisodeScope(actor, { taskId: input.taskId, episodeId: input.episodeId, learnerOriginated: true });
  const events = await getDb().select().from(conversationEvents).where(eq(conversationEvents.taskId, input.taskId)).orderBy(desc(conversationEvents.createdAt)).limit(30);
  const attempts = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.taskId, input.taskId)).orderBy(desc(learnerAttempts.createdAt)).limit(10);
  const candidates: ContextItem[] = [
    ...contextItemsFromConversationEvents(events),
    ...attempts.map((attempt) => ({
      id: attempt.id,
      taskId: attempt.taskId,
      episodeId: attempt.episodeId,
      kind: "ATTEMPT" as const,
      content: attempt.response,
      modality: attempt.fileAssetId ? "IMAGE" as const : "TEXT" as const,
    })),
    ...(input.carryoverItems ?? []),
  ];
  const compiled = compileContext({ activeTaskId: input.taskId, activeEpisodeId: input.episodeId, candidates });
  await getDb().insert(contextCompilations).values({
    id: compiled.id,
    taskId: compiled.activeTaskId,
    episodeId: compiled.activeEpisodeId,
    compilerVersion: compiled.compilerVersion,
    tokenBudget: compiled.tokenBudget,
    modalityBudget: compiled.modalityBudget,
    tokenizer: compiled.tokenizer,
    selectedTokenCount: compiled.selectedTokenCount,
    modalityUsage: compiled.modalityUsage,
    selectedItems: compiled.selectedItems,
    excludedItems: compiled.excludedItems,
  });
  return compiled;
}
