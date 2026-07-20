import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/0006_diagnosis_capability_resolution.sql", "utf8");
const resolver = readFileSync("application/capability-resolution.ts", "utf8");

describe("CAP-02 Capability Resolution migration and honesty contract", () => {
  it("adds one bounded Class-B assertion without rewriting prior Product State", () => {
    expect(migration).toContain('CREATE TABLE "foundry_product"."capability_resolutions"');
    expect(migration).toContain("('foundry_product','capability_resolutions','TENANT_DIRECT_CLASS_B',true)");
    expect(migration).not.toMatch(/ALTER TABLE "foundry_product"\.(?:"capabilities"|"capability_versions"|"diagnostic_observations"|"context_compilations")/);
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
  });

  it("forces tenant scope, exact lineage, complete candidates and immutable replay", () => {
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('cap02_capability_resolution_lineage_guard');
    expect(migration).toContain("context.consumer='CAPABILITY_RESOLUTION'");
    expect(migration).toContain('observation.superseded_by_id IS NULL');
    expect(migration).toContain('candidate_count<>registry_count');
    expect(migration).toContain('distinct_rank_count<>candidate_count');
    expect(migration).toContain('candidate decision detail is incomplete');
    expect(migration).toContain("candidate->>'contentHash'=version.content_hash");
    expect(migration).toContain("capability.active_version_id=version.id AND version.status='ACTIVE'");
    expect(migration).toContain('cap02_capability_resolution_immutable');
    expect(migration).toContain('BEFORE UPDATE OR DELETE');
  });

  it("uses only canonical Context, Diagnosis and Registry objects and cannot execute assets", () => {
    expect(resolver).toContain('compileAuthorizedContext');
    expect(resolver).toContain('consumer: "CAPABILITY_RESOLUTION"');
    expect(resolver).toContain('diagnosticObservations');
    expect(resolver).toContain('capabilityVersions');
    expect(resolver).not.toMatch(/components|componentVersions|componentDeliveries|executePersistedCapability|RuntimeDelivery|ActivityPlan/);
  });
});
