import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getCheckpointDatabaseUrl } from "@/db/client";

let saver: PostgresSaver | null = null;

export function getWorkflowCheckpointer(): PostgresSaver {
  if (!saver) saver = PostgresSaver.fromConnString(getCheckpointDatabaseUrl(), { schema: "langgraph_checkpoint" });
  return saver;
}

export async function closeWorkflowCheckpointer(): Promise<void> {
  if (saver) await saver.end();
  saver = null;
}
