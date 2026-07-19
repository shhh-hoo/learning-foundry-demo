import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "@/db/schema";
import {
  RUNTIME_DATABASE_ROLES,
  resolveAuthorityDatabaseUrls,
  resolveRuntimeDatabaseUrls,
  withPostgresStartupSettings,
  withRuntimeDatabaseRole,
} from "@/db/database-config";
import type { Actor } from "@/domain/model";

let sqlClient: Sql | null = null;
let checkpointSqlClient: Sql | null = null;
let authSqlClient: Sql | null = null;
let database: PostgresJsDatabase<typeof schema> | null = null;
let authDatabase: PostgresJsDatabase<typeof schema> | null = null;
const tenantCheckpointSqlClients = new Map<string, Sql>();

type TenantDatabaseContext = {
  actor: Actor;
  sql: Sql;
  db: PostgresJsDatabase<typeof schema>;
};

const tenantDatabaseContext = new AsyncLocalStorage<TenantDatabaseContext>();

export function getProductDatabaseUrl(): string {
  return resolveRuntimeDatabaseUrls().productDatabaseUrl;
}

export function getCheckpointDatabaseUrl(): string {
  return resolveRuntimeDatabaseUrls().checkpointDatabaseUrl;
}

export function getAuthDatabaseUrl(): string {
  return resolveRuntimeDatabaseUrls().authDatabaseUrl;
}

export function getMigrationDatabaseUrl(): string {
  return resolveAuthorityDatabaseUrls().migrationDatabaseUrl;
}

export function getCheckpointMigrationDatabaseUrl(): string {
  return resolveAuthorityDatabaseUrls().checkpointMigrationDatabaseUrl;
}

/** Compatibility alias for scripts that operate only on canonical Product State. */
export function getDatabaseUrl(): string {
  return getProductDatabaseUrl();
}

export function getSql(): Sql {
  const scoped = tenantDatabaseContext.getStore();
  if (scoped) return scoped.sql;
  if (!sqlClient) {
    sqlClient = postgres(getProductDatabaseUrl(), { max: 10, prepare: false });
  }
  return sqlClient;
}

export function getAuthSql(): Sql {
  if (!authSqlClient) authSqlClient = postgres(getAuthDatabaseUrl(), { max: 5, prepare: false });
  return authSqlClient;
}

export function getCheckpointSql(): Sql {
  if (!checkpointSqlClient) {
    checkpointSqlClient = postgres(getCheckpointDatabaseUrl(), { max: 5, prepare: false });
  }
  return checkpointSqlClient;
}

/** Data-bearing checkpoint reads always assume the checkpoint role and one institution scope. */
export function getTenantCheckpointSql(institutionId: string): Sql {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(institutionId)) {
    throw new Error("Checkpoint tenant scope must be a UUID");
  }
  const existing = tenantCheckpointSqlClients.get(institutionId);
  if (existing) return existing;
  const roleScoped = withRuntimeDatabaseRole(getCheckpointDatabaseUrl(), RUNTIME_DATABASE_ROLES.checkpoint);
  const tenantScoped = withPostgresStartupSettings(roleScoped, { "foundry.institution_id": institutionId });
  const client = postgres(tenantScoped, { max: 3, prepare: false });
  tenantCheckpointSqlClients.set(institutionId, client);
  return client;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  const scoped = tenantDatabaseContext.getStore();
  if (scoped) return scoped.db;
  if (!database) database = drizzle(getSql(), { schema });
  return database;
}

export function getAuthDb(): PostgresJsDatabase<typeof schema> {
  if (!authDatabase) authDatabase = drizzle(getAuthSql(), { schema });
  return authDatabase;
}

/**
 * Pins all Product State queries for one protected request to one transaction
 * and transaction-local PostgreSQL settings. Context cannot leak through the pool.
 */
export async function withTenantDatabase<T>(actor: Actor, operation: () => Promise<T>): Promise<T> {
  const existing = tenantDatabaseContext.getStore();
  if (existing) {
    if (existing.actor.userId !== actor.userId || existing.actor.institutionId !== actor.institutionId) {
      throw new Error("Refusing to replace an active tenant database context");
    }
    return operation();
  }
  const rootSql = getSql();
  const result = await rootSql.begin(async (transaction) => {
    await transaction`
      SELECT
        set_config('foundry.institution_id', ${actor.institutionId}, true),
        set_config('foundry.user_id', ${actor.userId}, true),
        set_config('foundry.session_id', ${actor.sessionId}, true),
        set_config('foundry.roles', ${actor.roles.join(",")}, true),
        set_config('foundry.course_ids', ${actor.courseIds.join(",")}, true)
    `;
    const transactionSql = transaction as unknown as Sql;
    Object.defineProperty(transactionSql, "options", { value: rootSql.options, configurable: true });
    const scopedDb = drizzle(transactionSql, { schema });
    // Existing command boundaries already call `db.transaction(...)`. The
    // request-level transaction is the stronger boundary because it owns the
    // transaction-local RLS settings. Reuse it instead of trying to call
    // postgres.js `begin` on its reserved transaction connection. A thrown
    // command error still aborts the request-level transaction atomically.
    Object.defineProperty(scopedDb, "transaction", {
      configurable: true,
      value: async (nestedOperation: (tx: PostgresJsDatabase<typeof schema>) => Promise<unknown>) => nestedOperation(scopedDb),
    });
    return tenantDatabaseContext.run({ actor, sql: transactionSql, db: scopedDb }, operation);
  });
  return result as unknown as T;
}

export function currentTenantActor(): Actor | null {
  return tenantDatabaseContext.getStore()?.actor ?? null;
}

export async function closeDb(): Promise<void> {
  if (sqlClient) await sqlClient.end();
  if (checkpointSqlClient) await checkpointSqlClient.end();
  if (authSqlClient) await authSqlClient.end();
  await Promise.all([...tenantCheckpointSqlClients.values()].map((client) => client.end()));
  tenantCheckpointSqlClients.clear();
  sqlClient = null;
  checkpointSqlClient = null;
  authSqlClient = null;
  database = null;
  authDatabase = null;
}
