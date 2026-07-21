import { describe, expect, it } from "vitest";
import {
  RUNTIME_DATABASE_ROLES,
  resolveAuthorityDatabaseUrls,
  resolveDatabaseUrls,
  resolveRuntimeDatabaseUrls,
  withPostgresStartupSettings,
  withRuntimeDatabaseRole,
} from "@/db/database-config";

describe("database connection boundaries", () => {
  it("uses DATABASE_URL only as a local/test fallback", () => {
    const url = "postgresql://local:local@127.0.0.1:55432/learning_foundry";
    expect(resolveDatabaseUrls({ NODE_ENV: "test", DATABASE_URL: url })).toEqual({
      productDatabaseUrl: url,
      checkpointDatabaseUrl: url,
    });
  });

  it("fails production when Product and checkpoint use the same role and target", () => {
    const url = "postgresql://shared_role:secret@db.example/learning_foundry";
    expect(() => resolveDatabaseUrls({
      NODE_ENV: "production",
      PRODUCT_DATABASE_URL: url,
      CHECKPOINT_DATABASE_URL: url,
    })).toThrow(/distinct database roles or targets/);
  });

  it("allows the same managed database with distinct least-privilege roles", () => {
    const resolved = resolveDatabaseUrls({
      NODE_ENV: "production",
      PRODUCT_DATABASE_URL: "postgresql://product_role:one@db.example/learning_foundry",
      CHECKPOINT_DATABASE_URL: "postgresql://checkpoint_role:two@db.example/learning_foundry",
    });
    expect(resolved.productDatabaseUrl).toContain("product_role");
    expect(resolved.checkpointDatabaseUrl).toContain("checkpoint_role");
  });

  it("does not accept DATABASE_URL as a production fallback", () => {
    expect(() => resolveDatabaseUrls({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://shared:secret@db.example/learning_foundry",
    })).toThrow(/PRODUCT_DATABASE_URL/);
  });

  it("requires separate auth, worker and migration identities in the product process", () => {
    expect(() => resolveAuthorityDatabaseUrls({
      NODE_ENV: "production",
      PRODUCT_DATABASE_URL: "postgresql://product:one@db.example/foundry",
      CHECKPOINT_DATABASE_URL: "postgresql://checkpoint:two@db.example/checkpoint",
    })).toThrow(/AUTH_DATABASE_URL/);
    const resolved = resolveAuthorityDatabaseUrls({
      NODE_ENV: "production",
      PRODUCT_DATABASE_URL: "postgresql://product:one@db.example/foundry",
      CHECKPOINT_DATABASE_URL: "postgresql://checkpoint:two@db.example/checkpoint",
      AUTH_DATABASE_URL: "postgresql://auth:three@db.example/foundry",
      WORKER_DATABASE_URL: "postgresql://worker:four@db.example/foundry",
      MIGRATION_DATABASE_URL: "postgresql://migrator:six@db.example/foundry",
      CHECKPOINT_MIGRATION_DATABASE_URL: "postgresql://checkpoint_migrator:seven@db.example/checkpoint",
    });
    expect(resolved.authDatabaseUrl).toContain("auth");
    expect(resolved.workerDatabaseUrl).toContain("worker");
  });

  it("rejects the Component Executor database credential in product configuration", () => {
    expect(() => resolveAuthorityDatabaseUrls({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://product:one@db.example/foundry",
      COMPONENT_EXECUTOR_DATABASE_URL: "postgresql://executor:two@db.example/foundry",
    })).toThrow(/forbidden in the product web process/);
  });

  it("preserves startup options while appending exact runtime role and tenant settings", () => {
    const original = "postgresql://login:secret@db.example/foundry?sslmode=require&options=-c%20statement_timeout%3D5000";
    const roleScoped = withRuntimeDatabaseRole(original, RUNTIME_DATABASE_ROLES.checkpoint);
    const tenantScoped = withPostgresStartupSettings(roleScoped, { "foundry.institution_id": "10000000-0000-4000-8000-000000000001" });
    const parsed = new URL(tenantScoped);
    expect(parsed.searchParams.get("sslmode")).toBe("require");
    expect(parsed.searchParams.get("options")).toBe("-c statement_timeout=5000 -c role=foundry_checkpoint_runtime -c foundry.institution_id=10000000-0000-4000-8000-000000000001");
  });

  it("forces every production application connection into its exact NOLOGIN group role", () => {
    const resolved = resolveRuntimeDatabaseUrls({
      NODE_ENV: "production",
      PRODUCT_DATABASE_URL: "postgresql://product_login:one@db.example/foundry",
      CHECKPOINT_DATABASE_URL: "postgresql://checkpoint_login:two@db.example/checkpoint",
      AUTH_DATABASE_URL: "postgresql://auth_login:three@db.example/foundry",
      WORKER_DATABASE_URL: "postgresql://worker_login:four@db.example/foundry",
      MIGRATION_DATABASE_URL: "postgresql://migrator_login:six@db.example/foundry",
      CHECKPOINT_MIGRATION_DATABASE_URL: "postgresql://checkpoint_migrator_login:seven@db.example/checkpoint",
    });
    expect(new URL(resolved.productDatabaseUrl).searchParams.get("options")).toContain("role=foundry_product_runtime");
    expect(new URL(resolved.authDatabaseUrl).searchParams.get("options")).toContain("role=foundry_auth_bootstrap");
    expect(new URL(resolved.workerDatabaseUrl).searchParams.get("options")).toContain("role=foundry_worker");
    expect(new URL(resolved.checkpointDatabaseUrl).searchParams.get("options")).toContain("role=foundry_checkpoint_runtime");
    expect(new URL(resolved.migrationDatabaseUrl).searchParams.get("options")).toBeNull();
    expect(new URL(resolved.checkpointMigrationDatabaseUrl).searchParams.get("options")).toBeNull();
  });
});
