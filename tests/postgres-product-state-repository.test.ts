import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PostgresProductStateRepository } from "../src/product-state/postgres-product-state-repository";

function snapshotPool(rowsFor: (sql: string) => readonly Record<string, unknown>[]) {
  const queries: string[] = [];
  let releases = 0;
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      const rows = rowsFor(sql);
      return { rows, rowCount: rows.length };
    },
    release: () => { releases += 1; },
  };
  const pool = {
    connect: async () => client,
    query: async () => { throw new Error("snapshot reads must not escape to pool.query"); },
  } as unknown as Pool;
  return { pool, queries, releases: () => releases };
}

describe("Postgres Product State read snapshots", () => {
  it("loads an Observation and its correction chain on one repeatable-read client", async () => {
    const fixture = snapshotPool((sql) => {
      if (sql.includes("diagnostic_observation WHERE id")) {
        return [{
          id: "observation-snapshot",
          attempt_id: "attempt-snapshot",
          status: "ACTIVE",
          created_at: "2026-07-18T10:00:00.000Z",
          source_refs: [],
          evidence_refs: [],
          provenance: { executionId: "execution", policyVersion: "1.0.0" },
          diagnosis_payload: {
            representationVersion: "1.0.0",
            derivedAt: "2026-07-18T10:00:00.000Z",
            derivation: { kind: "DETERMINISTIC", implementationId: "test", implementationVersion: "1.0.0", sourceRecordIds: ["attempt-snapshot"] },
            value: {},
          },
        }];
      }
      return [];
    });
    const repository = new PostgresProductStateRepository(fixture.pool);

    await expect(repository.getObservation("observation-snapshot")).resolves.toMatchObject({
      id: "observation-snapshot",
      corrections: [],
    });
    expect(fixture.queries[0]).toBe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(fixture.queries).toContain("COMMIT");
    expect(fixture.queries.some((sql) => sql.includes("observation_correction"))).toBe(true);
    expect(fixture.releases()).toBe(1);
  });

  it("loads the complete LearningLoop projection on one repeatable-read client", async () => {
    const fixture = snapshotPool((sql) => sql.includes("learning_task WHERE id")
      ? [{
          id: "task-snapshot",
          learner_id: "learner-snapshot",
          status: "ACTIVE",
          goal: "Consistent projection",
          created_at: "2026-07-18T10:00:00.000Z",
          updated_at: "2026-07-18T10:00:00.000Z",
          material_refs: [],
        }]
      : []);
    const repository = new PostgresProductStateRepository(fixture.pool);

    await expect(repository.getLearningLoop("task-snapshot")).resolves.toMatchObject({
      task: { id: "task-snapshot" },
      episodes: [],
      conversationEvents: [],
      attempts: [],
      observations: [],
      reviews: [],
      retries: [],
      outcomes: [],
    });
    expect(fixture.queries[0]).toBe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(fixture.queries.at(-1)).toBe("COMMIT");
    expect(fixture.queries.filter((sql) => sql.startsWith("SELECT"))).toHaveLength(9);
    expect(fixture.releases()).toBe(1);
  });
});
