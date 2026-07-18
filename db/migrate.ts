import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "@/db/client";

await migrate(getDb(), {
  migrationsFolder: resolve("db/migrations"),
  migrationsSchema: "foundry_product",
  migrationsTable: "__drizzle_migrations",
});

await closeDb();
console.log("Product State migrations applied to foundry_product.");
