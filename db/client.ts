import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "@/db/schema";
import { resolveDatabaseUrls } from "@/db/database-config";

let sqlClient: Sql | null = null;
let checkpointSqlClient: Sql | null = null;
let database: PostgresJsDatabase<typeof schema> | null = null;

export function getProductDatabaseUrl(): string {
  return resolveDatabaseUrls().productDatabaseUrl;
}

export function getCheckpointDatabaseUrl(): string {
  return resolveDatabaseUrls().checkpointDatabaseUrl;
}

/** Compatibility alias for scripts that operate only on canonical Product State. */
export function getDatabaseUrl(): string {
  return getProductDatabaseUrl();
}

export function getSql(): Sql {
  if (!sqlClient) {
    sqlClient = postgres(getProductDatabaseUrl(), { max: 10, prepare: false });
  }
  return sqlClient;
}

export function getCheckpointSql(): Sql {
  if (!checkpointSqlClient) {
    checkpointSqlClient = postgres(getCheckpointDatabaseUrl(), { max: 5, prepare: false });
  }
  return checkpointSqlClient;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!database) database = drizzle(getSql(), { schema });
  return database;
}

export async function closeDb(): Promise<void> {
  if (sqlClient) await sqlClient.end();
  if (checkpointSqlClient) await checkpointSqlClient.end();
  sqlClient = null;
  checkpointSqlClient = null;
  database = null;
}
