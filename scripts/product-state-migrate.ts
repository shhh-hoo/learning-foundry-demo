import { Pool } from "pg";
import { runProductStateMigrations } from "./lib/product-state-migrations";

const connectionString = process.env.PRODUCT_STATE_DATABASE_URL?.trim();
if (!connectionString) throw new Error("PRODUCT_STATE_DATABASE_URL_REQUIRED");
const pool = new Pool({ connectionString, max: 1 });
try {
  const migrations = await runProductStateMigrations(pool);
  console.log(JSON.stringify({ ok: true, appliedThrough: migrations.at(-1)?.version ?? null, migrations: migrations.map((item) => item.filename) }));
} finally {
  await pool.end();
}
