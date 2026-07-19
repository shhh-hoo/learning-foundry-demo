import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";

const newWritableTables = [
  "context_carryover_relations",
  "context_items",
  "evidence_derivatives",
  "learner_profiles",
  "learner_strategy_versions",
  "source_asset_versions",
  "source_assets",
  "source_processing_attempts",
].map((table) => `foundry_product.${table}`).sort();

function guardedLocalUrl(raw: string | undefined): string {
  if (!raw) throw new Error("RW03_TEST_DATABASE_URL is required");
  const url = new URL(raw);
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) throw new Error("RW03_TEST_DATABASE_URL must target localhost");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database.startsWith("learning_foundry_rw03")) throw new Error("RW03_TEST_DATABASE_URL must target a disposable learning_foundry_rw03* database");
  return url.toString();
}

async function expectDenied(
  label: string,
  client: Sql,
  tenantId: string,
  operation: (tx: Sql) => Promise<void>,
  expected: { codes: string[]; message: RegExp },
): Promise<void> {
  try {
    await client.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE foundry_product_runtime");
      await tx`SELECT set_config('foundry.institution_id', ${tenantId}, true)`;
      await operation(tx as unknown as Sql);
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : String(error);
    if (!expected.codes.includes(code) || !expected.message.test(message)) {
      throw new Error(`${label} failed for an unrelated reason (${code}): ${message}`);
    }
    return;
  }
  throw new Error(`${label} unexpectedly committed`);
}

const url = guardedLocalUrl(process.env.RW03_TEST_DATABASE_URL ?? process.env.DATABASE_URL);
const db = postgres(url, { max: 1, prepare: false });

const tenantA = "10000000-0000-4000-8000-000000000001";
const courseA = "40000000-0000-4000-8000-000000000001";
const userA = randomUUID();
const profileA = randomUUID();
const strategyA = randomUUID();
const taskA = randomUUID();
const targetTaskA = randomUUID();
const episodeA = randomUUID();
const assetA = randomUUID();
const versionA = randomUUID();
const sourceA = randomUUID();
const stableSourceKeyA = `rw03-source-${sourceA}`;
const evidenceA = randomUUID();
const processingA = randomUUID();
const derivativeA = randomUUID();
const contextA = randomUUID();
const carryoverA = randomUUID();

const tenantB = randomUUID();
const userB = randomUUID();
const subjectB = randomUUID();
const courseB = randomUUID();
const taskB = randomUUID();
const episodeB = randomUUID();
const sourceB = randomUUID();
const evidenceB = randomUUID();

try {
  await db`INSERT INTO foundry_product.users (id,email,name) VALUES (${userA}::uuid,${`rw03-a-${userA}@example.invalid`},'RW-03 learner A')`;
  await db`INSERT INTO foundry_product.institution_memberships (user_id,institution_id,role) VALUES (${userA}::uuid,${tenantA}::uuid,'LEARNER')`;
  await db`INSERT INTO foundry_product.course_enrollments (institution_id,course_id,user_id,role) VALUES (${tenantA}::uuid,${courseA}::uuid,${userA}::uuid,'LEARNER')`;

  await db`INSERT INTO foundry_product.institutions (id,slug,name) VALUES (${tenantB}::uuid,${`rw03-${tenantB}`},'RW-03 tenant B')`;
  await db`INSERT INTO foundry_product.users (id,email,name) VALUES (${userB}::uuid,${`rw03-b-${userB}@example.invalid`},'RW-03 learner B')`;
  await db`INSERT INTO foundry_product.institution_memberships (user_id,institution_id,role) VALUES (${userB}::uuid,${tenantB}::uuid,'LEARNER')`;
  await db`INSERT INTO foundry_product.subjects (id,institution_id,key,name,reference_pack_key) VALUES (${subjectB}::uuid,${tenantB}::uuid,${`rw03-${subjectB}`},'RW-03 subject B','chemistry-caie-9701')`;
  await db`INSERT INTO foundry_product.courses (id,institution_id,subject_id,code,name) VALUES (${courseB}::uuid,${tenantB}::uuid,${subjectB}::uuid,${`RW03-${courseB}`},'RW-03 course B')`;
  await db`INSERT INTO foundry_product.course_enrollments (institution_id,course_id,user_id,role) VALUES (${tenantB}::uuid,${courseB}::uuid,${userB}::uuid,'LEARNER')`;
  await db`INSERT INTO foundry_product.learning_tasks (id,institution_id,course_id,learner_id,title,goal) VALUES (${taskB}::uuid,${tenantB}::uuid,${courseB}::uuid,${userB}::uuid,'RW-03 task B','Negative lineage fixture')`;
  await db`INSERT INTO foundry_product.learning_episodes (id,task_id,sequence) VALUES (${episodeB}::uuid,${taskB}::uuid,1)`;
  await db`
    INSERT INTO foundry_product.source_records
      (id,institution_id,course_id,source_key,title,source_type,version,authority,rights,rights_authorization_status,distribution_scope,allowed_purposes,content_hash)
    VALUES (${sourceB}::uuid,${tenantB}::uuid,${courseB}::uuid,${`rw03-source-${sourceB}`},'RW-03 source B','INTERNAL_NOTE','1','TEST','Test only','APPROVED','INSTITUTION','["LEARNING"]'::jsonb,${`hash-${sourceB}`})
  `;
  await db`
    INSERT INTO foundry_product.evidence_units
      (id,source_id,institution_id,modality,locator,title,content,search_document,metadata,content_hash)
    VALUES (${evidenceB}::uuid,${sourceB}::uuid,${tenantB}::uuid,'TEXT','rw03-b','RW-03 evidence B','B','B','{}'::jsonb,${`hash-${evidenceB}`})
  `;
  const [bLineage] = await db<Array<{ profile_id: string; asset_id: string; version_id: string; derivative_id: string }>>`
    SELECT t.learner_profile_id AS profile_id,s.source_asset_id AS asset_id,s.source_asset_version_id AS version_id,d.id AS derivative_id
    FROM foundry_product.learning_tasks t
    JOIN foundry_product.source_records s ON s.id=${sourceB}::uuid
    JOIN foundry_product.evidence_derivatives d ON d.evidence_unit_id=${evidenceB}::uuid
    WHERE t.id=${taskB}::uuid
  `;
  if (!bLineage) throw new Error("RW-03 tenant-B canonical fixture was not materialized");

  let autoDerivativeA = "";
  await db.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await tx`SELECT set_config('foundry.institution_id', ${tenantA}, true)`;
    await tx`INSERT INTO foundry_product.learner_profiles (id,institution_id,learner_id,created_by) VALUES (${profileA}::uuid,${tenantA}::uuid,${userA}::uuid,${userA}::uuid)`;
    await tx`INSERT INTO foundry_product.learner_strategy_versions (id,institution_id,learner_profile_id,kind,strategy,provenance,rule_version,actor_user_id,effective_from) VALUES (${strategyA}::uuid,${tenantA}::uuid,${profileA}::uuid,'LEARNING_PREFERENCE','{}'::jsonb,'{"test":"rw03"}'::jsonb,'1',${userA}::uuid,now())`;
    await tx`INSERT INTO foundry_product.learning_tasks (id,institution_id,course_id,learner_id,learner_profile_id,title,goal) VALUES (${taskA}::uuid,${tenantA}::uuid,${courseA}::uuid,${userA}::uuid,${profileA}::uuid,'RW-03 task A','Positive lineage fixture')`;
    await tx`INSERT INTO foundry_product.learning_tasks (id,institution_id,course_id,learner_id,learner_profile_id,title,goal) VALUES (${targetTaskA}::uuid,${tenantA}::uuid,${courseA}::uuid,${userA}::uuid,${profileA}::uuid,'RW-03 target task A','Carryover target fixture')`;
    await tx`INSERT INTO foundry_product.learning_episodes (id,task_id,sequence) VALUES (${episodeA}::uuid,${taskA}::uuid,1)`;
    await tx`INSERT INTO foundry_product.source_assets (id,institution_id,course_id,stable_key,source_type,owner_user_id,created_by) VALUES (${assetA}::uuid,${tenantA}::uuid,${courseA}::uuid,${stableSourceKeyA},'INTERNAL_NOTE',${userA}::uuid,${userA}::uuid)`;
    await tx`
      INSERT INTO foundry_product.source_asset_versions
        (id,source_asset_id,institution_id,version_key,content_hash,stable_locator,provenance,rights_basis,rights_status,access_scope,created_by)
      VALUES (${versionA}::uuid,${assetA}::uuid,${tenantA}::uuid,'1',${`hash-${versionA}`},${`rw03://${versionA}`},'{"test":"rw03"}'::jsonb,'Test only','APPROVED','INSTITUTION',${userA}::uuid)
    `;
    await tx`
      INSERT INTO foundry_product.source_records
        (id,institution_id,course_id,source_key,title,source_type,version,authority,rights,rights_authorization_status,distribution_scope,allowed_purposes,content_hash,source_asset_id,source_asset_version_id)
      VALUES (${sourceA}::uuid,${tenantA}::uuid,${courseA}::uuid,${stableSourceKeyA},'RW-03 source A','INTERNAL_NOTE','1','TEST','Test only','APPROVED','INSTITUTION','["LEARNING"]'::jsonb,${`hash-${versionA}`},${assetA}::uuid,${versionA}::uuid)
    `;
    await tx`
      INSERT INTO foundry_product.evidence_units
        (id,source_id,source_asset_version_id,institution_id,modality,locator,title,content,search_document,metadata,content_hash)
      VALUES (${evidenceA}::uuid,${sourceA}::uuid,${versionA}::uuid,${tenantA}::uuid,'TEXT','rw03-a','RW-03 evidence A','A','A','{}'::jsonb,${`hash-${evidenceA}`})
    `;
    const [derived] = await tx<Array<{ id: string }>>`SELECT id FROM foundry_product.evidence_derivatives WHERE evidence_unit_id=${evidenceA}::uuid`;
    if (!derived) throw new Error("RW-03 evidence compatibility derivative was not materialized");
    autoDerivativeA = derived.id;
    await tx`
      INSERT INTO foundry_product.source_processing_attempts
        (id,institution_id,source_asset_version_id,operation,processor,processor_version,status,idempotency_key)
      VALUES (${processingA}::uuid,${tenantA}::uuid,${versionA}::uuid,'TEST','RW03_HARNESS','1','STARTED',${`rw03-${processingA}`})
    `;
    await tx`
      INSERT INTO foundry_product.evidence_derivatives
        (id,institution_id,source_asset_version_id,derivative_type,locator,content_hash,processor,processor_version,provenance)
      VALUES (${derivativeA}::uuid,${tenantA}::uuid,${versionA}::uuid,'TEST','manual',${`hash-${derivativeA}`},'RW03_HARNESS','1','{"test":"rw03"}'::jsonb)
    `;
    await tx`
      INSERT INTO foundry_product.context_items
        (id,institution_id,learner_profile_id,course_id,task_id,episode_id,kind,scope,payload,provenance,rule_version,source_record_id,source_asset_version_id,evidence_unit_id,evidence_derivative_id,actor_user_id)
      VALUES (${contextA}::uuid,${tenantA}::uuid,${profileA}::uuid,${courseA}::uuid,${taskA}::uuid,${episodeA}::uuid,'TEST_ASSERTION','EPISODE','{}'::jsonb,'{"test":"rw03"}'::jsonb,'1',${sourceA}::uuid,${versionA}::uuid,${evidenceA}::uuid,${derived.id}::uuid,${userA}::uuid)
    `;
    await tx`
      INSERT INTO foundry_product.context_carryover_relations
        (id,institution_id,source_task_id,source_context_item_id,target_task_id,relation_type,actor_user_id,reason)
      VALUES (${carryoverA}::uuid,${tenantA}::uuid,${taskA}::uuid,${contextA}::uuid,${targetTaskA}::uuid,'EXPLICIT_REFERENCE',${userA}::uuid,'RW-03 test')
    `;
  });

  await expectDenied("LearnerProfile tenant B", db, tenantA, async (tx) => {
    await tx`INSERT INTO foundry_product.learner_profiles (institution_id,learner_id,created_by) VALUES (${tenantB}::uuid,${userB}::uuid,${userB}::uuid)`;
  }, { codes: ["23514", "42501"], message: /LearnerProfile tenant lineage mismatch|row-level security policy/ });
  await expectDenied("LearnerStrategyVersion tenant B profile", db, tenantA, async (tx) => {
    await tx`INSERT INTO foundry_product.learner_strategy_versions (institution_id,learner_profile_id,kind,strategy,provenance,rule_version,actor_user_id,effective_from) VALUES (${tenantA}::uuid,${bLineage.profile_id}::uuid,'LEARNING_PREFERENCE','{}'::jsonb,'{"test":"cross-tenant"}'::jsonb,'1',${userA}::uuid,now())`;
  }, { codes: ["23514", "42501"], message: /LearnerStrategyVersion tenant lineage mismatch|row-level security policy/ });
  await expectDenied("SourceAsset tenant B", db, tenantA, async (tx) => {
    await tx`INSERT INTO foundry_product.source_assets (institution_id,course_id,stable_key,source_type) VALUES (${tenantB}::uuid,${courseB}::uuid,${`denied-${randomUUID()}`},'INTERNAL_NOTE')`;
  }, { codes: ["23514", "42501"], message: /SourceAsset tenant lineage mismatch|row-level security policy/ });
  await expectDenied("SourceAssetVersion tenant B asset", db, tenantA, async (tx) => {
    await tx`INSERT INTO foundry_product.source_asset_versions (source_asset_id,institution_id,version_key,content_hash,stable_locator,provenance,rights_basis,rights_status,access_scope) VALUES (${bLineage.asset_id}::uuid,${tenantA}::uuid,'denied',${`hash-${randomUUID()}`},'rw03://denied','{"test":"cross-tenant"}'::jsonb,'Test','APPROVED','INSTITUTION')`;
  }, { codes: ["23514", "42501"], message: /SourceAssetVersion tenant lineage mismatch|row-level security policy/ });
  await expectDenied("SourceProcessingAttempt tenant B version", db, tenantA, async (tx) => {
    await tx`INSERT INTO foundry_product.source_processing_attempts (institution_id,source_asset_version_id,operation,processor,processor_version,status,idempotency_key) VALUES (${tenantA}::uuid,${bLineage.version_id}::uuid,'TEST','RW03_HARNESS','1','STARTED',${randomUUID()})`;
  }, { codes: ["23514", "42501"], message: /SourceProcessingAttempt tenant lineage mismatch|row-level security policy/ });
  await expectDenied("EvidenceDerivative tenant B version", db, tenantA, async (tx) => {
    await tx`INSERT INTO foundry_product.evidence_derivatives (institution_id,source_asset_version_id,evidence_unit_id,derivative_type,locator,content_hash,processor,processor_version,provenance) VALUES (${tenantA}::uuid,${bLineage.version_id}::uuid,${evidenceB}::uuid,'TEST','denied',${`hash-${randomUUID()}`},'RW03_HARNESS','1','{"test":"cross-tenant"}'::jsonb)`;
  }, { codes: ["23514", "42501"], message: /EvidenceDerivative tenant lineage mismatch|row-level security policy/ });
  await expectDenied("ContextItem duplicated tenant B lineage", db, tenantA, async (tx) => {
    await tx`INSERT INTO foundry_product.context_items (institution_id,learner_profile_id,course_id,task_id,episode_id,kind,scope,payload,provenance,rule_version,source_record_id,source_asset_version_id,evidence_unit_id,evidence_derivative_id,actor_user_id) VALUES (${tenantA}::uuid,${profileA}::uuid,${courseA}::uuid,${taskA}::uuid,${episodeA}::uuid,'TEST_ASSERTION','EPISODE','{}'::jsonb,'{"test":"cross-tenant"}'::jsonb,'1',${sourceB}::uuid,${bLineage.version_id}::uuid,${evidenceB}::uuid,${bLineage.derivative_id}::uuid,${userA}::uuid)`;
  }, { codes: ["23514", "42501"], message: /ContextItem tenant lineage mismatch|row-level security policy/ });
  await expectDenied("ContextCarryover tenant B target", db, tenantA, async (tx) => {
    await tx`INSERT INTO foundry_product.context_carryover_relations (institution_id,source_task_id,source_context_item_id,target_task_id,relation_type,actor_user_id,reason) VALUES (${tenantA}::uuid,${taskA}::uuid,${contextA}::uuid,${taskB}::uuid,'EXPLICIT_REFERENCE',${userA}::uuid,'Denied cross-tenant target')`;
  }, { codes: ["23514", "42501"], message: /ContextCarryover tenant lineage mismatch|row-level security policy/ });

  await db.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE foundry_product_runtime");
    await tx`SELECT set_config('foundry.institution_id', ${tenantA}, true)`;
    const completed = await tx`UPDATE foundry_product.source_processing_attempts SET status='SUCCEEDED',finished_at=now() WHERE id=${processingA}::uuid AND status='STARTED'`;
    if (completed.count !== 1) throw new Error("RW-03 permitted processing lifecycle update did not affect exactly one row");
  });
  await expectDenied("LearnerStrategyVersion provenance rewrite", db, tenantA, async (tx) => {
    await tx`UPDATE foundry_product.learner_strategy_versions SET provenance='{"rewritten":true}'::jsonb WHERE id=${strategyA}::uuid`;
  }, { codes: ["23514"], message: /LearnerStrategyVersion identity\/provenance is immutable/ });
  await expectDenied("ContextItem payload rewrite", db, tenantA, async (tx) => {
    await tx`UPDATE foundry_product.context_items SET payload='{"rewritten":true}'::jsonb WHERE id=${contextA}::uuid`;
  }, { codes: ["23514"], message: /ContextItem identity\/provenance\/payload is immutable/ });
  await expectDenied("EvidenceDerivative processor rewrite", db, tenantA, async (tx) => {
    await tx`UPDATE foundry_product.evidence_derivatives SET processor='REWRITTEN' WHERE id=${derivativeA}::uuid`;
  }, { codes: ["23514"], message: /EvidenceDerivative identity\/provenance is immutable/ });
  await expectDenied("SourceProcessingAttempt terminal rewrite", db, tenantA, async (tx) => {
    await tx`UPDATE foundry_product.source_processing_attempts SET failure_message='rewritten' WHERE id=${processingA}::uuid`;
  }, { codes: ["23514"], message: /SourceProcessingAttempt identity\/processor lineage is immutable/ });
  await expectDenied("SourceAssetVersion mutation", db, tenantA, async (tx) => {
    await tx`UPDATE foundry_product.source_asset_versions SET rights_basis='rewritten' WHERE id=${versionA}::uuid`;
  }, { codes: ["42501"], message: /permission denied for table source_asset_versions/ });
  await expectDenied("ContextCarryover mutation", db, tenantA, async (tx) => {
    await tx`UPDATE foundry_product.context_carryover_relations SET reason='rewritten' WHERE id=${carryoverA}::uuid`;
  }, { codes: ["42501"], message: /permission denied for table context_carryover_relations/ });

  const [inventory] = await db<Array<{ catalog_count: number; grant_count: number; guard_count: number; rw03_direct_count: number }>>`
    WITH actual AS (
      SELECT DISTINCT table_schema,table_name FROM information_schema.role_table_grants
      WHERE grantee IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap') AND privilege_type IN ('INSERT','UPDATE','DELETE')
      UNION
      SELECT DISTINCT table_schema,table_name FROM information_schema.role_column_grants
      WHERE grantee IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap') AND privilege_type IN ('INSERT','UPDATE','DELETE')
    ), guarded AS (
      SELECT DISTINCT n.nspname,c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE t.tgname='_authority_tenant_lineage_guard' AND NOT t.tgisinternal
    )
    SELECT
      (SELECT count(*)::int FROM foundry_private.writable_lineage_catalog) AS catalog_count,
      (SELECT count(*)::int FROM actual) AS grant_count,
      (SELECT count(*)::int FROM foundry_private.writable_lineage_catalog i JOIN guarded g ON g.nspname=i.schema_name AND g.relname=i.table_name) AS guard_count,
      (SELECT count(*)::int FROM foundry_private.writable_lineage_catalog WHERE schema_name='foundry_product' AND table_name=ANY(${newWritableTables.map((key) => key.split(".")[1])}::text[])) AS rw03_direct_count
  `;
  if (!inventory || inventory.catalog_count !== 45 || inventory.grant_count !== 45 || inventory.guard_count !== 45 || inventory.rw03_direct_count !== 8) {
    throw new Error(`RW-03 writable inventory mismatch: ${JSON.stringify(inventory)}`);
  }

  const positiveCounts = await db<Array<{ table_name: string; present: number }>>`
    SELECT * FROM (VALUES
      ('learner_profiles',(SELECT count(*)::int FROM foundry_product.learner_profiles WHERE id=${profileA}::uuid)),
      ('learner_strategy_versions',(SELECT count(*)::int FROM foundry_product.learner_strategy_versions WHERE id=${strategyA}::uuid)),
      ('source_assets',(SELECT count(*)::int FROM foundry_product.source_assets WHERE id=${assetA}::uuid)),
      ('source_asset_versions',(SELECT count(*)::int FROM foundry_product.source_asset_versions WHERE id=${versionA}::uuid)),
      ('source_processing_attempts',(SELECT count(*)::int FROM foundry_product.source_processing_attempts WHERE id=${processingA}::uuid)),
      ('evidence_derivatives',(SELECT count(*)::int FROM foundry_product.evidence_derivatives WHERE id=${derivativeA}::uuid)),
      ('context_items',(SELECT count(*)::int FROM foundry_product.context_items WHERE id=${contextA}::uuid)),
      ('context_carryover_relations',(SELECT count(*)::int FROM foundry_product.context_carryover_relations WHERE id=${carryoverA}::uuid))
    ) AS evidence(table_name,present)
  `;
  if (positiveCounts.length !== 8 || positiveCounts.some((row) => row.present !== 1) || !autoDerivativeA) {
    throw new Error(`RW-03 same-tenant positives incomplete: ${JSON.stringify(positiveCounts)}`);
  }
  process.stdout.write(`${JSON.stringify({ status: "PASS", catalog: 45, actualWritable: 45, guarded: 45, rw03DirectTables: 8, sameTenantPositive: 8, crossTenantDenied: 8, lifecyclePositive: 1, immutableRewriteDenied: 6, exactContextLineage: true })}\n`);
} finally {
  await db.end();
}
