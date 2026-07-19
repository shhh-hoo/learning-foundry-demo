import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getCheckpointDatabaseUrl } from "@/db/client";
import { RUNTIME_DATABASE_ROLES, withPostgresStartupSettings, withRuntimeDatabaseRole } from "@/db/database-config";

const savers = new Map<string, PostgresSaver>();

export function getWorkflowCheckpointer(institutionId?: string): PostgresSaver {
  if (process.env.NODE_ENV === "production" && !institutionId) {
    throw new Error("Production checkpoint access requires an institution scope");
  }
  const key = institutionId ?? "local-unscoped";
  const existing = savers.get(key);
  if (existing) return existing;
  const roleScoped = withRuntimeDatabaseRole(getCheckpointDatabaseUrl(), RUNTIME_DATABASE_ROLES.checkpoint);
  const connection = institutionId
    ? withPostgresStartupSettings(roleScoped, { "foundry.institution_id": institutionId })
    : roleScoped;
  const saver = PostgresSaver.fromConnString(connection, { schema: "langgraph_checkpoint" });
  savers.set(key, saver);
  return saver;
}

export async function closeWorkflowCheckpointer(): Promise<void> {
  await Promise.all([...savers.values()].map((saver) => saver.end()));
  savers.clear();
}
