import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { closeServiceAuthority, withServiceTenantContext } from "@/application/service-authority";
import { RUNTIME_DATABASE_ROLES, withRuntimeDatabaseRole } from "@/db/database-config";

type CatalogRow = { schema_name: string; table_name: string; classification: string; policy_required: boolean };

function guardedLocalUrl(raw: string | undefined, label: string): string {
  if (!raw) throw new Error(`${label} is required`);
  const url = new URL(raw);
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) throw new Error(`${label} must target localhost`);
  const database = decodeURIComponent(url.pathname.slice(1));
  const configuredDatabase = process.env.TENANT_TEST_DATABASE_NAME;
  if (configuredDatabase && configuredDatabase !== "learning_foundry") throw new Error("TENANT_TEST_DATABASE_NAME may only name the PM-owned disposable learning_foundry database");
  const allowedDatabases = new Set(["learning_foundry_rw02", "learning_foundry_e2e", ...(configuredDatabase ? [configuredDatabase] : [])]);
  if (!allowedDatabases.has(database) && !database.startsWith("learning_foundry_rw03")) {
    throw new Error(`${label} must target a disposable Learning Foundry enforcement database`);
  }
  return url.toString();
}

function quoted(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe catalog identifier: ${value}`);
  return `"${value}"`;
}

async function expectReadAndWriteDenied(transaction: Sql, row: CatalogRow): Promise<void> {
  const table = `${quoted(row.schema_name)}.${quoted(row.table_name)}`;
  const privilegeName = `${row.schema_name}.${row.table_name}`;
  const tenantPredicate = row.classification.includes("TENANT_OR_GLOBAL") ? " WHERE institution_id IS NOT NULL" : "";
  const privileges = await transaction<Array<{ readable: boolean; updatable: boolean; deletable: boolean }>>`
    SELECT
      has_table_privilege(current_user, ${privilegeName}, 'SELECT') AS readable,
      has_table_privilege(current_user, ${privilegeName}, 'UPDATE') AS updatable,
      has_table_privilege(current_user, ${privilegeName}, 'DELETE') AS deletable
  `;
  if (privileges[0]?.readable) {
    const result = await transaction.unsafe<Array<{ count: number }>>(`SELECT count(*)::int AS count FROM ${table}${tenantPredicate}`);
    if (result[0]?.count !== 0) throw new Error(`${table} exposed ${result[0]?.count} rows without/cross tenant context`);
  }
  if (privileges[0]?.deletable) {
    const result = await transaction.unsafe(`DELETE FROM ${table}${tenantPredicate}`);
    if (result.count !== 0) throw new Error(`${table} deleted ${result.count} rows without/cross tenant context`);
  }
  if (privileges[0]?.updatable) {
    const [column] = await transaction<Array<{ attname: string }>>`
      SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${row.schema_name} AND c.relname = ${row.table_name}
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity = ''
      ORDER BY a.attnum
      LIMIT 1
    `;
    if (!column) throw new Error(`${table} has UPDATE authority but no safe no-op probe column`);
    const identifier = quoted(column.attname);
    const result = await transaction.unsafe(`UPDATE ${table} SET ${identifier} = ${identifier}${tenantPredicate}`);
    if (result.count !== 0) throw new Error(`${table} updated ${result.count} rows without/cross tenant context`);
  }
}

async function expectRoleTransactionDenied(
  label: string,
  client: Sql,
  role: string,
  institutionId: string,
  operation: (transaction: Sql) => Promise<void>,
  expectedMessage?: RegExp,
): Promise<void> {
  let denied = false;
  try {
    await client.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL ROLE ${role}`);
      await transaction`SELECT set_config('foundry.institution_id', ${institutionId}, true)`;
      await operation(transaction as unknown as Sql);
    });
  } catch (error) {
    denied = true;
    if (expectedMessage && !expectedMessage.test(error instanceof Error ? error.message : String(error))) {
      throw new Error(`${label} failed for the wrong reason: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!denied) throw new Error(`${label} unexpectedly committed`);
}

async function expectSessionAuthorizationDenied(
  label: string,
  client: Sql,
  sessionRole: string,
  operation: (transaction: Sql) => Promise<void>,
  expectedMessage: RegExp,
): Promise<void> {
  let denied = false;
  try {
    await client.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL SESSION AUTHORIZATION ${quoted(sessionRole)}`);
      const [identity] = await transaction<Array<{ current_user: string; session_user: string; configured_role: string }>>`
        SELECT current_user, session_user, current_setting('role', true) AS configured_role
      `;
      if (!identity || identity.session_user !== sessionRole || identity.configured_role !== "none") {
        throw new Error(`${label} did not establish the role-none session path: ${JSON.stringify(identity)}`);
      }
      await operation(transaction as unknown as Sql);
    });
  } catch (error) {
    denied = true;
    if (!expectedMessage.test(error instanceof Error ? error.message : String(error))) {
      throw new Error(`${label} failed for the wrong reason: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!denied) throw new Error(`${label} unexpectedly committed`);
}

async function expectResetRoleDenied(
  label: string,
  client: Sql,
  loginRole: string,
  runtimeRole: string,
  operation: (transaction: Sql) => Promise<void>,
  expectedMessage: RegExp,
): Promise<void> {
  let denied = false;
  try {
    await client.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL SESSION AUTHORIZATION ${quoted(loginRole)}`);
      await transaction.unsafe(`SET LOCAL ROLE ${quoted(runtimeRole)}`);
      await transaction.unsafe("RESET ROLE");
      const [identity] = await transaction<Array<{ current_user: string; session_user: string; configured_role: string }>>`
        SELECT current_user, session_user, current_setting('role', true) AS configured_role
      `;
      if (!identity || identity.current_user !== loginRole || identity.session_user !== loginRole || identity.configured_role !== "none") {
        throw new Error(`${label} did not return to the inheriting role-none login: ${JSON.stringify(identity)}`);
      }
      await operation(transaction as unknown as Sql);
    });
  } catch (error) {
    denied = true;
    if (!expectedMessage.test(error instanceof Error ? error.message : String(error))) {
      throw new Error(`${label} failed for the wrong reason: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!denied) throw new Error(`${label} unexpectedly committed`);
}

async function expectDenied(label: string, operation: () => Promise<unknown>, expectedMessage?: RegExp): Promise<void> {
  let denied = false;
  try {
    await operation();
  } catch (error) {
    denied = true;
    if (expectedMessage && !expectedMessage.test(error instanceof Error ? error.message : String(error))) {
      throw new Error(`${label} failed for the wrong reason: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!denied) throw new Error(`${label} unexpectedly succeeded`);
}

async function expectCrossTenantUuidUpdateDenied(
  label: string,
  client: Sql,
  institutionId: string,
  schemaName: string,
  tableName: string,
  columnName: string,
  foreignId: string,
  expectedMessage: RegExp,
  targetId?: string,
  actorUserId?: string,
  zeroRowsArePolicyDenial?: boolean,
): Promise<void> {
  const table = `${quoted(schemaName)}.${quoted(tableName)}`;
  const column = quoted(columnName);
  await expectRoleTransactionDenied(label, client, RUNTIME_DATABASE_ROLES.product, institutionId, async (transaction) => {
    if (actorUserId) {
      await transaction`SELECT set_config('foundry.user_id', ${actorUserId}, true)`;
      await transaction`SELECT set_config('foundry.session_id', 'tenant-harness-course-read', true)`;
      await transaction`SELECT set_config('foundry.auth_method', 'tenant-harness', true)`;
      await transaction`SELECT set_config('foundry.roles', 'LEARNER', true)`;
    }
    const predicate = targetId ? `"id" = $2::uuid` : `ctid = (SELECT ctid FROM ${table} LIMIT 1)`;
    const result = await transaction.unsafe(
      `UPDATE ${table} SET ${column} = $1::uuid WHERE ${predicate}`,
      targetId ? [foreignId, targetId] : [foreignId],
    );
    if (result.count === 0 && zeroRowsArePolicyDenial) throw new Error(`${label} blocked before mutation by row policy`);
    if (result.count !== 1) throw new Error(`${label} requires one visible tenant-A fixture`);
  }, expectedMessage);
}

const productUrl = guardedLocalUrl(process.env.TENANT_TEST_DATABASE_URL ?? process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL, "TENANT_TEST_DATABASE_URL");
const checkpointUrl = guardedLocalUrl(process.env.TENANT_TEST_CHECKPOINT_DATABASE_URL ?? productUrl, "TENANT_TEST_CHECKPOINT_DATABASE_URL");
const product = postgres(productUrl, { max: 1, prepare: false });
const checkpoint = postgres(checkpointUrl, { max: 1, prepare: false });
const tenantA = "10000000-0000-4000-8000-000000000001";
const learnerA = "20000000-0000-4000-8000-000000000001";
const teacherA = "20000000-0000-4000-8000-000000000002";
const courseA = "40000000-0000-4000-8000-000000000001";
const taskA = "80000000-0000-4000-8000-000000000001";
const episodeA = "80000000-0000-4000-8000-000000000002";
const attemptA = "90000000-0000-4000-8000-000000000001";
const observationA = "90000000-0000-4000-8000-000000000002";
const tenantB = randomUUID();
const learnerB = randomUUID();
const subjectB = randomUUID();
const courseB = randomUUID();
const taskB = randomUUID();
const episodeB = randomUUID();
const sourceB = randomUUID();
const evidenceB = randomUUID();
const fileB = randomUUID();
const attemptB = randomUUID();
const observationB = randomUUID();
const reviewB = randomUUID();
const retryB = randomUUID();
const componentB = randomUUID();
const componentVersionB = randomUUID();
const tenantAReviewFixture = randomUUID();
const tenantARetryFixture = randomUUID();
const libraryFixtureA = randomUUID();
const scheduleFixtureA = randomUUID();
const transferFixtureA = randomUUID();
const retentionFixtureA = randomUUID();
const evalFixtureA = randomUUID();
const retrievalA = randomUUID();
const retrievalB = randomUUID();
const checkpointA = randomUUID();
const checkpointB = randomUUID();
const threadA = `${tenantA}:tenant-harness:${checkpointA}`;
const threadB = `${tenantB}:tenant-harness:${checkpointB}`;
const attemptedTaskIds = [randomUUID(), randomUUID()];
const attemptedRetrievalId = randomUUID();
const attemptedDeliveryId = randomUUID();
const attemptedDeliveryKey = `tenant-harness-denied-${attemptedDeliveryId}`;
const attemptedCapabilityResolutionId = randomUUID();
const attemptedCapabilityResolutionHash = `tenant-harness-denied-${attemptedCapabilityResolutionId}`;
const attemptedActivityPlanProposalId = randomUUID();
const attemptedActivityPlanProposalHash = `tenant-harness-denied-${attemptedActivityPlanProposalId}`;
const attemptedActivityPlanId = randomUUID();
const attemptedRuntimeDeliveryId = randomUUID();
const attemptedLearningEventId = randomUUID();
const attemptedOutcomeId = randomUUID();
const attemptedTeacherAssignmentId = randomUUID();
const attemptedTeacherInterventionId = randomUUID();
const attemptedTeacherConstraintId = randomUUID();
const attemptedCheckpointId = randomUUID();
const attemptedCheckpointThread = `${tenantB}:tenant-harness-denied:${attemptedCheckpointId}`;
const authSessionPositiveId = randomUUID();
const attemptedAuthSessionId = randomUUID();
const roleNoneAuthSessionIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const authAuditPrincipal = `tenant-auth-harness:${randomUUID()}`;
const auditPrincipal = `tenant-harness:${randomUUID()}`;
const auditPurpose = "RW-02_DIRECT_DB";
const roleSuffix = randomUUID().replaceAll("-", "").slice(0, 12);
const productionLoginContracts = [
  { login: `rw02_product_login_${roleSuffix}`, runtime: RUNTIME_DATABASE_ROLES.product },
  { login: `rw02_auth_login_${roleSuffix}`, runtime: RUNTIME_DATABASE_ROLES.auth },
  { login: `rw02_worker_login_${roleSuffix}`, runtime: RUNTIME_DATABASE_ROLES.worker },
  { login: `rw02_component_executor_login_${roleSuffix}`, runtime: RUNTIME_DATABASE_ROLES.componentExecutor },
  { login: `rw02_checkpoint_login_${roleSuffix}`, runtime: RUNTIME_DATABASE_ROLES.checkpoint },
] as const;
const inheritingAuthLogin = `rw02_auth_inherit_${roleSuffix}`;
const ambiguousRuntimeLogin = `rw02_ambiguous_login_${roleSuffix}`;
const harnessLoginRoles = [...productionLoginContracts.map(({ login }) => login), inheritingAuthLogin, ambiguousRuntimeLogin];
let harnessLoginRolesCleaned = false;

async function cleanupHarnessLoginRoles(): Promise<void> {
  if (harnessLoginRolesCleaned) return;
  for (const role of harnessLoginRoles) await product.unsafe(`DROP ROLE IF EXISTS ${quoted(role)}`);
  harnessLoginRolesCleaned = true;
}

try {
  await product`
    INSERT INTO foundry_product.institutions (id, slug, name)
    VALUES (${tenantB}::uuid, ${`tenant-harness-${tenantB}`}, 'Tenant harness B')
  `;
  await product`
    INSERT INTO foundry_product.users (id, email, name)
    VALUES (${learnerB}::uuid, ${`tenant-harness-${learnerB}@example.invalid`}, 'Tenant harness learner B')
  `;
  await product`
    INSERT INTO foundry_product.institution_memberships (user_id, institution_id, role)
    VALUES (${learnerB}::uuid, ${tenantB}::uuid, 'LEARNER')
  `;
  await product`
    INSERT INTO foundry_product.subjects (id, institution_id, key, name, reference_pack_key)
    VALUES (${subjectB}::uuid, ${tenantB}::uuid, ${`tenant-harness-${subjectB}`}, 'Tenant harness subject B', 'chemistry-caie-9701')
  `;
  await product`
    INSERT INTO foundry_product.courses (id, institution_id, subject_id, code, name)
    VALUES (${courseB}::uuid, ${tenantB}::uuid, ${subjectB}::uuid, ${`TH-${courseB}`}, 'Tenant harness course B')
  `;
  await product`
    INSERT INTO foundry_product.learning_tasks (id, institution_id, course_id, learner_id, title, goal)
    VALUES (${taskB}::uuid, ${tenantB}::uuid, ${courseB}::uuid, ${learnerB}::uuid, 'Tenant harness task B', 'Direct RLS evidence')
  `;
  await product`
    INSERT INTO foundry_product.learning_episodes (id, task_id, sequence)
    VALUES (${episodeB}::uuid, ${taskB}::uuid, 1)
  `;
  const [capability] = await product<Array<{ id: string; version_id: string; reference_pack_key: string }>>`
    SELECT c.id, c.active_version_id AS version_id, c.reference_pack_key
    FROM foundry_product.capabilities c WHERE c.active_version_id IS NOT NULL ORDER BY c.id LIMIT 1
  `;
  if (!capability) throw new Error("Tenant harness requires one active global Capability");
  await product`UPDATE foundry_product.subjects SET reference_pack_key=${capability.reference_pack_key} WHERE id=${subjectB}::uuid`;
  await product`
    INSERT INTO foundry_product.source_records
      (id, institution_id, course_id, source_key, title, source_type, version, authority, rights,
       rights_authorization_status, distribution_scope, allowed_purposes, content_hash)
    VALUES
      (${sourceB}::uuid, ${tenantB}::uuid, ${courseB}::uuid, ${`tenant-harness-source-${sourceB}`}, 'Tenant B source', 'INTERNAL_NOTE', '1',
       'TENANT_HARNESS', 'Harness only', 'APPROVED', 'INSTITUTION', '["LEARNING"]'::jsonb, ${`hash-${sourceB}`})
  `;
  await product`
    INSERT INTO foundry_product.evidence_units
      (id, source_id, institution_id, modality, locator, title, content, search_document, metadata, content_hash)
    VALUES
      (${evidenceB}::uuid, ${sourceB}::uuid, ${tenantB}::uuid, 'TEXT', 'tenant-b', 'Tenant B evidence', 'Tenant B evidence',
       'Tenant B evidence', '{}'::jsonb, ${`hash-${evidenceB}`})
  `;
  await product`
    INSERT INTO foundry_product.file_assets
      (id, institution_id, course_id, task_id, owner_user_id, source_id, purpose, storage_key, original_name,
       media_type, byte_size, content_hash)
    VALUES
      (${fileB}::uuid, ${tenantB}::uuid, ${courseB}::uuid, ${taskB}::uuid, ${learnerB}::uuid, ${sourceB}::uuid,
       'LEARNER_ATTEMPT', ${`tenant-harness/${fileB}`}, 'tenant-b.txt', 'text/plain', 1, ${`hash-${sourceB}`})
  `;
  await product`
    INSERT INTO foundry_product.learner_attempts
      (id, task_id, episode_id, learner_id, capability_id, file_asset_id, prompt, response, structured_input, source_refs)
    VALUES
      (${attemptB}::uuid, ${taskB}::uuid, ${episodeB}::uuid, ${learnerB}::uuid, ${capability.id}::uuid, ${fileB}::uuid,
       'Tenant B prompt', 'Tenant B response', '{}'::jsonb,
       jsonb_build_array(jsonb_build_object('sourceId', ${sourceB}::text)))
  `;
  await product`
    INSERT INTO foundry_product.diagnostic_observations
      (id, attempt_id, capability_version_id, observation_source, status, failure_code, summary, structured_result, input_lineage, output_lineage)
    VALUES
      (${observationB}::uuid, ${attemptB}::uuid, ${capability.version_id}::uuid, 'CAPABILITY', 'FAILED', 'TENANT_B_FAILURE',
       'Tenant B observation', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
  `;
  await product`
    INSERT INTO foundry_product.teacher_reviews
      (id, observation_id, teacher_id, decision, teaching_support, actor_provenance, idempotency_key)
    VALUES
      (${reviewB}::uuid, ${observationB}::uuid, ${learnerB}::uuid, 'ACCEPT', 'Tenant B reviewed support',
       jsonb_build_object(
         'userId', ${learnerB}::text,
         'institutionId', ${tenantB}::text,
         'roles', jsonb_build_array('TEACHER'),
         'authMethod', 'tenant-harness',
         'sessionId', ${`tenant-b-${reviewB}`}::text,
         'authenticatedAt', now()::text
       ),
       ${`tenant-b-review-${reviewB}`})
  `;
  await product`
    INSERT INTO foundry_product.retry_attempts
      (id, original_attempt_id, reviewed_observation_id, teacher_review_id, activity_type, prompt,
       status, result_attempt_id, result_observation_id, result_review_id)
    VALUES (${retryB}::uuid, ${attemptB}::uuid, ${observationB}::uuid, ${reviewB}::uuid, 'RETRY', 'Tenant B retry',
      'REVIEWED', ${attemptB}::uuid, ${observationB}::uuid, ${reviewB}::uuid)
  `;
  const [componentCandidateFixture] = await product<Array<Record<string, unknown>>>`
    SELECT
      t.institution_id=${tenantB}::uuid AS institution_matches,
      t.course_id=${courseB}::uuid AS course_matches,
      cap.id=${capability.id}::uuid AS capability_matches,
      cap.active_version_id=o.capability_version_id AS active_version_matches,
      s.reference_pack_key=${capability.reference_pack_key} AS subject_pack_matches,
      cap.reference_pack_key=${capability.reference_pack_key} AS capability_pack_matches,
      o.observation_source='CAPABILITY' AS observation_source_matches,
      o.failure_code='TENANT_B_FAILURE' AS failure_matches,
      o.superseded_by_id IS NULL AS observation_current,
      r.decision IN ('ACCEPT','CORRECT','SUPPLEMENT') AS review_accepted,
      r.actor_provenance->>'userId'=r.teacher_id::text AS review_user_matches,
      r.actor_provenance->>'institutionId'=${tenantB} AS review_institution_matches,
      length(COALESCE(r.actor_provenance->>'sessionId',''))>0 AS review_session_present,
      COALESCE(r.actor_provenance->>'authMethod','') NOT LIKE 'migrated-%' AS review_auth_current
    FROM foundry_product.diagnostic_observations o
    JOIN foundry_product.learner_attempts a ON a.id=o.attempt_id
    JOIN foundry_product.learning_tasks t ON t.id=a.task_id
    JOIN foundry_product.courses course_scope ON course_scope.id=t.course_id
    JOIN foundry_product.subjects s ON s.id=course_scope.subject_id
    JOIN foundry_product.capabilities cap ON cap.id=a.capability_id
    JOIN foundry_product.teacher_reviews r ON r.observation_id=o.id
    WHERE o.id=${observationB}::uuid AND r.id=${reviewB}::uuid
  `;
  if (!componentCandidateFixture || Object.values(componentCandidateFixture).some((value) => value !== true)) {
    throw new Error(`Tenant B Component candidate fixture is incomplete: ${JSON.stringify(componentCandidateFixture)}`);
  }
  await product.begin(async (transaction) => {
    await transaction`SELECT set_config('foundry.governance_command', 'component_candidate', true)`;
    await transaction`
      INSERT INTO foundry_product.components
        (id, institution_id, course_id, capability_id, reference_pack_key, failure_code, key, title, source_signal, created_by)
      VALUES
        (${componentB}::uuid, ${tenantB}::uuid, ${courseB}::uuid, ${capability.id}::uuid, ${capability.reference_pack_key}, 'TENANT_B_FAILURE',
         ${`tenant-b-component-${componentB}`}, 'Tenant B Component',
         jsonb_build_object('observationId', ${observationB}::text, 'reviewId', ${reviewB}::text), ${learnerB}::uuid)
    `;
    await transaction`
      INSERT INTO foundry_product.component_versions
        (id, component_id, version, contract, content, source_observation_ids, source_review_ids, validation, content_hash, created_by)
      VALUES
        (${componentVersionB}::uuid, ${componentB}::uuid, '0.0.1', '{}'::jsonb, '{}'::jsonb, ARRAY[${observationB}::uuid], ARRAY[${reviewB}::uuid], '{}'::jsonb, ${`hash-${componentVersionB}`}, ${learnerB}::uuid)
    `;
  });
  await product`
    INSERT INTO foundry_product.teacher_reviews
      (id,observation_id,teacher_id,decision,teaching_support,actor_provenance,idempotency_key)
    VALUES (${tenantAReviewFixture}::uuid,${observationA}::uuid,${teacherA}::uuid,'ACCEPT','Tenant harness lineage fixture',
      jsonb_build_object(
        'userId',${teacherA}::text,'institutionId',${tenantA}::text,'roles',jsonb_build_array('TEACHER'),
        'authMethod','tenant-harness','sessionId',${`tenant-a-${tenantAReviewFixture}`}::text,'authenticatedAt',now()::text
      ),${`tenant-a-review-${tenantAReviewFixture}`})
  `;
  await product`
    INSERT INTO foundry_product.retry_attempts
      (id,original_attempt_id,reviewed_observation_id,teacher_review_id,activity_type,prompt,status)
    VALUES (${tenantARetryFixture}::uuid,${attemptA}::uuid,${observationA}::uuid,${tenantAReviewFixture}::uuid,
      'RETRY','Tenant harness legacy-lineage fixture','ASSIGNED')
  `;
  const tenantARetry = { id: tenantARetryFixture };
  const [tenantAEvidence] = await product<Array<{ id: string }>>`SELECT id FROM foundry_product.evidence_units WHERE institution_id=${tenantA}::uuid ORDER BY created_at LIMIT 1`;
  if (!tenantAEvidence) throw new Error("Tenant harness requires tenant A Evidence");
  await product`INSERT INTO foundry_product.library_items (id, learner_id, course_id, evidence_unit_id, title, reason) VALUES (${libraryFixtureA}::uuid, ${learnerA}::uuid, ${courseA}::uuid, ${tenantAEvidence.id}::uuid, 'Harness library', 'Lineage probe')`;
  await product`INSERT INTO foundry_product.schedule_items (id, learner_id, task_id, activity_type, due_at) VALUES (${scheduleFixtureA}::uuid, ${learnerA}::uuid, ${taskA}::uuid, 'STUDY_REVIEW', now())`;
  await product`INSERT INTO foundry_product.transfer_activities (id, retry_id, target_concept, evidence_unit_id) VALUES (${transferFixtureA}::uuid, ${tenantARetry.id}::uuid, 'Harness transfer', ${tenantAEvidence.id}::uuid)`;
  await product`INSERT INTO foundry_product.retention_reviews (id, retry_id, due_at, evidence_unit_id) VALUES (${retentionFixtureA}::uuid, ${tenantARetry.id}::uuid, now(), ${tenantAEvidence.id}::uuid)`;
  await product`INSERT INTO foundry_operational.eval_runs (id, institution_id, dataset, dataset_version, status, passed, failed, results) VALUES (${evalFixtureA}::uuid, ${tenantA}::uuid, 'tenant-harness', '1', 'COMPLETED', 0, 0, '[]'::jsonb)`;
  await product`
    INSERT INTO foundry_operational.retrieval_runs
      (id, institution_id, task_id, query, purpose, selected_evidence_ids, ranking_evidence, retrieval_mode,
       embedding_status, reranker_status, missing_signal, conflicting_signal, latency_ms)
    VALUES
      (${retrievalA}::uuid, ${tenantA}::uuid, ${taskA}::uuid, 'tenant A fixture', 'LEARNING', '[]'::jsonb, '[]'::jsonb, 'LEXICAL', 'UNAVAILABLE', 'UNAVAILABLE', false, false, 0),
      (${retrievalB}::uuid, ${tenantB}::uuid, ${taskB}::uuid, 'tenant B fixture', 'LEARNING', '[]'::jsonb, '[]'::jsonb, 'LEXICAL', 'UNAVAILABLE', 'UNAVAILABLE', false, false, 0)
  `;
  await checkpoint`
    INSERT INTO langgraph_checkpoint.checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)
    VALUES (${threadA}, '', ${checkpointA}, '{}'::jsonb, '{}'::jsonb), (${threadB}, '', ${checkpointB}, '{}'::jsonb, '{}'::jsonb)
  `;
  await checkpoint`
    INSERT INTO langgraph_checkpoint.checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob)
    VALUES (${threadA}, '', 'tenant-harness', ${checkpointA}, 'json', decode('7b7d','hex')), (${threadB}, '', 'tenant-harness', ${checkpointB}, 'json', decode('7b7d','hex'))
  `;
  await checkpoint`
    INSERT INTO langgraph_checkpoint.checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
    VALUES (${threadA}, '', ${checkpointA}, 'tenant-harness', 0, 'tenant-harness', 'json', decode('7b7d','hex')), (${threadB}, '', ${checkpointB}, 'tenant-harness', 0, 'tenant-harness', 'json', decode('7b7d','hex'))
  `;

  for (const { login, runtime } of productionLoginContracts) {
    await product.unsafe(`CREATE ROLE ${quoted(login)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await product.unsafe(`GRANT ${quoted(runtime)} TO ${quoted(login)}`);
  }
  await product.unsafe(`CREATE ROLE ${quoted(inheritingAuthLogin)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await product.unsafe(`GRANT ${quoted(RUNTIME_DATABASE_ROLES.auth)} TO ${quoted(inheritingAuthLogin)}`);
  await product.unsafe(`CREATE ROLE ${quoted(ambiguousRuntimeLogin)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await product.unsafe(`GRANT ${quoted(RUNTIME_DATABASE_ROLES.auth)}, ${quoted(RUNTIME_DATABASE_ROLES.worker)} TO ${quoted(ambiguousRuntimeLogin)}`);

  const roleRows = await product<Array<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>>`
    SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
    WHERE rolname IN ('foundry_product_runtime','foundry_auth_bootstrap','foundry_worker','foundry_component_executor','foundry_checkpoint_runtime')
    ORDER BY rolname
  `;
  if (roleRows.length !== 5 || roleRows.some((row) => row.rolcanlogin || row.rolsuper || row.rolbypassrls)) throw new Error("Runtime roles are missing, LOGIN, superuser or BYPASSRLS");
  const [executorBoundary] = await product<Array<{
    product_evaluation_execute: boolean;
    product_preview_execute: boolean;
    executor_evaluation_execute: boolean;
    executor_preview_execute: boolean;
    executor_any_table_write: boolean;
  }>>`
    SELECT
      has_function_privilege('foundry_product_runtime','foundry_product.record_web_component_evaluation(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb)','EXECUTE') AS product_evaluation_execute,
      has_function_privilege('foundry_product_runtime','foundry_product.record_component_asset_preview(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text)','EXECUTE') AS product_preview_execute,
      has_function_privilege('foundry_component_executor','foundry_product.record_web_component_evaluation(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb)','EXECUTE') AS executor_evaluation_execute,
      has_function_privilege('foundry_component_executor','foundry_product.record_component_asset_preview(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text)','EXECUTE') AS executor_preview_execute,
      EXISTS (
        SELECT 1 FROM information_schema.role_table_grants grant_row
        WHERE grant_row.grantee='foundry_component_executor' AND grant_row.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
      ) AS executor_any_table_write`;
  if (!executorBoundary || executorBoundary.product_evaluation_execute || executorBoundary.product_preview_execute
    || !executorBoundary.executor_evaluation_execute || !executorBoundary.executor_preview_execute || executorBoundary.executor_any_table_write) {
    throw new Error(`Trusted Component executor boundary is incomplete: ${JSON.stringify(executorBoundary)}`);
  }

  const loginContractRows = await product<Array<{
    rolname: string;
    rolinherit: boolean;
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    memberships: string[];
  }>>`
    SELECT r.rolname, r.rolinherit, r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
      r.rolreplication, r.rolbypassrls,
      ARRAY(
        SELECT parent.rolname
        FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
        WHERE membership.member=r.oid
        ORDER BY parent.rolname
      )::text[] AS memberships
    FROM pg_roles r
    WHERE r.rolname = ANY(${productionLoginContracts.map(({ login }) => login)}::text[])
    ORDER BY r.rolname
  `;
  if (loginContractRows.length !== productionLoginContracts.length) throw new Error("Production login contract fixtures are missing");
  for (const row of loginContractRows) {
    const expected = productionLoginContracts.find(({ login }) => login === row.rolname);
    if (!expected || !row.rolcanlogin || row.rolinherit || row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication || row.rolbypassrls
      || JSON.stringify(row.memberships) !== JSON.stringify([expected.runtime])) {
      throw new Error(`Production login role contract failed: ${JSON.stringify(row)}`);
    }
  }
  const loginOwnedObjects = await product<Array<{ rolname: string; schema_name: string; object_name: string }>>`
    SELECT r.rolname, n.nspname AS schema_name, c.relname AS object_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE r.rolname = ANY(${productionLoginContracts.map(({ login }) => login)}::text[])
      AND n.nspname IN ('foundry_product','foundry_operational','langgraph_checkpoint')
  `;
  if (loginOwnedObjects.length) throw new Error(`Production login fixtures own governed objects: ${JSON.stringify(loginOwnedObjects)}`);

  for (const { login, runtime } of productionLoginContracts) {
    await product.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL SESSION AUTHORIZATION ${quoted(login)}`);
      await transaction.unsafe(`SET LOCAL ROLE ${quoted(runtime)}`);
      const [identity] = await transaction<Array<{ current_user: string; session_user: string; configured_role: string }>>`
        SELECT current_user, session_user, current_setting('role', true) AS configured_role
      `;
      if (!identity || identity.current_user !== runtime || identity.session_user !== login || identity.configured_role !== runtime) {
        throw new Error(`Production login did not SET its exact startup role: ${JSON.stringify(identity)}`);
      }
    });
  }

  const ownedTables = await product<Array<{ rolname: string; schema_name: string; table_name: string }>>`
    SELECT r.rolname, n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE r.rolname IN ('foundry_product_runtime','foundry_auth_bootstrap','foundry_worker','foundry_component_executor','foundry_checkpoint_runtime')
      AND n.nspname IN ('foundry_product','foundry_operational','langgraph_checkpoint') AND c.relkind IN ('r','p')
  `;
  if (ownedTables.length) throw new Error(`Runtime roles own governed tables: ${JSON.stringify(ownedTables)}`);
  const ownedCheckpointTables = await checkpoint<Array<{ rolname: string; schema_name: string; table_name: string }>>`
    SELECT r.rolname, n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE r.rolname='foundry_checkpoint_runtime' AND n.nspname='langgraph_checkpoint' AND c.relkind IN ('r','p')
  `;
  if (ownedCheckpointTables.length) throw new Error(`Checkpoint runtime owns governed tables: ${JSON.stringify(ownedCheckpointTables)}`);

  const startupClients = [
    [RUNTIME_DATABASE_ROLES.product, postgres(withRuntimeDatabaseRole(productUrl, RUNTIME_DATABASE_ROLES.product), { max: 1, prepare: false })],
    [RUNTIME_DATABASE_ROLES.auth, postgres(withRuntimeDatabaseRole(productUrl, RUNTIME_DATABASE_ROLES.auth), { max: 1, prepare: false })],
    [RUNTIME_DATABASE_ROLES.worker, postgres(withRuntimeDatabaseRole(productUrl, RUNTIME_DATABASE_ROLES.worker), { max: 1, prepare: false })],
    [RUNTIME_DATABASE_ROLES.componentExecutor, postgres(withRuntimeDatabaseRole(productUrl, RUNTIME_DATABASE_ROLES.componentExecutor), { max: 1, prepare: false })],
    [RUNTIME_DATABASE_ROLES.checkpoint, postgres(withRuntimeDatabaseRole(checkpointUrl, RUNTIME_DATABASE_ROLES.checkpoint), { max: 1, prepare: false })],
  ] as const;
  try {
    for (const [expectedRole, client] of startupClients) {
      const [identity] = await client<Array<{ current_user: string; session_user: string }>>`SELECT current_user, session_user`;
      if (identity?.current_user !== expectedRole) throw new Error(`Startup role assumption failed for ${expectedRole}`);
    }
  } finally {
    await Promise.all(startupClients.map(([, client]) => client.end()));
  }

  const uncovered = await product<Array<{ schema_name: string; table_name: string }>>`
    SELECT c.schema_name, c.table_name
    FROM foundry_private.table_authority_catalog c
    LEFT JOIN pg_namespace pn ON pn.nspname = c.schema_name
    LEFT JOIN pg_class pc ON pc.relnamespace = pn.oid AND pc.relname = c.table_name
    WHERE c.policy_required AND (pn.oid IS NULL OR pc.oid IS NULL OR NOT pc.relrowsecurity OR NOT pc.relforcerowsecurity
      OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = pc.oid))
  `;
  if (uncovered.length) throw new Error(`Uncovered RLS tables: ${JSON.stringify(uncovered)}`);

  const catalog = await product<CatalogRow[]>`
    SELECT schema_name, table_name, classification, policy_required
    FROM foundry_private.table_authority_catalog
    WHERE policy_required
    ORDER BY schema_name, table_name
  `;
  const tenantTables = catalog.filter((row) => !row.classification.startsWith("GLOBAL_REFERENCE") && row.classification !== "AUTH_BOOTSTRAP_ONLY");
  const globalTables = catalog.filter((row) => row.classification.startsWith("GLOBAL_REFERENCE"));

  const writableInventoryGaps = await product<Array<{ schema_name: string; table_name: string; catalog_roles: string[] | null; actual_roles: string[] | null; guarded: boolean }>>`
    WITH runtime_grants AS (
      SELECT table_schema AS schema_name, table_name, grantee::text AS role_name
      FROM information_schema.role_table_grants
      WHERE grantee IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap') AND privilege_type IN ('INSERT','UPDATE','DELETE')
      UNION
      SELECT table_schema AS schema_name, table_name, grantee::text AS role_name
      FROM information_schema.role_column_grants
      WHERE grantee IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap') AND privilege_type IN ('INSERT','UPDATE','DELETE')
    ), actual AS (
      SELECT schema_name, table_name, array_agg(role_name ORDER BY role_name)::text[] AS roles
      FROM runtime_grants
      GROUP BY schema_name, table_name
    ), inventory AS (
      SELECT schema_name, table_name, ARRAY(SELECT unnest(writable_roles) ORDER BY 1) AS roles
      FROM foundry_private.writable_lineage_catalog
    )
    SELECT COALESCE(i.schema_name,a.schema_name) AS schema_name, COALESCE(i.table_name,a.table_name) AS table_name,
      i.roles AS catalog_roles, a.roles AS actual_roles,
      EXISTS (
        SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=COALESCE(i.schema_name,a.schema_name) AND c.relname=COALESCE(i.table_name,a.table_name)
          AND t.tgname='_authority_tenant_lineage_guard' AND NOT t.tgisinternal
      ) AS guarded
    FROM inventory i FULL JOIN actual a USING (schema_name,table_name)
    WHERE i.roles IS DISTINCT FROM a.roles OR NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=COALESCE(i.schema_name,a.schema_name) AND c.relname=COALESCE(i.table_name,a.table_name)
        AND t.tgname='_authority_tenant_lineage_guard' AND NOT t.tgisinternal
    )
  `;
  if (writableInventoryGaps.length) throw new Error(`Writable lineage inventory gaps: ${JSON.stringify(writableInventoryGaps)}`);

  const [userPrivileges] = await product<Array<{ product_id: boolean; product_password: boolean; worker_id: boolean; worker_password: boolean }>>`
    SELECT
      has_column_privilege('foundry_product_runtime','foundry_product.users','id','SELECT') AS product_id,
      has_column_privilege('foundry_product_runtime','foundry_product.users','password_hash','SELECT') AS product_password,
      has_column_privilege('foundry_worker','foundry_product.users','id','SELECT') AS worker_id,
      has_column_privilege('foundry_worker','foundry_product.users','password_hash','SELECT') AS worker_password
  `;
  if (!userPrivileges?.product_id || userPrivileges.worker_id || userPrivileges.product_password || userPrivileges.worker_password) {
    throw new Error(`Password verifier privilege boundary failed: ${JSON.stringify(userPrivileges)}`);
  }
  const workerReadableTables = await product<Array<{ table_key: string }>>`
    SELECT table_schema || '.' || table_name AS table_key
    FROM information_schema.role_table_grants
    WHERE grantee='foundry_worker' AND privilege_type='SELECT'
      AND table_schema IN ('foundry_product','foundry_operational')
    ORDER BY table_schema, table_name
  `;
  const expectedWorkerReads = [
    "foundry_operational.model_runs",
    "foundry_operational.retrieval_runs",
    "foundry_operational.security_events",
    "foundry_operational.workflow_runs",
    "foundry_product.courses",
    "foundry_product.evidence_units",
    "foundry_product.file_assets",
    "foundry_product.institution_memberships",
    "foundry_product.institutions",
    "foundry_product.learning_episodes",
    "foundry_product.learning_tasks",
    "foundry_product.source_records",
  ];
  if (JSON.stringify(workerReadableTables.map((row) => row.table_key)) !== JSON.stringify(expectedWorkerReads)) {
    throw new Error(`Worker read privilege boundary failed: ${JSON.stringify(workerReadableTables)}`);
  }
  await expectRoleTransactionDenied("Product runtime password verifier read", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`SELECT password_hash FROM foundry_product.users LIMIT 1`;
  }, /permission denied/);
  await expectRoleTransactionDenied("Worker password verifier read", product, RUNTIME_DATABASE_ROLES.worker, tenantA, async (transaction) => {
    await transaction`SELECT password_hash FROM foundry_product.users LIMIT 1`;
  }, /permission denied/);

  await product.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    for (const row of tenantTables) await expectReadAndWriteDenied(transaction as unknown as Sql, row);
    for (const row of globalTables) {
      const privilege = await transaction<Array<{ writable: boolean }>>`
        SELECT has_table_privilege(current_user, ${`${row.schema_name}.${row.table_name}`}, 'INSERT,UPDATE,DELETE') AS writable
      `;
      if (privilege[0]?.writable) throw new Error(`${row.schema_name}.${row.table_name} is not read-only to product runtime`);
    }
  });

  await product.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`SELECT set_config('foundry.institution_id', ${randomUUID()}, true)`;
    for (const row of tenantTables) await expectReadAndWriteDenied(transaction as unknown as Sql, row);
  });

  await product.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`SELECT set_config('foundry.institution_id', ${tenantA}, true)`;
    const [positive] = await transaction<Array<{ direct_a: number; direct_b: number; indirect_a: number; indirect_b: number; operational_a: number; operational_b: number }>>`
      SELECT
        (SELECT count(*)::int FROM foundry_product.learning_tasks WHERE id=${taskA}::uuid) AS direct_a,
        (SELECT count(*)::int FROM foundry_product.learning_tasks WHERE id=${taskB}::uuid) AS direct_b,
        (SELECT count(*)::int FROM foundry_product.learning_episodes WHERE id=${episodeA}::uuid) AS indirect_a,
        (SELECT count(*)::int FROM foundry_product.learning_episodes WHERE id=${episodeB}::uuid) AS indirect_b,
        (SELECT count(*)::int FROM foundry_operational.retrieval_runs WHERE id=${retrievalA}::uuid) AS operational_a,
        (SELECT count(*)::int FROM foundry_operational.retrieval_runs WHERE id=${retrievalB}::uuid) AS operational_b
    `;
    if (!positive || positive.direct_a !== 1 || positive.indirect_a !== 1 || positive.operational_a !== 1
      || positive.direct_b !== 0 || positive.indirect_b !== 0 || positive.operational_b !== 0) {
      throw new Error(`Two-tenant product positive/negative control failed: ${JSON.stringify(positive)}`);
    }
    const updated = await transaction`UPDATE foundry_product.learning_tasks SET title=title WHERE id=${taskA}::uuid`;
    if (updated.count !== 1) throw new Error("Same-tenant direct UPDATE positive control failed");
  });

  const directlyProbedWritableTables = new Set<string>();
  const probeUuidLineage = async (input: {
    label: string;
    schemaName: string;
    tableName: string;
    columnName: string;
    foreignId: string;
    expectedMessage: RegExp;
    targetId?: string;
    actorUserId?: string;
    zeroRowsArePolicyDenial?: boolean;
  }) => {
    await expectCrossTenantUuidUpdateDenied(
      input.label,
      product,
      tenantA,
      input.schemaName,
      input.tableName,
      input.columnName,
      input.foreignId,
      input.expectedMessage,
      input.targetId,
      input.actorUserId,
      input.zeroRowsArePolicyDenial,
    );
    directlyProbedWritableTables.add(`${input.schemaName}.${input.tableName}`);
  };

  await expectRoleTransactionDenied("CapabilityResolution insert with tenant B Task", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    const inserted = await transaction`
      INSERT INTO foundry_product.capability_resolutions
        (id, institution_id, course_id, task_id, episode_id, context_compilation_id,
         diagnostic_observation_id, policy_version, input_hash, decision, candidate_set,
         selected_capability_id, selected_capability_version_id, selection_rationale,
         parameterization_recommendation, composition_recommendation, gap_signal,
         no_match, teacher_escalation, created_by)
      SELECT
        ${attemptedCapabilityResolutionId}::uuid, institution_id, course_id, ${taskB}::uuid, ${episodeB}::uuid,
        context_compilation_id, diagnostic_observation_id, policy_version, ${attemptedCapabilityResolutionHash},
        decision, candidate_set, selected_capability_id, selected_capability_version_id,
        selection_rationale, parameterization_recommendation, composition_recommendation,
        gap_signal, no_match, teacher_escalation, created_by
      FROM foundry_product.capability_resolutions
      ORDER BY created_at
      LIMIT 1
    `;
    if (inserted.count !== 1) throw new Error("CapabilityResolution probe requires one visible tenant-A fixture");
  }, /CAP-02 CapabilityResolution Task\/Episode tenant lineage mismatch|CAP-07 freshness lock requires the active Task tenant/);
  directlyProbedWritableTables.add("foundry_product.capability_resolutions");

  await expectRoleTransactionDenied("ActivityPlanProposal insert with tenant B Task", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    const inserted = await transaction`
      INSERT INTO foundry_product.activity_plan_proposals
        (id, institution_id, course_id, task_id, episode_id, context_compilation_id,
         diagnostic_observation_id, capability_resolution_id, policy_version, input_hash,
         state, resolution_decision, selected_capability_id, selected_capability_version_id,
         selected_version_content_hash, rationale, stages, teacher_constraints,
         teacher_intervention, retry_intent, runtime_handoff, block_reasons, created_by)
      SELECT
        ${attemptedActivityPlanProposalId}::uuid, institution_id, course_id, ${taskB}::uuid, ${episodeB}::uuid,
        context_compilation_id, diagnostic_observation_id, capability_resolution_id, policy_version,
        ${attemptedActivityPlanProposalHash}, state, resolution_decision, selected_capability_id,
        selected_capability_version_id, selected_version_content_hash, rationale, stages,
        teacher_constraints, teacher_intervention, retry_intent, runtime_handoff, block_reasons, created_by
      FROM foundry_product.activity_plan_proposals
      ORDER BY created_at
      LIMIT 1
    `;
    if (inserted.count !== 1) throw new Error("ActivityPlanProposal probe requires one visible tenant-A fixture");
  }, /CAP-03 ActivityPlanProposal Task\/Episode tenant lineage mismatch|CAP-07 freshness lock requires the active Task tenant/);
  directlyProbedWritableTables.add("foundry_product.activity_plan_proposals");

  await expectRoleTransactionDenied("ActivityPlan insert with tenant B Task", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    const inserted = await transaction`
      INSERT INTO foundry_product.activity_plans
        (id, institution_id, course_id, task_id, episode_id, activity_plan_proposal_id,
         context_compilation_id, diagnostic_observation_id, capability_resolution_id,
         capability_id, capability_version_id, capability_version_content_hash,
         runtime_contract_hash, implementation_key, runtime_kind, stage_order,
         stage_snapshot, runtime_contract, evidence_provenance, input_hash, created_by)
      SELECT
        ${attemptedActivityPlanId}::uuid, institution_id, course_id, ${taskB}::uuid, ${episodeB}::uuid,
        activity_plan_proposal_id, context_compilation_id, diagnostic_observation_id,
        capability_resolution_id, capability_id, capability_version_id,
        capability_version_content_hash, runtime_contract_hash, implementation_key,
        runtime_kind, stage_order, stage_snapshot, runtime_contract, evidence_provenance,
        ${`tenant-harness-denied-${attemptedActivityPlanId}`}, created_by
      FROM foundry_product.activity_plans
      ORDER BY created_at
      LIMIT 1
    `;
    if (inserted.count !== 1) throw new Error("ActivityPlan probe requires one visible tenant-A fixture");
  }, /CAP-04 ActivityPlan exact READY lineage mismatch/);
  directlyProbedWritableTables.add("foundry_product.activity_plans");

  await expectRoleTransactionDenied("RuntimeDelivery insert with tenant B Task", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    const inserted = await transaction`
      INSERT INTO foundry_product.runtime_deliveries
        (id, institution_id, course_id, task_id, episode_id, learner_id, activity_plan_id,
         capability_id, capability_version_id, capability_version_content_hash,
         runtime_contract_hash, implementation_key, runtime_kind, request_hash,
         idempotency_key, status, deadline_ms)
      SELECT
        ${attemptedRuntimeDeliveryId}::uuid, institution_id, course_id, ${taskB}::uuid, ${episodeB}::uuid,
        learner_id, activity_plan_id, capability_id, capability_version_id,
        capability_version_content_hash, runtime_contract_hash, implementation_key,
        runtime_kind, ${`tenant-harness-denied-${attemptedRuntimeDeliveryId}`},
        ${`tenant-harness-denied-${attemptedRuntimeDeliveryId}`}, 'PENDING', deadline_ms
      FROM foundry_product.runtime_deliveries
      ORDER BY started_at
      LIMIT 1
    `;
    if (inserted.count !== 1) throw new Error("RuntimeDelivery probe requires one visible tenant-A fixture");
  }, /RuntimeDelivery ActivityPlan\/exact-version lineage mismatch/);
  directlyProbedWritableTables.add("foundry_product.runtime_deliveries");

  await expectRoleTransactionDenied("LearningEvent insert with tenant B Task", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    const inserted = await transaction`
      INSERT INTO foundry_product.learning_events
        (id, institution_id, course_id, task_id, episode_id, activity_plan_id,
         runtime_delivery_id, sequence, event_key, event_type, actor_type,
         actor_user_id, payload, evidence_refs)
      SELECT
        ${attemptedLearningEventId}::uuid, institution_id, course_id, ${taskB}::uuid, ${episodeB}::uuid,
        activity_plan_id, runtime_delivery_id, sequence,
        ${`tenant-harness-denied-${attemptedLearningEventId}`}, event_type, actor_type,
        actor_user_id, payload, evidence_refs
      FROM foundry_product.learning_events
      ORDER BY created_at
      LIMIT 1
    `;
    if (inserted.count !== 1) throw new Error("LearningEvent probe requires one visible tenant-A fixture");
  }, /LearningEvent delivery\/actor lineage mismatch/);
  directlyProbedWritableTables.add("foundry_product.learning_events");

  await expectRoleTransactionDenied("TeacherAssignment insert outside current tenant/actor", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO foundry_product.teacher_assignments
        (id,institution_id,course_id,learner_id,task_id,teacher_id,instructions,completion_rule,actor_provenance,idempotency_key)
      VALUES (${attemptedTeacherAssignmentId}::uuid,${tenantB}::uuid,${courseB}::uuid,${learnerB}::uuid,${taskB}::uuid,${learnerB}::uuid,
        'Denied tenant assignment','Denied tenant completion',
        jsonb_build_object('userId',${learnerB}::text,'institutionId',${tenantB}::text,'roles',jsonb_build_array('TEACHER'),'authMethod','tenant-harness','sessionId','denied','authenticatedAt',now()::text),
        ${`tenant-harness-denied-${attemptedTeacherAssignmentId}`})
    `;
  }, /CAP-05 assignment actor\/course denied|row-level security/);
  directlyProbedWritableTables.add("foundry_product.teacher_assignments");

  await expectRoleTransactionDenied("TeacherIntervention insert outside current tenant/actor", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO foundry_product.teacher_interventions
        (id,institution_id,course_id,task_id,episode_id,runtime_delivery_id,learner_attempt_id,activity_plan_id,
         diagnostic_observation_id,context_compilation_id,capability_resolution_id,capability_version_id,
         constraint_capability_id,constraint_capability_key_snapshot,teacher_id,action_type,reason,target_lineage,actor_provenance,idempotency_key)
      VALUES (${attemptedTeacherInterventionId}::uuid,${tenantB}::uuid,${courseB}::uuid,${taskB}::uuid,${episodeB}::uuid,
        ${randomUUID()}::uuid,${attemptB}::uuid,${randomUUID()}::uuid,${observationB}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,
        ${capability.version_id}::uuid,${capability.id}::uuid,'denied-capability',${learnerB}::uuid,'REQUIRE_CAPABILITY','Denied intervention',
        jsonb_build_object('taskId',${taskB}::text),
        jsonb_build_object('userId',${learnerB}::text,'institutionId',${tenantB}::text,'roles',jsonb_build_array('TEACHER'),'authMethod','tenant-harness','sessionId','denied','authenticatedAt',now()::text),
        ${`tenant-harness-denied-${attemptedTeacherInterventionId}`})
    `;
  }, /CAP-05 intervention actor\/course denied|row-level security/);
  directlyProbedWritableTables.add("foundry_product.teacher_interventions");

  await expectRoleTransactionDenied("TeacherCapabilityConstraint insert outside current tenant/actor", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO foundry_product.teacher_capability_constraints
        (id,institution_id,course_id,task_id,episode_id,teacher_id,effect,capability_id,capability_key_snapshot,reason,source_assignment_id)
      VALUES (${attemptedTeacherConstraintId}::uuid,${tenantB}::uuid,${courseB}::uuid,${taskB}::uuid,${episodeB}::uuid,
        ${learnerB}::uuid,'REQUIRE',${capability.id}::uuid,'denied-capability','Denied constraint',${attemptedTeacherAssignmentId}::uuid)
    `;
  }, /CAP-05 constraint actor\/tenant denied|row-level security/);
  directlyProbedWritableTables.add("foundry_product.teacher_capability_constraints");

  await expectRoleTransactionDenied("LearningTask insert with tenant B course", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO foundry_product.learning_tasks (id, institution_id, course_id, learner_id, title, goal)
      VALUES (${attemptedTaskIds[0]}::uuid, ${tenantA}::uuid, ${courseB}::uuid, ${learnerA}::uuid, 'Denied cross-course task', 'Must not commit')
    `;
  }, /learning Task tenant lineage mismatch/);
  directlyProbedWritableTables.add("foundry_product.learning_tasks");
  await expectRoleTransactionDenied("LearningTask insert with tenant B learner", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO foundry_product.learning_tasks (id, institution_id, course_id, learner_id, title, goal)
      VALUES (${attemptedTaskIds[1]}::uuid, ${tenantA}::uuid, ${courseA}::uuid, ${learnerB}::uuid, 'Denied cross-learner task', 'Must not commit')
    `;
  }, /learning Task tenant lineage mismatch/);
  await expectRoleTransactionDenied("LearningTask update to tenant B learner", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`UPDATE foundry_product.learning_tasks SET learner_id=${learnerB}::uuid WHERE id=${taskA}::uuid`;
  }, /learning Task tenant lineage mismatch/);

  await probeUuidLineage({ label: "LearningEpisode update to tenant B task", schemaName: "foundry_product", tableName: "learning_episodes", columnName: "task_id", foreignId: taskB, expectedMessage: /Episode Task tenant lineage mismatch/ });
  await probeUuidLineage({ label: "ConversationEvent update to tenant B actor", schemaName: "foundry_product", tableName: "conversation_events", columnName: "actor_user_id", foreignId: learnerB, expectedMessage: /ConversationEvent tenant lineage mismatch/ });
  await probeUuidLineage({ label: "SourceRecord update to tenant B course", schemaName: "foundry_product", tableName: "source_records", columnName: "course_id", foreignId: courseB, expectedMessage: /Source scope tenant lineage mismatch/ });
  await probeUuidLineage({ label: "FileAsset update to tenant B course", schemaName: "foundry_product", tableName: "file_assets", columnName: "course_id", foreignId: courseB, expectedMessage: /FileAsset tenant lineage mismatch/ });
  await probeUuidLineage({ label: "EvidenceUnit update to tenant B source", schemaName: "foundry_product", tableName: "evidence_units", columnName: "source_id", foreignId: sourceB, expectedMessage: /EvidenceUnit tenant lineage mismatch/ });
  await probeUuidLineage({ label: "ContextCompilation update to tenant B task", schemaName: "foundry_product", tableName: "context_compilations", columnName: "task_id", foreignId: taskB, expectedMessage: /ContextCompilation tenant lineage mismatch/ });
  await probeUuidLineage({ label: "LearnerAttempt update to tenant B task", schemaName: "foundry_product", tableName: "learner_attempts", columnName: "task_id", foreignId: taskB, expectedMessage: /LearnerAttempt tenant lineage mismatch/ });
  await probeUuidLineage({ label: "DiagnosticObservation update to tenant B attempt", schemaName: "foundry_product", tableName: "diagnostic_observations", columnName: "attempt_id", foreignId: attemptB, expectedMessage: /DiagnosticObservation tenant lineage mismatch/ });
  await probeUuidLineage({ label: "TeacherReview update to tenant B observation", schemaName: "foundry_product", tableName: "teacher_reviews", columnName: "observation_id", foreignId: observationB, expectedMessage: /TeacherReview tenant lineage mismatch/ });
  await probeUuidLineage({ label: "RetryAttempt update to tenant B attempt", schemaName: "foundry_product", tableName: "retry_attempts", columnName: "original_attempt_id", foreignId: attemptB, targetId: tenantARetry.id, expectedMessage: /Retry tenant lineage mismatch/ });
  await probeUuidLineage({ label: "TransferActivity update to tenant B evidence", schemaName: "foundry_product", tableName: "transfer_activities", columnName: "evidence_unit_id", foreignId: evidenceB, targetId: transferFixtureA, expectedMessage: /Transfer tenant lineage mismatch/ });
  await probeUuidLineage({ label: "RetentionReview update to tenant B evidence", schemaName: "foundry_product", tableName: "retention_reviews", columnName: "evidence_unit_id", foreignId: evidenceB, targetId: retentionFixtureA, expectedMessage: /Retention tenant lineage mismatch/ });
  await expectRoleTransactionDenied("LearningOutcome insert with tenant B Task", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO foundry_product.learning_outcomes
        (id,task_id,retry_id,result_review_id,teacher_id,outcome_type,status,evidence_refs,narrative,actor_provenance,idempotency_key)
      VALUES (${attemptedOutcomeId}::uuid,${taskB}::uuid,${retryB}::uuid,${reviewB}::uuid,${learnerB}::uuid,
        'RETRY','REVIEWED','[]'::jsonb,'Denied cross-tenant Outcome probe',
        jsonb_build_object('institutionId',${tenantB}::text,'userId',${learnerB}::text),
        ${`tenant-harness-denied-outcome:${attemptedOutcomeId}`})
    `;
  }, /LearningOutcome tenant lineage mismatch|row-level security/);
  directlyProbedWritableTables.add("foundry_product.learning_outcomes");
  await probeUuidLineage({ label: "Component update to tenant B course", schemaName: "foundry_product", tableName: "components", columnName: "course_id", foreignId: courseB, actorUserId: learnerA, expectedMessage: /Component tenant lineage mismatch|row-level security policy/ });
  await probeUuidLineage({ label: "ComponentVersion update to tenant B component", schemaName: "foundry_product", tableName: "component_versions", columnName: "component_id", foreignId: componentB, actorUserId: learnerA, expectedMessage: /ComponentVersion tenant lineage mismatch|Terminal Component versions are immutable|row-level security policy/ });
  await probeUuidLineage({ label: "ComponentEvaluation update to tenant B version", schemaName: "foundry_product", tableName: "component_evaluations", columnName: "component_version_id", foreignId: componentVersionB, actorUserId: learnerA, zeroRowsArePolicyDenial: true, expectedMessage: /ComponentEvaluation tenant lineage mismatch|Component evaluations are immutable|row-level security policy|blocked before mutation by row policy/ });
  await probeUuidLineage({ label: "PublicationDecision update to tenant B version", schemaName: "foundry_product", tableName: "publication_decisions", columnName: "component_version_id", foreignId: componentVersionB, actorUserId: learnerA, zeroRowsArePolicyDenial: true, expectedMessage: /PublicationDecision tenant lineage mismatch|Publication decisions are immutable|row-level security policy|blocked before mutation by row policy/ });

  await expectRoleTransactionDenied("ComponentDelivery insert with tenant A scope and tenant B course", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    const inserted = await transaction`
      INSERT INTO foundry_product.component_deliveries
        (id, institution_id, course_id, task_id, episode_id, component_id, component_version_id,
         observation_id, review_id, delivered_by, audience, support_snapshot, idempotency_key)
      SELECT
        ${attemptedDeliveryId}::uuid, institution_id, ${courseB}::uuid, task_id, episode_id, component_id,
        component_version_id, observation_id, review_id, delivered_by, audience, support_snapshot, ${attemptedDeliveryKey}
      FROM foundry_product.component_deliveries
      ORDER BY created_at
      LIMIT 1
    `;
    if (inserted.count !== 1) throw new Error("ComponentDelivery probe requires one visible tenant-A fixture");
  }, /ComponentDelivery tenant lineage mismatch/);
  directlyProbedWritableTables.add("foundry_product.component_deliveries");

  await probeUuidLineage({ label: "LibraryItem update to tenant B evidence", schemaName: "foundry_product", tableName: "library_items", columnName: "evidence_unit_id", foreignId: evidenceB, expectedMessage: /LibraryItem tenant lineage mismatch/ });
  await probeUuidLineage({ label: "ScheduleItem update to tenant B task", schemaName: "foundry_product", tableName: "schedule_items", columnName: "task_id", foreignId: taskB, expectedMessage: /ScheduleItem tenant lineage mismatch/ });
  await probeUuidLineage({ label: "GovernanceEvent update to tenant B entity", schemaName: "foundry_product", tableName: "governance_events", columnName: "entity_id", foreignId: taskB, expectedMessage: /GovernanceEvent tenant lineage mismatch|GovernanceEvents are append-only/ });

  await expectRoleTransactionDenied("IdempotencyKey update to tenant B result", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    const updated = await transaction`
      UPDATE foundry_product.idempotency_keys
      SET command_type='CREATE_TASK', result_id=${taskB}::uuid
      WHERE ctid=(SELECT ctid FROM foundry_product.idempotency_keys LIMIT 1)
    `;
    if (updated.count !== 1) throw new Error("IdempotencyKey probe requires one visible tenant-A fixture");
  }, /Idempotency result tenant lineage mismatch/);
  directlyProbedWritableTables.add("foundry_product.idempotency_keys");

  await probeUuidLineage({ label: "WorkflowRun update to tenant B task", schemaName: "foundry_operational", tableName: "workflow_runs", columnName: "task_id", foreignId: taskB, expectedMessage: /WorkflowRun tenant lineage mismatch/ });
  await expectRoleTransactionDenied("Retrieval insert with tenant B task", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO foundry_operational.retrieval_runs
        (id, institution_id, task_id, query, purpose, selected_evidence_ids, ranking_evidence, retrieval_mode,
         embedding_status, reranker_status, missing_signal, conflicting_signal, latency_ms)
      VALUES
        (${attemptedRetrievalId}::uuid, ${tenantA}::uuid, ${taskB}::uuid, 'denied cross-tenant retrieval', 'LEARNING', '[]'::jsonb, '[]'::jsonb, 'LEXICAL', 'UNAVAILABLE', 'UNAVAILABLE', false, false, 0)
    `;
  }, /RetrievalRun tenant lineage mismatch/);
  directlyProbedWritableTables.add("foundry_operational.retrieval_runs");
  await expectRoleTransactionDenied("Retrieval update to tenant B task", product, RUNTIME_DATABASE_ROLES.product, tenantA, async (transaction) => {
    await transaction`UPDATE foundry_operational.retrieval_runs SET task_id=${taskB}::uuid WHERE id=${retrievalA}::uuid`;
  }, /RetrievalRun tenant lineage mismatch/);
  await probeUuidLineage({ label: "ModelRun update to tenant B task", schemaName: "foundry_operational", tableName: "model_runs", columnName: "task_id", foreignId: taskB, expectedMessage: /ModelRun tenant lineage mismatch/ });
  await probeUuidLineage({ label: "EvalRun update to tenant B institution", schemaName: "foundry_operational", tableName: "eval_runs", columnName: "institution_id", foreignId: tenantB, expectedMessage: /EvalRun tenant lineage mismatch/ });

  await product.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_worker");
    for (const row of tenantTables) await expectReadAndWriteDenied(transaction as unknown as Sql, row);
    await transaction`SELECT set_config('foundry.institution_id', ${randomUUID()}, true)`;
    for (const row of tenantTables) await expectReadAndWriteDenied(transaction as unknown as Sql, row);
  });

  const workerProductWrite = await product<Array<{ allowed: boolean }>>`
    SELECT has_table_privilege('foundry_worker', 'foundry_product.learning_tasks', 'INSERT,UPDATE,DELETE') AS allowed
  `;
  if (workerProductWrite[0]?.allowed) throw new Error("Worker role holds canonical Product State write authority");

  process.env.PRODUCT_DATABASE_URL = productUrl;
  process.env.CHECKPOINT_DATABASE_URL = checkpointUrl;
  process.env.WORKER_DATABASE_URL = productUrl;
  process.env.FOUNDRY_SERVICE_GRANTS = JSON.stringify([{ principal: auditPrincipal, purposes: [auditPurpose], institutionIds: [tenantA] }]);
  const serviceIdentity = await withServiceTenantContext({ principal: auditPrincipal, purpose: auditPurpose, institutionId: tenantA }, async (sql) => {
    const [row] = await sql<Array<{ current_user: string; institution_id: string; service_principal: string; service_purpose: string }>>`
      SELECT current_user,
        current_setting('foundry.institution_id') AS institution_id,
        current_setting('foundry.service_principal') AS service_principal,
        current_setting('foundry.service_purpose') AS service_purpose
    `;
    return row;
  });
  if (!serviceIdentity || serviceIdentity.current_user !== RUNTIME_DATABASE_ROLES.worker
    || serviceIdentity.institution_id !== tenantA || serviceIdentity.service_principal !== auditPrincipal
    || serviceIdentity.service_purpose !== auditPurpose) {
    throw new Error(`Audited service facade did not establish its exact runtime scope: ${JSON.stringify(serviceIdentity)}`);
  }
  const serviceAudit = await product<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM foundry_operational.security_events
    WHERE principal=${auditPrincipal} AND purpose=${auditPurpose} AND event_code='SERVICE_INVOCATION'
  `;
  if (serviceAudit[0]?.count !== 1) throw new Error("Scoped worker invocation did not emit one durable service audit record");

  let ungrantedOperationRan = false;
  await expectDenied("Ungranted worker purpose", async () => withServiceTenantContext(
    { principal: auditPrincipal, purpose: "RW-02_UNGRANTED", institutionId: tenantA },
    async () => { ungrantedOperationRan = true; },
  ), /not allowlisted/);
  if (ungrantedOperationRan) throw new Error("Ungranted worker callback executed");

  await expectDenied("Audited worker canonical Product State write", async () => withServiceTenantContext(
    { principal: auditPrincipal, purpose: auditPurpose, institutionId: tenantA },
    async (sql) => sql`
      INSERT INTO foundry_product.learning_tasks (id, institution_id, course_id, learner_id, title, goal)
      VALUES (${randomUUID()}::uuid, ${tenantA}::uuid, ${courseA}::uuid, ${learnerA}::uuid, 'Forbidden worker write', 'Must fail')
    `,
  ), /permission denied/);

  await expectDenied("Audited worker cross-tenant security event", async () => withServiceTenantContext(
    { principal: auditPrincipal, purpose: auditPurpose, institutionId: tenantA },
    async (sql) => sql`
      INSERT INTO foundry_operational.security_events
        (institution_id, event_class, event_code, principal, purpose, detail)
      VALUES (${tenantB}::uuid, 'SERVICE', 'SERVICE_INVOCATION', ${auditPrincipal}, ${auditPurpose}, '{}'::jsonb)
    `,
  ), /Service audit tenant lineage mismatch|new row violates row-level security policy/);
  directlyProbedWritableTables.add("foundry_operational.security_events");

  const afterRolledBackServiceAttempts = await product<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM foundry_operational.security_events
    WHERE principal=${auditPrincipal} AND purpose=${auditPurpose} AND event_code='SERVICE_INVOCATION'
  `;
  if (afterRolledBackServiceAttempts[0]?.count !== 1) throw new Error("Denied service work did not roll back its invocation audit atomically");

  const missingInstitution = randomUUID();
  process.env.FOUNDRY_SERVICE_GRANTS = JSON.stringify([{ principal: auditPrincipal, purposes: [auditPurpose], institutionIds: [missingInstitution] }]);
  let auditFailureOperationRan = false;
  await expectDenied("Service audit persistence failure", async () => withServiceTenantContext(
    { principal: auditPrincipal, purpose: auditPurpose, institutionId: missingInstitution },
    async () => { auditFailureOperationRan = true; },
  ));
  if (auditFailureOperationRan) throw new Error("Worker callback ran before its durable service audit was accepted");

  await closeServiceAuthority();
  await product`DELETE FROM foundry_operational.security_events WHERE principal = ${auditPrincipal}`;

  const [authIdentityA] = await product<Array<{ id: string }>>`
    SELECT id FROM foundry_product.auth_identities
    WHERE user_id=${learnerA}::uuid AND active
    ORDER BY created_at LIMIT 1
  `;
  if (!authIdentityA) throw new Error("Tenant harness requires one active tenant-A authentication identity");
  await product.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_auth_bootstrap");
    const inserted = await transaction`
      INSERT INTO foundry_product.auth_sessions
        (id, identity_id, user_id, institution_id, expires_at)
      VALUES
        (${authSessionPositiveId}::uuid, ${authIdentityA.id}::uuid, ${learnerA}::uuid, ${tenantA}::uuid, now() + interval '1 hour')
    `;
    if (inserted.count !== 1) throw new Error("Valid auth-session positive control did not insert");
    const updated = await transaction`
      UPDATE foundry_product.auth_sessions SET last_verified_at=now() WHERE id=${authSessionPositiveId}::uuid
    `;
    if (updated.count !== 1) throw new Error("Valid auth-session positive control did not update");
  });
  const [validAuthSession] = await product<Array<{ user_id: string; institution_id: string }>>`
    SELECT user_id, institution_id FROM foundry_product.auth_sessions WHERE id=${authSessionPositiveId}::uuid
  `;
  if (!validAuthSession || validAuthSession.user_id !== learnerA || validAuthSession.institution_id !== tenantA) {
    throw new Error(`Valid auth-session positive control has wrong lineage: ${JSON.stringify(validAuthSession)}`);
  }
  await expectRoleTransactionDenied("AuthSession tenant-A identity with tenant-B institution", product, RUNTIME_DATABASE_ROLES.auth, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO foundry_product.auth_sessions
        (id, identity_id, user_id, institution_id, expires_at)
      VALUES
        (${attemptedAuthSessionId}::uuid, ${authIdentityA.id}::uuid, ${learnerA}::uuid, ${tenantB}::uuid, now() + interval '1 hour')
    `;
  }, /AuthSession tenant lineage mismatch/);
  directlyProbedWritableTables.add("foundry_product.auth_sessions");

  await expectSessionAuthorizationDenied(
    "AuthSession role-none exact auth group with tenant-A identity and tenant-B institution",
    product,
    RUNTIME_DATABASE_ROLES.auth,
    async (transaction) => {
      await transaction`
        INSERT INTO foundry_product.auth_sessions
          (id, identity_id, user_id, institution_id, expires_at)
        VALUES
          (${roleNoneAuthSessionIds[0]}::uuid, ${authIdentityA.id}::uuid, ${learnerA}::uuid, ${tenantB}::uuid, now() + interval '1 hour')
      `;
    },
    /AuthSession tenant lineage mismatch/,
  );
  await expectSessionAuthorizationDenied(
    "AuthSession role-none inheriting login with tenant-A identity and tenant-B institution",
    product,
    inheritingAuthLogin,
    async (transaction) => {
      await transaction`
        INSERT INTO foundry_product.auth_sessions
          (id, identity_id, user_id, institution_id, expires_at)
        VALUES
          (${roleNoneAuthSessionIds[1]}::uuid, ${authIdentityA.id}::uuid, ${learnerA}::uuid, ${tenantB}::uuid, now() + interval '1 hour')
      `;
    },
    /AuthSession tenant lineage mismatch/,
  );
  await expectResetRoleDenied(
    "AuthSession inheriting login after RESET ROLE with tenant-A identity and tenant-B institution",
    product,
    inheritingAuthLogin,
    RUNTIME_DATABASE_ROLES.auth,
    async (transaction) => {
      await transaction`
        INSERT INTO foundry_product.auth_sessions
          (id, identity_id, user_id, institution_id, expires_at)
        VALUES
          (${roleNoneAuthSessionIds[2]}::uuid, ${authIdentityA.id}::uuid, ${learnerA}::uuid, ${tenantB}::uuid, now() + interval '1 hour')
      `;
    },
    /AuthSession tenant lineage mismatch/,
  );
  await expectSessionAuthorizationDenied(
    "AuthSession ambiguous multi-runtime login",
    product,
    ambiguousRuntimeLogin,
    async (transaction) => {
      await transaction`
        INSERT INTO foundry_product.auth_sessions
          (id, identity_id, user_id, institution_id, expires_at)
        VALUES
          (${roleNoneAuthSessionIds[3]}::uuid, ${authIdentityA.id}::uuid, ${learnerA}::uuid, ${tenantA}::uuid, now() + interval '1 hour')
      `;
    },
    /multiple RW-02 runtime roles/,
  );

  await product.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_auth_bootstrap");
    await transaction`
      INSERT INTO foundry_operational.security_events
        (event_class, event_code, principal, detail)
      VALUES ('AUTHENTICATION', 'PRETENANT_AUTH_DENIAL', ${authAuditPrincipal}, '{}'::jsonb)
    `;
    await transaction`
      INSERT INTO foundry_operational.security_events
        (institution_id, actor_user_id, session_id, event_class, event_code, principal, detail)
      VALUES
        (${tenantA}::uuid, ${learnerA}::uuid, ${authSessionPositiveId}::uuid,
         'AUTHORIZATION', 'TENANT_AUTH_EVENT', ${authAuditPrincipal}, '{}'::jsonb)
    `;
  });
  const [authAuditPositive] = await product<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM foundry_operational.security_events WHERE principal=${authAuditPrincipal}
  `;
  if (authAuditPositive?.count !== 2) throw new Error("Auth audit pre-tenant and tenant-consistent positive controls did not persist");
  await expectRoleTransactionDenied("Auth audit tenant-A actor/session with tenant-B institution", product, RUNTIME_DATABASE_ROLES.auth, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO foundry_operational.security_events
        (institution_id, actor_user_id, session_id, event_class, event_code, principal, detail)
      VALUES
        (${tenantB}::uuid, ${learnerA}::uuid, ${authSessionPositiveId}::uuid,
         'AUTHORIZATION', 'DENIED_CROSS_TENANT_AUTH_EVENT', ${authAuditPrincipal}, '{}'::jsonb)
    `;
  }, /Auth audit tenant lineage mismatch/);

  // CAP-07's scoped Registry/supply writes have their own two-course, direct-bypass,
  // and deferred-publication matrix in test-cap07-upgrade.ts.
  const expectedWritableTables = await product<Array<{ table_key: string }>>`
    SELECT schema_name || '.' || table_name AS table_key
    FROM foundry_private.writable_lineage_catalog
    WHERE NOT (schema_name='foundry_product' AND table_name=ANY(ARRAY[
      'learner_profiles','learner_strategy_versions','source_assets','source_asset_versions',
      'source_processing_attempts','evidence_derivatives','context_items','context_carryover_relations',
      'capabilities','capability_versions','capability_availability_decisions','capability_supply_relations'
    ]::text[]))
    ORDER BY schema_name, table_name
  `;
  const expectedWritableKeys = expectedWritableTables.map((row) => row.table_key).sort();
  const actualWritableKeys = [...directlyProbedWritableTables].sort();
  if (JSON.stringify(actualWritableKeys) !== JSON.stringify(expectedWritableKeys)) {
    throw new Error(`Direct writable-lineage probe matrix mismatch: ${JSON.stringify({ expectedWritableKeys, actualWritableKeys })}`);
  }

  const authCanInsertIdentity = await product<Array<{ allowed: boolean }>>`
    SELECT has_table_privilege('foundry_auth_bootstrap', 'foundry_product.auth_identities', 'INSERT') AS allowed
  `;
  if (authCanInsertIdentity[0]?.allowed) throw new Error("Authentication runtime can insert arbitrary OIDC identity bindings");

  const checkpointTables = ["checkpoints", "checkpoint_blobs", "checkpoint_writes"];
  await checkpoint.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_checkpoint_runtime");
    for (const table of checkpointTables) {
      const rows = await transaction.unsafe<Array<{ count: number }>>(`SELECT count(*)::int AS count FROM langgraph_checkpoint.${quoted(table)}`);
      if (rows[0]?.count !== 0) throw new Error(`Checkpoint ${table} exposed tenant rows without context`);
    }
  });
  await checkpoint.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_checkpoint_runtime");
    await transaction`SELECT set_config('foundry.institution_id', ${tenantA}, true)`;
    for (const table of checkpointTables) {
      const own = await transaction.unsafe<Array<{ count: number }>>(`SELECT count(*)::int AS count FROM langgraph_checkpoint.${quoted(table)} WHERE thread_id = $1`, [threadA]);
      const foreign = await transaction.unsafe<Array<{ count: number }>>(`SELECT count(*)::int AS count FROM langgraph_checkpoint.${quoted(table)} WHERE thread_id = $1`, [threadB]);
      if (own[0]?.count !== 1 || foreign[0]?.count !== 0) throw new Error(`Checkpoint ${table} failed tenant A positive/tenant B negative control`);
    }
  });
  await checkpoint.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_checkpoint_runtime");
    await transaction`SELECT set_config('foundry.institution_id', ${tenantB}, true)`;
    for (const table of checkpointTables) {
      const own = await transaction.unsafe<Array<{ count: number }>>(`SELECT count(*)::int AS count FROM langgraph_checkpoint.${quoted(table)} WHERE thread_id = $1`, [threadB]);
      const foreign = await transaction.unsafe<Array<{ count: number }>>(`SELECT count(*)::int AS count FROM langgraph_checkpoint.${quoted(table)} WHERE thread_id = $1`, [threadA]);
      if (own[0]?.count !== 1 || foreign[0]?.count !== 0) throw new Error(`Checkpoint ${table} failed tenant B positive/tenant A negative control`);
    }
  });
  await expectRoleTransactionDenied("Checkpoint insert with tenant B thread under tenant A", checkpoint, RUNTIME_DATABASE_ROLES.checkpoint, tenantA, async (transaction) => {
    await transaction`
      INSERT INTO langgraph_checkpoint.checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)
      VALUES (${attemptedCheckpointThread}, '', ${attemptedCheckpointId}, '{}'::jsonb, '{}'::jsonb)
    `;
  });
  await expectRoleTransactionDenied("Checkpoint update from tenant A to tenant B thread", checkpoint, RUNTIME_DATABASE_ROLES.checkpoint, tenantA, async (transaction) => {
    await transaction`UPDATE langgraph_checkpoint.checkpoints SET thread_id=${attemptedCheckpointThread} WHERE thread_id=${threadA} AND checkpoint_id=${checkpointA}`;
  });

  await cleanupHarnessLoginRoles();
  const remainingHarnessRoles = await product<Array<{ rolname: string }>>`
    SELECT rolname FROM pg_roles WHERE rolname = ANY(${harnessLoginRoles}::text[])
  `;
  if (remainingHarnessRoles.length) throw new Error(`Harness login roles were not cleaned up: ${JSON.stringify(remainingHarnessRoles)}`);

  console.log(JSON.stringify({
    result: "PASS",
    catalogRows: catalog.length,
    tenantNegativeTables: tenantTables.length,
    workerNegativeTables: tenantTables.length,
    globalReadOnlyTables: globalTables.length,
    checkpointNegativeTables: checkpointTables.length,
    sameTenantPositiveTables: 6,
    writableLineageCatalogRows: expectedWritableKeys.length,
    directWritableLineageProbeTables: actualWritableKeys.length,
    validAuthSessionPositive: true,
    authSessionCrossTenantDenials: 1,
    roleNoneAuthSessionDenials: 3,
    resetRoleAuthSessionDenials: 1,
    ambiguousRuntimeMembershipDenials: 1,
    authAuditPositiveEvents: authAuditPositive.count,
    authAuditLineageDenials: 1,
    workerReadableTables: workerReadableTables.length,
    passwordVerifierRoleDenials: 2,
    auditedServiceInvocation: true,
    deniedServiceWorkRolledBack: true,
    productionLoginContracts: loginContractRows.length,
    harnessLoginRolesCleaned,
    runtimeRoleStartupAssumptions: 5,
    runtimeRoles: roleRows.map((row) => row.rolname),
    trustedComponentExecutorBoundary: executorBoundary,
  }));
} finally {
  try {
    await closeServiceAuthority();
    await checkpoint`DELETE FROM langgraph_checkpoint.checkpoint_writes WHERE thread_id IN (${threadA}, ${threadB}, ${attemptedCheckpointThread})`;
    await checkpoint`DELETE FROM langgraph_checkpoint.checkpoint_blobs WHERE thread_id IN (${threadA}, ${threadB}, ${attemptedCheckpointThread})`;
    await checkpoint`DELETE FROM langgraph_checkpoint.checkpoints WHERE thread_id IN (${threadA}, ${threadB}, ${attemptedCheckpointThread})`;
    await product`DELETE FROM foundry_operational.security_events WHERE principal=${auditPrincipal}`;
    await product`DELETE FROM foundry_operational.security_events WHERE principal=${authAuditPrincipal}`;
    await product`DELETE FROM foundry_product.auth_sessions WHERE id IN (${authSessionPositiveId}::uuid, ${attemptedAuthSessionId}::uuid, ${roleNoneAuthSessionIds[0]}::uuid, ${roleNoneAuthSessionIds[1]}::uuid, ${roleNoneAuthSessionIds[2]}::uuid, ${roleNoneAuthSessionIds[3]}::uuid)`;
    await product`DELETE FROM foundry_operational.eval_runs WHERE id=${evalFixtureA}::uuid`;
    await product`DELETE FROM foundry_operational.retrieval_runs WHERE id IN (${retrievalA}::uuid, ${retrievalB}::uuid, ${attemptedRetrievalId}::uuid)`;
    await product`DELETE FROM foundry_product.capability_resolutions WHERE id=${attemptedCapabilityResolutionId}::uuid`;
    await product`DELETE FROM foundry_product.activity_plan_proposals WHERE id=${attemptedActivityPlanProposalId}::uuid`;
    await product`DELETE FROM foundry_product.component_deliveries WHERE id=${attemptedDeliveryId}::uuid`;
    await product`DELETE FROM foundry_product.library_items WHERE id=${libraryFixtureA}::uuid`;
    await product`DELETE FROM foundry_product.schedule_items WHERE id=${scheduleFixtureA}::uuid`;
    await product`DELETE FROM foundry_product.transfer_activities WHERE id=${transferFixtureA}::uuid`;
    await product`DELETE FROM foundry_product.retention_reviews WHERE id=${retentionFixtureA}::uuid`;
    await product`DELETE FROM foundry_product.retry_attempts WHERE id=${tenantARetryFixture}::uuid`;
    await product`DELETE FROM foundry_product.teacher_reviews WHERE id=${tenantAReviewFixture}::uuid`;
    await product`DELETE FROM foundry_product.component_versions WHERE id=${componentVersionB}::uuid`;
    await product`DELETE FROM foundry_product.components WHERE id=${componentB}::uuid`;
    await product`DELETE FROM foundry_product.retry_attempts WHERE id=${retryB}::uuid`;
    await product`DELETE FROM foundry_product.teacher_reviews WHERE id=${reviewB}::uuid`;
    await product`DELETE FROM foundry_product.diagnostic_observations WHERE id=${observationB}::uuid`;
    await product`DELETE FROM foundry_product.learner_attempts WHERE id=${attemptB}::uuid`;
    await product`DELETE FROM foundry_product.evidence_derivatives WHERE evidence_unit_id=${evidenceB}::uuid`;
    await product`DELETE FROM foundry_product.file_assets WHERE id=${fileB}::uuid`;
    await product`DELETE FROM foundry_product.evidence_units WHERE id=${evidenceB}::uuid`;
    await product`DELETE FROM foundry_product.source_records WHERE id=${sourceB}::uuid`;
    await product`DELETE FROM foundry_product.source_assets WHERE institution_id=${tenantB}::uuid`;
    await product`DELETE FROM foundry_product.learning_episodes WHERE id=${episodeB}::uuid`;
    await product`DELETE FROM foundry_product.learning_tasks WHERE id IN (${taskB}::uuid, ${attemptedTaskIds[0]}::uuid, ${attemptedTaskIds[1]}::uuid)`;
    await product`DELETE FROM foundry_product.courses WHERE id=${courseB}::uuid`;
    await product`DELETE FROM foundry_product.subjects WHERE id=${subjectB}::uuid`;
    await product`DELETE FROM foundry_product.institution_memberships WHERE user_id=${learnerB}::uuid AND institution_id=${tenantB}::uuid`;
    await product`DELETE FROM foundry_product.users WHERE id=${learnerB}::uuid`;
    await product`DELETE FROM foundry_product.institutions WHERE id=${tenantB}::uuid`;
    await cleanupHarnessLoginRoles();
  } finally {
    await product.end();
    await checkpoint.end();
  }
}
