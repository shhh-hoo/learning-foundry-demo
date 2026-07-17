import { readFile } from "node:fs/promises";
import { resolveProductStateConfiguration } from "../src/product-state/product-state-mode";
import { LegacyExperienceImporter } from "../src/product-state/legacy-experience-importer";
import { createPostgresProductStateRepository } from "../src/product-state/postgres-product-state-repository";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`ARGUMENT_REQUIRED: ${name}`);
  return value;
}

const configuration = resolveProductStateConfiguration(process.env);
if (configuration.mode !== "POSTGRES_CANONICAL") throw new Error("POSTGRES_CANONICAL_MODE_REQUIRED");
const inputPath = argument("--input");
const snapshot = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
const connection = createPostgresProductStateRepository(configuration.databaseUrl);
try {
  const result = await new LegacyExperienceImporter(connection.repository).import({
    snapshot,
    goal: argument("--goal"),
    learnerId: argument("--learner"),
    importedBy: argument("--actor"),
  });
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await connection.close();
}
