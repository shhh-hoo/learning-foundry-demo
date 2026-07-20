import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

function guardedLocalUrl(raw: string | undefined): string {
  if (!raw) throw new Error("CAP02_UPGRADE_DATABASE_URL is required");
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) {
    throw new Error("CAP02_UPGRADE_DATABASE_URL must target localhost");
  }
  if (database !== "learning_foundry_cap02_upgrade") {
    throw new Error("CAP-02 upgrade database must be named exactly learning_foundry_cap02_upgrade");
  }
  if (process.env.CAP02_UPGRADE_RESET_ALLOWED !== "true") {
    throw new Error("CAP02_UPGRADE_RESET_ALLOWED=true is required");
  }
  return url.toString();
}

async function applyMigration(client: postgres.Sql, filename: string): Promise<void> {
  const migration = await readFile(resolve("db/migrations", filename), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await client.unsafe(statement);
  }
}

const client = postgres(guardedLocalUrl(process.env.CAP02_UPGRADE_DATABASE_URL), { max: 1, prepare: false });
const institutionId = randomUUID();
const learnerId = randomUUID();
const subjectId = randomUUID();
const courseId = randomUUID();
const profileId = randomUUID();
const taskId = randomUUID();
const episodeId = randomUUID();
const capabilityId = randomUUID();
const capabilityVersionId = randomUUID();
const attemptId = randomUUID();
const observationId = randomUUID();
const contextId = randomUUID();
const resolutionId = randomUUID();

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
    "0005_authoritative_context_compiler.sql",
  ]) await applyMigration(client, migration);

  await client`INSERT INTO foundry_product.institutions (id,slug,name) VALUES (${institutionId}::uuid,${`cap02-${institutionId}`},'CAP-02 upgrade fixture')`;
  await client`INSERT INTO foundry_product.users (id,email,name) VALUES (${learnerId}::uuid,${`cap02-${learnerId}@integration.invalid`},'CAP-02 learner')`;
  await client`INSERT INTO foundry_product.institution_memberships (user_id,institution_id,role) VALUES (${learnerId}::uuid,${institutionId}::uuid,'LEARNER')`;
  await client`INSERT INTO foundry_product.subjects (id,institution_id,key,name,reference_pack_key) VALUES (${subjectId}::uuid,${institutionId}::uuid,${`cap02-${subjectId}`},'CAP-02 subject','cap02-pack')`;
  await client`INSERT INTO foundry_product.courses (id,institution_id,subject_id,code,name) VALUES (${courseId}::uuid,${institutionId}::uuid,${subjectId}::uuid,${`CAP02-${courseId.slice(0, 8)}`},'CAP-02 course')`;
  await client`INSERT INTO foundry_product.course_enrollments (institution_id,course_id,user_id,role) VALUES (${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,'LEARNER')`;
  await client`INSERT INTO foundry_product.learner_profiles (id,institution_id,learner_id,created_by) VALUES (${profileId}::uuid,${institutionId}::uuid,${learnerId}::uuid,${learnerId}::uuid)`;
  await client`INSERT INTO foundry_product.learning_tasks (id,institution_id,course_id,learner_id,learner_profile_id,title,goal) VALUES (${taskId}::uuid,${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,${profileId}::uuid,'CAP-02 populated Task','Preserve prior Product State during CAP-02 upgrade')`;
  await client`INSERT INTO foundry_product.learning_episodes (id,task_id,sequence) VALUES (${episodeId}::uuid,${taskId}::uuid,1)`;
  await client`INSERT INTO foundry_product.capabilities (id,key,name,reference_pack_key,kind,active_version_id) VALUES (${capabilityId}::uuid,${`cap02-legacy-${capabilityId}`},'Legacy callable contract','cap02-pack','DETERMINISTIC_ADAPTER',${capabilityVersionId}::uuid)`;
  await client`INSERT INTO foundry_product.capability_versions (id,capability_id,version,contract,implementation_key,status,content_hash) VALUES (${capabilityVersionId}::uuid,${capabilityId}::uuid,'1.0.0','{"input":"legacy","output":"legacy"}'::jsonb,'cap02.legacy','ACTIVE',${`legacy-${capabilityVersionId}`})`;
  await client`INSERT INTO foundry_product.learner_attempts (id,task_id,episode_id,learner_id,capability_id,prompt,response,structured_input,source_refs) VALUES (${attemptId}::uuid,${taskId}::uuid,${episodeId}::uuid,${learnerId}::uuid,${capabilityId}::uuid,'CAP-02 attempt','Legacy attempt','{}'::jsonb,'[]'::jsonb)`;
  await client`INSERT INTO foundry_product.diagnostic_observations (id,attempt_id,capability_version_id,observation_source,status,summary,structured_result,input_lineage,output_lineage) VALUES (${observationId}::uuid,${attemptId}::uuid,${capabilityVersionId}::uuid,'CAPABILITY','NEEDS_REVIEW','Legacy current Diagnosis','{}'::jsonb,${JSON.stringify({ attemptId })}::jsonb,${JSON.stringify({ capabilityVersionId })}::jsonb)`;

  await client.begin(async (transaction) => {
    await transaction`SELECT set_config('foundry.institution_id', ${institutionId}, true)`;
    await transaction`
      INSERT INTO foundry_product.context_compilations
        (id,task_id,episode_id,consumer,compiler_version,context_policy_version,input_hash,snapshot_hash,
         token_budget,modality_budget,tokenizer,selected_token_count,modality_usage,candidate_items,
         selected_items,excluded_items,provenance_refs,referenced_prior_task_ids)
      SELECT
        ${contextId}::uuid,task.id,episode.id,'CAPABILITY_RESOLUTION','3.0.0','cap-01.1',
        ${`sha256:input-${contextId}`},${`sha256:snapshot-${contextId}`},4000,'{"TEXT":24}'::jsonb,'o200k_base',2,'{"TEXT":2}'::jsonb,
        items.value,items.value,'[]'::jsonb,
        jsonb_build_array(
          jsonb_build_object('type','LEARNING_TASK','id',task.id::text),
          jsonb_build_object('type','LEARNING_EPISODE','id',episode.id::text)
        ),
        '[]'::jsonb
      FROM foundry_product.learning_tasks task
      JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id
      CROSS JOIN LATERAL (
        SELECT jsonb_build_array(
          jsonb_build_object(
            'id','learning-task:' || task.id::text,
            'taskId',task.id::text,
            'institutionId',task.institution_id::text,
            'courseId',task.course_id::text,
            'learnerProfileId',task.learner_profile_id::text,
            'kind','TASK_GOAL',
            'provenanceRefs',jsonb_build_array(jsonb_build_object('type','LEARNING_TASK','id',task.id::text))
          ),
          jsonb_build_object(
            'id','learning-episode:' || episode.id::text,
            'taskId',task.id::text,
            'episodeId',episode.id::text,
            'institutionId',task.institution_id::text,
            'courseId',task.course_id::text,
            'learnerProfileId',task.learner_profile_id::text,
            'kind','ACTIVE_EPISODE',
            'provenanceRefs',jsonb_build_array(jsonb_build_object('type','LEARNING_EPISODE','id',episode.id::text))
          )
        ) AS value
      ) items
      WHERE task.id=${taskId}::uuid AND episode.id=${episodeId}::uuid
    `;
  });

  const [before] = await client<Array<{ contract: unknown; observation_summary: string; selected_items: unknown }>>`
    SELECT version.contract,observation.summary AS observation_summary,context.selected_items
    FROM foundry_product.capability_versions version
    JOIN foundry_product.diagnostic_observations observation ON observation.id=${observationId}::uuid
    JOIN foundry_product.context_compilations context ON context.id=${contextId}::uuid
    WHERE version.id=${capabilityVersionId}::uuid
  `;
  if (!before) throw new Error("CAP-02 populated fixture was not created");

  await applyMigration(client, "0006_diagnosis_capability_resolution.sql");

  const [after] = await client<Array<{ contract: unknown; observation_summary: string; selected_items: unknown }>>`
    SELECT version.contract,observation.summary AS observation_summary,context.selected_items
    FROM foundry_product.capability_versions version
    JOIN foundry_product.diagnostic_observations observation ON observation.id=${observationId}::uuid
    JOIN foundry_product.context_compilations context ON context.id=${contextId}::uuid
    WHERE version.id=${capabilityVersionId}::uuid
  `;
  if (!after
    || JSON.stringify(after.contract) !== JSON.stringify(before.contract)
    || after.observation_summary !== before.observation_summary
    || JSON.stringify(after.selected_items) !== JSON.stringify(before.selected_items)) {
    throw new Error("CAP-02 migration rewrote prior Registry, Diagnosis or Context facts");
  }

  const candidate = {
    capabilityId,
    capabilityKey: `cap02-legacy-${capabilityId}`,
    capabilityName: "Legacy callable contract",
    referencePackKey: "cap02-pack",
    activeVersionId: capabilityVersionId,
    versionId: capabilityVersionId,
    version: "1.0.0",
    versionStatus: "ACTIVE",
    contentHash: `legacy-${capabilityVersionId}`,
    contract: { input: "legacy", output: "legacy" },
    rank: 1,
    eligibility: "EXCLUDED",
    exclusionReasons: ["INELIGIBLE"],
    compatibility: [{ dimension: "registry-contract", compatible: false, detail: "Legacy contract is incomplete." }],
    matchMode: "NONE",
    score: 0,
    rationale: "Excluded incomplete legacy callable contract.",
  };
  await client.begin(async (transaction) => {
    await transaction`SELECT set_config('foundry.institution_id', ${institutionId}, true)`;
    await transaction`
      INSERT INTO foundry_product.capability_resolutions
        (id,institution_id,course_id,task_id,episode_id,context_compilation_id,diagnostic_observation_id,
         policy_version,input_hash,decision,candidate_set,selection_rationale,gap_signal,no_match,teacher_escalation,created_by)
      VALUES (
        ${resolutionId}::uuid,${institutionId}::uuid,${courseId}::uuid,${taskId}::uuid,${episodeId}::uuid,${contextId}::uuid,${observationId}::uuid,
        'cap-02.1',${`sha256:upgrade-${resolutionId}`},'NO_MATCH',${transaction.json([candidate])},
        'Incomplete historical contract remains visible and fails closed.',
        '{"kind":"NO_MATCH","reason":"Incomplete historical contract","relatedCapabilityVersionId":null}'::jsonb,true,true,${learnerId}::uuid
      )
    `;
  });

  let immutableDenied = false;
  try {
    await client`UPDATE foundry_product.capability_resolutions SET selection_rationale='rewritten' WHERE id=${resolutionId}::uuid`;
  } catch (error) {
    immutableDenied = (error as { code?: string }).code === "23514";
  }
  if (!immutableDenied) throw new Error("CAP-02 resolution accepted an in-place rewrite");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    exactBaseMigrations: "0000-0005",
    appliedMigration: "0006",
    populatedRegistryRowsPreserved: 1,
    populatedDiagnosisRowsPreserved: 1,
    populatedContextRowsPreserved: 1,
    legacyContractFailedClosed: true,
    immutableRewriteDenied: true,
  })}\n`);
} finally {
  await client.end();
}
