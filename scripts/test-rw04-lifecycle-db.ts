import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";

const newTables = [
  "component_change_requests",
  "component_deprecation_decisions",
  "component_disable_decisions",
  "component_draft_revisions",
  "component_review_assignments",
  "component_review_comments",
  "component_review_decisions",
  "component_rollback_decisions",
].sort();

function localUrl(raw: string | undefined): string {
  if (!raw) throw new Error("RW04_TEST_DATABASE_URL is required");
  const url = new URL(raw);
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) throw new Error("RW04_TEST_DATABASE_URL must target localhost");
  if (!decodeURIComponent(url.pathname.slice(1)).startsWith("learning_foundry_rw04")) throw new Error("RW04_TEST_DATABASE_URL must target a disposable learning_foundry_rw04* database");
  return url.toString();
}

const db = postgres(localUrl(process.env.RW04_TEST_DATABASE_URL ?? process.env.DATABASE_URL), { max: 1, prepare: false });
const rollbackSentinel = Symbol("rollback-positive");

async function positive(label: string, tenantId: string, operation: (tx: Sql) => Promise<void>): Promise<void> {
  try {
    await db.begin(async (transaction) => {
      const tx = transaction as unknown as Sql;
      await tx.unsafe("SET LOCAL ROLE foundry_product_runtime");
      await tx`SELECT set_config('foundry.institution_id',${tenantId},true)`;
      await operation(tx);
      throw rollbackSentinel;
    });
  } catch (error) {
    if (error === rollbackSentinel) return;
    throw new Error(`${label} same-tenant positive failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${label} did not execute its rollback-safe positive`);
}

async function negative(label: string, tenantId: string, operation: (tx: Sql) => Promise<void>): Promise<void> {
  try {
    await db.begin(async (transaction) => {
      const tx = transaction as unknown as Sql;
      await tx.unsafe("SET LOCAL ROLE foundry_product_runtime");
      await tx`SELECT set_config('foundry.institution_id',${tenantId},true)`;
      await operation(tx);
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (["42501", "23514"].includes(code)) return;
    throw new Error(`${label} cross-tenant negative failed for an unrelated reason (${code}): ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${label} cross-tenant write unexpectedly committed`);
}

const unexpectedlyAllowed = Symbol("unexpectedly-allowed");

async function expectedDenied(
  label: string,
  tenantId: string,
  operation: (tx: Sql) => Promise<void>,
  message: RegExp,
  runtimeRole = true,
): Promise<void> {
  try {
    await db.begin(async (transaction) => {
      const tx = transaction as unknown as Sql;
      if (runtimeRole) await tx.unsafe("SET LOCAL ROLE foundry_product_runtime");
      await tx`SELECT set_config('foundry.institution_id',${tenantId},true)`;
      await operation(tx);
      throw unexpectedlyAllowed;
    });
  } catch (error) {
    if (error === unexpectedlyAllowed) throw new Error(`${label} unexpectedly succeeded`);
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const detail = error instanceof Error ? error.message : String(error);
    if (["42501", "23514"].includes(code) && message.test(detail)) return;
    throw new Error(`${label} failed for an unrelated reason (${code}): ${detail}`);
  }
}

try {
  const [fixture] = await db<Array<{
    component_id: string; institution_id: string; course_id: string; active_version_id: string; active_revision_id: string;
    active_revision_number: number; maximum_revision_number: number; active_hash: string; active_predecessor_version_id: string; predecessor_revision_id: string;
    expert_id: string; assignment_id: string;
  }>>`
    SELECT c.id component_id,c.institution_id,c.course_id,c.active_version_id,v.draft_revision_id active_revision_id,
      r.revision_number active_revision_number,v.content_hash active_hash,v.successor_of_version_id active_predecessor_version_id,
      predecessor.draft_revision_id predecessor_revision_id,
      (SELECT max(all_revisions.revision_number)::int FROM foundry_product.component_draft_revisions all_revisions WHERE all_revisions.component_id=c.id) maximum_revision_number,
      (SELECT m.user_id FROM foundry_product.institution_memberships m WHERE m.institution_id=c.institution_id AND m.role IN ('EXPERT','ADMIN') ORDER BY m.user_id LIMIT 1) expert_id,
      (SELECT a.id FROM foundry_product.component_review_assignments a WHERE a.draft_revision_id=v.draft_revision_id ORDER BY a.assigned_at DESC,a.id DESC LIMIT 1) assignment_id
    FROM foundry_product.components c
    JOIN foundry_product.component_versions v ON v.id=c.active_version_id AND v.status='PUBLISHED'
    JOIN foundry_product.component_draft_revisions r ON r.id=v.draft_revision_id
    JOIN foundry_product.component_versions predecessor ON predecessor.id=v.successor_of_version_id AND predecessor.status='PUBLISHED'
    WHERE c.status='PUBLISHED' AND NOT EXISTS (SELECT 1 FROM foundry_product.component_draft_revisions child WHERE child.predecessor_revision_id=r.id)
    ORDER BY c.created_at,c.id LIMIT 1
  `;
  if (!fixture?.assignment_id || !fixture.expert_id) throw new Error("RW-04 DB harness requires one populated published successor with canonical review binding");

  const otherTenant = randomUUID();
  const actorProvenance = { userId: fixture.expert_id, institutionId: fixture.institution_id, roles: ["EXPERT"], authMethod: "rw04-direct-db", sessionId: `rw04:${randomUUID()}`, authenticatedAt: new Date().toISOString() };

  async function eligibleReviewFixture(
    tx: Sql,
    lifecycleState: "DRAFT" | "READY_FOR_REVIEW" = "READY_FOR_REVIEW",
    includeAssignment = true,
  ) {
    const revisionId = randomUUID();
    const assignmentId = randomUUID();
    const contentHash = fixture.active_hash;
    const revision = await tx`
      INSERT INTO foundry_product.component_draft_revisions
        (id,institution_id,course_id,component_id,revision_number,predecessor_revision_id,derived_from_version_id,contract,content,content_hash,source_observation_ids,source_review_ids,source_asset_version_ids,evidence_unit_ids,context_item_ids,lifecycle_state,created_by,change_reason)
      SELECT ${revisionId}::uuid,c.institution_id,c.course_id,c.id,
        (SELECT max(r.revision_number)+1 FROM foundry_product.component_draft_revisions r WHERE r.component_id=c.id),
        v.draft_revision_id,v.id,v.contract,v.content,v.content_hash,v.source_observation_ids,v.source_review_ids,
        '{}'::uuid[],'{}'::uuid[],'{}'::uuid[],'DRAFT',${fixture.expert_id}::uuid,'RW-04 rollback-only eligible review fixture'
      FROM foundry_product.components c JOIN foundry_product.component_versions v ON v.id=c.active_version_id
      WHERE c.id=${fixture.component_id}::uuid
      RETURNING id`;
    if (revision.length !== 1) throw new Error("eligible DraftRevision fixture was not created");
    if (lifecycleState === "READY_FOR_REVIEW") {
      await tx`UPDATE foundry_product.component_draft_revisions SET lifecycle_state='READY_FOR_REVIEW' WHERE id=${revisionId}::uuid`;
    }
    if (includeAssignment) {
      await tx`INSERT INTO foundry_product.component_review_assignments
        (id,institution_id,course_id,component_id,draft_revision_id,revision_content_hash,assigned_by,reviewer_id,review_scope,conflict_state,status)
        VALUES (${assignmentId}::uuid,${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,
          ${revisionId}::uuid,${contentHash},${fixture.expert_id}::uuid,${fixture.expert_id}::uuid,
          '{"scope":"PRIVATE_INTERNAL","mode":"ROLLBACK_ONLY_DB_PROBE"}'::jsonb,'DECLARED_NONE','ASSIGNED')`;
    }
    return { revisionId, assignmentId, contentHash };
  }

  await positive("ComponentDraftRevision", fixture.institution_id, async (tx) => {
    const { revisionId } = await eligibleReviewFixture(tx, "DRAFT", false);
    const [revision] = await tx<Array<{ lifecycle_state: string }>>`SELECT lifecycle_state FROM foundry_product.component_draft_revisions WHERE id=${revisionId}::uuid`;
    if (revision?.lifecycle_state !== "DRAFT") throw new Error("authored DraftRevision did not begin in DRAFT");
  });

  await positive("ComponentReviewAssignment", fixture.institution_id, async (tx) => {
    const { assignmentId } = await eligibleReviewFixture(tx);
    const [assignment] = await tx<Array<{ status: string }>>`SELECT status FROM foundry_product.component_review_assignments WHERE id=${assignmentId}::uuid`;
    if (assignment?.status !== "ASSIGNED") throw new Error("eligible assignment did not begin ASSIGNED");
  });

  await positive("ComponentReviewComment", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx);
    const result = await tx`INSERT INTO foundry_product.component_review_comments
      (institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,author_id,comment_kind,target_kind,target_ref,body)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${live.revisionId}::uuid,${live.assignmentId}::uuid,${live.contentHash},${fixture.expert_id}::uuid,'COMMENT','FIELD','content.teachingSupport','RW-04 rollback-only eligible comment') RETURNING id`;
    if (result.length !== 1) throw new Error("comment insert did not return one row");
  });

  await positive("ComponentChangeRequest", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx);
    await tx`UPDATE foundry_product.component_draft_revisions SET lifecycle_state='IN_REVIEW' WHERE id=${live.revisionId}::uuid`;
    const result = await tx`INSERT INTO foundry_product.component_change_requests
      (institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,requested_by,reason,idempotency_key)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${live.revisionId}::uuid,${live.assignmentId}::uuid,${live.contentHash},${fixture.expert_id}::uuid,'Clarify the exact teaching support block.',${`rw04-change-${randomUUID()}`}) RETURNING id`;
    if (result.length !== 1) throw new Error("change request insert did not return one row");
  });

  await positive("ComponentReviewDecision", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx);
    await tx`UPDATE foundry_product.component_draft_revisions SET lifecycle_state='IN_REVIEW' WHERE id=${live.revisionId}::uuid`;
    await tx`UPDATE foundry_product.component_review_assignments SET status='COMPLETED',completed_at=now() WHERE id=${live.assignmentId}::uuid`;
    const result = await tx`INSERT INTO foundry_product.component_review_decisions
      (institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,reviewer_id,action,reason,actor_provenance,idempotency_key)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${live.revisionId}::uuid,${live.assignmentId}::uuid,${live.contentHash},${fixture.expert_id}::uuid,'REJECT','RW-04 rollback-only eligible review decision',${tx.json(actorProvenance)},${`rw04-review-${randomUUID()}`}) RETURNING id`;
    if (result.length !== 1) throw new Error("review decision insert did not return one row");
  });

  await positive("ComponentDeprecationDecision", fixture.institution_id, async (tx) => {
    const result = await tx`INSERT INTO foundry_product.component_deprecation_decisions
      (institution_id,course_id,component_id,component_version_id,successor_version_id,action,migration_guidance,actor_user_id,reason,actor_provenance,idempotency_key)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${fixture.active_predecessor_version_id}::uuid,${fixture.active_version_id}::uuid,'DEPRECATE','Use the exact governed published successor.',${fixture.expert_id}::uuid,'The successor replaces this historical version.',${tx.json(actorProvenance)},${`rw04-deprecate-${randomUUID()}`}) RETURNING id`;
    if (result.length !== 1) throw new Error("deprecation decision insert did not return one row");
  });

  await positive("ComponentDisableDecision", fixture.institution_id, async (tx) => {
    const result = await tx`INSERT INTO foundry_product.component_disable_decisions
      (institution_id,course_id,component_id,component_version_id,action,actor_user_id,reason,actor_provenance,idempotency_key)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${fixture.active_version_id}::uuid,'EMERGENCY_DISABLE',${fixture.expert_id}::uuid,'Rollback-safe emergency disable proof.',${tx.json(actorProvenance)},${`rw04-disable-${randomUUID()}`}) RETURNING id`;
    if (result.length !== 1) throw new Error("disable decision insert did not return one row");
  });

  await positive("ComponentRollbackDecision", fixture.institution_id, async (tx) => {
    const result = await tx`INSERT INTO foundry_product.component_rollback_decisions
      (institution_id,course_id,component_id,previous_version_id,target_version_id,actor_user_id,reason,actor_provenance,idempotency_key)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${fixture.active_version_id}::uuid,${fixture.active_predecessor_version_id}::uuid,${fixture.expert_id}::uuid,'Rollback-safe exact history proof.',${tx.json(actorProvenance)},${`rw04-rollback-${randomUUID()}`}) RETURNING id`;
    if (result.length !== 1) throw new Error("rollback decision insert did not return one row");
  });

  await positive("DraftRevision legal lifecycle", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx, "DRAFT", false);
    for (const state of ["CHECK_FAILED", "READY_FOR_REVIEW", "IN_REVIEW", "CHANGES_REQUESTED"]) {
      await tx`UPDATE foundry_product.component_draft_revisions SET lifecycle_state=${state} WHERE id=${live.revisionId}::uuid`;
    }
  });
  await expectedDenied("DraftRevision authored payload immutability", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx, "DRAFT", false);
    await tx`UPDATE foundry_product.component_draft_revisions SET content_hash='forged-rw04-payload' WHERE id=${live.revisionId}::uuid`;
  }, /authored payload is immutable/, false);
  await expectedDenied("DraftRevision illegal lifecycle", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx, "DRAFT", false);
    await tx`UPDATE foundry_product.component_draft_revisions SET lifecycle_state='APPROVED' WHERE id=${live.revisionId}::uuid`;
  }, /Illegal ComponentDraftRevision lifecycle transition/);

  await positive("ReviewAssignment legal lifecycle", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx);
    await tx`UPDATE foundry_product.component_review_assignments SET status='COMPLETED',completed_at=now() WHERE id=${live.assignmentId}::uuid`;
  });
  await expectedDenied("ReviewAssignment illegal lifecycle", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx);
    await tx`UPDATE foundry_product.component_review_assignments SET status='COMPLETED' WHERE id=${live.assignmentId}::uuid`;
  }, /ComponentReviewAssignment identity or lifecycle is immutable\/illegal/);

  await positive("ChangeRequest legal lifecycle", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx);
    await tx`UPDATE foundry_product.component_draft_revisions SET lifecycle_state='IN_REVIEW' WHERE id=${live.revisionId}::uuid`;
    const requestId = randomUUID();
    await tx`INSERT INTO foundry_product.component_change_requests
      (id,institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,requested_by,reason,idempotency_key)
      VALUES (${requestId}::uuid,${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,
        ${live.revisionId}::uuid,${live.assignmentId}::uuid,${live.contentHash},${fixture.expert_id}::uuid,
        'Author an exact successor for this requested change.',${`rw04-legal-change-${randomUUID()}`})`;
    const successorId = randomUUID();
    await tx`INSERT INTO foundry_product.component_draft_revisions
      (id,institution_id,course_id,component_id,revision_number,predecessor_revision_id,derived_from_version_id,contract,content,content_hash,source_observation_ids,source_review_ids,source_asset_version_ids,evidence_unit_ids,context_item_ids,lifecycle_state,created_by,change_reason)
      SELECT ${successorId}::uuid,institution_id,course_id,component_id,revision_number+1,id,derived_from_version_id,contract,content,
        content_hash,source_observation_ids,source_review_ids,source_asset_version_ids,evidence_unit_ids,context_item_ids,
        'DRAFT',created_by,'Rollback-only exact response successor'
      FROM foundry_product.component_draft_revisions WHERE id=${live.revisionId}::uuid`;
    await tx`UPDATE foundry_product.component_change_requests SET status='RESPONDED',successor_revision_id=${successorId}::uuid,
      responded_by=${fixture.expert_id}::uuid,responded_at=now() WHERE id=${requestId}::uuid`;
  });
  await expectedDenied("ChangeRequest illegal lifecycle", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx);
    const requestId = randomUUID();
    await tx`INSERT INTO foundry_product.component_change_requests
      (id,institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,requested_by,reason,idempotency_key)
      VALUES (${requestId}::uuid,${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,
        ${live.revisionId}::uuid,${live.assignmentId}::uuid,${live.contentHash},${fixture.expert_id}::uuid,
        'This response intentionally omits exact successor lineage.',${`rw04-illegal-change-${randomUUID()}`})`;
    await tx`UPDATE foundry_product.component_change_requests SET status='RESPONDED',responded_by=${fixture.expert_id}::uuid,responded_at=now() WHERE id=${requestId}::uuid`;
  }, /ComponentChangeRequest identity or response lifecycle is immutable\/illegal/);

  await expectedDenied("stale assignment hash binding", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx, "READY_FOR_REVIEW", false);
    await tx`INSERT INTO foundry_product.component_review_assignments
      (institution_id,course_id,component_id,draft_revision_id,revision_content_hash,assigned_by,reviewer_id,review_scope,conflict_state,status)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${live.revisionId}::uuid,
        'stale-mismatched-hash',${fixture.expert_id}::uuid,${fixture.expert_id}::uuid,
        '{"scope":"PRIVATE_INTERNAL","mode":"ROLLBACK_ONLY_STALE_PROBE"}'::jsonb,'DECLARED_NONE','ASSIGNED')`;
  }, /ComponentReviewAssignment exact revision\/reviewer lineage mismatch/);

  await expectedDenied("ReviewComment append-only", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx);
    const [comment] = await tx<Array<{ id: string }>>`INSERT INTO foundry_product.component_review_comments
      (institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,author_id,comment_kind,target_kind,body)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${live.revisionId}::uuid,
        ${live.assignmentId}::uuid,${live.contentHash},${fixture.expert_id}::uuid,'COMMENT','GENERAL','Immutable rollback-only comment') RETURNING id`;
    await tx`UPDATE foundry_product.component_review_comments SET body='rewritten' WHERE id=${comment!.id}::uuid`;
  }, /append-only immutable history/, false);
  await expectedDenied("ReviewDecision append-only", fixture.institution_id, async (tx) => {
    const live = await eligibleReviewFixture(tx);
    await tx`UPDATE foundry_product.component_draft_revisions SET lifecycle_state='IN_REVIEW' WHERE id=${live.revisionId}::uuid`;
    await tx`UPDATE foundry_product.component_review_assignments SET status='COMPLETED',completed_at=now() WHERE id=${live.assignmentId}::uuid`;
    const [decision] = await tx<Array<{ id: string }>>`INSERT INTO foundry_product.component_review_decisions
      (institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,reviewer_id,action,reason,actor_provenance,idempotency_key)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${live.revisionId}::uuid,
        ${live.assignmentId}::uuid,${live.contentHash},${fixture.expert_id}::uuid,'REJECT','Immutable rollback-only decision',
        ${tx.json(actorProvenance)},${`rw04-append-review-${randomUUID()}`}) RETURNING id`;
    await tx`UPDATE foundry_product.component_review_decisions SET reason='rewritten' WHERE id=${decision!.id}::uuid`;
  }, /append-only immutable history/, false);
  await expectedDenied("DeprecationDecision append-only", fixture.institution_id, async (tx) => {
    const [decision] = await tx<Array<{ id: string }>>`INSERT INTO foundry_product.component_deprecation_decisions
      (institution_id,course_id,component_id,component_version_id,successor_version_id,action,migration_guidance,actor_user_id,reason,actor_provenance,idempotency_key)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${fixture.active_predecessor_version_id}::uuid,
        ${fixture.active_version_id}::uuid,'DEPRECATE','Use the governed published successor.',${fixture.expert_id}::uuid,
        'Immutable rollback-only deprecation',${tx.json(actorProvenance)},${`rw04-append-deprecate-${randomUUID()}`}) RETURNING id`;
    await tx`UPDATE foundry_product.component_deprecation_decisions SET reason='rewritten' WHERE id=${decision!.id}::uuid`;
  }, /append-only immutable history/, false);
  await expectedDenied("DisableDecision append-only", fixture.institution_id, async (tx) => {
    const [decision] = await tx<Array<{ id: string }>>`INSERT INTO foundry_product.component_disable_decisions
      (institution_id,course_id,component_id,component_version_id,action,actor_user_id,reason,actor_provenance,idempotency_key)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${fixture.active_version_id}::uuid,
        'EMERGENCY_DISABLE',${fixture.expert_id}::uuid,'Immutable rollback-only disable',${tx.json(actorProvenance)},${`rw04-append-disable-${randomUUID()}`}) RETURNING id`;
    await tx`UPDATE foundry_product.component_disable_decisions SET reason='rewritten' WHERE id=${decision!.id}::uuid`;
  }, /append-only immutable history/, false);
  await expectedDenied("RollbackDecision append-only", fixture.institution_id, async (tx) => {
    const [decision] = await tx<Array<{ id: string }>>`INSERT INTO foundry_product.component_rollback_decisions
      (institution_id,course_id,component_id,previous_version_id,target_version_id,actor_user_id,reason,actor_provenance,idempotency_key)
      VALUES (${fixture.institution_id}::uuid,${fixture.course_id}::uuid,${fixture.component_id}::uuid,${fixture.active_version_id}::uuid,
        ${fixture.active_predecessor_version_id}::uuid,${fixture.expert_id}::uuid,'Immutable rollback-only rollback',${tx.json(actorProvenance)},${`rw04-append-rollback-${randomUUID()}`}) RETURNING id`;
    await tx`UPDATE foundry_product.component_rollback_decisions SET reason='rewritten' WHERE id=${decision!.id}::uuid`;
  }, /append-only immutable history/, false);

  const negativeValues: Record<string, string> = {
    component_draft_revisions: `INSERT INTO foundry_product.component_draft_revisions (institution_id,course_id,component_id,revision_number,contract,content,content_hash,source_observation_ids,source_review_ids,source_asset_version_ids,evidence_unit_ids,context_item_ids,lifecycle_state,created_by,change_reason) VALUES ('${fixture.institution_id}','${fixture.course_id}','${fixture.component_id}',999,'{}','{}','cross','{}','{}','{}','{}','{}','DRAFT','${fixture.expert_id}','cross tenant')`,
    component_review_assignments: `INSERT INTO foundry_product.component_review_assignments (institution_id,course_id,component_id,draft_revision_id,revision_content_hash,assigned_by,reviewer_id,review_scope,conflict_state,status) VALUES ('${fixture.institution_id}','${fixture.course_id}','${fixture.component_id}','${fixture.active_revision_id}','${fixture.active_hash}','${fixture.expert_id}','${fixture.expert_id}','{}','DECLARED_NONE','ASSIGNED')`,
    component_review_comments: `INSERT INTO foundry_product.component_review_comments (institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,author_id,comment_kind,target_kind,body) VALUES ('${fixture.institution_id}','${fixture.course_id}','${fixture.component_id}','${fixture.active_revision_id}','${fixture.assignment_id}','${fixture.active_hash}','${fixture.expert_id}','COMMENT','GENERAL','cross tenant')`,
    component_change_requests: `INSERT INTO foundry_product.component_change_requests (institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,requested_by,reason,idempotency_key) VALUES ('${fixture.institution_id}','${fixture.course_id}','${fixture.component_id}','${fixture.active_revision_id}','${fixture.assignment_id}','${fixture.active_hash}','${fixture.expert_id}','cross tenant','cross-${randomUUID()}')`,
    component_review_decisions: `INSERT INTO foundry_product.component_review_decisions (institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,reviewer_id,action,reason,actor_provenance,idempotency_key) VALUES ('${fixture.institution_id}','${fixture.course_id}','${fixture.component_id}','${fixture.active_revision_id}','${fixture.assignment_id}','${fixture.active_hash}','${fixture.expert_id}','REJECT','cross tenant','${JSON.stringify(actorProvenance)}','cross-${randomUUID()}')`,
    component_deprecation_decisions: `INSERT INTO foundry_product.component_deprecation_decisions (institution_id,course_id,component_id,component_version_id,successor_version_id,action,migration_guidance,actor_user_id,reason,actor_provenance,idempotency_key) VALUES ('${fixture.institution_id}','${fixture.course_id}','${fixture.component_id}','${fixture.active_predecessor_version_id}','${fixture.active_version_id}','DEPRECATE','cross tenant guidance','${fixture.expert_id}','cross tenant','${JSON.stringify(actorProvenance)}','cross-${randomUUID()}')`,
    component_disable_decisions: `INSERT INTO foundry_product.component_disable_decisions (institution_id,course_id,component_id,component_version_id,action,actor_user_id,reason,actor_provenance,idempotency_key) VALUES ('${fixture.institution_id}','${fixture.course_id}','${fixture.component_id}','${fixture.active_version_id}','EMERGENCY_DISABLE','${fixture.expert_id}','cross tenant','${JSON.stringify(actorProvenance)}','cross-${randomUUID()}')`,
    component_rollback_decisions: `INSERT INTO foundry_product.component_rollback_decisions (institution_id,course_id,component_id,previous_version_id,target_version_id,actor_user_id,reason,actor_provenance,idempotency_key) VALUES ('${fixture.institution_id}','${fixture.course_id}','${fixture.component_id}','${fixture.active_version_id}','${fixture.active_predecessor_version_id}','${fixture.expert_id}','cross tenant','${JSON.stringify(actorProvenance)}','cross-${randomUUID()}')`,
  };
  for (const table of newTables) await negative(table, otherTenant, async (tx) => { await tx.unsafe(negativeValues[table]!); });

  const [inventory] = await db<Array<{ catalog_count: number; grant_count: number; guard_count: number; rw04_count: number; authority_count: number }>>`
    WITH actual AS (
      SELECT DISTINCT table_schema,table_name FROM information_schema.role_table_grants WHERE grantee IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap') AND privilege_type IN ('INSERT','UPDATE','DELETE')
      UNION SELECT DISTINCT table_schema,table_name FROM information_schema.role_column_grants WHERE grantee IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap') AND privilege_type IN ('INSERT','UPDATE','DELETE')
    ), guarded AS (
      SELECT DISTINCT n.nspname,c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE t.tgname='_authority_tenant_lineage_guard' AND NOT t.tgisinternal
    ) SELECT
      (SELECT count(*)::int FROM foundry_private.writable_lineage_catalog) catalog_count,
      (SELECT count(*)::int FROM actual) grant_count,
      (SELECT count(*)::int FROM foundry_private.writable_lineage_catalog i JOIN guarded g ON g.nspname=i.schema_name AND g.relname=i.table_name) guard_count,
      (SELECT count(*)::int FROM foundry_private.writable_lineage_catalog WHERE table_name=ANY(${newTables}::text[])) rw04_count,
      (SELECT count(*)::int FROM foundry_private.table_authority_catalog) authority_count
  `;
  if (!inventory || inventory.catalog_count !== 45 || inventory.grant_count !== 45 || inventory.guard_count !== 45 || inventory.rw04_count !== 8 || inventory.authority_count !== 55) throw new Error(`RW-04 inventory mismatch: ${JSON.stringify(inventory)}`);

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    authorityCatalog: 55,
    writableCatalog: 45,
    actualWritable: 45,
    guarded: 45,
    rw04Tables: 8,
    sameTenantPositive: 8,
    crossTenantDenied: 8,
    legalLifecycleProbes: 3,
    illegalLifecycleDenied: 3,
    authoredPayloadRewriteDenied: 1,
    staleExactBindingDenied: 1,
    appendOnlyRewritesDenied: 5,
    rollbackSafe: true,
    fixtures: "ROLLBACK_ONLY_ELIGIBLE",
  })}\n`);
} finally {
  await db.end();
}
