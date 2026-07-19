import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getCheckpointMigrationDatabaseUrl } from "@/db/client";
import { applyCheckpointSecurity } from "@/db/checkpoint-security";

const databaseUrl = getCheckpointMigrationDatabaseUrl();
const checkpointer = PostgresSaver.fromConnString(databaseUrl, {
  schema: "langgraph_checkpoint",
});

await checkpointer.setup();
await checkpointer.end();
await applyCheckpointSecurity(databaseUrl);
console.log("LangGraph checkpoint migrations and tenant policies applied to langgraph_checkpoint.");
