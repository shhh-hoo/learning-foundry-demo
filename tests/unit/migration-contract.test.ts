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
    expect(migrations).toEqual(["0000_full_framework.sql", "0001_full_framework.sql", "0002_recoverable_resume_claims.sql", "0003_production_auth_tenant_enforcement.sql", "0004_canonical_identity_context_evidence.sql", "0005_authoritative_context_compiler.sql", "0006_diagnosis_capability_resolution.sql"]);
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

  it("upgrades Context snapshots additively and preserves historical rows", async () => {
    const migration = await readFile(new URL("../../db/migrations/0005_authoritative_context_compiler.sql", import.meta.url), "utf8");
    expect(migration).toContain('ADD COLUMN "input_hash" text');
    expect(migration).toContain('ADD COLUMN "snapshot_hash" text');
    expect(migration).toContain("'LEGACY_COMPATIBILITY'");
    expect(migration).toContain('"candidate_items" = "selected_items" || "excluded_items"');
    expect(migration).toContain('CREATE UNIQUE INDEX "context_compilation_replay_uq"');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "foundry_private"."context_items_in_tenant"');
    expect(migration).toContain("WHEN 'CONTEXT_ITEM'");
    expect(migration).toContain("WHEN 'CONTEXT_CARRYOVER_RELATION'");
    expect(migration).toContain("WHEN 'SOURCE_ASSET_VERSION'");
    expect(migration).toContain("WHEN 'EVIDENCE_DERIVATIVE'");
    expect(migration).toContain("item->>'kind' IN ('EVENT','ATTEMPT')");
    expect(migration).toContain('CREATE TRIGGER "cap01_context_compilation_lineage_guard"');
    expect(migration).toContain('NOT foundry_private.context_items_in_tenant(NEW.candidate_items,tenant_id)');
    expect(migration).toContain("NOT foundry_private.uuid_array_in_tenant(NEW.referenced_prior_task_ids,'TASK',tenant_id)");
    expect(migration).toContain('candidate decisions are incomplete or duplicated');
    expect(migration).toContain('CREATE TRIGGER "cap01_context_snapshot_immutable"');
    expect(migration).toContain('BEFORE UPDATE ON "foundry_product"."context_compilations"');
    expect(migration).not.toContain('BEFORE UPDATE OR DELETE ON "foundry_product"."context_compilations"');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
  });

  it("adds immutable tenant-scoped CAP-02 resolution assertions without rewriting Registry, Diagnosis or Context", async () => {
    const migration = await readFile(new URL("../../db/migrations/0006_diagnosis_capability_resolution.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE TABLE "foundry_product"."capability_resolutions"');
    expect(migration).toContain('CREATE UNIQUE INDEX "capability_resolution_replay_uq"');
    expect(migration).toContain('cap02_capability_resolution_lineage_guard');
    expect(migration).toContain('candidate set is incomplete, duplicated or stale');
    expect(migration).toContain('selected CapabilityVersion is not the eligible active exact version');
    expect(migration).toContain('cap02_capability_resolution_immutable');
    expect(migration).not.toMatch(/ALTER TABLE "foundry_product"\.(?:"capabilities"|"capability_versions"|"diagnostic_observations"|"context_compilations")/);
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
    const rehearsal = await readFile(new URL("../../scripts/test-cap02-resolution-upgrade.ts", import.meta.url), "utf8");
    expect(rehearsal).toContain('exactBaseMigrations: "0000-0005"');
    expect(rehearsal).toContain('legacyContractFailedClosed: true');
    expect(rehearsal).toContain('immutableRewriteDenied: true');
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
