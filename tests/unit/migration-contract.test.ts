import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("fresh migration contract", () => {
  it("allows Drizzle to pre-create its migration schema", async () => {
    const migration = await readFile(new URL("../../db/migrations/0000_full_framework.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS "foundry_product";');
    expect(migration).not.toContain('CREATE EXTENSION IF NOT EXISTS "vector"');
    expect(migration).toContain('"embedding" real[]');
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

  it("keeps the clean rewrite history and adds governed Asset Loop enforcement", async () => {
    const directory = new URL("../../db/migrations/", import.meta.url);
    const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql"));
    expect(migrations).toEqual(["0000_full_framework.sql", "0001_full_framework.sql", "0002_recoverable_resume_claims.sql", "0003_production_auth_tenant_enforcement.sql"]);
    const migration = await readFile(new URL("../../db/migrations/0000_full_framework.sql", import.meta.url), "utf8");
    const assetMigration = await readFile(new URL("../../db/migrations/0001_full_framework.sql", import.meta.url), "utf8");
    expect(migration).not.toMatch(/migrated-legacy-record|legacy-review|legacy-outcome|legacy-publication|HUMAN_COMMAND/);
    expect(migration).toContain('CREATE TRIGGER "retry_lineage_guard"');
    expect(migration).toContain('CREATE TRIGGER "published_component_version_immutable_guard"');
    expect(assetMigration).toContain('DROP TRIGGER IF EXISTS "publication_fail_closed_guard"');
    expect(assetMigration).toContain('CREATE TRIGGER "component_version_immutable_guard"');
    expect(assetMigration).toContain('CREATE TRIGGER "component_active_version_guard"');
    expect(assetMigration).toContain('CREATE TRIGGER "publication_decision_governance_guard"');
    expect(assetMigration).toContain('CREATE TRIGGER "publication_decision_immutable_guard"');
    expect(assetMigration).toContain("EXPERT_PUBLICATION_REVIEW_REQUIRED");
    expect(assetMigration).toMatch(/ADD COLUMN "source_review_ids" uuid\[\];[\s\S]*JOIN LATERAL[\s\S]*teacher_reviews[\s\S]*ALTER COLUMN "source_review_ids" SET NOT NULL/);
    expect(assetMigration).toContain("PRE_EVAL_DRAFT_QUARANTINED");
    expect(assetMigration).toContain("Component versions must begin as governed Drafts");
    expect(assetMigration).toContain("Components must begin as governed Candidates without an active version");
  });

  it("adds forward-compatible recoverable resume claims without rewriting prior migrations", async () => {
    const migration = await readFile(new URL("../../db/migrations/0002_recoverable_resume_claims.sql", import.meta.url), "utf8");
    expect(migration).toContain('ADD COLUMN "resume_claim_token" text');
    expect(migration).toContain('ADD COLUMN "resume_claim_version" integer DEFAULT 0 NOT NULL');
    expect(migration).toContain('ADD COLUMN "resume_lease_expires_at" timestamp with time zone');
    expect(migration).toContain("'legacy:' || \"id\"::text");
    expect(migration).toContain('workflow_resume_claim_integrity_ck');
    expect(migration).toContain('workflow_runs_resume_lease_idx');
  });

  it("enforces one canonical TeacherReview per Observation", async () => {
    const migration = await readFile(new URL("../../db/migrations/0000_full_framework.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE UNIQUE INDEX "reviews_observation_uq" ON "foundry_product"."teacher_reviews" USING btree ("observation_id")');
    expect(migration).not.toContain('CREATE INDEX "reviews_observation_idx"');
  });

  it("persists file ownership, extraction, embeddings, model calls and their lineage guards", async () => {
    const migration = await readFile(new URL("../../db/migrations/0000_full_framework.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE TABLE "foundry_product"."file_assets"');
    expect(migration).toContain('CREATE TABLE "foundry_operational"."model_runs"');
    expect(migration).toContain('CREATE TRIGGER "source_scope_guard"');
    expect(migration).toContain('CREATE TRIGGER "file_asset_lineage_guard"');
    expect(migration).toContain("attempt file lineage mismatch");
    expect(migration).toContain('"tokenizer" text NOT NULL');
    expect(migration).toContain('"selected_token_count" integer NOT NULL');
  });
});
