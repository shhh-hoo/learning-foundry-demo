import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CAP-04 schema and responsibility boundary", () => {
  const migration = readFileSync("db/migrations/0008_asset_stage_runtime.sql", "utf8");
  const runtime = readFileSync("application/asset-runtime.ts", "utf8");
  const adapter = readFileSync("reference-packs/capability-runtime.ts", "utf8");

  it("adds canonical exact-lineage runtime facts with database tenant enforcement", () => {
    expect(migration).toContain('CREATE TABLE "foundry_product"."activity_plans"');
    expect(migration).toContain('CREATE TABLE "foundry_product"."runtime_deliveries"');
    expect(migration).toContain('CREATE TABLE "foundry_product"."learning_events"');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CAP-04 ActivityPlan exact READY lineage mismatch');
    expect(migration).toContain('RuntimeDelivery ActivityPlan/exact-version lineage mismatch');
    expect(migration).toContain('Runtime-linked LearnerAttempt lineage mismatch');
    expect(migration).toContain('LearningEvent delivery/actor lineage mismatch');
    expect(migration).toContain('RuntimeDelivery terminal state is immutable');
    expect(migration).toContain('CAP-04 ActivityPlan role denied');
    expect(migration).toContain('"learning_event_actor_ck"');
  });

  it("executes only the current READY exact Registry contract through an explicit adapter", () => {
    expect(runtime).toContain('lineage.proposal.state !== "READY"');
    expect(runtime).toContain('ASSET_RUNTIME_PLAN_STALE');
    expect(runtime).toContain('ASSET_RUNTIME_CONTRACT_CHANGED');
    expect(runtime).toContain('ASSET_RUNTIME_STAGE_CHANGED');
    expect(runtime).toContain('getAdapter(prepared.version.implementationKey, prepared.runtimeContract.kind)');
    expect(adapter).toContain('ASSET_RUNTIME_ADAPTERS');
    expect(adapter).toContain('TRUSTED_DETERMINISTIC_ADAPTER');
  });

  it("does not revive historical ComponentDelivery, CMS or human authority writes", () => {
    expect(runtime).not.toMatch(/componentDeliveries|publicationDecisions|teacherReviews|learningOutcomes|retryAttempts/);
    expect(runtime).not.toMatch(/createComponent|publish|approve|mastery/i);
    expect(migration).not.toMatch(/ALTER TABLE "foundry_product"\."component_deliveries"/);
  });
});
