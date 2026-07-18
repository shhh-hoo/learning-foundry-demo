import { eq } from "drizzle-orm";
import { compileContext } from "@/domain/context";
import type { ContextItem } from "@/domain/model";
import { getDb } from "@/db/client";
import { contextCompilations, conversationEvents } from "@/db/schema";
import type { Actor } from "@/domain/model";
import { requireTaskEpisodeScope } from "@/application/task-scope";

export async function compileAndPersistContext(actor: Actor, input: {
  taskId: string;
  episodeId: string;
  carryoverItems?: ContextItem[];
}) {
  await requireTaskEpisodeScope(actor, { taskId: input.taskId, episodeId: input.episodeId, learnerOriginated: true });
  const events = await getDb().select().from(conversationEvents).where(eq(conversationEvents.taskId, input.taskId)).orderBy(conversationEvents.createdAt).limit(30);
  const candidates: ContextItem[] = [
    ...events.map((event) => ({
      id: event.id,
      taskId: event.taskId,
      episodeId: event.episodeId,
      kind: "EVENT" as const,
      content: event.content,
      superseded: Boolean(event.supersedesEventId),
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
    selectedItems: compiled.selectedItems,
    excludedItems: compiled.excludedItems,
  });
  return compiled;
}
