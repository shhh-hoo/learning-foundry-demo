import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

function guardedLocalUrl(raw: string | undefined): string {
  if (!raw) throw new Error("CAP01_UPGRADE_DATABASE_URL is required");
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) {
    throw new Error("CAP01_UPGRADE_DATABASE_URL must target localhost");
  }
  if (database !== "learning_foundry_cap01_upgrade") {
    throw new Error("CAP01 upgrade database must be named exactly learning_foundry_cap01_upgrade");
  }
  if (process.env.CAP01_UPGRADE_RESET_ALLOWED !== "true") {
    throw new Error("CAP01_UPGRADE_RESET_ALLOWED=true is required");
  }
  return url.toString();
}

async function applyMigration(client: postgres.Sql, filename: string): Promise<void> {
  const migration = await readFile(resolve("db/migrations", filename), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await client.unsafe(statement);
  }
}

const client = postgres(guardedLocalUrl(process.env.CAP01_UPGRADE_DATABASE_URL), { max: 1, prepare: false });
const institutionId = randomUUID();
const learnerId = randomUUID();
const subjectId = randomUUID();
const courseId = randomUUID();
const profileId = randomUUID();
const taskId = randomUUID();
const episodeId = randomUUID();
const snapshotId = randomUUID();

try {
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_private CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_operational CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_product CASCADE");
  for (const migration of [
    "0000_full_framework.sql",
    "0001_full_framework.sql",
    "0002_recoverable_resume_claims.sql",
    "0003_production_auth_tenant_enforcement.sql",
    "0004_canonical_identity_context_evidence.sql",
  ]) await applyMigration(client, migration);

  await client`
    INSERT INTO foundry_product.institutions (id,slug,name)
    VALUES (${institutionId}::uuid,${`cap01-${institutionId}`},'CAP-01 upgrade fixture')
  `;
  await client`
    INSERT INTO foundry_product.users (id,email,name)
    VALUES (${learnerId}::uuid,${`cap01-${learnerId}@integration.invalid`},'CAP-01 learner')
  `;
  await client`
    INSERT INTO foundry_product.institution_memberships (user_id,institution_id,role)
    VALUES (${learnerId}::uuid,${institutionId}::uuid,'LEARNER')
  `;
  await client`
    INSERT INTO foundry_product.subjects (id,institution_id,key,name,reference_pack_key)
    VALUES (${subjectId}::uuid,${institutionId}::uuid,${`cap01-${subjectId}`},'CAP-01 subject','cap01-test-pack')
  `;
  await client`
    INSERT INTO foundry_product.courses (id,institution_id,subject_id,code,name)
    VALUES (${courseId}::uuid,${institutionId}::uuid,${subjectId}::uuid,${`CAP01-${courseId.slice(0, 8)}`},'CAP-01 course')
  `;
  await client`
    INSERT INTO foundry_product.learner_profiles (id,institution_id,learner_id,created_by)
    VALUES (${profileId}::uuid,${institutionId}::uuid,${learnerId}::uuid,${learnerId}::uuid)
  `;
  await client`
    INSERT INTO foundry_product.learning_tasks
      (id,institution_id,course_id,learner_id,learner_profile_id,title,goal)
    VALUES (${taskId}::uuid,${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,${profileId}::uuid,'CAP-01 task','Preserve a populated legacy Context snapshot')
  `;
  await client`
    INSERT INTO foundry_product.learning_episodes (id,task_id,sequence)
    VALUES (${episodeId}::uuid,${taskId}::uuid,1)
  `;
  await client`
    INSERT INTO foundry_product.context_compilations
      (id,task_id,episode_id,compiler_version,token_budget,modality_budget,tokenizer,selected_token_count,modality_usage,selected_items,excluded_items)
    VALUES (
      ${snapshotId}::uuid,${taskId}::uuid,${episodeId}::uuid,'2.0.0',4000,
      '{"TEXT":12}'::jsonb,'o200k_base',2,'{"TEXT":1}'::jsonb,
      ${JSON.stringify([{ id: "historical-selected", content: "retained" }])}::jsonb,
      ${JSON.stringify([{ id: "historical-excluded", reason: "STALE" }])}::jsonb
    )
  `;
  const [before] = await client<Array<{ created_at: string; selected_items: unknown; excluded_items: unknown }>>`
    SELECT created_at::text,selected_items,excluded_items
    FROM foundry_product.context_compilations WHERE id=${snapshotId}::uuid
  `;
  if (!before) throw new Error("CAP-01 pre-upgrade Context snapshot was not created");

  await applyMigration(client, "0005_authoritative_context_compiler.sql");
  const [after] = await client<Array<{
    created_at: string;
    selected_items: unknown;
    excluded_items: unknown;
    candidate_items: unknown[];
    consumer: string;
    context_policy_version: string;
    input_hash: string;
    snapshot_hash: string;
  }>>`
    SELECT created_at::text,selected_items,excluded_items,candidate_items,consumer,context_policy_version,input_hash,snapshot_hash
    FROM foundry_product.context_compilations WHERE id=${snapshotId}::uuid
  `;
  if (!after
    || after.created_at !== before.created_at
    || JSON.stringify(after.selected_items) !== JSON.stringify(before.selected_items)
    || JSON.stringify(after.excluded_items) !== JSON.stringify(before.excluded_items)
    || after.candidate_items.length !== 2
    || after.consumer !== "LEGACY_COMPATIBILITY"
    || after.context_policy_version !== "legacy-2.0.0"
    || after.input_hash !== `legacy-row:${snapshotId}`
    || after.snapshot_hash !== `legacy-row:${snapshotId}`) {
    throw new Error(`CAP-01 populated upgrade did not preserve historical snapshot facts: ${JSON.stringify(after)}`);
  }

  let immutableDenied = false;
  try {
    await client`UPDATE foundry_product.context_compilations SET token_budget=1 WHERE id=${snapshotId}::uuid`;
  } catch (error) {
    immutableDenied = (error as { code?: string }).code === "23514";
  }
  if (!immutableDenied) throw new Error("CAP-01 upgraded Context snapshot accepted an in-place rewrite");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    exactBaseMigrations: "0000-0004",
    appliedMigration: "0005",
    historicalRowsPreserved: 1,
    historicalFactsRebound: false,
    immutableRewriteDenied: true,
  })}\n`);
} finally {
  await client.end();
}
