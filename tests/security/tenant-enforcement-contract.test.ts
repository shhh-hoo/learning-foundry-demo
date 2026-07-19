import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/0003_production_auth_tenant_enforcement.sql", "utf8");

describe("RW-02 tenant enforcement contract", () => {
  it("retains the accepted-base 36-row inventory and classifies every new auth table", () => {
    const catalogRows = [...migration.matchAll(/\('foundry_(?:product|operational)','[^']+','[^']+',(?:true|false)\)/g)].map((match) => match[0]);
    expect(catalogRows).toHaveLength(39);
    expect(catalogRows.filter((row) => !row.includes("auth_identities") && !row.includes("auth_sessions") && !row.includes("security_events"))).toHaveLength(36);
    expect(migration).toContain("('foundry_product','__drizzle_migrations','GLOBAL_MIGRATION_METADATA',false)");
  });

  it("forces RLS on every policy-required catalog table and denies broad public access", () => {
    const required = [...migration.matchAll(/\('([^']+)','([^']+)','[^']+',true\)/g)].map((match) => `${match[1]}.${match[2]}`);
    const forced = [...migration.matchAll(/ALTER TABLE "([^"]+)"\."([^"]+)" FORCE ROW LEVEL SECURITY/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(new Set(forced)).toEqual(new Set(required));
    expect(migration).toContain("REVOKE ALL ON ALL TABLES");
    expect(migration).toContain("NOBYPASSRLS");
  });

  it("inventories every writable runtime table and applies the secondary-lineage guard", () => {
    const writableRows = [...migration.matchAll(/\('foundry_(?:product|operational)','[^']+',ARRAY\[[^\]]+\],'[^']+'\)/g)].map((match) => match[0]);
    expect(writableRows).toHaveLength(29);
    expect(migration).toContain("('foundry_product','auth_sessions',ARRAY['foundry_auth_bootstrap']");
    expect(migration).toContain("('foundry_operational','security_events',ARRAY['foundry_auth_bootstrap','foundry_worker']");
    expect(migration).toContain("assert_rw02_tenant_lineage");
    expect(migration).toContain("_authority_tenant_lineage_guard");
    expect(migration).toContain("ComponentDelivery tenant lineage mismatch");
    expect(migration).toContain("AuthSession tenant lineage mismatch");
    expect(migration).toContain("Auth audit tenant lineage mismatch");
    expect(migration).toContain("configured_role text := NULLIF(NULLIF(current_setting('role', true), ''), 'none')");
    expect(migration).toContain("invoker_role text := session_user");
    expect(migration).toContain("pg_catalog.pg_has_role(invoker_role, r.rolname, 'MEMBER')");
    expect(migration).toContain("PostgreSQL session principal has multiple RW-02 runtime roles");
  });

  it("keeps worker SQL behind the audited service facade and hides password verifiers", () => {
    const client = readFileSync("db/client.ts", "utf8");
    const service = readFileSync("application/service-authority.ts", "utf8");
    expect(client).not.toContain("getWorkerSql");
    expect(client).not.toContain("getWorkerDatabaseUrl");
    expect(service).toContain("withServiceTenantContext");
    expect(service).toContain("SERVICE_INVOCATION");
    expect(migration).toContain('REVOKE SELECT ON "foundry_product"."users" FROM foundry_product_runtime');
    expect(migration).toContain('GRANT SELECT ("id", "email", "name", "active", "created_at")');
    expect(migration).not.toContain('"created_at") ON "foundry_product"."users" TO foundry_product_runtime, foundry_worker');
  });

  it("uses transaction-local request context and institution-prefixed checkpoint policy", () => {
    const client = readFileSync("db/client.ts", "utf8");
    const checkpoints = readFileSync("db/checkpoint-security.ts", "utf8");
    const queries = readFileSync("application/queries.ts", "utf8");
    const checkpointer = readFileSync("workflows/checkpointer.ts", "utf8");
    expect(client).toContain("set_config('foundry.institution_id'");
    expect(client).toContain("true)");
    expect(client).toContain("getTenantCheckpointSql");
    expect(checkpoints).toContain("thread_id LIKE foundry_checkpoint_private.current_institution_id()::text || ':%'");
    expect(queries).toContain("getTenantCheckpointSql(actor.institutionId)");
    expect(checkpointer).toContain("withPostgresStartupSettings");
  });

  it("wraps every protected route and data-bearing workspace in tenant context", () => {
    const discover = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? discover(path) : [path];
    });
    const routes = discover("app/api").filter((path) => path.endsWith("route.ts"));
    const publicRoutes = new Set(["app/api/auth/[...nextauth]/route.ts", "app/api/health/route.ts"]);
    const protectedRoutes = routes.filter((path) => !publicRoutes.has(path));
    expect(routes.filter((path) => publicRoutes.has(path))).toHaveLength(2);
    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const route of protectedRoutes) expect(readFileSync(route, "utf8"), route).toContain("withApiActor");
    for (const page of ["learner", "teacher", "foundry", "engineering"]) expect(readFileSync(`app/${page}/page.tsx`, "utf8")).toContain("withWorkspaceActor");
  });
});
