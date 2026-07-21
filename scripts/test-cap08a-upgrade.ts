import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

function guardedLocalUrl(raw: string | undefined): string {
  if (!raw) throw new Error("CAP08A_UPGRADE_DATABASE_URL is required");
  const url = new URL(raw);
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) throw new Error("CAP08A_UPGRADE_DATABASE_URL must target localhost");
  if (decodeURIComponent(url.pathname.slice(1)) !== "learning_foundry_upgrade_rehearsal") throw new Error("CAP-08A upgrade database must be named exactly learning_foundry_upgrade_rehearsal");
  if (process.env.CAP08A_UPGRADE_RESET_ALLOWED !== "true") throw new Error("CAP08A_UPGRADE_RESET_ALLOWED=true is required");
  return url.toString();
}

async function applyMigration(client: postgres.Sql, filename: string): Promise<void> {
  const migration = await readFile(resolve("db/migrations", filename), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.unsafe(statement);
}

async function expectDenied(label: string, operation: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (pattern.test(message)) return;
    throw new Error(`${label} failed for the wrong reason: ${message}`);
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

const client = postgres(guardedLocalUrl(process.env.CAP08A_UPGRADE_DATABASE_URL), { max: 1, prepare: false });
const institutionId = randomUUID();
const subjectId = randomUUID();
const courseId = randomUUID();
const learnerId = randomUUID();
const expertId = randomUUID();
const learnerProfileId = randomUUID();
const taskId = randomUUID();
const componentId = randomUUID();
const componentVersionId = randomUUID();
const capabilityId = randomUUID();
const capabilityVersionId = randomUUID();
const supplyRelationId = randomUUID();
const taskReservationKey = `cap08a-preexisting-task:${randomUUID()}`;

try {
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_private CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_operational CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_product CASCADE");
  for (const migration of [
    "0000_full_framework.sql", "0001_full_framework.sql", "0002_recoverable_resume_claims.sql",
    "0003_production_auth_tenant_enforcement.sql", "0004_canonical_identity_context_evidence.sql",
    "0005_authoritative_context_compiler.sql", "0006_diagnosis_capability_resolution.sql",
    "0007_activity_planning.sql", "0008_asset_stage_runtime.sql", "0009_teacher_assignment_intervention.sql",
    "0010_governed_followup.sql", "0011_capability_gap_supply.sql",
  ]) await applyMigration(client, migration);

  await client.unsafe("SET session_replication_role = replica");
  try {
    await client`INSERT INTO foundry_product.institutions(id,slug,name) VALUES (${institutionId}::uuid,${`cap08a-${institutionId}`},'CAP-08A upgrade fixture')`;
    await client`INSERT INTO foundry_product.users(id,email,name) VALUES
      (${learnerId}::uuid,${`cap08a-learner-${learnerId}@upgrade.invalid`},'CAP-08A learner'),
      (${expertId}::uuid,${`cap08a-expert-${expertId}@upgrade.invalid`},'CAP-08A expert')`;
    await client`INSERT INTO foundry_product.institution_memberships(user_id,institution_id,role) VALUES
      (${learnerId}::uuid,${institutionId}::uuid,'LEARNER'),(${expertId}::uuid,${institutionId}::uuid,'EXPERT')`;
    await client`INSERT INTO foundry_product.subjects(id,institution_id,key,name,reference_pack_key)
      VALUES (${subjectId}::uuid,${institutionId}::uuid,${`cap08a-${subjectId}`},'CAP-08A subject','cap08a-pack')`;
    await client`INSERT INTO foundry_product.courses(id,institution_id,subject_id,code,name)
      VALUES (${courseId}::uuid,${institutionId}::uuid,${subjectId}::uuid,${`CAP08A-${courseId.slice(0, 8)}`},'CAP-08A course')`;
    await client`INSERT INTO foundry_product.course_enrollments(institution_id,course_id,user_id,role) VALUES
      (${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,'LEARNER'),(${institutionId}::uuid,${courseId}::uuid,${expertId}::uuid,'EXPERT')`;
    await client`INSERT INTO foundry_product.learner_profiles(id,institution_id,learner_id,created_by)
      VALUES (${learnerProfileId}::uuid,${institutionId}::uuid,${learnerId}::uuid,${learnerId}::uuid)`;
    await client`INSERT INTO foundry_product.learning_tasks(id,institution_id,course_id,learner_id,learner_profile_id,title,goal)
      VALUES (${taskId}::uuid,${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,${learnerProfileId}::uuid,'Preserved CAP-07 task','Preserve canonical Product State through CAP-08A')`;
    await client`INSERT INTO foundry_product.capabilities(id,institution_id,course_id,key,name,reference_pack_key,kind)
      VALUES (${capabilityId}::uuid,${institutionId}::uuid,${courseId}::uuid,${`cap08a-capability-${capabilityId}`},'Preserved exact Web capability','cap08a-pack','WEB_COMPONENT_ASSET')`;
    await client`INSERT INTO foundry_product.components
      (id,institution_id,course_id,capability_id,asset_type,registered_capability_id,registered_capability_version_id,
       reference_pack_key,key,title,status,source_signal,active_version_id,created_by)
      VALUES (${componentId}::uuid,${institutionId}::uuid,${courseId}::uuid,${capabilityId}::uuid,'WEB_COMPONENT_ASSET',${capabilityId}::uuid,${capabilityVersionId}::uuid,
        'cap08a-pack',${`cap08a-component-${componentId}`},'Preserved exact Web ComponentAsset','PUBLISHED','{}'::jsonb,${componentVersionId}::uuid,${expertId}::uuid)`;
    await client`INSERT INTO foundry_product.component_versions
      (id,component_id,version,contract,content,source_observation_ids,source_review_ids,validation,status,content_hash,created_by)
      VALUES (${componentVersionId}::uuid,${componentId}::uuid,'1.0.0',${client.json({ contractType: "WEB_COMPONENT_ASSET", contractVersion: "cap-07.1" })},
        ${client.json({ packageType: "DECLARATIVE_WEB_COMPONENT_ASSET", packageRole: "ADAPTED" })},ARRAY[]::uuid[],ARRAY[]::uuid[],
        ${client.json({ cap07: "preserved" })},'PUBLISHED',${`sha256:${componentVersionId}`},${expertId}::uuid)`;
    await client`INSERT INTO foundry_product.capability_versions
      (id,capability_id,institution_id,course_id,component_asset_version_id,version,contract,implementation_key,status,content_hash)
      VALUES (${capabilityVersionId}::uuid,${capabilityId}::uuid,${institutionId}::uuid,${courseId}::uuid,${componentVersionId}::uuid,'1.0.0',
        ${client.json({ componentAsset: { componentId, versionId: componentVersionId } })},'foundry.web.pause-predict','ACTIVE',${`sha256:${capabilityVersionId}`})`;
    await client`UPDATE foundry_product.capabilities SET active_version_id=${capabilityVersionId}::uuid WHERE id=${capabilityId}::uuid`;
    await client`INSERT INTO foundry_product.capability_supply_relations
      (id,institution_id,course_id,source_capability_resolution_id,source_activity_plan_proposal_id,source_diagnostic_observation_id,
       source_attempt_id,component_id,component_version_id,registered_capability_id,registered_capability_version_id,confirmation_decision_id,created_by)
      VALUES (${supplyRelationId}::uuid,${institutionId}::uuid,${courseId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,
        ${randomUUID()}::uuid,${componentId}::uuid,${componentVersionId}::uuid,${capabilityId}::uuid,${capabilityVersionId}::uuid,${randomUUID()}::uuid,${expertId}::uuid)`;
    await client`INSERT INTO foundry_product.idempotency_keys(institution_id,key,command_type,request_hash,result_id)
      VALUES (${institutionId}::uuid,${taskReservationKey},'CREATE_TASK',${`sha256:${taskId}`},${taskId}::uuid)`;
  } finally {
    await client.unsafe("SET session_replication_role = origin");
  }

  const [before] = await client<Array<{ snapshot: string; reservation_count: number }>>`
    SELECT jsonb_build_object(
      'component',(SELECT to_jsonb(row) FROM (SELECT id,institution_id,course_id,asset_type,supply_strategy,status,active_version_id FROM foundry_product.components WHERE id=${componentId}::uuid) row),
      'componentVersion',(SELECT to_jsonb(row) FROM (SELECT id,component_id,version,status,content_hash FROM foundry_product.component_versions WHERE id=${componentVersionId}::uuid) row),
      'capability',(SELECT to_jsonb(row) FROM (SELECT id,institution_id,course_id,active_version_id FROM foundry_product.capabilities WHERE id=${capabilityId}::uuid) row),
      'capabilityVersion',(SELECT to_jsonb(row) FROM (SELECT id,capability_id,institution_id,course_id,component_asset_version_id,status,content_hash FROM foundry_product.capability_versions WHERE id=${capabilityVersionId}::uuid) row),
      'supplyRelation',(SELECT to_jsonb(row) FROM (SELECT id,institution_id,course_id,component_id,component_version_id,registered_capability_id,registered_capability_version_id FROM foundry_product.capability_supply_relations WHERE id=${supplyRelationId}::uuid) row)
    )::text AS snapshot,
    (SELECT count(*)::int FROM foundry_product.idempotency_keys WHERE institution_id=${institutionId}::uuid AND key=${taskReservationKey}) AS reservation_count
  `;
  if (!before || before.reservation_count !== 1) throw new Error("CAP-07 preservation fixture is incomplete");

  await applyMigration(client, "0012_asset_optimization.sql");

  const [after] = await client<Array<{
    snapshot: string;
    reservation_count: number;
    proposal_count: number;
    decision_count: number;
    authority_count: number;
    guard_count: number;
    forced_rls_count: number;
    pgcrypto_available: boolean;
    old_result_lineage: boolean;
  }>>`
    SELECT jsonb_build_object(
      'component',(SELECT to_jsonb(row) FROM (SELECT id,institution_id,course_id,asset_type,supply_strategy,status,active_version_id FROM foundry_product.components WHERE id=${componentId}::uuid) row),
      'componentVersion',(SELECT to_jsonb(row) FROM (SELECT id,component_id,version,status,content_hash FROM foundry_product.component_versions WHERE id=${componentVersionId}::uuid) row),
      'capability',(SELECT to_jsonb(row) FROM (SELECT id,institution_id,course_id,active_version_id FROM foundry_product.capabilities WHERE id=${capabilityId}::uuid) row),
      'capabilityVersion',(SELECT to_jsonb(row) FROM (SELECT id,capability_id,institution_id,course_id,component_asset_version_id,status,content_hash FROM foundry_product.capability_versions WHERE id=${capabilityVersionId}::uuid) row),
      'supplyRelation',(SELECT to_jsonb(row) FROM (SELECT id,institution_id,course_id,component_id,component_version_id,registered_capability_id,registered_capability_version_id FROM foundry_product.capability_supply_relations WHERE id=${supplyRelationId}::uuid) row)
    )::text AS snapshot,
    (SELECT count(*)::int FROM foundry_product.idempotency_keys WHERE institution_id=${institutionId}::uuid AND key=${taskReservationKey}) AS reservation_count,
    (SELECT count(*)::int FROM foundry_product.asset_optimization_proposals) AS proposal_count,
    (SELECT count(*)::int FROM foundry_product.asset_optimization_decisions) AS decision_count,
    (SELECT count(*)::int FROM foundry_private.table_authority_catalog WHERE table_name IN ('asset_optimization_proposals','asset_optimization_decisions')) AS authority_count,
    (SELECT count(*)::int FROM pg_trigger trigger_row JOIN pg_class table_row ON table_row.oid=trigger_row.tgrelid JOIN pg_namespace namespace_row ON namespace_row.oid=table_row.relnamespace
      WHERE namespace_row.nspname='foundry_product' AND table_row.relname IN ('asset_optimization_proposals','asset_optimization_decisions') AND trigger_row.tgname='_authority_tenant_lineage_guard' AND NOT trigger_row.tgisinternal) AS guard_count,
    (SELECT count(*)::int FROM pg_class table_row JOIN pg_namespace namespace_row ON namespace_row.oid=table_row.relnamespace
      WHERE namespace_row.nspname='foundry_product' AND table_row.relname IN ('asset_optimization_proposals','asset_optimization_decisions') AND table_row.relrowsecurity AND table_row.relforcerowsecurity) AS forced_rls_count,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto') AS pgcrypto_available,
    foundry_private.idempotency_result_in_tenant('CREATE_TASK',${taskId}::uuid,${institutionId}::uuid) AS old_result_lineage
  `;
  if (!after || after.snapshot !== before.snapshot || after.reservation_count !== 1 || after.proposal_count !== 0 || after.decision_count !== 0
    || after.authority_count !== 2 || after.guard_count !== 2 || after.forced_rls_count !== 2 || !after.pgcrypto_available || !after.old_result_lineage) {
    throw new Error(`CAP-08A forward-only preservation contract failed: ${JSON.stringify({ before, after })}`);
  }

  await client`UPDATE foundry_product.idempotency_keys SET request_hash=request_hash
    WHERE institution_id=${institutionId}::uuid AND command_type='CREATE_TASK' AND key=${taskReservationKey}`;
  await expectDenied("actorless CAP-08A reservation", () => client`
    INSERT INTO foundry_product.idempotency_keys(institution_id,key,command_type,request_hash,result_id)
    VALUES (${institutionId}::uuid,${`actorless:${randomUUID()}`},'CREATE_ASSET_OPTIMIZATION_PROPOSAL',${`sha256:${randomUUID()}`},${randomUUID()}::uuid)
  `, /Governed reservation requires an authenticated actor/);

  console.log(JSON.stringify({
    status: "CAP08A_UPGRADE_VERIFIED",
    exactBaseMigration: "0011_capability_gap_supply.sql",
    appliedMigration: "0012_asset_optimization.sql",
    preservedComponentAssetVersionId: componentVersionId,
    preservedCapabilityVersionId: capabilityVersionId,
    preservedSupplyRelationId: supplyRelationId,
    preservedPriorIdempotencyBehavior: true,
    noOptimizationRowsFabricated: true,
    guardedTables: 2,
  }));
} catch (error) {
  console.error("CAP08A_UPGRADE_FAILURE", error);
  throw error;
} finally {
  await client.end({ timeout: 1 });
}
