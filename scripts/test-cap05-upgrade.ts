import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

function guardedLocalUrl(raw: string | undefined): string {
  if (!raw) throw new Error("CAP05_UPGRADE_DATABASE_URL is required");
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) throw new Error("CAP05_UPGRADE_DATABASE_URL must target localhost");
  if (database !== "learning_foundry_cap05_upgrade") throw new Error("CAP-05 upgrade database must be named exactly learning_foundry_cap05_upgrade");
  if (process.env.CAP05_UPGRADE_RESET_ALLOWED !== "true") throw new Error("CAP05_UPGRADE_RESET_ALLOWED=true is required");
  return url.toString();
}

async function applyMigration(client: postgres.Sql, filename: string): Promise<void> {
  const migration = await readFile(resolve("db/migrations", filename), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.unsafe(statement);
}

const client = postgres(guardedLocalUrl(process.env.CAP05_UPGRADE_DATABASE_URL), { max: 1, prepare: false });
const institutionId = randomUUID();
const learnerId = randomUUID();
const subjectId = randomUUID();
const courseId = randomUUID();
const profileId = randomUUID();
const taskId = randomUUID();
const episodeId = randomUUID();

try {
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_private CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_operational CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_product CASCADE");
  for (const migration of [
    "0000_full_framework.sql", "0001_full_framework.sql", "0002_recoverable_resume_claims.sql",
    "0003_production_auth_tenant_enforcement.sql", "0004_canonical_identity_context_evidence.sql",
    "0005_authoritative_context_compiler.sql", "0006_diagnosis_capability_resolution.sql",
    "0007_activity_planning.sql", "0008_asset_stage_runtime.sql",
  ]) await applyMigration(client, migration);

  await client`INSERT INTO foundry_product.institutions (id,slug,name) VALUES (${institutionId}::uuid,${`cap05-${institutionId}`},'CAP-05 upgrade fixture')`;
  await client`INSERT INTO foundry_product.users (id,email,name) VALUES (${learnerId}::uuid,${`cap05-${learnerId}@upgrade.invalid`},'CAP-05 learner')`;
  await client`INSERT INTO foundry_product.institution_memberships (user_id,institution_id,role) VALUES (${learnerId}::uuid,${institutionId}::uuid,'LEARNER')`;
  await client`INSERT INTO foundry_product.subjects (id,institution_id,key,name,reference_pack_key) VALUES (${subjectId}::uuid,${institutionId}::uuid,${`cap05-${subjectId}`},'CAP-05 subject','cap05-pack')`;
  await client`INSERT INTO foundry_product.courses (id,institution_id,subject_id,code,name) VALUES (${courseId}::uuid,${institutionId}::uuid,${subjectId}::uuid,${`CAP05-${courseId.slice(0, 8)}`},'CAP-05 course')`;
  await client`INSERT INTO foundry_product.course_enrollments (institution_id,course_id,user_id,role) VALUES (${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,'LEARNER')`;
  await client`INSERT INTO foundry_product.learner_profiles (id,institution_id,learner_id,created_by) VALUES (${profileId}::uuid,${institutionId}::uuid,${learnerId}::uuid,${learnerId}::uuid)`;
  await client`INSERT INTO foundry_product.learning_tasks (id,institution_id,course_id,learner_id,learner_profile_id,title,goal) VALUES (${taskId}::uuid,${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,${profileId}::uuid,'Populated pre-CAP-05 Task','Remain byte-equivalent through the additive upgrade')`;
  await client`INSERT INTO foundry_product.learning_episodes (id,task_id,sequence) VALUES (${episodeId}::uuid,${taskId}::uuid,1)`;

  const [before] = await client<Array<{ task_hash: string; episode_hash: string }>>`
    SELECT md5(row_to_json(task)::text) AS task_hash, md5(row_to_json(episode)::text) AS episode_hash
    FROM foundry_product.learning_tasks task JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id
    WHERE task.id=${taskId}::uuid AND episode.id=${episodeId}::uuid
  `;
  if (!before) throw new Error("CAP-05 pre-upgrade fixture was not created");

  await applyMigration(client, "0009_teacher_assignment_intervention.sql");

  const [after] = await client<Array<{ task_hash: string; episode_hash: string }>>`
    SELECT md5(row_to_json(task)::text) AS task_hash, md5(row_to_json(episode)::text) AS episode_hash
    FROM foundry_product.learning_tasks task JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id
    WHERE task.id=${taskId}::uuid AND episode.id=${episodeId}::uuid
  `;
  const [newRows] = await client<Array<{ assignments: number; interventions: number; constraints: number }>>`
    SELECT
      (SELECT count(*)::int FROM foundry_product.teacher_assignments) AS assignments,
      (SELECT count(*)::int FROM foundry_product.teacher_interventions) AS interventions,
      (SELECT count(*)::int FROM foundry_product.teacher_capability_constraints) AS constraints
  `;
  const [catalog] = await client<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM foundry_private.table_authority_catalog
    WHERE schema_name='foundry_product' AND table_name IN ('teacher_assignments','teacher_interventions','teacher_capability_constraints')
  `;
  if (!after || before.task_hash!==after.task_hash || before.episode_hash!==after.episode_hash) throw new Error("CAP-05 migration rewrote historical Task/Episode facts");
  if (!newRows || newRows.assignments!==0 || newRows.interventions!==0 || newRows.constraints!==0) throw new Error("CAP-05 migration fabricated human governance rows");
  if (catalog?.count!==3) throw new Error("CAP-05 authority catalog is incomplete");

  process.stdout.write(`${JSON.stringify({
    status: "PASS", exactBaseMigrations: "0000-0008", appliedMigration: "0009",
    historicalTaskEpisodeRowsPreserved: 2, fabricatedHumanRows: 0, authorityCatalogRows: 3,
  })}\n`);
} finally {
  await client.end();
}
