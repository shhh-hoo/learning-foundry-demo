import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/0004_canonical_identity_context_evidence.sql", "utf8");
const rw02 = readFileSync("db/migrations/0003_production_auth_tenant_enforcement.sql", "utf8");
const newTables = [
  "learner_profiles",
  "learner_strategy_versions",
  "source_assets",
  "source_asset_versions",
  "source_processing_attempts",
  "evidence_derivatives",
  "context_items",
  "context_carryover_relations",
];

describe("RW-03 canonical identity, Context and Evidence migration contract", () => {
  it("adds exactly the bounded eight canonical objects to the accepted RW-02 inventories", () => {
    for (const table of newTables) {
      expect(migration).toContain(`CREATE TABLE "foundry_product"."${table}"`);
      expect(migration).toContain(`('foundry_product','${table}'`);
    }
    const rw02Authority = [...rw02.matchAll(/\('foundry_(?:product|operational)','[^']+','[^']+',(?:true|false)\)/g)];
    const rw03Authority = [...migration.matchAll(/\('foundry_product','[^']+','[^']+',true\)/g)];
    const rw02Writable = [...rw02.matchAll(/\('foundry_(?:product|operational)','[^']+',ARRAY\[[^\]]+\],/g)];
    const rw03Writable = [...migration.matchAll(/\('foundry_product','[^']+',ARRAY\[[^\]]+\],/g)];
    expect(rw02Authority).toHaveLength(39);
    expect(rw03Authority).toHaveLength(8);
    expect(rw02Writable).toHaveLength(29);
    expect(rw03Writable).toHaveLength(8);
  });

  it("backfills and then requires every legacy compatibility link", () => {
    for (const column of [
      '"learning_tasks" ALTER COLUMN "learner_profile_id" SET NOT NULL',
      '"source_records" ALTER COLUMN "source_asset_id" SET NOT NULL',
      '"source_records" ALTER COLUMN "source_asset_version_id" SET NOT NULL',
      '"file_assets" ALTER COLUMN "source_asset_id" SET NOT NULL',
      '"file_assets" ALTER COLUMN "source_asset_version_id" SET NOT NULL',
      '"evidence_units" ALTER COLUMN "source_asset_version_id" SET NOT NULL',
    ]) expect(migration).toContain(column);
    expect(migration).toContain("RW-03 preflight:");
    expect(migration).toContain("multiple FileAssets for one SourceRecord are ambiguous");
    expect(migration).toContain("RW-03 backfill:");
    expect(migration).toContain("version.storage_key IS DISTINCT FROM file.storage_key");
    expect(migration).toContain("rw03_compatibility_adapter");
    expect(migration).toContain("rw03_evidence_derivative_adapter");
  });

  it("enforces exact tenant and lineage boundaries without widening worker or auth authority", () => {
    expect(migration).toContain("assert_rw03_canonical_lineage");
    expect(migration).toContain("rw03_lifecycle_update_guard");
    expect(migration).toContain("ContextItem tenant lineage mismatch");
    expect(migration).toContain("ContextCarryover tenant lineage mismatch");
    expect(migration).toContain("SourceProcessingAttempt tenant lineage mismatch");
    expect(migration).not.toMatch(/GRANT .* TO foundry_worker/);
    expect(migration).not.toMatch(/GRANT .* TO foundry_auth_bootstrap/);
    for (const table of newTables) {
      expect(migration).toContain(`ALTER TABLE "foundry_product"."${table}" FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."${table}"`);
    }
  });

  it("keeps source versions, carryover and canonical provenance fail-closed", () => {
    expect(migration).toContain("source_asset_version_provenance_ck");
    expect(migration).toContain("evidence_derivative_provenance_ck");
    expect(migration).toContain("context_item_provenance_ck");
    expect(migration).toContain("context_carryover_cross_task_ck");
    expect(migration).toContain("source_processing_attempt_active_file_uq");
    expect(migration).toContain("source_asset_version_immutable_guard");
    expect(migration).toContain("context_carryover_immutable_guard");
  });
});
