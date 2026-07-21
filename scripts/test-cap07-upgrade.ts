import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

function guardedLocalUrl(raw: string | undefined): string {
  if (!raw) throw new Error("CAP07_UPGRADE_DATABASE_URL is required");
  const url = new URL(raw);
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) throw new Error("CAP07_UPGRADE_DATABASE_URL must target localhost");
  if (decodeURIComponent(url.pathname.slice(1)) !== "learning_foundry_cap07_upgrade") throw new Error("CAP-07 upgrade database must be named exactly learning_foundry_cap07_upgrade");
  if (process.env.CAP07_UPGRADE_RESET_ALLOWED !== "true") throw new Error("CAP07_UPGRADE_RESET_ALLOWED=true is required");
  return url.toString();
}

async function applyMigration(client: postgres.Sql, filename: string): Promise<void> {
  const migration = await readFile(resolve("db/migrations", filename), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.unsafe(statement);
}

const client = postgres(guardedLocalUrl(process.env.CAP07_UPGRADE_DATABASE_URL), { max: 1, prepare: false });
const institutionId = randomUUID();
const subjectId = randomUUID();
const courseId = randomUUID();
const otherCourseId = randomUUID();
const capabilityId = randomUUID();
const capabilityVersionId = randomUUID();
const fixtureUserId = randomUUID();
const otherCourseUserId = randomUUID();
const fixtureComponentId = randomUUID();
const fixtureComponentVersionId = randomUUID();
const fixtureEvaluationId = randomUUID();
const seededWebComponentId = randomUUID();
const seededWebVersionId = randomUUID();
const seededWebEvaluationId = randomUUID();
const seededWebPreviewId = randomUUID();
const seededWebDecisionId = randomUUID();
const seededWebAvailabilityId = randomUUID();
const malformedEvaluationId = randomUUID();
const malformedPreviewId = randomUUID();
const malformedAvailabilityId = randomUUID();
const malformedDecisionId = randomUUID();
const malformedParentCapabilityId = randomUUID();
const malformedParentCapabilityVersionId = randomUUID();
const seededScopedCapabilityId = randomUUID();
const seededScopedCapabilityVersionId = randomUUID();
const seededSourceComponentVersionId = randomUUID();
const partialWebComponentId = randomUUID();
const partialWebVersionId = randomUUID();

async function expectDenied(label: string, action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return;
    throw new Error(`${label} failed for the wrong reason: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${label} did not fail closed`);
}

try {
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_private CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_operational CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_product CASCADE");
  for (const migration of [
    "0000_full_framework.sql", "0001_full_framework.sql", "0002_recoverable_resume_claims.sql",
    "0003_production_auth_tenant_enforcement.sql", "0004_canonical_identity_context_evidence.sql",
    "0005_authoritative_context_compiler.sql", "0006_diagnosis_capability_resolution.sql",
    "0007_activity_planning.sql", "0008_asset_stage_runtime.sql", "0009_teacher_assignment_intervention.sql",
    "0010_governed_followup.sql",
  ]) await applyMigration(client, migration);

  await client`INSERT INTO foundry_product.institutions(id,slug,name) VALUES (${institutionId}::uuid,${`cap07-${institutionId}`},'CAP-07 upgrade fixture')`;
  await client`INSERT INTO foundry_product.subjects(id,institution_id,key,name,reference_pack_key) VALUES (${subjectId}::uuid,${institutionId}::uuid,${`cap07-${subjectId}`},'CAP-07 subject','cap07-pack')`;
  await client`INSERT INTO foundry_product.courses(id,institution_id,subject_id,code,name) VALUES (${courseId}::uuid,${institutionId}::uuid,${subjectId}::uuid,${`CAP07-${courseId.slice(0, 8)}`},'CAP-07 course')`;
  await client`INSERT INTO foundry_product.courses(id,institution_id,subject_id,code,name) VALUES (${otherCourseId}::uuid,${institutionId}::uuid,${subjectId}::uuid,${`CAP07-${otherCourseId.slice(0, 8)}`},'Other CAP-07 course')`;
  await client`INSERT INTO foundry_product.capabilities(id,key,name,reference_pack_key,kind,active_version_id) VALUES (${capabilityId}::uuid,${`pre-cap07-${capabilityId}`},'Pre-CAP-07 global capability','cap07-pack','DETERMINISTIC_ADAPTER',NULL)`;
  await client`INSERT INTO foundry_product.capability_versions(id,capability_id,version,contract,implementation_key,status,content_hash) VALUES (${capabilityVersionId}::uuid,${capabilityId}::uuid,'1.0.0','{}'::jsonb,'pre-cap07','ACTIVE',${`sha256:${capabilityVersionId}`})`;
  await client`UPDATE foundry_product.capabilities SET active_version_id=${capabilityVersionId}::uuid WHERE id=${capabilityId}::uuid`;
  const [before] = await client<Array<{ key: string; content_hash: string }>>`SELECT c.key,v.content_hash FROM foundry_product.capabilities c JOIN foundry_product.capability_versions v ON v.id=c.active_version_id WHERE c.id=${capabilityId}::uuid`;

  await applyMigration(client, "0011_capability_gap_supply.sql");
  await client.unsafe("GRANT foundry_product_runtime TO postgres");

  const [columnParity] = await client<Array<{
    evaluation_self_reference_count: number;
    preview_evaluation_count: number;
    preview_evaluation_not_null: boolean;
    preview_evaluation_fk_count: number;
    preview_executor_column_count: number;
    exact_source_column_count: number;
    supply_relation_table_count: number;
    publication_completeness_trigger_count: number;
    product_evaluation_service_executable: boolean;
    executor_evaluation_service_executable: boolean;
    product_preview_service_executable: boolean;
    executor_preview_service_executable: boolean;
    product_is_executor_member: boolean;
  }>>`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='foundry_product' AND table_name='component_evaluations' AND column_name='component_evaluation_id') AS evaluation_self_reference_count,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='foundry_product' AND table_name='component_asset_previews' AND column_name='component_evaluation_id') AS preview_evaluation_count,
      COALESCE((SELECT is_nullable='NO' FROM information_schema.columns WHERE table_schema='foundry_product' AND table_name='component_asset_previews' AND column_name='component_evaluation_id'),false) AS preview_evaluation_not_null,
      (SELECT count(*)::int FROM information_schema.table_constraints constraint_row
        JOIN information_schema.key_column_usage key_row ON key_row.constraint_schema=constraint_row.constraint_schema AND key_row.constraint_name=constraint_row.constraint_name
        JOIN information_schema.constraint_column_usage target_row ON target_row.constraint_schema=constraint_row.constraint_schema AND target_row.constraint_name=constraint_row.constraint_name
        WHERE constraint_row.constraint_type='FOREIGN KEY' AND constraint_row.table_schema='foundry_product' AND constraint_row.table_name='component_asset_previews'
          AND key_row.column_name='component_evaluation_id' AND target_row.table_schema='foundry_product' AND target_row.table_name='component_evaluations' AND target_row.column_name='id') AS preview_evaluation_fk_count,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='foundry_product' AND table_name='component_asset_previews' AND column_name IN ('executor_version','executor_receipt_hash') AND is_nullable='NO') AS preview_executor_column_count,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='foundry_product' AND table_name='components' AND column_name IN ('adapted_from_component_version_id','adapted_from_component_content_hash')) AS exact_source_column_count,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='foundry_product' AND table_name='capability_supply_relations') AS supply_relation_table_count,
      (SELECT count(*)::int FROM pg_trigger trigger_row JOIN pg_class table_row ON table_row.oid=trigger_row.tgrelid JOIN pg_namespace namespace_row ON namespace_row.oid=table_row.relnamespace
        WHERE namespace_row.nspname='foundry_product' AND ((table_row.relname='publication_decisions' AND trigger_row.tgname='cap07_registration_decision_complete_guard') OR (table_row.relname='component_versions' AND trigger_row.tgname='cap07_registration_published_version_complete_guard'))
          AND trigger_row.tgconstraint<>0 AND NOT trigger_row.tgisinternal) AS publication_completeness_trigger_count,
      has_function_privilege('foundry_product_runtime','foundry_product.record_web_component_evaluation(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb)','EXECUTE') AS product_evaluation_service_executable,
      has_function_privilege('foundry_component_executor','foundry_product.record_web_component_evaluation(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb)','EXECUTE') AS executor_evaluation_service_executable,
      has_function_privilege('foundry_product_runtime','foundry_product.record_component_asset_preview(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text)','EXECUTE') AS product_preview_service_executable,
      has_function_privilege('foundry_component_executor','foundry_product.record_component_asset_preview(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text)','EXECUTE') AS executor_preview_service_executable,
      pg_has_role('foundry_product_runtime','foundry_component_executor','MEMBER') AS product_is_executor_member`;
  if (!columnParity || columnParity.evaluation_self_reference_count !== 0 || columnParity.preview_evaluation_count !== 1 || !columnParity.preview_evaluation_not_null || columnParity.preview_evaluation_fk_count !== 1 || columnParity.preview_executor_column_count !== 2 || columnParity.exact_source_column_count !== 2 || columnParity.supply_relation_table_count !== 1 || columnParity.publication_completeness_trigger_count !== 2 || columnParity.product_evaluation_service_executable || !columnParity.executor_evaluation_service_executable || columnParity.product_preview_service_executable || !columnParity.executor_preview_service_executable || columnParity.product_is_executor_member) {
    throw new Error("CAP-07 clean-install schema/migration parity is incomplete");
  }

  await client`INSERT INTO foundry_product.users(id,email,name) VALUES (${fixtureUserId}::uuid,${`cap07-${fixtureUserId}@example.invalid`},'CAP-07 evaluation fixture')`;
  await client`INSERT INTO foundry_product.users(id,email,name) VALUES (${otherCourseUserId}::uuid,${`cap07-${otherCourseUserId}@example.invalid`},'Other-course CAP-07 expert')`;
  await client`INSERT INTO foundry_product.institution_memberships(user_id,institution_id,role) VALUES (${fixtureUserId}::uuid,${institutionId}::uuid,'EXPERT'),(${otherCourseUserId}::uuid,${institutionId}::uuid,'EXPERT')`;
  await client`INSERT INTO foundry_product.course_enrollments(institution_id,course_id,user_id,role) VALUES (${institutionId}::uuid,${courseId}::uuid,${fixtureUserId}::uuid,'EXPERT'),(${institutionId}::uuid,${otherCourseId}::uuid,${otherCourseUserId}::uuid,'EXPERT')`;
  await client.unsafe("SET session_replication_role = replica");
  try {
    await client`INSERT INTO foundry_product.components(id,institution_id,course_id,capability_id,asset_type,reference_pack_key,key,title,status,source_signal,created_by) VALUES (${fixtureComponentId}::uuid,${institutionId}::uuid,${courseId}::uuid,${capabilityId}::uuid,'TEACHING_SUPPORT','cap07-pack',${`evaluation-fixture-${fixtureComponentId}`},'Evaluation insertion fixture','CANDIDATE','{}'::jsonb,${fixtureUserId}::uuid)`;
    await client`INSERT INTO foundry_product.component_versions(id,component_id,version,contract,content,source_observation_ids,source_review_ids,validation,status,content_hash,created_by) VALUES (${fixtureComponentVersionId}::uuid,${fixtureComponentId}::uuid,'0.0.1','{}'::jsonb,'{}'::jsonb,ARRAY[${randomUUID()}::uuid],ARRAY[${randomUUID()}::uuid],'{}'::jsonb,'DRAFT',${`sha256:${fixtureComponentVersionId}`},${fixtureUserId}::uuid)`;
  } finally {
    await client.unsafe("SET session_replication_role = origin");
  }
  await client`INSERT INTO foundry_product.component_evaluations(id,component_version_id,institution_id,course_id,evaluator_key,evaluator_version,content_hash,input_hash,system_status,system_checks,source_observation_ids,source_review_ids,source_attempt_ids,fixture_execution,evidence_checks,provider_checks,created_by) VALUES (${fixtureEvaluationId}::uuid,${fixtureComponentVersionId}::uuid,${institutionId}::uuid,${courseId}::uuid,'cap07-clean-install','1.0.0',${`sha256:${fixtureComponentVersionId}`},${`sha256:${fixtureEvaluationId}`},'PASSED','[]'::jsonb,ARRAY[${randomUUID()}::uuid],ARRAY[${randomUUID()}::uuid],ARRAY[${randomUUID()}::uuid],'{}'::jsonb,'[]'::jsonb,'{}'::jsonb,${fixtureUserId}::uuid)`;
  const [insertedEvaluation] = await client<Array<{ id: string }>>`SELECT id FROM foundry_product.component_evaluations WHERE id=${fixtureEvaluationId}::uuid`;
  if (insertedEvaluation?.id !== fixtureEvaluationId) throw new Error("CAP-07 clean install could not insert an independent ComponentEvaluation");

  await client.unsafe("SET session_replication_role = replica");
  try {
    await client`INSERT INTO foundry_product.components(id,institution_id,course_id,capability_id,asset_type,reference_pack_key,key,title,status,source_signal,source_capability_resolution_id,source_activity_plan_proposal_id,supply_strategy,adapted_from_capability_id,adapted_from_capability_version_id,adapted_from_content_hash,adapted_from_component_version_id,adapted_from_component_content_hash,created_by) VALUES (${seededWebComponentId}::uuid,${institutionId}::uuid,${courseId}::uuid,NULL,'WEB_COMPONENT_ASSET','cap07-pack',${`immutability-fixture-${seededWebComponentId}`},'Immutable source fixture','CANDIDATE','{}'::jsonb,${randomUUID()}::uuid,${randomUUID()}::uuid,'ADAPT',${capabilityId}::uuid,${capabilityVersionId}::uuid,${`sha256:${capabilityVersionId}`},${seededSourceComponentVersionId}::uuid,${`sha256:${seededSourceComponentVersionId}`},${fixtureUserId}::uuid)`;
    await client`INSERT INTO foundry_product.component_versions(id,component_id,version,contract,content,source_observation_ids,source_review_ids,validation,status,content_hash,created_by) VALUES (${seededWebVersionId}::uuid,${seededWebComponentId}::uuid,'0.0.1','{}'::jsonb,'{}'::jsonb,ARRAY[${randomUUID()}::uuid],ARRAY[]::uuid[],'{}'::jsonb,'PUBLISHED',${`sha256:${seededWebVersionId}`},${fixtureUserId}::uuid)`;
    await client`INSERT INTO foundry_product.capabilities(id,institution_id,course_id,key,name,reference_pack_key,kind,active_version_id) VALUES (${seededScopedCapabilityId}::uuid,${institutionId}::uuid,${courseId}::uuid,${`bypass-fixture-${seededScopedCapabilityId}`},'Direct bypass fixture','cap07-pack','WEB_COMPONENT_ASSET',NULL)`;
    await client`INSERT INTO foundry_product.capability_versions(id,capability_id,institution_id,course_id,component_asset_version_id,version,contract,implementation_key,status,content_hash) VALUES (${seededScopedCapabilityVersionId}::uuid,${seededScopedCapabilityId}::uuid,${institutionId}::uuid,${courseId}::uuid,${seededWebVersionId}::uuid,'0.0.1','{}'::jsonb,'bypass-fixture','ACTIVE',${`sha256:${seededScopedCapabilityVersionId}`})`;
    await client`INSERT INTO foundry_product.capabilities(id,institution_id,course_id,key,name,reference_pack_key,kind,active_version_id) VALUES (${malformedParentCapabilityId}::uuid,${institutionId}::uuid,${courseId}::uuid,${`malformed-parent-${malformedParentCapabilityId}`},'Malformed-parent capability','cap07-pack','WEB_COMPONENT_ASSET',NULL)`;
    await client`INSERT INTO foundry_product.capability_versions(id,capability_id,institution_id,course_id,component_asset_version_id,version,contract,implementation_key,status,content_hash) VALUES (${malformedParentCapabilityVersionId}::uuid,${malformedParentCapabilityId}::uuid,${institutionId}::uuid,${courseId}::uuid,${seededWebVersionId}::uuid,'0.0.1','{}'::jsonb,'malformed-parent','ACTIVE',${`sha256:${malformedParentCapabilityVersionId}`})`;
    await client`UPDATE foundry_product.capabilities SET active_version_id=${malformedParentCapabilityVersionId}::uuid WHERE id=${malformedParentCapabilityId}::uuid`;
    await client`INSERT INTO foundry_product.component_evaluations(id,component_version_id,institution_id,course_id,evaluator_key,evaluator_version,content_hash,input_hash,system_status,system_checks,source_observation_ids,source_review_ids,source_attempt_ids,fixture_execution,evidence_checks,provider_checks,created_by) VALUES (${seededWebEvaluationId}::uuid,${seededWebVersionId}::uuid,${institutionId}::uuid,${courseId}::uuid,'cap07-read-fixture','1.0.0',${`sha256:${seededWebVersionId}`},${`sha256:${seededWebEvaluationId}`},'PASSED','[]'::jsonb,ARRAY[${randomUUID()}::uuid],ARRAY[]::uuid[],ARRAY[${randomUUID()}::uuid],'{}'::jsonb,'[]'::jsonb,'{}'::jsonb,${fixtureUserId}::uuid)`;
    await client`INSERT INTO foundry_product.publication_decisions(id,component_version_id,expert_id,action,rationale,actor_provenance,idempotency_key,evaluation_id,human_rubric,workflow_thread_id) VALUES (${seededWebDecisionId}::uuid,${seededWebVersionId}::uuid,${fixtureUserId}::uuid,'APPROVE','Read policy fixture',${JSON.stringify({ userId: fixtureUserId, institutionId, sessionId: 'fixture-session', authMethod: 'password' })}::jsonb,${`read-fixture-${seededWebDecisionId}`},${seededWebEvaluationId}::uuid,'{}'::jsonb,'fixture-thread')`;
    await client`INSERT INTO foundry_product.component_asset_previews(id,institution_id,course_id,component_version_id,component_evaluation_id,source_capability_resolution_id,content_hash,request_hash,learner_input,runtime_output,event_trace,executor_version,executor_receipt_hash,status,previewed_by,actor_provenance,idempotency_key) VALUES (${seededWebPreviewId}::uuid,${institutionId}::uuid,${courseId}::uuid,${seededWebVersionId}::uuid,${seededWebEvaluationId}::uuid,${randomUUID()}::uuid,${`sha256:${seededWebVersionId}`},${`sha256:${seededWebPreviewId}`},'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'cap-07.shared-web-executor.v1',${`sha256:${seededWebPreviewId}`},'SUCCEEDED',${fixtureUserId}::uuid,${JSON.stringify({ userId: fixtureUserId, institutionId, sessionId: 'fixture-session', authMethod: 'password' })}::jsonb,${`read-fixture-${seededWebPreviewId}`})`;
    await client`INSERT INTO foundry_product.capability_availability_decisions(id,institution_id,course_id,capability_id,capability_version_id,component_version_id,confirmation_decision_id,availability_status,availability_scope,confirmed_by,actor_provenance,rationale) VALUES (${seededWebAvailabilityId}::uuid,${institutionId}::uuid,${courseId}::uuid,${seededScopedCapabilityId}::uuid,${seededScopedCapabilityVersionId}::uuid,${seededWebVersionId}::uuid,${seededWebDecisionId}::uuid,'AVAILABLE','{}'::jsonb,${fixtureUserId}::uuid,${JSON.stringify({ userId: fixtureUserId, institutionId, sessionId: 'fixture-session', authMethod: 'password' })}::jsonb,'Read policy fixture')`;
    await client`INSERT INTO foundry_product.component_evaluations(id,component_version_id,institution_id,course_id,evaluator_key,evaluator_version,content_hash,input_hash,system_status,system_checks,source_observation_ids,source_review_ids,source_attempt_ids,fixture_execution,evidence_checks,provider_checks,created_by) VALUES (${malformedEvaluationId}::uuid,${seededWebVersionId}::uuid,${institutionId}::uuid,${otherCourseId}::uuid,'malformed-parent-fixture','1.0.0',${`sha256:${seededWebVersionId}`},${`sha256:${malformedEvaluationId}`},'PASSED','[]'::jsonb,ARRAY[]::uuid[],ARRAY[]::uuid[],ARRAY[]::uuid[],'{}'::jsonb,'[]'::jsonb,'{}'::jsonb,${fixtureUserId}::uuid)`;
    await client`INSERT INTO foundry_product.component_asset_previews(id,institution_id,course_id,component_version_id,component_evaluation_id,source_capability_resolution_id,content_hash,request_hash,learner_input,runtime_output,event_trace,executor_version,executor_receipt_hash,status,previewed_by,actor_provenance,idempotency_key) VALUES (${malformedPreviewId}::uuid,${institutionId}::uuid,${otherCourseId}::uuid,${seededWebVersionId}::uuid,${malformedEvaluationId}::uuid,${randomUUID()}::uuid,${`sha256:${seededWebVersionId}`},${`sha256:${malformedPreviewId}`},'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'cap-07.shared-web-executor.v1',${`sha256:${malformedPreviewId}`},'SUCCEEDED',${otherCourseUserId}::uuid,'{}'::jsonb,${`malformed-${malformedPreviewId}`})`;
    await client`INSERT INTO foundry_product.publication_decisions(id,component_version_id,expert_id,action,rationale,actor_provenance,idempotency_key,evaluation_id,human_rubric,workflow_thread_id) VALUES (${malformedDecisionId}::uuid,${fixtureComponentVersionId}::uuid,${otherCourseUserId}::uuid,'APPROVE','Malformed parent fixture','{}'::jsonb,${`malformed-${malformedDecisionId}`},${fixtureEvaluationId}::uuid,'{}'::jsonb,'malformed-parent-thread')`;
    await client`INSERT INTO foundry_product.capability_availability_decisions(id,institution_id,course_id,capability_id,capability_version_id,component_version_id,confirmation_decision_id,availability_status,availability_scope,confirmed_by,actor_provenance,rationale) VALUES (${malformedAvailabilityId}::uuid,${institutionId}::uuid,${otherCourseId}::uuid,${malformedParentCapabilityId}::uuid,${malformedParentCapabilityVersionId}::uuid,${seededWebVersionId}::uuid,${malformedDecisionId}::uuid,'AVAILABLE','{}'::jsonb,${otherCourseUserId}::uuid,'{}'::jsonb,'Malformed parent fixture')`;
    await client`INSERT INTO foundry_product.components(id,institution_id,course_id,capability_id,asset_type,reference_pack_key,key,title,status,source_signal,created_by) VALUES (${partialWebComponentId}::uuid,${institutionId}::uuid,${courseId}::uuid,${capabilityId}::uuid,'WEB_COMPONENT_ASSET','cap07-pack',${`partial-publication-${partialWebComponentId}`},'Partial publication fixture','CANDIDATE','{}'::jsonb,${fixtureUserId}::uuid)`;
    await client`INSERT INTO foundry_product.component_versions(id,component_id,version,contract,content,source_observation_ids,source_review_ids,validation,status,content_hash,created_by) VALUES (${partialWebVersionId}::uuid,${partialWebComponentId}::uuid,'0.0.1','{}'::jsonb,'{}'::jsonb,ARRAY[]::uuid[],ARRAY[]::uuid[],'{}'::jsonb,'DRAFT',${`sha256:${partialWebVersionId}`},${fixtureUserId}::uuid)`;
  } finally {
    await client.unsafe("SET session_replication_role = origin");
  }

  const [after] = await client<Array<{ key: string; content_hash: string; institution_id: string | null; course_id: string | null; component_asset_version_id: string | null }>>`
    SELECT c.key,v.content_hash,c.institution_id,c.course_id,v.component_asset_version_id
    FROM foundry_product.capabilities c JOIN foundry_product.capability_versions v ON v.id=c.active_version_id
    WHERE c.id=${capabilityId}::uuid`;
  if (!before || !after || before.key !== after.key || before.content_hash !== after.content_hash || after.institution_id !== null || after.course_id !== null || after.component_asset_version_id !== null) {
    throw new Error("CAP-07 migration rewrote or promoted an existing global Registry exact version");
  }
  const [contract] = await client<Array<{ previews: string | null; availability: string | null; catalog_count: number; guard_count: number }>>`
    SELECT to_regclass('foundry_product.component_asset_previews')::text AS previews,
      to_regclass('foundry_product.capability_availability_decisions')::text AS availability,
      (SELECT count(*)::int FROM foundry_private.table_authority_catalog WHERE schema_name='foundry_product' AND table_name IN ('component_asset_previews','capability_availability_decisions','capability_supply_relations')) AS catalog_count,
      (SELECT count(*)::int FROM pg_trigger trigger_row JOIN pg_class table_row ON table_row.oid=trigger_row.tgrelid JOIN pg_namespace namespace_row ON namespace_row.oid=table_row.relnamespace WHERE namespace_row.nspname='foundry_product' AND table_row.relname IN ('capabilities','capability_versions','component_asset_previews','capability_availability_decisions','capability_supply_relations') AND trigger_row.tgname='_authority_tenant_lineage_guard' AND NOT trigger_row.tgisinternal) AS guard_count`;
  if (!contract?.previews || !contract.availability || contract.catalog_count !== 3 || contract.guard_count !== 5) throw new Error("CAP-07 authority catalog or database guards are incomplete");
  const [lockingContract] = await client<Array<{ publication_lock_executable: boolean; resolution_update_granted: boolean; plan_update_granted: boolean; version_update_granted: boolean }>>`
    SELECT has_function_privilege('foundry_product_runtime','foundry_product.lock_cap07_publication_source(uuid,uuid,uuid)','EXECUTE') AS publication_lock_executable,
      has_table_privilege('foundry_product_runtime','foundry_product.capability_resolutions','UPDATE') AS resolution_update_granted,
      has_table_privilege('foundry_product_runtime','foundry_product.activity_plan_proposals','UPDATE') AS plan_update_granted,
      has_table_privilege('foundry_product_runtime','foundry_product.capability_versions','UPDATE') AS version_update_granted`;
  if (!lockingContract?.publication_lock_executable || lockingContract.resolution_update_granted || lockingContract.plan_update_granted || lockingContract.version_update_granted) {
    throw new Error("CAP-07 source freshness locking broadened direct immutable-table write authority");
  }

  await expectDenied("CAP-07 scoped Registry insert without tenant context", () => client`INSERT INTO foundry_product.capabilities(id,institution_id,course_id,key,name,reference_pack_key,kind) VALUES (${randomUUID()}::uuid,${institutionId}::uuid,${courseId}::uuid,${`cap07-denied-${randomUUID()}`},'Denied scoped capability','cap07-pack','WEB_COMPONENT_ASSET')`, /Tenant-private Capability Registry scope mismatch/);
  await expectDenied("direct product-runtime preview INSERT", () => client.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`INSERT INTO foundry_product.component_asset_previews(institution_id,course_id,component_version_id,component_evaluation_id,source_capability_resolution_id,content_hash,request_hash,learner_input,runtime_output,event_trace,executor_version,executor_receipt_hash,status,previewed_by,actor_provenance,idempotency_key) VALUES (${institutionId}::uuid,${courseId}::uuid,${fixtureComponentVersionId}::uuid,${fixtureEvaluationId}::uuid,${randomUUID()}::uuid,${`sha256:${fixtureComponentVersionId}`},'forged','{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'forged','forged','SUCCEEDED',${fixtureUserId}::uuid,'{}'::jsonb,'forged-preview')`;
  }), /permission denied for table component_asset_previews/);
  await expectDenied("product-runtime fabricated evaluation service call", () => client.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`SELECT * FROM foundry_product.record_web_component_evaluation(
      ${randomUUID()}::uuid,${partialWebVersionId}::uuid,${"a".repeat(64)},'PASSED',
      ${JSON.stringify(Array.from({ length: 10 }, (_, index) => ({ id: `forged-${index}`, status: "PASSED", detail: "fabricated" })))}::jsonb,
      ${JSON.stringify({ status: "EXECUTED_PASSED", executorVersion: "cap-07.shared-web-executor.v1", executorReceiptHash: `sha256:${"b".repeat(64)}` })}::jsonb,
      '[]'::jsonb,'{"status":"UNAVAILABLE"}'::jsonb)`;
  }), /permission denied for function record_web_component_evaluation/);
  await expectDenied("product-runtime fabricated preview service call", () => client.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`SELECT * FROM foundry_product.record_component_asset_preview(
      ${randomUUID()}::uuid,${seededWebComponentId}::uuid,${seededWebVersionId}::uuid,${seededWebEvaluationId}::uuid,
      ${`sha256:${"c".repeat(64)}`},'{"selectedChoiceId":"forged"}'::jsonb,'{"componentCompleted":true,"correct":true,"feedback":"fabricated"}'::jsonb,
      '[{"sequence":1,"eventType":"COMPONENT_STARTED","previewOnly":true}]'::jsonb,'cap-07.shared-web-executor.v1',${`sha256:${"d".repeat(64)}`},${`forged-${randomUUID()}`})`;
  }), /permission denied for function record_component_asset_preview/);
  await expectDenied("forged successful preview row", () => client`INSERT INTO foundry_product.component_asset_previews(institution_id,course_id,component_version_id,component_evaluation_id,source_capability_resolution_id,content_hash,request_hash,learner_input,runtime_output,event_trace,executor_version,executor_receipt_hash,status,previewed_by,actor_provenance,idempotency_key) VALUES (${institutionId}::uuid,${courseId}::uuid,${fixtureComponentVersionId}::uuid,${fixtureEvaluationId}::uuid,${randomUUID()}::uuid,${`sha256:${fixtureComponentVersionId}`},'forged','{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'forged','forged','SUCCEEDED',${fixtureUserId}::uuid,'{}'::jsonb,'forged-preview-superuser')`, /Exact learner preview command, result or actor authority mismatch/);
  await expectDenied("ComponentAsset source lineage swap", () => client`UPDATE foundry_product.components SET source_capability_resolution_id=${randomUUID()}::uuid WHERE id=${seededWebComponentId}::uuid`, /ComponentAsset proposal strategy and source lineage are immutable/);
  await expectDenied("direct scoped CapabilityVersion insertion", () => client`INSERT INTO foundry_product.capability_versions(id,capability_id,institution_id,course_id,component_asset_version_id,version,contract,implementation_key,status,content_hash) VALUES (${randomUUID()}::uuid,${seededScopedCapabilityId}::uuid,${institutionId}::uuid,${courseId}::uuid,${seededWebVersionId}::uuid,'0.0.2','{}'::jsonb,'direct-bypass','ACTIVE',${`sha256:${randomUUID()}`})`, /Tenant-private CapabilityVersion exact ComponentAsset lineage mismatch/);
  await expectDenied("direct scoped Capability activation", () => client.begin(async (transaction) => {
    await transaction`SELECT set_config('foundry.institution_id',${institutionId},true)`;
    await transaction`UPDATE foundry_product.capabilities SET active_version_id=${seededScopedCapabilityVersionId}::uuid WHERE id=${seededScopedCapabilityId}::uuid`;
  }), /Capability activation requires the authenticated confirmation command and exact published ComponentAssetVersion/);
  await expectDenied("direct product-runtime CapabilityResolution rewrite", () => client.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`UPDATE foundry_product.capability_resolutions SET id=id WHERE false`;
  }), /permission denied for table capability_resolutions/);
  await expectDenied("direct product-runtime ActivityPlanProposal rewrite", () => client.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`UPDATE foundry_product.activity_plan_proposals SET id=id WHERE false`;
  }), /permission denied for table activity_plan_proposals/);

  const readCountsFor = async (userId: string) => client.begin(async (transaction) => {
    await transaction`SELECT set_config('foundry.institution_id',${institutionId},true)`;
    await transaction`SELECT set_config('foundry.user_id',${userId},true)`;
    await transaction`SELECT set_config('foundry.session_id',${`cap07-read-${userId}`},true)`;
    await transaction`SELECT set_config('foundry.auth_method','password',true)`;
    await transaction`SELECT set_config('foundry.roles','EXPERT',true)`;
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    const [counts] = await transaction<Array<{
      capability_count: number;
      capability_version_count: number;
      component_count: number;
      component_version_count: number;
      evaluation_count: number;
      preview_count: number;
      availability_count: number;
      global_capability_count: number;
      global_version_count: number;
      malformed_evaluation_count: number;
      malformed_preview_count: number;
      malformed_availability_count: number;
    }>>`SELECT
      (SELECT count(*)::int FROM foundry_product.capabilities WHERE id=${seededScopedCapabilityId}::uuid) AS capability_count,
      (SELECT count(*)::int FROM foundry_product.capability_versions WHERE id=${seededScopedCapabilityVersionId}::uuid) AS capability_version_count,
      (SELECT count(*)::int FROM foundry_product.components WHERE id=${seededWebComponentId}::uuid) AS component_count,
      (SELECT count(*)::int FROM foundry_product.component_versions WHERE id=${seededWebVersionId}::uuid) AS component_version_count,
      (SELECT count(*)::int FROM foundry_product.component_evaluations WHERE id=${seededWebEvaluationId}::uuid) AS evaluation_count,
      (SELECT count(*)::int FROM foundry_product.component_asset_previews WHERE id=${seededWebPreviewId}::uuid) AS preview_count,
      (SELECT count(*)::int FROM foundry_product.capability_availability_decisions WHERE id=${seededWebAvailabilityId}::uuid) AS availability_count,
      (SELECT count(*)::int FROM foundry_product.capabilities WHERE id=${capabilityId}::uuid) AS global_capability_count,
      (SELECT count(*)::int FROM foundry_product.capability_versions WHERE id=${capabilityVersionId}::uuid) AS global_version_count,
      (SELECT count(*)::int FROM foundry_product.component_evaluations WHERE id=${malformedEvaluationId}::uuid) AS malformed_evaluation_count,
      (SELECT count(*)::int FROM foundry_product.component_asset_previews WHERE id=${malformedPreviewId}::uuid) AS malformed_preview_count,
      (SELECT count(*)::int FROM foundry_product.capability_availability_decisions WHERE id=${malformedAvailabilityId}::uuid) AS malformed_availability_count`;
    return counts;
  });
  const allowedReadCounts = await readCountsFor(fixtureUserId);
  const deniedReadCounts = await readCountsFor(otherCourseUserId);
  const privateReadKeys = ["capability_count", "capability_version_count", "component_count", "component_version_count", "evaluation_count", "preview_count", "availability_count"] as const;
  if (!allowedReadCounts || privateReadKeys.some((key) => allowedReadCounts[key] !== 1) || allowedReadCounts.global_capability_count !== 1 || allowedReadCounts.global_version_count !== 1) {
    throw new Error(`CAP-07 enrolled actor could not read the exact course-private parent chain: ${JSON.stringify(allowedReadCounts)}`);
  }
  if (!deniedReadCounts || privateReadKeys.some((key) => deniedReadCounts[key] !== 0) || deniedReadCounts.global_capability_count !== 1 || deniedReadCounts.global_version_count !== 1) {
    throw new Error(`CAP-07 same-institution other-course actor crossed course-private read scope: ${JSON.stringify(deniedReadCounts)}`);
  }
  const malformedReadKeys = ["malformed_evaluation_count", "malformed_preview_count", "malformed_availability_count"] as const;
  if (malformedReadKeys.some((key) => allowedReadCounts[key] !== 0 || deniedReadCounts[key] !== 0)) {
    throw new Error(`CAP-07 malformed child/parent chains crossed qualified RLS: ${JSON.stringify({ allowedReadCounts, deniedReadCounts })}`);
  }

  await expectDenied("other-course malformed CapabilityVersion parent insert", () => client.begin(async (transaction) => {
    await transaction`SELECT set_config('foundry.institution_id',${institutionId},true)`;
    await transaction`SELECT set_config('foundry.user_id',${otherCourseUserId},true)`;
    await transaction`SELECT set_config('foundry.session_id','cap07-malformed-parent-insert',true)`;
    await transaction`SELECT set_config('foundry.auth_method','password',true)`;
    await transaction`SELECT set_config('foundry.roles','EXPERT',true)`;
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`INSERT INTO foundry_product.capability_versions(id,capability_id,institution_id,course_id,component_asset_version_id,version,contract,implementation_key,status,content_hash) VALUES (${randomUUID()}::uuid,${malformedParentCapabilityId}::uuid,${institutionId}::uuid,${otherCourseId}::uuid,${seededWebVersionId}::uuid,'0.0.2','{}'::jsonb,'malformed-parent-insert','ACTIVE',${`sha256:${randomUUID()}`})`;
  }), /row-level security|lineage mismatch/i);

  await expectDenied("exact-lineage forged PASSED Web ComponentAsset evaluation", () => client.begin(async (transaction) => {
    await transaction`SELECT set_config('foundry.institution_id',${institutionId},true)`;
    await transaction`SELECT set_config('foundry.user_id',${fixtureUserId},true)`;
    await transaction`SELECT set_config('foundry.session_id','cap07-forged-evaluation',true)`;
    await transaction`SELECT set_config('foundry.auth_method','password',true)`;
    await transaction`SELECT set_config('foundry.roles','EXPERT',true)`;
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`INSERT INTO foundry_product.component_evaluations(id,component_version_id,institution_id,course_id,evaluator_key,evaluator_version,content_hash,input_hash,system_status,system_checks,source_observation_ids,source_review_ids,source_attempt_ids,fixture_execution,evidence_checks,provider_checks,created_by) VALUES (${randomUUID()}::uuid,${partialWebVersionId}::uuid,${institutionId}::uuid,${courseId}::uuid,'forged-direct-runtime','1.0.0',${`sha256:${partialWebVersionId}`},${`sha256:${randomUUID()}`},'PASSED','[]'::jsonb,ARRAY[]::uuid[],ARRAY[]::uuid[],ARRAY[]::uuid[],'{}'::jsonb,'[]'::jsonb,'{}'::jsonb,${fixtureUserId}::uuid)`;
  }), /canonical evaluation service/);

  await expectDenied("runtime-role partial Web ComponentAsset publication", () => client.begin(async (transaction) => {
    await transaction`SELECT set_config('foundry.institution_id',${institutionId},true)`;
    await transaction`SELECT set_config('foundry.user_id',${fixtureUserId},true)`;
    await transaction`SELECT set_config('foundry.session_id','cap07-partial-publication',true)`;
    await transaction`SELECT set_config('foundry.auth_method','password',true)`;
    await transaction`SELECT set_config('foundry.roles','EXPERT',true)`;
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await transaction`UPDATE foundry_product.component_versions SET status='PUBLISHED' WHERE id=${partialWebVersionId}::uuid`;
    await transaction.unsafe("SET CONSTRAINTS ALL IMMEDIATE");
  }), /Published Web ComponentAssetVersion cannot commit without complete Registry availability and READY planning/);
  const [rolledBackPartialPublication] = await client<Array<{ status: string }>>`SELECT status FROM foundry_product.component_versions WHERE id=${partialWebVersionId}::uuid`;
  if (rolledBackPartialPublication?.status !== "DRAFT") throw new Error("CAP-07 partial Web ComponentAsset publication was not rolled back");

  console.log(JSON.stringify({
    status: "CAP07_UPGRADE_VERIFIED",
    preservedGlobalRegistryVersion: capabilityVersionId,
    evaluationInsertionVerified: fixtureEvaluationId,
    previewEvaluationForeignKeyVerified: true,
    schemaMigrationParityVerified: true,
    authorityCatalogRows: contract.catalog_count,
    namedAuthorityGuards: contract.guard_count,
    sourceFreshnessLockExecutable: true,
    immutableSourceUpdatePrivileges: false,
    coursePrivateReadGate: { enrolledCourseActor: "7/7", otherCourseActor: "0/7", globalRegistryReadable: true },
    forgedPassedEvaluationRejected: true,
    partialPublicationRolledBack: rolledBackPartialPublication.status === "DRAFT",
    trustedExecutorBoundary: { productEvaluationExecute: false, productPreviewExecute: false, executorEvaluationExecute: true, executorPreviewExecute: true },
    malformedParentChainReadCounts: "0/3 for both course actors",
    directNegativeCases: 13,
  }));
} catch (error) {
  console.error("CAP07_UPGRADE_FAILURE", error);
  throw error;
} finally {
  await client.end({ timeout: 1 });
}
