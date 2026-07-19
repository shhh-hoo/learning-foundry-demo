import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getCheckpointDatabaseUrl } from "@/db/client";

const checkpointer = PostgresSaver.fromConnString(getCheckpointDatabaseUrl(), {
  schema: "langgraph_checkpoint",
});

await checkpointer.setup();
await checkpointer.end();
console.log("LangGraph checkpoint migrations applied to langgraph_checkpoint.");
