import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

export const E2E_DATABASE_NAME = "learning_foundry_e2e";
export const E2E_STORAGE_ROOT = resolve(".local-data/e2e-uploads");

export function assertE2eDatabaseTarget(rawUrl: string | undefined, requireResetPermission = true): string {
  if (!rawUrl) throw new Error("E2E_DATABASE_URL is required");
  const url = new URL(rawUrl);
  if (!(["postgres:", "postgresql:"] as const).includes(url.protocol as "postgres:" | "postgresql:")) {
    throw new Error("E2E database must use PostgreSQL");
  }
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) {
    throw new Error("Refusing E2E database access: host must be local");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (databaseName !== E2E_DATABASE_NAME) {
    throw new Error(`Refusing E2E database access: database must be named exactly ${E2E_DATABASE_NAME}`);
  }
  if (requireResetPermission && process.env.E2E_RESET_ALLOWED !== "true") {
    throw new Error("Refusing E2E reset: E2E_RESET_ALLOWED=true is required");
  }
  return url.toString();
}

async function setupE2eDatabase(): Promise<void> {
  const databaseUrl = assertE2eDatabaseTarget(process.env.E2E_DATABASE_URL);
  const showcasePassword = process.env.E2E_SHOWCASE_PASSWORD;
  if (!showcasePassword || showcasePassword.length < 12) throw new Error("E2E_SHOWCASE_PASSWORD must contain at least 12 characters");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing E2E reset in production mode");

  await rm(E2E_STORAGE_ROOT, { recursive: true, force: true });
  await mkdir(E2E_STORAGE_ROOT, { recursive: true });

  const reset = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await reset`DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE`;
    await reset`DROP SCHEMA IF EXISTS foundry_operational CASCADE`;
    await reset`DROP SCHEMA IF EXISTS foundry_product CASCADE`;
  } finally {
    await reset.end();
  }

  process.env.DATABASE_URL = databaseUrl;
  process.env.PRODUCT_DATABASE_URL = databaseUrl;
  process.env.CHECKPOINT_DATABASE_URL = databaseUrl;
  process.env.SYNTHETIC_SHOWCASE_MODE = "true";
  process.env.SHOWCASE_PASSWORD = showcasePassword;
  process.env.DEEPSEEK_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  process.env.COHERE_API_KEY = "";
  process.env.FILE_STORAGE_LOCAL_ROOT = E2E_STORAGE_ROOT;
  process.env.LANGSMITH_TRACING = "false";

  const [{ migrate }, { getDb, closeDb }] = await Promise.all([
    import("drizzle-orm/postgres-js/migrator"),
    import("@/db/client"),
  ]);
  await migrate(getDb(), {
    migrationsFolder: resolve("db/migrations"),
    migrationsSchema: "foundry_product",
    migrationsTable: "__drizzle_migrations",
  });
  await closeDb();

  const { PostgresSaver } = await import("@langchain/langgraph-checkpoint-postgres");
  const checkpointer = PostgresSaver.fromConnString(databaseUrl, { schema: "langgraph_checkpoint" });
  await checkpointer.setup();
  await checkpointer.end();

  await import("@/db/seed-showcase");
  console.log(`Reset and seeded guarded local E2E database ${E2E_DATABASE_NAME}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await setupE2eDatabase();
