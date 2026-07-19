import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getMigrationDatabaseUrl } from "@/db/client";

const sql = postgres(getMigrationDatabaseUrl(), { max: 1, prepare: false });
await migrate(drizzle(sql), {
  migrationsFolder: resolve("db/migrations"),
  migrationsSchema: "foundry_product",
  migrationsTable: "__drizzle_migrations",
});
await sql.end();
console.log("Product State migrations applied to foundry_product.");
