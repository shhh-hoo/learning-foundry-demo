import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { getActor } from "@/application/actor";
import { getEngineeringWorkspace } from "@/application/queries";
import { closeDb, getCheckpointMigrationDatabaseUrl } from "@/db/client";
import { SEED } from "@/db/ids";
import { closeWorkflowCheckpointer } from "@/workflows/checkpointer";

describe.sequential("tenant-scoped Engineering checkpoint inspection", () => {
  afterAll(async () => {
    await closeWorkflowCheckpointer();
    await closeDb();
  });

  it("counts only the active institution through the checkpoint runtime role", async () => {
    const owner = postgres(getCheckpointMigrationDatabaseUrl(), { max: 1, prepare: false });
    const institutionB = randomUUID();
    const checkpointA = randomUUID();
    const checkpointB = randomUUID();
    try {
      await owner`
        INSERT INTO langgraph_checkpoint.checkpoints
          (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)
        VALUES
          (${`${SEED.institution}:inspection:${checkpointA}`}, '', ${checkpointA}, '{}'::jsonb, '{}'::jsonb),
          (${`${institutionB}:inspection:${checkpointB}`}, '', ${checkpointB}, '{}'::jsonb, '{}'::jsonb)
      `;
      const [expected] = await owner<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM langgraph_checkpoint.checkpoints
        WHERE thread_id LIKE ${`${SEED.institution}:%`}
      `;
      const engineer = await getActor(SEED.engineer, SEED.institution, "integration-test", `engineering:${randomUUID()}`);
      const workspace = await getEngineeringWorkspace(engineer);
      const checkpointCount = workspace.checkpointCounts.find((row) => row.table_name === "checkpoints");
      expect(checkpointCount?.count).toBe(expected.count);
      expect(expected.count).toBeGreaterThan(0);
    } finally {
      await owner`DELETE FROM langgraph_checkpoint.checkpoints WHERE checkpoint_id IN (${checkpointA}, ${checkpointB})`;
      await owner.end();
    }
  });
});
