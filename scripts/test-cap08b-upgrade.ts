import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

function guardedLocalUrl(raw: string | undefined): string {
  if (!raw) throw new Error("CAP08B_UPGRADE_DATABASE_URL is required");
  const url = new URL(raw);
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) throw new Error("CAP08B_UPGRADE_DATABASE_URL must target localhost");
  if (decodeURIComponent(url.pathname.slice(1)) !== "learning_foundry_upgrade_rehearsal") throw new Error("CAP-08B upgrade database must be named exactly learning_foundry_upgrade_rehearsal");
  if (process.env.CAP08B_UPGRADE_RESET_ALLOWED !== "true") throw new Error("CAP08B_UPGRADE_RESET_ALLOWED=true is required");
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

const client = postgres(guardedLocalUrl(process.env.CAP08B_UPGRADE_DATABASE_URL), { max: 1, prepare: false });
const institutionId = randomUUID();
const courseId = randomUUID();
const expertId = randomUUID();
const componentId = randomUUID();
const componentVersionId = randomUUID();
const capabilityId = randomUUID();
const capabilityVersionId = randomUUID();
const supplyRelationId = randomUUID();
const deliveryId = randomUUID();
const attemptId = randomUUID();
const proposalId = randomUUID();
const decisionId = randomUUID();
const proposalReservationKey = `cap08b-preserved-asset:${randomUUID()}`;

try {
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_private CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_operational CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_product CASCADE");
  for (const migration of [
    "0000_full_framework.sql", "0001_full_framework.sql", "0002_recoverable_resume_claims.sql",
    "0003_production_auth_tenant_enforcement.sql", "0004_canonical_identity_context_evidence.sql",
    "0005_authoritative_context_compiler.sql", "0006_diagnosis_capability_resolution.sql",
    "0007_activity_planning.sql", "0008_asset_stage_runtime.sql", "0009_teacher_assignment_intervention.sql",
    "0010_governed_followup.sql", "0011_capability_gap_supply.sql", "0012_asset_optimization.sql",
  ]) await applyMigration(client, migration);

  await client.unsafe("SET session_replication_role = replica");
  try {
    await client`INSERT INTO foundry_product.asset_optimization_proposals
      (id,institution_id,course_id,component_id,component_version_id,component_version_content_hash,
       capability_id,capability_version_id,capability_version_content_hash,capability_supply_relation_id,
       runtime_delivery_id,learner_attempt_id,learner_attempt_content_hash,proposal_type,signal_kind,rationale,
       proposed_change,evidence_snapshot,evidence_refs,evidence_hash,limitations,rule_key,rule_version,confidence,
       state,requested_by,requester_provenance,request_hash)
      VALUES (${proposalId}::uuid,${institutionId}::uuid,${courseId}::uuid,${componentId}::uuid,${componentVersionId}::uuid,'component-hash-preserved',
        ${capabilityId}::uuid,${capabilityVersionId}::uuid,'capability-hash-preserved',${supplyRelationId}::uuid,
        ${deliveryId}::uuid,${attemptId}::uuid,'attempt-hash-preserved','ASSET','INCORRECT_ATTEMPT','Preserved CAP-08A proposal.',
        '{"optimizationDomain":"ASSET"}'::jsonb,'{"correct":false}'::jsonb,'[]'::jsonb,'evidence-hash-preserved',
        '["NO_ROUTING_OPTIMIZATION"]'::jsonb,'cap08a.incorrect-attempt-bounded-retry-feedback','1.0.0',0.35,
        'PENDING_GOVERNANCE',${expertId}::uuid,'{"authMethod":"upgrade-fixture"}'::jsonb,'request-hash-preserved')`;
    await client`INSERT INTO foundry_product.asset_optimization_decisions
      (id,institution_id,course_id,proposal_id,component_id,component_version_id,action,rationale,decided_by,
       actor_provenance,idempotency_key,request_hash)
      VALUES (${decisionId}::uuid,${institutionId}::uuid,${courseId}::uuid,${proposalId}::uuid,${componentId}::uuid,${componentVersionId}::uuid,
        'KEEP_CURRENT','Preserve the current exact ComponentAssetVersion.',${expertId}::uuid,
        '{"authMethod":"upgrade-fixture"}'::jsonb,${`cap08b-preserved-decision:${decisionId}`},'decision-request-hash-preserved')`;
    await client`INSERT INTO foundry_product.idempotency_keys(institution_id,key,command_type,request_hash,result_id,actor_user_id)
      VALUES (${institutionId}::uuid,${proposalReservationKey},'CREATE_ASSET_OPTIMIZATION_PROPOSAL','request-hash-preserved',${proposalId}::uuid,${expertId}::uuid)`;
  } finally {
    await client.unsafe("SET session_replication_role = origin");
  }

  const [before] = await client<Array<{ snapshot: string; schema_snapshot: string }>>`
    SELECT jsonb_build_object(
      'proposal',(SELECT to_jsonb(row) FROM foundry_product.asset_optimization_proposals row WHERE id=${proposalId}::uuid),
      'decision',(SELECT to_jsonb(row) FROM foundry_product.asset_optimization_decisions row WHERE id=${decisionId}::uuid),
      'reservation',(SELECT to_jsonb(row) FROM foundry_product.idempotency_keys row WHERE institution_id=${institutionId}::uuid AND key=${proposalReservationKey})
    )::text AS snapshot,
    (SELECT jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default)
      ORDER BY table_name,ordinal_position)::text FROM information_schema.columns
      WHERE table_schema='foundry_product' AND table_name IN ('asset_optimization_proposals','asset_optimization_decisions')) AS schema_snapshot
  `;
  if (!before) throw new Error("CAP-08A preservation fixture is incomplete");

  await applyMigration(client, "0013_routing_optimization.sql");

  const [after] = await client<Array<{
    snapshot: string;
    schema_snapshot: string;
    proposal_count: number;
    decision_count: number;
    authority_count: number;
    guard_count: number;
    immutable_count: number;
    forced_rls_count: number;
    old_result_lineage: boolean;
  }>>`
    SELECT jsonb_build_object(
      'proposal',(SELECT to_jsonb(row) FROM foundry_product.asset_optimization_proposals row WHERE id=${proposalId}::uuid),
      'decision',(SELECT to_jsonb(row) FROM foundry_product.asset_optimization_decisions row WHERE id=${decisionId}::uuid),
      'reservation',(SELECT to_jsonb(row) FROM foundry_product.idempotency_keys row WHERE institution_id=${institutionId}::uuid AND key=${proposalReservationKey})
    )::text AS snapshot,
    (SELECT jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default)
      ORDER BY table_name,ordinal_position)::text FROM information_schema.columns
      WHERE table_schema='foundry_product' AND table_name IN ('asset_optimization_proposals','asset_optimization_decisions')) AS schema_snapshot,
    (SELECT count(*)::int FROM foundry_product.routing_optimization_proposals) AS proposal_count,
    (SELECT count(*)::int FROM foundry_product.routing_optimization_decisions) AS decision_count,
    (SELECT count(*)::int FROM foundry_private.table_authority_catalog WHERE table_name IN ('routing_optimization_proposals','routing_optimization_decisions')) AS authority_count,
    (SELECT count(*)::int FROM pg_trigger trigger_row JOIN pg_class table_row ON table_row.oid=trigger_row.tgrelid JOIN pg_namespace namespace_row ON namespace_row.oid=table_row.relnamespace
      WHERE namespace_row.nspname='foundry_product' AND table_row.relname IN ('routing_optimization_proposals','routing_optimization_decisions') AND trigger_row.tgname='_authority_tenant_lineage_guard' AND NOT trigger_row.tgisinternal) AS guard_count,
    (SELECT count(*)::int FROM pg_trigger trigger_row JOIN pg_class table_row ON table_row.oid=trigger_row.tgrelid JOIN pg_namespace namespace_row ON namespace_row.oid=table_row.relnamespace
      WHERE namespace_row.nspname='foundry_product' AND table_row.relname IN ('routing_optimization_proposals','routing_optimization_decisions') AND trigger_row.tgname LIKE 'routing_optimization_%_immutable' AND NOT trigger_row.tgisinternal) AS immutable_count,
    (SELECT count(*)::int FROM pg_class table_row JOIN pg_namespace namespace_row ON namespace_row.oid=table_row.relnamespace
      WHERE namespace_row.nspname='foundry_product' AND table_row.relname IN ('routing_optimization_proposals','routing_optimization_decisions') AND table_row.relrowsecurity AND table_row.relforcerowsecurity) AS forced_rls_count,
    foundry_private.idempotency_result_in_tenant('CREATE_ASSET_OPTIMIZATION_PROPOSAL',${proposalId}::uuid,${institutionId}::uuid) AS old_result_lineage
  `;
  if (!after || after.snapshot !== before.snapshot || after.schema_snapshot !== before.schema_snapshot
    || after.proposal_count !== 0 || after.decision_count !== 0 || after.authority_count !== 2
    || after.guard_count !== 2 || after.immutable_count !== 2 || after.forced_rls_count !== 2 || !after.old_result_lineage) {
    throw new Error(`CAP-08B forward-only preservation contract failed: ${JSON.stringify({ before, after })}`);
  }

  await client`SELECT set_config('foundry.user_id',${expertId},false)`;
  await expectDenied("preserved CAP-08A reservation mutation", () => client`
    UPDATE foundry_product.idempotency_keys SET request_hash=request_hash
    WHERE institution_id=${institutionId}::uuid AND key=${proposalReservationKey}
  `, /Asset Optimization idempotency reservation is immutable/);
  await client`SELECT set_config('foundry.user_id','',false)`;
  await expectDenied("actorless CAP-08B reservation", () => client`
    INSERT INTO foundry_product.idempotency_keys(institution_id,key,command_type,request_hash,result_id)
    VALUES (${institutionId}::uuid,${`actorless:${randomUUID()}`},'CREATE_ROUTING_OPTIMIZATION_PROPOSAL',${`sha256:${randomUUID()}`},${randomUUID()}::uuid)
  `, /Governed reservation requires an authenticated actor/);

  console.log(JSON.stringify({
    status: "CAP08B_UPGRADE_VERIFIED",
    exactBaseMigration: "0012_asset_optimization.sql",
    appliedMigration: "0013_routing_optimization.sql",
    preservedAssetOptimizationProposalId: proposalId,
    preservedAssetOptimizationDecisionId: decisionId,
    preservedPriorIdempotencyBehavior: true,
    noRoutingOptimizationRowsFabricated: true,
    guardedTables: 2,
  }));
} catch (error) {
  console.error("CAP08B_UPGRADE_FAILURE", error);
  throw error;
} finally {
  await client.end({ timeout: 1 });
}
