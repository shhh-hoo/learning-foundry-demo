import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";

const UPGRADE_DATABASE_NAME = "learning_foundry_upgrade_rehearsal";

export function assertUpgradeDatabaseTarget(rawUrl: string | undefined): string {
  if (!rawUrl) throw new Error("UPGRADE_REHEARSAL_DATABASE_URL is required");
  const url = new URL(rawUrl);
  if (!(url.protocol === "postgres:" || url.protocol === "postgresql:")) throw new Error("Upgrade rehearsal requires PostgreSQL");
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) throw new Error("Refusing upgrade rehearsal: host must be local");
  if (decodeURIComponent(url.pathname.replace(/^\//, "")) !== UPGRADE_DATABASE_NAME) throw new Error(`Refusing upgrade rehearsal: database must be named exactly ${UPGRADE_DATABASE_NAME}`);
  if (process.env.UPGRADE_REHEARSAL_ALLOWED !== "true") throw new Error("Refusing upgrade rehearsal reset: UPGRADE_REHEARSAL_ALLOWED=true is required");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing upgrade rehearsal in production mode");
  return url.toString();
}

async function applyMigration(client: Sql, file: string): Promise<void> {
  const migration = await readFile(resolve(file), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.unsafe(statement);
}

async function rehearseComponentUpgrade(): Promise<void> {
  const client = postgres(assertUpgradeDatabaseTarget(process.env.UPGRADE_REHEARSAL_DATABASE_URL), { max: 1, prepare: false });
  try {
    await client`DROP SCHEMA IF EXISTS foundry_operational CASCADE`;
    await client`DROP SCHEMA IF EXISTS foundry_product CASCADE`;
    await applyMigration(client, "db/migrations/0000_full_framework.sql");
    const statements = [
      `INSERT INTO foundry_product.institutions (id, slug, name) VALUES ('11000000-0000-4000-8000-000000000001', 'upgrade-fixture', 'Upgrade fixture')`,
      `INSERT INTO foundry_product.users (id, email, name, password_hash) VALUES
        ('21000000-0000-4000-8000-000000000001', 'learner@upgrade.invalid', 'Learner', 'not-used'),
        ('21000000-0000-4000-8000-000000000002', 'teacher@upgrade.invalid', 'Teacher', 'not-used'),
        ('21000000-0000-4000-8000-000000000003', 'expert@upgrade.invalid', 'Expert', 'not-used')`,
      `INSERT INTO foundry_product.institution_memberships (user_id, institution_id, role) VALUES
        ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'LEARNER'),
        ('21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', 'TEACHER'),
        ('21000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000001', 'EXPERT')`,
      `INSERT INTO foundry_product.subjects (id, institution_id, key, name, reference_pack_key) VALUES ('31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'chemistry', 'Chemistry', 'chemistry-caie-9701')`,
      `INSERT INTO foundry_product.courses (id, institution_id, subject_id, code, name) VALUES ('41000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'UPGRADE', 'Upgrade course')`,
      `INSERT INTO foundry_product.capabilities (id, key, name, reference_pack_key, kind) VALUES ('51000000-0000-4000-8000-000000000001', 'upgrade-capability', 'Upgrade capability', 'chemistry-caie-9701', 'DETERMINISTIC')`,
      `INSERT INTO foundry_product.capability_versions (id, capability_id, version, contract, implementation_key, status, content_hash) VALUES ('51000000-0000-4000-8000-000000000011', '51000000-0000-4000-8000-000000000001', '1.0.0', '{}'::jsonb, 'chemistry.molar-concentration.v1', 'ACTIVE', 'capability')`,
      `UPDATE foundry_product.capabilities SET active_version_id = '51000000-0000-4000-8000-000000000011' WHERE id = '51000000-0000-4000-8000-000000000001'`,
      `INSERT INTO foundry_product.learning_tasks (id, institution_id, course_id, learner_id, title, goal) VALUES ('81000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Upgrade Task', 'Exercise the accepted-baseline migration')`,
      `INSERT INTO foundry_product.learning_episodes (id, task_id, sequence) VALUES ('81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 1)`,
      `INSERT INTO foundry_product.learner_attempts (id, task_id, episode_id, learner_id, capability_id, prompt, response, structured_input, source_refs) VALUES ('91000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'Fixture', 'Fixture', '{}'::jsonb, '[]'::jsonb)`,
      `INSERT INTO foundry_product.diagnostic_observations (id, attempt_id, capability_version_id, observation_source, status, failure_code, first_invalid_step, summary, structured_result, input_lineage, output_lineage) VALUES ('91000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000011', 'CAPABILITY', 'NEEDS_REVIEW', 'NUMERIC_MISMATCH', 'FINAL_NUMERIC_COMPARISON', 'Reviewed failure', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
      `INSERT INTO foundry_product.teacher_reviews (id, observation_id, teacher_id, decision, correction, teaching_support, actor_provenance, idempotency_key) VALUES ('91000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', 'CORRECT', 'Correct the units.', 'Use a unit ledger.', '{"userId":"21000000-0000-4000-8000-000000000002","institutionId":"11000000-0000-4000-8000-000000000001","roles":["TEACHER"],"authMethod":"upgrade-rehearsal","sessionId":"upgrade-session","authenticatedAt":"2026-01-01T00:00:00.000Z"}'::jsonb, 'upgrade-review')`,
      `INSERT INTO foundry_product.components (id, institution_id, key, title, status, source_signal, created_by) VALUES
        ('a1000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'valid-old-shape', 'Valid old shape', 'CANDIDATE', '{"observationId":"91000000-0000-4000-8000-000000000002"}'::jsonb, '21000000-0000-4000-8000-000000000003'),
        ('a1000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', 'invalid-old-shell', 'Invalid old shell', 'CANDIDATE', '{"observationId":"91000000-0000-4000-8000-000000000099"}'::jsonb, '21000000-0000-4000-8000-000000000003')`,
      `INSERT INTO foundry_product.component_versions (id, component_id, version, contract, content, validation, status, content_hash, created_by) VALUES
        ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '0.1.0', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'DRAFT', 'valid', '21000000-0000-4000-8000-000000000003'),
        ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', '0.1.0', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'DRAFT', 'invalid', '21000000-0000-4000-8000-000000000003')`,
    ];
    for (const statement of statements) await client.unsafe(statement);
    await applyMigration(client, "db/migrations/0001_full_framework.sql");
    const [valid] = await client<Array<{ course_id: string; capability_id: string; reference_pack_key: string; source_observation_ids: string[]; source_review_ids: string[] }>>`
      SELECT c.course_id, c.capability_id, c.reference_pack_key, v.source_observation_ids, v.source_review_ids
      FROM foundry_product.components c JOIN foundry_product.component_versions v ON v.component_id = c.id
      WHERE c.id = 'a1000000-0000-4000-8000-000000000001'
    `;
    if (
      !valid
      || valid.course_id !== "41000000-0000-4000-8000-000000000001"
      || valid.capability_id !== "51000000-0000-4000-8000-000000000001"
      || valid.reference_pack_key !== "chemistry-caie-9701"
      || valid.source_review_ids[0] !== "91000000-0000-4000-8000-000000000003"
      || valid.source_observation_ids[0] !== "91000000-0000-4000-8000-000000000002"
    ) throw new Error("Valid accepted-baseline Component was not fully backfilled from its active Capability and current authenticated Review");
    const invalid = await client`SELECT id FROM foundry_product.components WHERE id = 'a1000000-0000-4000-8000-000000000002'`;
    const quarantine = await client`SELECT id FROM foundry_product.governance_events WHERE entity_id = 'a1000000-0000-4000-8000-000000000002' AND action = 'PRE_EVAL_DRAFT_QUARANTINED'`;
    if (invalid.length !== 0 || quarantine.length !== 1) throw new Error("Non-bindable pre-Eval shell was not explicitly audit-quarantined");
    console.log("Accepted-baseline Component migration rehearsal passed: valid old shape backfilled; only non-bindable shell quarantined.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await rehearseComponentUpgrade();
