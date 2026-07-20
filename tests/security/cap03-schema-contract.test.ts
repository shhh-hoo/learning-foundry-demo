import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/0007_activity_planning.sql", "utf8");
const planner = readFileSync("application/activity-planning.ts", "utf8");
const workflow = readFileSync("workflows/diagnosis.ts", "utf8");

describe("CAP-03 Activity Planning authority boundary", () => {
  it("persists an immutable forced-RLS Class-B proposal with exact lineage", () => {
    expect(migration).toContain("activity_plan_proposals");
    expect(migration).toContain("TENANT_DIRECT_CLASS_B");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("cap03_activity_plan_lineage_guard");
    expect(migration).toContain("cap03_activity_plan_immutable");
    expect(migration).toContain("capability_resolution_id");
    expect(migration).toContain("selected_version_content_hash");
    expect(migration).toContain("READY plan does not pin the eligible active exact version");
    expect(migration).toContain("GRANT SELECT, INSERT");
    expect(migration).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)/);
  });

  it("loads canonical CAP-02 lineage and never executes or simulates an asset", () => {
    expect(planner).toContain("capabilityResolutions");
    expect(planner).toContain("contextCompilations");
    expect(planner).toContain("diagnosticObservations");
    expect(planner).toContain("capabilityVersions");
    expect(planner).toContain("withTenantDatabase");
    expect(planner).not.toMatch(/executePersistedCapability|AssetRuntime|RuntimeDelivery|LearningEventService/);
    expect(workflow).toContain("plan_activity");
    expect(workflow.indexOf("resolve_capability")).toBeLessThan(workflow.lastIndexOf("plan_activity"));
  });
});
