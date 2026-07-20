import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

function guardedLocalUrl(raw: string | undefined): string {
  if (!raw) throw new Error("CAP06_UPGRADE_DATABASE_URL is required");
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) throw new Error("CAP06_UPGRADE_DATABASE_URL must target localhost");
  if (database !== "learning_foundry_cap06_upgrade") throw new Error("CAP-06 upgrade database must be named exactly learning_foundry_cap06_upgrade");
  if (process.env.CAP06_UPGRADE_RESET_ALLOWED !== "true") throw new Error("CAP06_UPGRADE_RESET_ALLOWED=true is required");
  return url.toString();
}

async function applyMigration(client: postgres.Sql, filename: string): Promise<void> {
  const migration = await readFile(resolve("db/migrations", filename), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.unsafe(statement);
}

let directPostgresNegativeCases = 0;

async function expectDatabaseRejection(label: string, pattern: RegExp, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) throw new Error(`${label} failed for an unexpected reason: ${message}`);
    directPostgresNegativeCases += 1;
    return;
  }
  throw new Error(`${label} was accepted`);
}

const client = postgres(guardedLocalUrl(process.env.CAP06_UPGRADE_DATABASE_URL), { max: 1, prepare: false });
const institutionId = randomUUID();
const learnerId = randomUUID();
const teacherId = randomUUID();
const unauthorizedId = randomUUID();
const subjectId = randomUUID();
const courseId = randomUUID();
const profileId = randomUUID();
const capabilityId = randomUUID();
const capabilityVersionId = randomUUID();
const capabilityKey = `cap06-capability-${capabilityId}`;
const capabilityHash = `sha256:${randomUUID()}`;
const sourceId = randomUUID();
const evidenceId = randomUUID();

type ActivityFixture = {
  id: string;
  taskId: string;
  sourceEpisodeId: string;
  targetEpisodeId: string;
  assignmentEventId: string;
  contextItemId: string;
  extensionId?: string;
  idempotencyKey: string;
  requestHash: string;
  assignedAt: Date;
  sourceSignature: Record<string, string>;
  generalEpisodeId?: string;
};

type ActivityFixtureOptions = {
  omitExtension?: boolean;
  extensionType?: "TRANSFER" | "RETENTION";
  transferChangedDimensions?: string[];
  transferTargetRepresentation?: string;
  retentionDueOffsetSeconds?: number;
  omitReservation?: boolean;
  reservationResultId?: string;
  activityRequestHash?: string;
};

try {
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_private CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_operational CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS foundry_product CASCADE");
  for (const migration of [
    "0000_full_framework.sql", "0001_full_framework.sql", "0002_recoverable_resume_claims.sql",
    "0003_production_auth_tenant_enforcement.sql", "0004_canonical_identity_context_evidence.sql",
    "0005_authoritative_context_compiler.sql", "0006_diagnosis_capability_resolution.sql",
    "0007_activity_planning.sql", "0008_asset_stage_runtime.sql", "0009_teacher_assignment_intervention.sql",
  ]) await applyMigration(client, migration);

  await client`INSERT INTO foundry_product.institutions (id,slug,name) VALUES (${institutionId}::uuid,${`cap06-${institutionId}`},'CAP-06 upgrade fixture')`;
  await client`INSERT INTO foundry_product.users (id,email,name) VALUES
    (${learnerId}::uuid,${`cap06-learner-${learnerId}@upgrade.invalid`},'CAP-06 learner'),
    (${teacherId}::uuid,${`cap06-teacher-${teacherId}@upgrade.invalid`},'CAP-06 teacher'),
    (${unauthorizedId}::uuid,${`cap06-unauthorized-${unauthorizedId}@upgrade.invalid`},'CAP-06 unauthorized member')`;
  await client`INSERT INTO foundry_product.institution_memberships (user_id,institution_id,role) VALUES
    (${learnerId}::uuid,${institutionId}::uuid,'LEARNER'),(${teacherId}::uuid,${institutionId}::uuid,'TEACHER'),
    (${unauthorizedId}::uuid,${institutionId}::uuid,'ADMIN')`;
  await client`INSERT INTO foundry_product.subjects (id,institution_id,key,name,reference_pack_key)
    VALUES (${subjectId}::uuid,${institutionId}::uuid,${`cap06-${subjectId}`},'CAP-06 subject','cap06-pack')`;
  await client`INSERT INTO foundry_product.courses (id,institution_id,subject_id,code,name)
    VALUES (${courseId}::uuid,${institutionId}::uuid,${subjectId}::uuid,${`CAP06-${courseId.slice(0, 8)}`},'CAP-06 course')`;
  await client`INSERT INTO foundry_product.course_enrollments (institution_id,course_id,user_id,role) VALUES
    (${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,'LEARNER'),
    (${institutionId}::uuid,${courseId}::uuid,${teacherId}::uuid,'TEACHER')`;
  await client`INSERT INTO foundry_product.learner_profiles (id,institution_id,learner_id,created_by)
    VALUES (${profileId}::uuid,${institutionId}::uuid,${learnerId}::uuid,${learnerId}::uuid)`;
  await client`INSERT INTO foundry_product.capabilities (id,key,name,reference_pack_key,kind)
    VALUES (${capabilityId}::uuid,${capabilityKey},'CAP-06 capability','cap06-pack','DETERMINISTIC_ADAPTER')`;
  await client`INSERT INTO foundry_product.capability_versions (id,capability_id,version,contract,implementation_key,status,content_hash)
    VALUES (${capabilityVersionId}::uuid,${capabilityId}::uuid,'1.0.0',${client.json({ inputs: [] })},'cap06-runtime','ACTIVE',${capabilityHash})`;
  await client`UPDATE foundry_product.capabilities SET active_version_id=${capabilityVersionId}::uuid WHERE id=${capabilityId}::uuid`;
  await client`INSERT INTO foundry_product.source_records
    (id,institution_id,course_id,source_key,title,source_type,version,authority,rights,rights_authorization_status,distribution_scope,allowed_purposes,content_hash)
    VALUES (${sourceId}::uuid,${institutionId}::uuid,${courseId}::uuid,${`cap06-source-${sourceId}`},'CAP-06 source','TEACHER_NOTE','1','UPGRADE_FIXTURE','AUTHORIZED','APPROVED','INSTITUTION',${client.json(["LEARNING", "TEACHING"])},${`sha256:${sourceId}`})`;
  await client`INSERT INTO foundry_product.evidence_units
    (id,source_id,institution_id,modality,locator,title,content,search_document,metadata,content_hash,embedding_status)
    VALUES (${evidenceId}::uuid,${sourceId}::uuid,${institutionId}::uuid,'TEXT','fixture#one','CAP-06 Evidence','Upgrade fixture Evidence','upgrade fixture evidence',${client.json({ courseIds: [courseId] })},${`sha256:${evidenceId}`},'PROVIDER_UNAVAILABLE')`;

  const legacyTaskId = randomUUID();
  const legacyEpisodeId = randomUUID();
  const legacyAttemptId = randomUUID();
  const legacyObservationId = randomUUID();
  const legacyReviewId = randomUUID();
  const legacyRetryId = randomUUID();
  const legacyTransferId = randomUUID();
  const legacyRetentionId = randomUUID();
  const legacyGovernanceEventId = randomUUID();
  const legacyFileId = randomUUID();
  const legacyFileStorageKey = `cap06-legacy-file-${legacyFileId}`;
  const legacyFileHash = `sha256:${legacyFileId}`;
  const legacyRetryWorkflowId = randomUUID();
  const legacyInterruptWorkflowId = randomUUID();
  await client`INSERT INTO foundry_product.learning_tasks
    (id,institution_id,course_id,learner_id,learner_profile_id,title,goal)
    VALUES (${legacyTaskId}::uuid,${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,${profileId}::uuid,'Pre-CAP-06 Task','Preserve historical follow-up facts')`;
  await client`INSERT INTO foundry_product.learning_episodes (id,task_id,sequence) VALUES (${legacyEpisodeId}::uuid,${legacyTaskId}::uuid,1)`;
  await client`INSERT INTO foundry_product.learner_attempts
    (id,task_id,episode_id,learner_id,capability_id,prompt,response,structured_input,source_refs)
    VALUES (${legacyAttemptId}::uuid,${legacyTaskId}::uuid,${legacyEpisodeId}::uuid,${learnerId}::uuid,${capabilityId}::uuid,'Legacy prompt','Legacy response','{}'::jsonb,'[]'::jsonb)`;
  await client`INSERT INTO foundry_product.diagnostic_observations
    (id,attempt_id,capability_version_id,status,failure_code,summary,structured_result,input_lineage,output_lineage)
    VALUES (${legacyObservationId}::uuid,${legacyAttemptId}::uuid,${capabilityVersionId}::uuid,'NEEDS_REVIEW','LEGACY_ISSUE','Legacy reviewed issue','{}'::jsonb,${client.json({ attemptId: legacyAttemptId })},${client.json({ capabilityVersionId })})`;
  await client`INSERT INTO foundry_product.teacher_reviews
    (id,observation_id,teacher_id,decision,teaching_support,actor_provenance,idempotency_key)
    VALUES (${legacyReviewId}::uuid,${legacyObservationId}::uuid,${teacherId}::uuid,'ACCEPT','Legacy authenticated teaching support',${client.json({ userId: teacherId, institutionId, roles: ["TEACHER"], authMethod: "cap06-upgrade", sessionId: "cap06-legacy", authenticatedAt: "2026-07-20T00:00:00.000Z" })},${`legacy-review:${legacyReviewId}`})`;
  await client`INSERT INTO foundry_product.retry_attempts
    (id,original_attempt_id,reviewed_observation_id,teacher_review_id,activity_type,prompt,status)
    VALUES (${legacyRetryId}::uuid,${legacyAttemptId}::uuid,${legacyObservationId}::uuid,${legacyReviewId}::uuid,'RETRY','Legacy retry','ASSIGNED')`;
  await client`INSERT INTO foundry_product.transfer_activities (id,retry_id,target_concept,evidence_unit_id)
    VALUES (${legacyTransferId}::uuid,${legacyRetryId}::uuid,'legacy-target',${evidenceId}::uuid)`;
  await client`INSERT INTO foundry_product.retention_reviews (id,retry_id,due_at,evidence_unit_id)
    VALUES (${legacyRetentionId}::uuid,${legacyRetryId}::uuid,'2026-07-25T00:00:00.000Z',${evidenceId}::uuid)`;
  await client`INSERT INTO foundry_product.governance_events
    (id,institution_id,actor_user_id,entity_type,entity_id,action,payload)
    VALUES (${legacyGovernanceEventId}::uuid,${institutionId}::uuid,${teacherId}::uuid,'TEACHER_REVIEW',${legacyReviewId}::uuid,'ACCEPT',${client.json({ historical: true, note: "pre-CAP-06 event" })})`;
  await client`INSERT INTO foundry_product.file_assets
    (id,institution_id,course_id,task_id,owner_user_id,purpose,storage_key,original_name,media_type,byte_size,content_hash)
    VALUES (${legacyFileId}::uuid,${institutionId}::uuid,${courseId}::uuid,${legacyTaskId}::uuid,${learnerId}::uuid,
      'LEARNING_MATERIAL',${legacyFileStorageKey},'legacy-cap06.txt','text/plain',16,${legacyFileHash})`;
  await client`INSERT INTO foundry_operational.workflow_runs
    (id,thread_id,workflow_kind,institution_id,task_id,episode_id,actor_user_id,status,interrupt_type,product_links)
    VALUES
      (${legacyRetryWorkflowId}::uuid,${`cap06-retry-outcome-${legacyRetryWorkflowId}`},'RETRY_OUTCOME',${institutionId}::uuid,
       ${legacyTaskId}::uuid,${legacyEpisodeId}::uuid,${learnerId}::uuid,'INTERRUPTED','LEARNER_RETRY_REQUIRED',${client.json({ legacy: true })}),
      (${legacyInterruptWorkflowId}::uuid,${`cap06-legacy-interrupt-${legacyInterruptWorkflowId}`},'LEARNER_TASK',${institutionId}::uuid,
       ${legacyTaskId}::uuid,${legacyEpisodeId}::uuid,${learnerId}::uuid,'RUNNING','LEARNER_RETRY_REQUIRED',${client.json({ legacy: true })})`;

  const [legacyBefore] = await client<Array<{ activity_type: string; prompt: string; target_concept: string; due_at: Date }>>`
    SELECT retry.activity_type,retry.prompt,transfer.target_concept,retention.due_at
    FROM foundry_product.retry_attempts retry
    JOIN foundry_product.transfer_activities transfer ON transfer.retry_id=retry.id
    JOIN foundry_product.retention_reviews retention ON retention.retry_id=retry.id
    WHERE retry.id=${legacyRetryId}::uuid`;
  await applyMigration(client, "0010_governed_followup.sql");
  const [legacyAfter] = await client<Array<{ activity_type: string; prompt: string; target_concept: string; due_at: Date; transfer_contract: string; retention_contract: string }>>`
    SELECT retry.activity_type,retry.prompt,transfer.target_concept,retention.due_at,
      transfer.contract_version AS transfer_contract,retention.contract_version AS retention_contract
    FROM foundry_product.retry_attempts retry
    JOIN foundry_product.transfer_activities transfer ON transfer.retry_id=retry.id
    JOIN foundry_product.retention_reviews retention ON retention.retry_id=retry.id
    WHERE retry.id=${legacyRetryId}::uuid`;
  if (!legacyBefore || !legacyAfter || legacyBefore.activity_type !== legacyAfter.activity_type || legacyBefore.prompt !== legacyAfter.prompt
    || legacyBefore.target_concept !== legacyAfter.target_concept || legacyBefore.due_at.toISOString() !== legacyAfter.due_at.toISOString()
    || legacyAfter.transfer_contract !== "LEGACY_UNVERIFIED" || legacyAfter.retention_contract !== "LEGACY_UNVERIFIED") {
    throw new Error("CAP-06 migration rewrote or promoted historical follow-up facts");
  }
  const [historicalEvent] = await client<Array<{ payload: Record<string, unknown> }>>`
    SELECT payload FROM foundry_product.governance_events WHERE id=${legacyGovernanceEventId}::uuid`;
  if (historicalEvent?.payload.note !== "pre-CAP-06 event") throw new Error("CAP-06 migration did not preserve the historical GovernanceEvent");
  const retiredWorkflowRuns = await client<Array<{
    id: string;
    status: string;
    interrupt_type: string | null;
    failure: string | null;
    failure_code: string | null;
    recovery_action: string | null;
    completed_at: Date | null;
    resume_claimed_at: Date | null;
    resume_claim_token: string | null;
    resume_lease_expires_at: Date | null;
  }>>`
    SELECT id,status,interrupt_type,failure,product_links->>'failureCode' AS failure_code,
      product_links->>'recoveryAction' AS recovery_action,completed_at,resume_claimed_at,resume_claim_token,resume_lease_expires_at
    FROM foundry_operational.workflow_runs
    WHERE id IN (${legacyRetryWorkflowId}::uuid,${legacyInterruptWorkflowId}::uuid)
    ORDER BY id`;
  if (retiredWorkflowRuns.length !== 2 || retiredWorkflowRuns.some((run) => run.status !== "FAILED"
    || run.interrupt_type !== null || run.failure_code !== "LEGACY_RETRY_OUTCOME_RETIRED"
    || run.recovery_action !== "RESTART_AS_GOVERNED_FOLLOWUP" || !run.failure || !run.completed_at
    || run.resume_claimed_at !== null || run.resume_claim_token !== null || run.resume_lease_expires_at !== null)) {
    throw new Error("CAP-06 migration did not fail and label every active legacy retry workflow");
  }

  await client`SELECT set_config('foundry.institution_id',${institutionId},false),set_config('foundry.user_id',${teacherId},false),set_config('foundry.roles','TEACHER',false)`;
  await client`UPDATE foundry_product.transfer_activities SET target_concept='legacy-target-updated' WHERE id=${legacyTransferId}::uuid`;
  await client`UPDATE foundry_product.retention_reviews SET due_at='2026-07-26T00:00:00.000Z' WHERE id=${legacyRetentionId}::uuid`;
  await expectDatabaseRejection("Historical GovernanceEvent update", /GovernanceEvents are append-only/, () => client`
    UPDATE foundry_product.governance_events SET payload='{"rewritten":true}'::jsonb WHERE id=${legacyGovernanceEventId}::uuid`);

  const wrongTenantId = randomUUID();
  await client`SELECT set_config('foundry.institution_id',${wrongTenantId},false)`;
  await expectDatabaseRejection("Legacy Retry wrong-tenant update", /Retry tenant lineage mismatch/, () => client`
    UPDATE foundry_product.retry_attempts SET prompt='wrong tenant rewrite' WHERE id=${legacyRetryId}::uuid`);
  await expectDatabaseRejection("Legacy Transfer wrong-tenant insert", /Transfer tenant lineage mismatch/, () => client`
    INSERT INTO foundry_product.transfer_activities (id,retry_id,target_concept,evidence_unit_id)
    VALUES (${randomUUID()}::uuid,${legacyRetryId}::uuid,'wrong-tenant',${evidenceId}::uuid)`);
  await expectDatabaseRejection("Legacy Retention wrong-tenant update", /Retention tenant lineage mismatch/, () => client`
    UPDATE foundry_product.retention_reviews SET due_at='2026-07-27T00:00:00.000Z' WHERE id=${legacyRetentionId}::uuid`);
  await client`SELECT set_config('foundry.institution_id',${institutionId},false)`;

  const legacyAuthorityColumnCases = [
    { column: "institution_id", valueSql: `'${institutionId}'::uuid` },
    { column: "course_id", valueSql: `'${courseId}'::uuid` },
    { column: "task_id", valueSql: `'${legacyTaskId}'::uuid` },
    { column: "source_episode_id", valueSql: `'${legacyEpisodeId}'::uuid` },
    { column: "target_episode_id", valueSql: `'${legacyEpisodeId}'::uuid` },
    { column: "learner_id", valueSql: `'${learnerId}'::uuid` },
    { column: "context_item_id", valueSql: `'${randomUUID()}'::uuid` },
    { column: "activity_plan_proposal_id", valueSql: `'${randomUUID()}'::uuid` },
    { column: "activity_plan_id", valueSql: `'${randomUUID()}'::uuid` },
    { column: "runtime_delivery_id", valueSql: `'${randomUUID()}'::uuid` },
    { column: "source_lineage", valueSql: `'{}'::jsonb` },
    { column: "actor_user_id", valueSql: `'${teacherId}'::uuid` },
    { column: "actor_provenance", valueSql: `'{}'::jsonb` },
    { column: "assignment_request_hash", valueSql: `'forbidden-legacy-request-hash'` },
    { column: "latest_transition_event_id", valueSql: `'${legacyGovernanceEventId}'::uuid` },
    { column: "cancellation_state", valueSql: `'{}'::jsonb` },
    { column: "failure_state", valueSql: `'{}'::jsonb` },
  ] as const;
  for (const authorityCase of legacyAuthorityColumnCases) {
    await expectDatabaseRejection(
      `Legacy Retry ${authorityCase.column} authority acquisition`,
      /Legacy retry rows cannot acquire CAP-06 authority columns/,
      () => client.unsafe(`UPDATE foundry_product.retry_attempts SET ${authorityCase.column}=${authorityCase.valueSql} WHERE id='${legacyRetryId}'::uuid`),
    );
  }
  await expectDatabaseRejection("Legacy Retry in-place CAP-06 conversion", /cannot be converted in place to CAP-06/, () => client`
    UPDATE foundry_product.retry_attempts SET idempotency_key=${`forbidden-upgrade:${legacyRetryId}`} WHERE id=${legacyRetryId}::uuid`);
  await expectDatabaseRejection("Legacy Transfer contract upgrade", /Legacy Transfer rows cannot acquire CAP-06 declaration authority/, () => client`
    UPDATE foundry_product.transfer_activities SET contract_version='CAP06_V1' WHERE id=${legacyTransferId}::uuid`);
  await expectDatabaseRejection("Legacy Retention contract upgrade", /Legacy Retention rows cannot acquire CAP-06 declaration authority/, () => client`
    UPDATE foundry_product.retention_reviews SET contract_version='CAP06_V1' WHERE id=${legacyRetentionId}::uuid`);
  await expectDatabaseRejection("Orphan governed follow-up idempotency reservation", /reservation must resolve to its exact governed activity at commit/, () => client`
    INSERT INTO foundry_product.idempotency_keys (institution_id,key,command_type,request_hash,result_id)
    VALUES (${institutionId}::uuid,${`orphan-followup:${randomUUID()}`},'CREATE_GOVERNED_FOLLOWUP',
      ${`orphan-request:${randomUUID()}`},${randomUUID()}::uuid)`);
  await expectDatabaseRejection("Governed follow-up reservation targeting Legacy Retry", /reservation must resolve to its exact governed activity at commit/, () => client`
    INSERT INTO foundry_product.idempotency_keys (institution_id,key,command_type,request_hash,result_id)
    VALUES (${institutionId}::uuid,${`legacy-target-followup:${randomUUID()}`},'CREATE_GOVERNED_FOLLOWUP',
      ${`legacy-target-request:${randomUUID()}`},${legacyRetryId}::uuid)`);

  const [legacyFileLineage] = await client<Array<{
    source_asset_id: string;
    source_asset_version_id: string;
  }>>`SELECT source_asset_id,source_asset_version_id FROM foundry_product.file_assets WHERE id=${legacyFileId}::uuid`;
  if (!legacyFileLineage) throw new Error("Legacy FileAsset canonical lineage is missing");
  const replacementFileVersionId = randomUUID();
  await client`INSERT INTO foundry_product.source_asset_versions
    (id,source_asset_id,institution_id,version_key,content_hash,storage_key,media_type,byte_size,provenance,
     rights_basis,rights_status,access_scope,supersedes_version_id,created_by)
    VALUES (${replacementFileVersionId}::uuid,${legacyFileLineage.source_asset_id}::uuid,${institutionId}::uuid,
      ${`cap06-processing-${replacementFileVersionId}`},${legacyFileHash},${legacyFileStorageKey},'text/plain',16,
      ${client.json({ authority: "CAP06_UPGRADE_REHEARSAL", fileAssetId: legacyFileId })},
      'LEGACY_UPLOAD','REVIEW_REQUIRED','INSTITUTION',${legacyFileLineage.source_asset_version_id}::uuid,${learnerId}::uuid)`;
  await client`UPDATE foundry_product.file_assets SET
      source_asset_version_id=${replacementFileVersionId}::uuid,
      ingestion_status='EXTRACTED',extraction_text='processed without changing identity',
      extraction_metadata=${client.json({ processor: "cap06-upgrade" })},interpretation='processing result',
      interpretation_status='AVAILABLE',updated_at=now()
    WHERE id=${legacyFileId}::uuid`;
  const [updatedLegacyFile] = await client<Array<{
    source_asset_version_id: string;
    ingestion_status: string;
    interpretation_status: string;
  }>>`SELECT source_asset_version_id,ingestion_status,interpretation_status
      FROM foundry_product.file_assets WHERE id=${legacyFileId}::uuid`;
  if (updatedLegacyFile?.source_asset_version_id !== replacementFileVersionId
    || updatedLegacyFile.ingestion_status !== "EXTRACTED" || updatedLegacyFile.interpretation_status !== "AVAILABLE") {
    throw new Error("Legitimate FileAsset processing/version update was not preserved");
  }
  await expectDatabaseRejection("FileAsset Task scope rewrite", /FileAsset identity and Task scope are immutable/, () => client`
    UPDATE foundry_product.file_assets SET task_id=NULL WHERE id=${legacyFileId}::uuid`);
  await expectDatabaseRejection("FileAsset storage identity rewrite", /FileAsset canonical lineage mismatch|FileAsset identity and Task scope are immutable/, () => client`
    UPDATE foundry_product.file_assets SET storage_key=${`forged-${legacyFileStorageKey}`} WHERE id=${legacyFileId}::uuid`);

  async function createActivity(
    activityType: "RETRY" | "TRANSFER" | "RETENTION",
    delaySeconds: number,
    reviewDecision: "ACCEPT" | "ESCALATE" = "ACCEPT",
    sourceSignatureOverride?: Record<string, string>,
    includePreexistingActiveGeneral = false,
    options: ActivityFixtureOptions = {},
  ): Promise<ActivityFixture> {
    const id = randomUUID();
    const taskId = randomUUID();
    const sourceEpisodeId = randomUUID();
    const targetEpisodeId = randomUUID();
    const attemptId = randomUUID();
    const observationId = randomUUID();
    const reviewId = randomUUID();
    const contextItemId = randomUUID();
    const assignmentEventId = randomUUID();
    const extensionId = options.omitExtension || (activityType === "RETRY" && !options.extensionType) ? undefined : randomUUID();
    const idempotencyKey = `cap06-activity:${id}`;
    const requestHash = `cap06-request:${id}`;
    const generalEpisodeId = includePreexistingActiveGeneral ? randomUUID() : undefined;
    const assignedAt = new Date(Date.now() + (activityType === "RETENTION" ? 10_000 : 0));
    const scheduledFor = new Date(assignedAt.getTime() + delaySeconds * 1_000);
    const taskTitle = `CAP-06 ${activityType} Task`;
    const sourceSignature = sourceSignatureOverride ?? { context: taskTitle, representation: "TEXT", itemFamily: capabilityKey, problemStructure: "cap06-runtime" };
    const sourceLineage = {
      learnerAttemptId: attemptId,
      diagnosticObservationId: observationId,
      teacherReviewId: reviewId,
      sourceEpisodeId,
      capabilityId,
      capabilityVersionId,
      capabilityVersionContentHash: capabilityHash,
      canonicalTransferSourceSignature: sourceSignature,
    };
    return client.begin(async (tx) => {
    await tx`INSERT INTO foundry_product.learning_tasks
      (id,institution_id,course_id,learner_id,learner_profile_id,title,goal)
      VALUES (${taskId}::uuid,${institutionId}::uuid,${courseId}::uuid,${learnerId}::uuid,${profileId}::uuid,${taskTitle},'Exercise database-governed follow-up facts')`;
    await tx`INSERT INTO foundry_product.learning_episodes (id,task_id,sequence,status)
      VALUES (${sourceEpisodeId}::uuid,${taskId}::uuid,1,'ACTIVE')`;
    await tx`INSERT INTO foundry_product.learning_episodes (id,task_id,sequence,status,purpose,predecessor_episode_id,waiting_reason,recovery_state)
      VALUES (${targetEpisodeId}::uuid,${taskId}::uuid,2,'ACTIVE',${activityType},${sourceEpisodeId}::uuid,'WAITING_FOR_LEARNER_ATTEMPT',${client.json({ status: "PENDING", externalWorkMayStillFinish: false })})`;
    if (generalEpisodeId) {
      await tx`INSERT INTO foundry_product.learning_episodes (id,task_id,sequence,status)
        VALUES (${generalEpisodeId}::uuid,${taskId}::uuid,3,'ACTIVE')`;
    }
    await tx`SELECT set_config('foundry.user_id',${learnerId},true),set_config('foundry.roles','LEARNER',true)`;
    await tx`INSERT INTO foundry_product.learner_attempts
      (id,task_id,episode_id,learner_id,capability_id,prompt,response,structured_input,source_refs)
      VALUES (${attemptId}::uuid,${taskId}::uuid,${sourceEpisodeId}::uuid,${learnerId}::uuid,${capabilityId}::uuid,'Source prompt','Source response','{}'::jsonb,'[]'::jsonb)`;
    await tx`UPDATE foundry_product.learning_episodes SET status='COMPLETED',ended_at=now() WHERE id=${sourceEpisodeId}::uuid`;
    await tx`SELECT set_config('foundry.user_id',${teacherId},true),set_config('foundry.roles','TEACHER',true)`;
    await tx`INSERT INTO foundry_product.diagnostic_observations
      (id,attempt_id,capability_version_id,status,failure_code,summary,structured_result,input_lineage,output_lineage)
      VALUES (${observationId}::uuid,${attemptId}::uuid,${capabilityVersionId}::uuid,'NEEDS_REVIEW','CAP06_ISSUE','CAP-06 reviewed issue','{}'::jsonb,${client.json({ attemptId })},${client.json({ capabilityVersionId })})`;
    await tx`INSERT INTO foundry_product.teacher_reviews
      (id,observation_id,teacher_id,decision,teaching_support,actor_provenance,idempotency_key)
      VALUES (${reviewId}::uuid,${observationId}::uuid,${teacherId}::uuid,${reviewDecision},'Authenticated CAP-06 teaching support',${client.json({ userId: teacherId, institutionId, roles: ["TEACHER"], authMethod: "cap06-upgrade", sessionId: `cap06-${activityType}`, authenticatedAt: assignedAt.toISOString() })},${`cap06-review:${reviewId}`})`;
    if (!options.omitReservation) {
      await tx`INSERT INTO foundry_product.idempotency_keys
        (institution_id,key,command_type,request_hash,result_id)
        VALUES (${institutionId}::uuid,${idempotencyKey},'CREATE_GOVERNED_FOLLOWUP',${requestHash},${options.reservationResultId ?? id}::uuid)`;
    }
    await tx`INSERT INTO foundry_product.context_items
      (id,institution_id,learner_profile_id,course_id,task_id,episode_id,kind,scope,state,payload,provenance,rule_version,review_status,actor_user_id,valid_from)
      VALUES (${contextItemId}::uuid,${institutionId}::uuid,${profileId}::uuid,${courseId}::uuid,${taskId}::uuid,${targetEpisodeId}::uuid,
        'GOVERNED_FOLLOWUP','EPISODE','ACTIVE',${client.json({ followupId: id, followupType: activityType, governingTeacherReviewId: reviewId, effectivenessClaim: false, masteryClaim: false })},
        ${client.json({ authority: "TEACHER_REVIEW", teacherReviewId: reviewId })},'cap06-v1','HUMAN_AUTHORIZED',${teacherId}::uuid,${assignedAt})`;
    await tx`INSERT INTO foundry_product.retry_attempts
      (id,original_attempt_id,reviewed_observation_id,teacher_review_id,activity_type,prompt,status,institution_id,course_id,task_id,
       source_episode_id,target_episode_id,learner_id,context_item_id,assigned_at,scheduled_for,source_lineage,actor_user_id,actor_provenance,
       idempotency_key,assignment_request_hash,created_at,updated_at)
      VALUES (${id}::uuid,${attemptId}::uuid,${observationId}::uuid,${reviewId}::uuid,${activityType},${`CAP-06 ${activityType} prompt`},'ASSIGNED',
       ${institutionId}::uuid,${courseId}::uuid,${taskId}::uuid,${sourceEpisodeId}::uuid,${targetEpisodeId}::uuid,${learnerId}::uuid,${contextItemId}::uuid,
       ${assignedAt},${scheduledFor},${client.json(sourceLineage)},${teacherId}::uuid,
       ${client.json({ userId: teacherId, institutionId, roles: ["TEACHER"], authMethod: "cap06-upgrade", sessionId: `cap06-${activityType}`, authenticatedAt: assignedAt.toISOString() })},
       ${idempotencyKey},${options.activityRequestHash ?? null},${assignedAt},${assignedAt})`;
    const extensionType = options.extensionType ?? activityType;
    if (extensionId && extensionType === "TRANSFER") {
      const declaration = {
        source: sourceSignature,
        target: options.transferTargetRepresentation
          ? { ...sourceSignature, representation: options.transferTargetRepresentation }
          : { ...sourceSignature, representation: "DIAGRAM", problemStructure: "graph-comparison" },
        materialDifferenceRationale: "The authenticated teacher declares a new representation and problem structure.",
        evidenceLimit: "TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN",
      };
      await tx`INSERT INTO foundry_product.transfer_activities
        (id,retry_id,target_concept,contract_version,declaration,changed_dimensions)
        VALUES (${extensionId}::uuid,${id}::uuid,${capabilityKey},'CAP06_V1',${tx.json(declaration)},
          ${tx.json(options.transferChangedDimensions ?? ["representation", "problemStructure"])})`;
    } else if (extensionId && extensionType === "RETENTION") {
      await tx`INSERT INTO foundry_product.retention_reviews
        (id,retry_id,due_at,contract_version,declared_delay_seconds,intervening_exposure,content_equivalence,assistance_policy,created_at)
        VALUES (${extensionId}::uuid,${id}::uuid,${new Date(assignedAt.getTime() + (options.retentionDueOffsetSeconds ?? delaySeconds) * 1_000)},
          'CAP06_V1',${delaySeconds},
          ${tx.json({ kind: "NONE_DECLARED", detail: "No intervening practice." })},
          ${tx.json({ kind: "EQUIVALENT_FORM", rationale: "Same concept in an equivalent form." })},
          ${tx.json({ kind: "INDEPENDENT", allowed: "No assistance." })},${assignedAt})`;
    }
    await tx`INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
      VALUES (${assignmentEventId}::uuid,${institutionId}::uuid,${teacherId}::uuid,'GOVERNED_FOLLOWUP',${id}::uuid,'ASSIGNED',NULL,
        ${client.json({ activityType, fromStatus: null, toStatus: "ASSIGNED", reason: "Authenticated assignment", actorUserId: teacherId, recordedAt: assignedAt.toISOString(), externalWorkMayStillFinish: false, educationalEffectivenessClaim: false, masteryClaim: false })})`;
    await tx`UPDATE foundry_product.retry_attempts SET latest_transition_event_id=${assignmentEventId}::uuid,updated_at=${assignedAt} WHERE id=${id}::uuid`;
    return { id, taskId, sourceEpisodeId, targetEpisodeId, assignmentEventId, contextItemId, extensionId,
      idempotencyKey, requestHash, assignedAt, sourceSignature, generalEpisodeId };
    });
  }

  const transfer = await createActivity("TRANSFER", 0);
  const wrongTenantTransfer = await createActivity("TRANSFER", 0);
  await expectDatabaseRejection("CAP-06 terminal ESCALATE source", /exact source\/target lineage mismatch/, () =>
    createActivity("TRANSFER", 0, "ESCALATE"));
  await expectDatabaseRejection("Forged canonical Transfer source signature", /exact source\/target lineage mismatch/, () =>
    createActivity("TRANSFER", 0, "ACCEPT", {
      context: "forged-task-context",
      representation: "TEXT",
      itemFamily: capabilityKey,
      problemStructure: "cap06-runtime",
    }));
  await expectDatabaseRejection("CAP-06 Transfer missing exact typed extension", /Transfer requires exactly its CAP06_V1 declaration/, () =>
    createActivity("TRANSFER", 0, "ACCEPT", undefined, false, { omitExtension: true }));
  await expectDatabaseRejection("CAP-06 Retention missing exact typed extension", /Retention requires exactly its CAP06_V1 declaration/, () =>
    createActivity("RETENTION", 3600, "ACCEPT", undefined, false, { omitExtension: true }));
  await expectDatabaseRejection("CAP-06 Retry with wrong typed extension", /not bound to its governed source lineage|Retry cannot carry/, () =>
    createActivity("RETRY", 0, "ACCEPT", undefined, false, { extensionType: "TRANSFER" }));
  await createActivity("RETRY", 0);
  const decisionMutationScope = await createActivity("RETRY", 0);
  const decisionMutationAttemptId = randomUUID();
  const decisionMutationObservationId = randomUUID();
  const decisionMutationReviewId = randomUUID();
  const decisionMutationPlanId = randomUUID();
  const decisionMutationDeliveryId = randomUUID();
  const decisionMutationEventId = randomUUID();
  const decisionMutationAt = new Date();
  // Seed only the already-terminal shape so this upgrade rehearsal can isolate
  // the post-commit TeacherReview mutation guard from the full runtime package.
  await client.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");
    await tx`INSERT INTO foundry_product.learner_attempts
      (id,task_id,episode_id,learner_id,capability_id,prompt,response,structured_input,source_refs,
        capability_version_id,activity_plan_id,runtime_delivery_id,modality,content_hash,assistance_provenance)
      VALUES (${decisionMutationAttemptId}::uuid,${decisionMutationScope.taskId}::uuid,${decisionMutationScope.targetEpisodeId}::uuid,
        ${learnerId}::uuid,${capabilityId}::uuid,'Terminal review mutation probe','Reviewed result','{}'::jsonb,'[]'::jsonb,
        ${capabilityVersionId}::uuid,${decisionMutationPlanId}::uuid,${decisionMutationDeliveryId}::uuid,
        'TEXT','cap06-terminal-review-mutation',${tx.json({ kind: "NONE", source: "cap06-upgrade" })})`;
    await tx`INSERT INTO foundry_product.diagnostic_observations
      (id,attempt_id,capability_version_id,status,summary,structured_result,input_lineage,output_lineage)
      VALUES (${decisionMutationObservationId}::uuid,${decisionMutationAttemptId}::uuid,${capabilityVersionId}::uuid,
        'NEEDS_REVIEW','Terminal review mutation probe','{}'::jsonb,'{}'::jsonb,'{}'::jsonb)`;
    await tx`INSERT INTO foundry_product.teacher_reviews
      (id,observation_id,teacher_id,decision,teaching_support,actor_provenance,idempotency_key)
      VALUES (${decisionMutationReviewId}::uuid,${decisionMutationObservationId}::uuid,${teacherId}::uuid,'ACCEPT',
        'Exact terminal Review mutation probe',
        ${tx.json({ userId: teacherId, institutionId, roles: ["TEACHER"], authMethod: "cap06-upgrade", sessionId: `decision-mutation:${decisionMutationReviewId}`, authenticatedAt: decisionMutationAt.toISOString() })},
        ${`decision-mutation-review:${decisionMutationReviewId}`})`;
    await tx`INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
      VALUES (${decisionMutationEventId}::uuid,${institutionId}::uuid,${teacherId}::uuid,'GOVERNED_FOLLOWUP',
        ${decisionMutationScope.id}::uuid,'STATUS_TRANSITION',${decisionMutationScope.assignmentEventId}::uuid,
        ${tx.json({ fromStatus: "WAITING_FOR_REVIEW", toStatus: "REVIEWED", reason: "Authorized teacher accepted exact result", actorUserId: teacherId, recordedAt: decisionMutationAt.toISOString(), externalWorkMayStillFinish: false, educationalEffectivenessClaim: false, masteryClaim: false })})`;
    await tx`UPDATE foundry_product.retry_attempts SET status='REVIEWED',activity_plan_id=${decisionMutationPlanId}::uuid,
      runtime_delivery_id=${decisionMutationDeliveryId}::uuid,result_attempt_id=${decisionMutationAttemptId}::uuid,
      result_observation_id=${decisionMutationObservationId}::uuid,result_review_id=${decisionMutationReviewId}::uuid,
      latest_transition_event_id=${decisionMutationEventId}::uuid,updated_at=${decisionMutationAt}
      WHERE id=${decisionMutationScope.id}::uuid`;
    await tx`UPDATE foundry_product.learning_episodes SET status='COMPLETED',ended_at=${decisionMutationAt},waiting_reason=NULL,
      recovery_state=${tx.json({ status: "REVIEWED", externalWorkMayStillFinish: false })}
      WHERE id=${decisionMutationScope.targetEpisodeId}::uuid`;
    await tx`UPDATE foundry_product.context_items SET state='INVALIDATED',invalidated_at=${decisionMutationAt},
      invalidation_reason='Governed follow-up ended with an authorized teacher review'
      WHERE id=${decisionMutationScope.contextItemId}::uuid`;
  });
  await client`SELECT foundry_private.cap06_assert_followup_complete(${decisionMutationScope.id}::uuid)`;
  await expectDatabaseRejection("Post-commit result TeacherReview decision rewrite", /TeacherReview author\/provenance\/transition\/current course authority mismatch/, () => client`
    UPDATE foundry_product.teacher_reviews SET decision='ESCALATE' WHERE id=${decisionMutationReviewId}::uuid`);
  await expectDatabaseRejection("CAP-06 follow-up missing idempotency reservation", /idempotency reservation does not match/, () =>
    createActivity("TRANSFER", 0, "ACCEPT", undefined, false,
      { omitReservation: true, activityRequestHash: `missing-reservation:${randomUUID()}` }));
  const mismatchedResultRequestHash = `mismatched-result:${randomUUID()}`;
  await expectDatabaseRejection("CAP-06 idempotency reservation result mismatch", /reservation must resolve to its exact governed activity at commit/, () =>
    createActivity("TRANSFER", 0, "ACCEPT", undefined, false,
      { reservationResultId: randomUUID(), activityRequestHash: mismatchedResultRequestHash }));
  await expectDatabaseRejection("CAP-06 idempotency reservation request mismatch", /reservation must resolve to its exact governed activity at commit/, () =>
    createActivity("TRANSFER", 0, "ACCEPT", undefined, false,
      { activityRequestHash: `wrong-request:${randomUUID()}` }));
  const [transferReservation] = await client<Array<{ actor_user_id: string; result_id: string; request_hash: string }>>`
    SELECT actor_user_id,result_id,request_hash FROM foundry_product.idempotency_keys
    WHERE institution_id=${institutionId}::uuid AND command_type='CREATE_GOVERNED_FOLLOWUP' AND key=${transfer.idempotencyKey}`;
  if (transferReservation?.actor_user_id !== teacherId || transferReservation.result_id !== transfer.id
    || transferReservation.request_hash !== transfer.requestHash) {
    throw new Error("CAP-06 valid reservation did not retain exact actor/result/request identity");
  }
  await expectDatabaseRejection("CAP-06 idempotency reservation rewrite", /reservation is immutable/, () => client`
    UPDATE foundry_product.idempotency_keys SET request_hash=${`rewritten:${randomUUID()}`}
    WHERE institution_id=${institutionId}::uuid AND command_type='CREATE_GOVERNED_FOLLOWUP' AND key=${transfer.idempotencyKey}`);
  await expectDatabaseRejection("Same-status proposal poison", /ActivityPlanProposal exact lineage mismatch/, () => client`
    UPDATE foundry_product.retry_attempts SET activity_plan_proposal_id=${randomUUID()}::uuid WHERE id=${transfer.id}::uuid`);
  await expectDatabaseRejection("Same-status plan poison", /ActivityPlan exact lineage mismatch/, () => client`
    UPDATE foundry_product.retry_attempts SET activity_plan_id=${randomUUID()}::uuid WHERE id=${transfer.id}::uuid`);
  await expectDatabaseRejection("Same-status delivery poison", /RuntimeDelivery exact lineage mismatch/, () => client`
    UPDATE foundry_product.retry_attempts SET runtime_delivery_id=${randomUUID()}::uuid WHERE id=${transfer.id}::uuid`);
  await expectDatabaseRejection("Same-status result poison", /result LearnerAttempt exact lineage mismatch/, () => client`
    UPDATE foundry_product.retry_attempts SET result_attempt_id=${randomUUID()}::uuid WHERE id=${transfer.id}::uuid`);
  await client`SELECT set_config('foundry.institution_id',${wrongTenantId},false)`;
  await expectDatabaseRejection("CAP-06 envelope wrong-tenant update", /Governed follow-up tenant mismatch/, () => client`
    UPDATE foundry_product.retry_attempts SET updated_at=now() WHERE id=${wrongTenantTransfer.id}::uuid`);
  await client`SELECT set_config('foundry.institution_id',${institutionId},false)`;
  await expectDatabaseRejection("Transfer dimension mismatch", /database-recomputed material difference/, () =>
    createActivity("TRANSFER", 0, "ACCEPT", undefined, false, { transferChangedDimensions: ["representation"] }));
  const transferExtensionId = transfer.extensionId;
  if (!transferExtensionId) throw new Error("CAP-06 Transfer exact extension fixture is missing");
  await expectDatabaseRejection("CAP-06 Transfer rewrite", /immutable/, () => client`
    UPDATE foundry_product.transfer_activities SET target_concept='rewritten' WHERE id=${transferExtensionId}::uuid`);
  await expectDatabaseRejection("Direct CAP-06 LearningOutcome INSERT", /cannot create LearningOutcome/, () => client`
    INSERT INTO foundry_product.learning_outcomes
      (id,task_id,retry_id,result_review_id,teacher_id,outcome_type,status,evidence_refs,narrative,actor_provenance,idempotency_key)
    VALUES (${randomUUID()}::uuid,${transfer.taskId}::uuid,${transfer.id}::uuid,${legacyReviewId}::uuid,${teacherId}::uuid,
      'RETRY','CONFIRMED','[]'::jsonb,'Forbidden direct CAP-06 Outcome claim',
      ${client.json({ userId: teacherId, institutionId, roles: ["TEACHER"] })},${`forbidden-outcome:${transfer.id}`})`);
  await expectDatabaseRejection("NFKC-equivalent Transfer declaration", /database-recomputed material difference/, () =>
    createActivity("TRANSFER", 0, "ACCEPT", undefined, false,
      { transferTargetRepresentation: "ＴＥＸＴ", transferChangedDimensions: ["representation"] }));

  const runtimeScope = await createActivity("TRANSFER", 0);
  const runtimeScopeStartedAt = new Date();
  const runtimeScopeStartedEventId = randomUUID();
  await client`SELECT set_config('foundry.user_id',${learnerId},false),set_config('foundry.roles','LEARNER',false)`;
  await client.begin(async (tx) => {
    await tx`INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
      VALUES (${runtimeScopeStartedEventId}::uuid,${institutionId}::uuid,${learnerId}::uuid,'GOVERNED_FOLLOWUP',${runtimeScope.id}::uuid,
        'STATUS_TRANSITION',${runtimeScope.assignmentEventId}::uuid,
        ${tx.json({ fromStatus: "ASSIGNED", toStatus: "IN_PROGRESS", reason: "Learner started exact-chain boundary probe", actorUserId: learnerId, recordedAt: runtimeScopeStartedAt.toISOString(), externalWorkMayStillFinish: true, educationalEffectivenessClaim: false, masteryClaim: false })})`;
    await tx`UPDATE foundry_product.retry_attempts SET status='IN_PROGRESS',latest_transition_event_id=${runtimeScopeStartedEventId}::uuid,
      updated_at=${runtimeScopeStartedAt} WHERE id=${runtimeScope.id}::uuid`;
  });
  await expectDatabaseRejection("Forged governed ActivityPlan/RuntimeDelivery/Proposal chain", /Runtime-linked LearnerAttempt lineage mismatch|outside the writable Episode\/runtime scope/, () => client`
    INSERT INTO foundry_product.learner_attempts
      (id,task_id,episode_id,learner_id,capability_id,prompt,response,structured_input,source_refs,activity_plan_id,runtime_delivery_id)
    VALUES (${randomUUID()}::uuid,${runtimeScope.taskId}::uuid,${runtimeScope.targetEpisodeId}::uuid,${learnerId}::uuid,${capabilityId}::uuid,
      'Forged exact chain','No linked proposal, plan, or delivery','{}'::jsonb,'[]'::jsonb,${randomUUID()}::uuid,${randomUUID()}::uuid)`);
  await client`SELECT set_config('foundry.user_id',${teacherId},false),set_config('foundry.roles','TEACHER',false)`;

  const orphanEventScope = await createActivity("TRANSFER", 0);
  await client`SELECT set_config('foundry.user_id',${learnerId},false),set_config('foundry.roles','LEARNER',false)`;
  await expectDatabaseRejection("Orphan governed GovernanceEvent commit", /must be consumed by exact Product State in the same transaction/, () => client.begin(async (tx) => {
    const eventId = randomUUID();
    const recordedAt = new Date();
    await tx`INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
      VALUES (${eventId}::uuid,${institutionId}::uuid,${learnerId}::uuid,'GOVERNED_FOLLOWUP',${orphanEventScope.id}::uuid,
        'STATUS_TRANSITION',${orphanEventScope.assignmentEventId}::uuid,
        ${tx.json({ fromStatus: "ASSIGNED", toStatus: "IN_PROGRESS", reason: "Unconsumed event probe", actorUserId: learnerId, recordedAt: recordedAt.toISOString(), externalWorkMayStillFinish: true, educationalEffectivenessClaim: false, masteryClaim: false })})`;
  }));
  await client`SELECT set_config('foundry.user_id',${teacherId},false),set_config('foundry.roles','TEACHER',false)`;

  await expectDatabaseRejection("Cancellation timestamp mismatch", /Cancellation fact does not match/, () => client.begin(async (tx) => {
    const eventId = randomUUID();
    const recordedAt = new Date();
    await tx`INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
      VALUES (${eventId}::uuid,${institutionId}::uuid,${teacherId}::uuid,'GOVERNED_FOLLOWUP',${transfer.id}::uuid,'STATUS_TRANSITION',${transfer.assignmentEventId}::uuid,
        ${tx.json({ fromStatus: "ASSIGNED", toStatus: "CANCELLED", reason: "Cancelled by teacher", actorUserId: teacherId, recordedAt: recordedAt.toISOString(), externalWorkMayStillFinish: false, educationalEffectivenessClaim: false, masteryClaim: false })})`;
    await tx`UPDATE foundry_product.retry_attempts SET status='CANCELLED',latest_transition_event_id=${eventId}::uuid,
      cancellation_state=${tx.json({ actorUserId: teacherId, recordedAt: new Date(recordedAt.getTime() + 1000).toISOString(), reason: "Cancelled by teacher", externalWorkMayStillFinish: false })}
      WHERE id=${transfer.id}::uuid`;
  }));
  await expectDatabaseRejection("Terminal cancellation without ContextItem invalidation", /Terminal governed follow-up requires exact ContextItem invalidation/, () => client.begin(async (tx) => {
    const eventId = randomUUID();
    const recordedAt = new Date();
    await tx`INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
      VALUES (${eventId}::uuid,${institutionId}::uuid,${teacherId}::uuid,'GOVERNED_FOLLOWUP',${transfer.id}::uuid,'STATUS_TRANSITION',${transfer.assignmentEventId}::uuid,
        ${tx.json({ fromStatus: "ASSIGNED", toStatus: "CANCELLED", reason: "Cancelled by teacher", actorUserId: teacherId, recordedAt: recordedAt.toISOString(), externalWorkMayStillFinish: false, educationalEffectivenessClaim: false, masteryClaim: false })})`;
    await tx`UPDATE foundry_product.retry_attempts SET status='CANCELLED',latest_transition_event_id=${eventId}::uuid,
      cancellation_state=${tx.json({ actorUserId: teacherId, recordedAt: recordedAt.toISOString(), reason: "Cancelled by teacher", externalWorkMayStillFinish: false })}
      WHERE id=${transfer.id}::uuid`;
    await tx`UPDATE foundry_product.learning_episodes SET status='CANCELLED',ended_at=${recordedAt},waiting_reason=NULL,
      recovery_state=${tx.json({ status: "CANCELLED", externalWorkMayStillFinish: false })}
      WHERE id=${transfer.targetEpisodeId}::uuid`;
  }));
  const cancelEventId = randomUUID();
  const cancelledAt = new Date();
  await client.begin(async (tx) => {
    await tx`INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
      VALUES (${cancelEventId}::uuid,${institutionId}::uuid,${teacherId}::uuid,'GOVERNED_FOLLOWUP',${transfer.id}::uuid,'STATUS_TRANSITION',${transfer.assignmentEventId}::uuid,
        ${tx.json({ fromStatus: "ASSIGNED", toStatus: "CANCELLED", reason: "Cancelled by teacher", actorUserId: teacherId, recordedAt: cancelledAt.toISOString(), externalWorkMayStillFinish: false, educationalEffectivenessClaim: false, masteryClaim: false })})`;
    await tx`UPDATE foundry_product.retry_attempts SET status='CANCELLED',latest_transition_event_id=${cancelEventId}::uuid,
      cancellation_state=${tx.json({ actorUserId: teacherId, recordedAt: cancelledAt.toISOString(), reason: "Cancelled by teacher", externalWorkMayStillFinish: false })}
      WHERE id=${transfer.id}::uuid`;
    await tx`UPDATE foundry_product.learning_episodes SET status='CANCELLED',ended_at=${cancelledAt},waiting_reason=NULL,
      recovery_state=${tx.json({ status: "CANCELLED", externalWorkMayStillFinish: false })}
      WHERE id=${transfer.targetEpisodeId}::uuid`;
    await tx`UPDATE foundry_product.context_items SET state='INVALIDATED',invalidated_at=${cancelledAt},
      invalidation_reason='Cancelled by teacher' WHERE id=${transfer.contextItemId}::uuid`;
  });
  await expectDatabaseRejection("Generic LearnerAttempt in terminal governed Episode", /outside the writable Episode\/runtime scope/, () => client`
    INSERT INTO foundry_product.learner_attempts
      (id,task_id,episode_id,learner_id,capability_id,prompt,response,structured_input,source_refs)
    VALUES (${randomUUID()}::uuid,${transfer.taskId}::uuid,${transfer.targetEpisodeId}::uuid,${learnerId}::uuid,${capabilityId}::uuid,
      'Bypass terminal Episode','No governed RuntimeDelivery','{}'::jsonb,'[]'::jsonb)`);
  await expectDatabaseRejection("Cancellation rewrite", /terminal state is immutable|Cancellation fact is immutable/, () => client`
    UPDATE foundry_product.retry_attempts SET cancellation_state=jsonb_set(cancellation_state,'{reason}','"rewritten"') WHERE id=${transfer.id}::uuid`);
  await expectDatabaseRejection("GovernanceEvent delete", /cannot be deleted/, () => client`
    DELETE FROM foundry_product.governance_events WHERE id=${cancelEventId}::uuid`);

  const retention = await createActivity("RETENTION", 3600, "ACCEPT", undefined, true);
  const retentionGeneralEpisodeId = retention.generalEpisodeId;
  if (!retentionGeneralEpisodeId) throw new Error("CAP-06 active GENERAL bypass fixture was not created");
  await expectDatabaseRejection("GENERAL Episode while governed follow-up is active", /cannot be added while a governed follow-up is active/, () => client`
    INSERT INTO foundry_product.learning_episodes (id,task_id,sequence,status)
    VALUES (${randomUUID()}::uuid,${retention.taskId}::uuid,4,'ACTIVE')`);
  await expectDatabaseRejection("Governed Episode purpose rewrite", /Episode Task, sequence, purpose and predecessor are immutable/, () => client`
    UPDATE foundry_product.learning_episodes SET purpose='TRANSFER' WHERE id=${retention.targetEpisodeId}::uuid`);
  await expectDatabaseRejection("Governed Episode predecessor rewrite", /predecessor must belong to the same Task|Episode Task, sequence, purpose and predecessor are immutable/, () => client`
    UPDATE foundry_product.learning_episodes SET predecessor_episode_id=${legacyEpisodeId}::uuid WHERE id=${retention.targetEpisodeId}::uuid`);
  await expectDatabaseRejection("Governed Episode illegal terminal status", /Governed Episode status transition is not forward-authorized/, () => client`
    UPDATE foundry_product.learning_episodes SET status='COMPLETED',ended_at=now() WHERE id=${retention.targetEpisodeId}::uuid`);
  await expectDatabaseRejection("Governed Episode cross-Task predecessor", /predecessor must belong to the same Task/, () => client`
    INSERT INTO foundry_product.learning_episodes (id,task_id,sequence,status,purpose,predecessor_episode_id)
    VALUES (${randomUUID()}::uuid,${retention.taskId}::uuid,99,'ACTIVE','RETENTION',${legacyEpisodeId}::uuid)`);
  const legacyAlternateEpisodeId = randomUUID();
  await client`INSERT INTO foundry_product.learning_episodes (id,task_id,sequence,status)
    VALUES (${legacyAlternateEpisodeId}::uuid,${legacyTaskId}::uuid,2,'ACTIVE')`;
  await expectDatabaseRejection("LearnerAttempt Task/Episode pair scope rewrite", /Learner write Task and Episode scope are immutable/, () => client`
    UPDATE foundry_product.learner_attempts SET task_id=${retention.taskId}::uuid,episode_id=${retentionGeneralEpisodeId}::uuid
    WHERE id=${legacyAttemptId}::uuid`);
  await expectDatabaseRejection("LearnerAttempt Episode scope rewrite", /Learner write Task and Episode scope are immutable/, () => client`
    UPDATE foundry_product.learner_attempts SET episode_id=${legacyAlternateEpisodeId}::uuid WHERE id=${legacyAttemptId}::uuid`);
  await expectDatabaseRejection("Task close while governed follow-up is active", /cannot close while a governed follow-up is active/, () => client`
    UPDATE foundry_product.learning_tasks SET status='COMPLETED',closed_at=now() WHERE id=${retention.taskId}::uuid`);
  await client`SELECT set_config('foundry.user_id',${learnerId},false),set_config('foundry.roles','LEARNER',false)`;
  await expectDatabaseRejection("ConversationEvent GENERAL bypass while governed follow-up is active", /requires an ACTIVE GENERAL Episode/, () => client`
    INSERT INTO foundry_product.conversation_events
      (id,task_id,episode_id,actor_user_id,actor_type,kind,content,source_refs,evidence_refs)
    VALUES (${randomUUID()}::uuid,${retention.taskId}::uuid,${retentionGeneralEpisodeId}::uuid,${learnerId}::uuid,
      'LEARNER','MESSAGE','Bypass active governed follow-up','[]'::jsonb,'[]'::jsonb)`);
  await expectDatabaseRejection("LearnerAttempt GENERAL bypass while governed follow-up is active", /outside the writable Episode\/runtime scope/, () => client`
    INSERT INTO foundry_product.learner_attempts
      (id,task_id,episode_id,learner_id,capability_id,prompt,response,structured_input,source_refs)
    VALUES (${randomUUID()}::uuid,${retention.taskId}::uuid,${retentionGeneralEpisodeId}::uuid,${learnerId}::uuid,${capabilityId}::uuid,
      'Bypass active governed follow-up','No governed runtime','{}'::jsonb,'[]'::jsonb)`);
  await client`SELECT set_config('foundry.user_id',${teacherId},false),set_config('foundry.roles','TEACHER',false)`;
  await client`SELECT set_config('foundry.user_id',${unauthorizedId},false),set_config('foundry.roles','ADMIN',false)`;
  await expectDatabaseRejection("Unauthorized governed transition actor", /transition event is not bound to current Product State/, () => client`
    INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
    VALUES (${randomUUID()}::uuid,${institutionId}::uuid,${unauthorizedId}::uuid,'GOVERNED_FOLLOWUP',${retention.id}::uuid,
      'STATUS_TRANSITION',${retention.assignmentEventId}::uuid,
      ${client.json({ fromStatus: "ASSIGNED", toStatus: "IN_PROGRESS", reason: "Unauthorized member attempted learner transition", actorUserId: unauthorizedId, recordedAt: new Date().toISOString(), externalWorkMayStillFinish: true, educationalEffectivenessClaim: false, masteryClaim: false })})`);
  await client`SELECT set_config('foundry.user_id',${teacherId},false),set_config('foundry.roles','TEACHER',false)`;
  await client`SELECT set_config('foundry.user_id',${learnerId},false),set_config('foundry.roles','LEARNER',false)`;
  await expectDatabaseRejection("Retention transition before dueAt", /transition event is not bound to current Product State/, () => client`
    INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
    VALUES (${randomUUID()}::uuid,${institutionId}::uuid,${learnerId}::uuid,'GOVERNED_FOLLOWUP',${retention.id}::uuid,
      'STATUS_TRANSITION',${retention.assignmentEventId}::uuid,
      ${client.json({ fromStatus: "ASSIGNED", toStatus: "IN_PROGRESS", reason: "Attempted before retained dueAt", actorUserId: learnerId, recordedAt: new Date().toISOString(), externalWorkMayStillFinish: true, educationalEffectivenessClaim: false, masteryClaim: false })})`);
  await expectDatabaseRejection("Generic ConversationEvent in future Retention Episode", /ACTIVE GENERAL Episode/, () => client`
    INSERT INTO foundry_product.conversation_events
      (id,task_id,episode_id,actor_user_id,actor_type,kind,content,source_refs,evidence_refs)
    VALUES (${randomUUID()}::uuid,${retention.taskId}::uuid,${retention.targetEpisodeId}::uuid,${learnerId}::uuid,'LEARNER','MESSAGE','Bypass future Retention','[]'::jsonb,'[]'::jsonb)`);
  await expectDatabaseRejection("Generic LearnerAttempt in future Retention Episode", /outside the writable Episode\/runtime scope/, () => client`
    INSERT INTO foundry_product.learner_attempts
      (id,task_id,episode_id,learner_id,capability_id,prompt,response,structured_input,source_refs)
    VALUES (${randomUUID()}::uuid,${retention.taskId}::uuid,${retention.targetEpisodeId}::uuid,${learnerId}::uuid,${capabilityId}::uuid,
      'Bypass future Retention','No governed RuntimeDelivery','{}'::jsonb,'[]'::jsonb)`);
  await client`SELECT set_config('foundry.user_id',${teacherId},false),set_config('foundry.roles','TEACHER',false)`;
  await expectDatabaseRejection("Task FileAsset while governed Retention is active", /writable GENERAL Episode/, () => client`
    INSERT INTO foundry_product.file_assets
      (id,institution_id,course_id,task_id,owner_user_id,purpose,storage_key,original_name,media_type,byte_size,content_hash)
    VALUES (${randomUUID()}::uuid,${institutionId}::uuid,${courseId}::uuid,${retention.taskId}::uuid,${learnerId}::uuid,
      'LEARNING_MATERIAL',${`cap06-blocked-file-${randomUUID()}`},'blocked.txt','text/plain',12,${`sha256:${randomUUID()}`})`);
  await expectDatabaseRejection("Retention assignment-time mismatch", /not bound to the persisted assignment/, () =>
    createActivity("RETENTION", 3600, "ACCEPT", undefined, false, { retentionDueOffsetSeconds: 3599 }));
  const retentionExtensionId = retention.extensionId;
  if (!retentionExtensionId) throw new Error("CAP-06 Retention exact extension fixture is missing");
  await expectDatabaseRejection("Retention completion without actual exposure and teacher confirmation", /actual exposure confirmation is set-once/, () => client`
    UPDATE foundry_product.retention_reviews SET completed_at=due_at WHERE id=${retentionExtensionId}::uuid`);

  await expectDatabaseRejection("Failure timestamp mismatch", /Failure fact does not match/, () => client.begin(async (tx) => {
    const eventId = randomUUID();
    const recordedAt = new Date();
    await tx`INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
      VALUES (${eventId}::uuid,${institutionId}::uuid,${teacherId}::uuid,'GOVERNED_FOLLOWUP',${retention.id}::uuid,'STATUS_TRANSITION',${retention.assignmentEventId}::uuid,
        ${tx.json({ fromStatus: "ASSIGNED", toStatus: "FAILED_RECOVERABLE", reason: "Recoverable runtime failure", actorUserId: teacherId, recordedAt: recordedAt.toISOString(), externalWorkMayStillFinish: true, educationalEffectivenessClaim: false, masteryClaim: false })})`;
    await tx`UPDATE foundry_product.retry_attempts SET status='FAILED_RECOVERABLE',latest_transition_event_id=${eventId}::uuid,
      failure_state=${tx.json({ actorUserId: teacherId, recordedAt: new Date(recordedAt.getTime() + 1000).toISOString(), reason: "Recoverable runtime failure", externalWorkMayStillFinish: true })}
      WHERE id=${retention.id}::uuid`;
  }));
  const failureEventId = randomUUID();
  const failedAt = new Date();
  await client.begin(async (tx) => {
    await tx`INSERT INTO foundry_product.governance_events
      (id,institution_id,actor_user_id,entity_type,entity_id,action,previous_event_id,payload)
      VALUES (${failureEventId}::uuid,${institutionId}::uuid,${teacherId}::uuid,'GOVERNED_FOLLOWUP',${retention.id}::uuid,'STATUS_TRANSITION',${retention.assignmentEventId}::uuid,
        ${tx.json({ fromStatus: "ASSIGNED", toStatus: "FAILED_RECOVERABLE", reason: "Recoverable runtime failure", actorUserId: teacherId, recordedAt: failedAt.toISOString(), externalWorkMayStillFinish: true, educationalEffectivenessClaim: false, masteryClaim: false })})`;
    await tx`UPDATE foundry_product.retry_attempts SET status='FAILED_RECOVERABLE',latest_transition_event_id=${failureEventId}::uuid,
      failure_state=${tx.json({ actorUserId: teacherId, recordedAt: failedAt.toISOString(), reason: "Recoverable runtime failure", externalWorkMayStillFinish: true })}
      WHERE id=${retention.id}::uuid`;
  });
  await expectDatabaseRejection("Failure fact rewrite", /Failure fact can be replaced only by a new governed failure transition/, () => client`
    UPDATE foundry_product.retry_attempts SET failure_state=jsonb_set(failure_state,'{reason}','"rewritten"') WHERE id=${retention.id}::uuid`);
  await expectDatabaseRejection("Illegal status edge", /not forward-authorized/, () => client`
    UPDATE foundry_product.retry_attempts SET status='WAITING_FOR_REVIEW' WHERE id=${retention.id}::uuid`);
  await expectDatabaseRejection("CAP-06 Retention delete", /cannot be deleted/, () => client`
    DELETE FROM foundry_product.retention_reviews WHERE id=${retentionExtensionId}::uuid`);

  const [outcomeCount] = await client<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM foundry_product.learning_outcomes`;
  if (!outcomeCount || outcomeCount.count !== 0) throw new Error("CAP-06 upgrade rehearsal created a LearningOutcome claim");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    exactBaseMigrations: "0000-0009",
    appliedMigration: "0010",
    legacyFactsPreservedAndLabeled: true,
    legacyUpdateSemanticsPreserved: true,
    directPostgresNegativeCases,
    learningOutcomeRowsCreated: outcomeCount.count,
  })}\n`);
} finally {
  await client.end();
}
