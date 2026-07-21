import { readFile, readdir } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { componentAssetPreviews, componentEvaluations } from "@/db/schema";

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
    expect(migrations).toEqual(["0000_full_framework.sql", "0001_full_framework.sql", "0002_recoverable_resume_claims.sql", "0003_production_auth_tenant_enforcement.sql", "0004_canonical_identity_context_evidence.sql", "0005_authoritative_context_compiler.sql", "0006_diagnosis_capability_resolution.sql", "0007_activity_planning.sql", "0008_asset_stage_runtime.sql", "0009_teacher_assignment_intervention.sql", "0010_governed_followup.sql", "0011_capability_gap_supply.sql"]);
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

  it("adds bounded CAP-07 gap supply without generic CMS or automatic human authority", async () => {
    const migration = await readFile(new URL("../../db/migrations/0011_capability_gap_supply.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE TABLE "foundry_product"."component_asset_previews"');
    expect(migration).toContain('CREATE TABLE "foundry_product"."capability_availability_decisions"');
    expect(migration).toContain('"component_asset_version_id" uuid REFERENCES "foundry_product"."component_versions"');
    expect(migration).toContain("Web ComponentAsset confirmation requires exact authenticated checks-bound learner preview");
    expect(migration).toContain("Tenant-private CapabilityVersion exact ComponentAsset lineage mismatch");
    expect(migration).toContain('CREATE TRIGGER "0_cap07_source_freshness_lock" BEFORE INSERT ON foundry_product.capability_resolutions');
    expect(migration).toContain('CREATE TRIGGER "0_cap07_source_freshness_lock" BEFORE INSERT ON foundry_product.activity_plan_proposals');
    expect(migration).toContain("lock_cap07_publication_source");
    expect(migration).toContain("CREATE ROLE foundry_component_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS");
    expect(migration).toContain("Web ComponentAsset evaluation requires the dedicated trusted executor identity");
    expect(migration).toContain("Web ComponentAsset preview requires the dedicated trusted executor identity");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION foundry_private.assert_component_evaluation_tenant_lineage()");
    expect(migration).toContain("executor_command:=TG_OP='INSERT' AND COALESCE(current_setting('foundry.executor_purpose',true),'')='WEB_COMPONENT_EVALUATION'");
    expect(migration).toContain('DROP TRIGGER IF EXISTS "_authority_tenant_lineage_guard" ON foundry_product.component_evaluations');
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION foundry_product.record_web_component_evaluation(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb) TO foundry_component_executor");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION foundry_product.record_component_asset_preview(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text) TO foundry_component_executor");
    expect(migration).not.toContain("GRANT EXECUTE ON FUNCTION foundry_product.record_web_component_evaluation(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb) TO foundry_product_runtime");
    expect(migration).not.toContain("GRANT EXECUTE ON FUNCTION foundry_product.record_component_asset_preview(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text) TO foundry_product_runtime");
    expect(migration).toContain('c.id="capability_versions"."capability_id"');
    expect(migration).toContain('v.id="component_asset_previews"."component_version_id"');
    expect(migration).not.toContain('GRANT UPDATE ON "foundry_product"."capability_resolutions"');
    expect(migration).not.toContain('GRANT UPDATE ON "foundry_product"."activity_plan_proposals"');
    expect(migration).toContain("INSTITUTION_COURSE_PRIVATE");
    expect(migration).not.toMatch(/CREATE TABLE[^;]*(cms|page|article|content_entries)/i);
    expect(migration).not.toMatch(/INSERT INTO\s+"foundry_product"\."(teacher_reviews|learning_outcomes)"/i);
    const rehearsal = await readFile(new URL("../../scripts/test-cap07-upgrade.ts", import.meta.url), "utf8");
    expect(rehearsal).toContain("CAP07_UPGRADE_VERIFIED");
    expect(rehearsal).toContain("preservedGlobalRegistryVersion");
  });

  it("binds a preview to its evaluation without making evaluations self-referential", async () => {
    const evaluationConfig = getTableConfig(componentEvaluations);
    const previewConfig = getTableConfig(componentAssetPreviews);
    expect(evaluationConfig.columns.map((column) => column.name)).not.toContain("component_evaluation_id");
    expect(previewConfig.columns.find((column) => column.name === "component_evaluation_id")?.notNull).toBe(true);
    expect(previewConfig.foreignKeys.some((foreignKey) => {
      const reference = foreignKey.reference();
      return reference.columns.map((column) => column.name).join(",") === "component_evaluation_id"
        && getTableConfig(reference.foreignTable).name === "component_evaluations"
        && reference.foreignColumns.map((column) => column.name).join(",") === "id";
    })).toBe(true);

    const migration = await readFile(new URL("../../db/migrations/0011_capability_gap_supply.sql", import.meta.url), "utf8");
    const previewTable = migration.match(/CREATE TABLE "foundry_product"\."component_asset_previews" \(([\s\S]*?)\n\);/)?.[1];
    expect(previewTable).toContain('"component_evaluation_id" uuid NOT NULL REFERENCES "foundry_product"."component_evaluations"("id")');
    expect(migration).not.toMatch(/ALTER TABLE "foundry_product"\."component_evaluations" ADD COLUMN "component_evaluation_id"/);
  });

  it("adds a typed, forward-only CAP-06 follow-up envelope without creating Outcome authority", async () => {
    const migration = await readFile(new URL("../../db/migrations/0010_governed_followup.sql", import.meta.url), "utf8");
    expect(migration).toContain("Governed follow-up status transition is not forward-authorized");
    expect(migration).toContain("Cancellation fact is immutable");
    expect(migration).toContain("Failure fact can be replaced only by a new governed failure transition");
    expect(migration).toContain("(NEW.cancellation_state->>'recordedAt')::timestamptz<>(transition.payload->>'recordedAt')::timestamptz");
    expect(migration).toContain("(NEW.failure_state->>'recordedAt')::timestamptz<>(transition.payload->>'recordedAt')::timestamptz");
    expect(migration).toContain("Transfer changedDimensions must be the exact database-recomputed material difference");
    expect(migration).toContain("NEW.due_at>=activity.assigned_at+(NEW.declared_delay_seconds * interval '1 second')");
    expect(migration).toContain("NEW.created_at=activity.assigned_at");
    expect(migration).toContain("GovernanceEvents cannot be deleted");
    expect(migration).toContain("GovernanceEvents are append-only");
    expect(migration).toContain('CREATE TRIGGER "cap06_episode_identity_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learning_episodes"');
    expect(migration).toContain("Governed Episode predecessor must belong to the same Task");
    expect(migration).toContain("Episode Task, sequence, purpose and predecessor are immutable");
    expect(migration).toContain('CREATE TRIGGER "cap06_task_close_guard" BEFORE UPDATE ON "foundry_product"."learning_tasks"');
    expect(migration).toContain("Learning Task cannot close while a governed follow-up is active");
    expect(migration).toContain("A terminal Learning Task cannot be reopened");
    expect(migration).toContain("A GENERAL Episode cannot be added while a governed follow-up is active");
    expect(migration).toContain("Governed Episode must be atomically aligned with its exact follow-up activity");
    expect(migration).toContain("Governed follow-up GovernanceEvent must be consumed by exact Product State in the same transaction");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "foundry_private"."cap06_transition_actor_authorized"');
    expect(migration).toContain("Governed follow-up transition actor lacks learner or course-teacher authority");
    expect(migration).toContain("Legacy retry rows cannot acquire CAP-06 authority columns");
    expect(migration).toContain("activity.idempotency_key IS NOT NULL AND activity.activity_type=episode.purpose AND activity.status='IN_PROGRESS'");
    expect(migration).toContain("plan.id=p_activity_plan_id AND plan.id=delivery.activity_plan_id");
    expect(migration).toContain("activity.activity_plan_proposal_id=plan.activity_plan_proposal_id");
    expect(migration).toContain("activity.learner_id=NULLIF(current_setting('foundry.user_id',true),'')::uuid");
    expect(migration).toContain("position('LEARNER' in COALESCE(current_setting('foundry.roles',true),''))>0");
    expect(migration).toContain("delivery.learner_id=activity.learner_id");
    expect(migration).toContain("plan.task_id=task.id AND plan.episode_id=episode.id");
    expect(migration).toContain('ADD COLUMN "completed_intervening_exposure" jsonb');
    expect(migration).toContain('ADD COLUMN "exposure_confirmed_at" timestamp with time zone');
    expect(migration).toContain('ADD COLUMN "exposure_confirmed_by" uuid');
    expect(migration).toContain("Retention declaration is immutable and actual exposure confirmation is set-once");
    expect(migration).toContain("Legacy Transfer rows cannot acquire CAP-06 declaration authority");
    expect(migration).toContain("Legacy Retention rows cannot acquire CAP-06 declaration authority");
    expect(migration).toContain("Retention cannot begin before its persisted dueAt");
    expect(migration).toContain("delivery.started_at>=activity.scheduled_for");
    expect(migration).toContain("normalize(NEW.declaration->'source'->>dimension,NFKC)");
    expect(migration).toContain("NEW.exposure_confirmed_at=NEW.completed_at AND NEW.exposure_confirmed_by=actor_id");
    expect(migration).toContain('CREATE TRIGGER "cap06_learner_write_scope_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."conversation_events"');
    expect(migration).toContain('CREATE TRIGGER "cap06_learner_write_scope_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learner_attempts"');
    expect(migration).toContain('CREATE TRIGGER "cap06_learner_write_scope_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."file_assets"');
    expect(migration).toContain("Learner write Task and Episode scope are immutable");
    expect(migration).toContain("ConversationEvents are append-only; corrections require supersedes_event_id");
    expect(migration).toContain("LearnerAttempt evidence is immutable");
    expect(migration).toContain("FileAsset identity and Task scope are immutable");
    expect(migration).toContain("Execution lineage may change only with its governed status transition");
    expect(migration).toContain("CAP-06 governed follow-ups cannot create LearningOutcome");
    expect(migration).toContain("LEGACY_RETRY_OUTCOME_RETIRED");
    expect(migration).toContain("LEGACY_UNVERIFIED");
    expect(migration).toContain("CAP-06 Transfer requires exactly its CAP06_V1 declaration and no Retention declaration");
    expect(migration).toContain("CAP-06 Retention requires exactly its CAP06_V1 declaration and no Transfer declaration");
    expect(migration).toContain("Governed follow-up idempotency reservation does not match actor/tenant/request/result identity");
    expect(migration).toContain("Governed follow-up reservation must resolve to its exact governed activity at commit");
    expect(migration).toContain("Terminal governed follow-up requires exact ContextItem invalidation provenance/reason/time");
    expect(migration).toContain("Governed result TeacherReview author/provenance/transition/current course authority mismatch");
    expect(migration).toContain("activity.status='REVIEWED' AND review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')");
    expect(migration).toContain("activity.status='ESCALATED' AND review.decision='ESCALATE'");
    expect(migration).not.toMatch(/INSERT INTO\s+"foundry_product"\."learning_outcomes"/i);
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

  it("adds immutable Class-B CAP-03 planning without creating runtime or rewriting prior Product State", async () => {
    const migration = await readFile(new URL("../../db/migrations/0007_activity_planning.sql", import.meta.url), "utf8");
    expect(migration).toContain('CREATE TABLE "foundry_product"."activity_plan_proposals"');
    expect(migration).toContain("TENANT_DIRECT_CLASS_B");
    expect(migration).toContain("cap03_activity_plan_lineage_guard");
    expect(migration).toContain("READY plan does not pin the eligible active exact version");
    expect(migration).toContain("cap03_activity_plan_immutable");
    expect(migration).not.toMatch(/CREATE TABLE[^;]*(runtime_deliveries|learning_events)/i);
    expect(migration).not.toMatch(/ALTER TABLE "foundry_product"\."(capability_resolutions|context_compilations|diagnostic_observations|capability_versions)"/);
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
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
