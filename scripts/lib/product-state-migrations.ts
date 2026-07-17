import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

export interface ProductStateMigration {
  readonly version: string;
  readonly filename: string;
  readonly contentHash: string;
  readonly sql: string;
}

const defaultDirectory = resolve(process.cwd(), "migrations/product-state");

export async function loadProductStateMigrations(directory = defaultDirectory): Promise<readonly ProductStateMigration[]> {
  const filenames = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const migrations: ProductStateMigration[] = [];
  for (const filename of filenames) {
    const source = await readFile(resolve(directory, filename), "utf8");
    const contentHash = createHash("sha256").update(source).digest("hex");
    migrations.push({
      version: filename.slice(0, 4),
      filename,
      contentHash,
      sql: source.replaceAll("__MIGRATION_CONTENT_HASH__", contentHash),
    });
  }
  return migrations;
}

export async function runProductStateMigrations(pool: Pool, directory = defaultDirectory): Promise<readonly ProductStateMigration[]> {
  const migrations = await loadProductStateMigrations(directory);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('learning-foundry-product-state-migrations'))");
    for (const migration of migrations) {
      const exists = await client.query<{ content_hash: string }>(
        `SELECT content_hash
         FROM product_state.schema_migration
         WHERE version = $1`,
        [migration.version],
      ).catch((error: unknown) => {
        const pgError = error as { code?: string };
        if (pgError.code === "42P01" || pgError.code === "3F000") return { rows: [] };
        throw error;
      });
      const applied = exists.rows[0];
      if (applied?.content_hash === migration.contentHash) continue;
      if (applied) throw new Error(`PRODUCT_STATE_MIGRATION_HASH_MISMATCH: ${migration.filename}`);
      try {
        await client.query(migration.sql);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    return migrations;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('learning-foundry-product-state-migrations'))").catch(() => undefined);
    client.release();
  }
}
