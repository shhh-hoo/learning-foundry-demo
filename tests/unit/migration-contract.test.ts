import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("fresh migration contract", () => {
  it("allows Drizzle to pre-create its migration schema", async () => {
    const migration = await readFile(new URL("../../db/migrations/0000_full_framework.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS "foundry_product";');
    expect(migration).not.toMatch(/CREATE EXTENSION IF NOT EXISTS "vector"|\bembedding\b/);
  });

  it("creates the operational schema idempotently", async () => {
    const migration = await readFile(new URL("../../db/migrations/0000_full_framework.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS "foundry_operational";');
    expect(migration).toContain('CREATE TABLE "foundry_operational"."workflow_runs"');
  });

  it("persists an explicit fail-closed Evidence rights status", async () => {
    const migration = await readFile(new URL("../../db/migrations/0000_full_framework.sql", import.meta.url), "utf8");
    expect(migration).toContain('"rights_authorization_status" text NOT NULL');
    expect(migration).toContain('CONSTRAINT "source_rights_authorization_ck"');
    expect(migration).toContain("IN ('APPROVED','REVIEW_REQUIRED','DENIED')");
  });

  it("uses one clean rewrite migration without fabricated Legacy provenance", async () => {
    const directory = new URL("../../db/migrations/", import.meta.url);
    const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql"));
    expect(migrations).toEqual(["0000_full_framework.sql"]);
    const migration = await readFile(new URL("../../db/migrations/0000_full_framework.sql", import.meta.url), "utf8");
    expect(migration).not.toMatch(/migrated-legacy-record|legacy-review|legacy-outcome|legacy-publication|HUMAN_COMMAND/);
    expect(migration).toContain('CREATE TRIGGER "retry_lineage_guard"');
    expect(migration).toContain('CREATE TRIGGER "publication_fail_closed_guard"');
    expect(migration).toContain('CREATE TRIGGER "published_component_version_immutable_guard"');
  });

  it("enforces one canonical TeacherReview per Observation", async () => {
    const migration = await readFile(new URL("../../db/migrations/0000_full_framework.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE UNIQUE INDEX "reviews_observation_uq" ON "foundry_product"."teacher_reviews" USING btree ("observation_id")');
    expect(migration).not.toContain('CREATE INDEX "reviews_observation_idx"');
  });
});
