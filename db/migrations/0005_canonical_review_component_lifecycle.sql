-- RW-04: canonical review and Learning Component lifecycle foundation.
-- Additive, private/internal checkpoint only. It grants no public, organisation,
-- cross-institution, production, preview, or implicit approval authority.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM foundry_product.component_versions v
    LEFT JOIN foundry_product.components c ON c.id=v.component_id
    LEFT JOIN foundry_product.users u ON u.id=v.created_by
    LEFT JOIN foundry_product.institution_memberships m ON m.user_id=v.created_by AND m.institution_id=c.institution_id
    WHERE c.id IS NULL OR u.id IS NULL OR m.user_id IS NULL
  ) THEN RAISE EXCEPTION 'RW-04 preflight: ComponentVersion creator/component scope is not bindable'; END IF;

  IF EXISTS (
    SELECT 1 FROM foundry_product.component_versions v
    JOIN foundry_product.component_versions prior ON prior.id=v.successor_of_version_id
    WHERE prior.component_id<>v.component_id OR v.created_at<prior.created_at
  ) THEN RAISE EXCEPTION 'RW-04 preflight: ComponentVersion successor lineage is cross-Component'; END IF;

  IF EXISTS (
    SELECT component_id FROM foundry_product.component_versions GROUP BY component_id HAVING count(*)>1 AND count(*) FILTER (WHERE successor_of_version_id IS NULL)<>1
  ) THEN RAISE EXCEPTION 'RW-04 preflight: multi-version Component must have exactly one preserved root'; END IF;

  IF EXISTS (
    WITH RECURSIVE roots AS (
      SELECT id,component_id FROM foundry_product.component_versions WHERE successor_of_version_id IS NULL
    ), reachable AS (
      SELECT id,component_id FROM roots
      UNION
      SELECT child.id,child.component_id FROM foundry_product.component_versions child JOIN reachable parent ON child.successor_of_version_id=parent.id
    )
    SELECT 1 FROM foundry_product.component_versions v LEFT JOIN reachable r ON r.id=v.id WHERE r.id IS NULL
  ) THEN RAISE EXCEPTION 'RW-04 preflight: ComponentVersion successor graph contains an orphan or cycle'; END IF;

  IF EXISTS (
    SELECT 1 FROM foundry_product.component_versions v
    WHERE v.content ? 'evidenceRefs' AND jsonb_typeof(v.content->'evidenceRefs')<>'array'
  ) THEN RAISE EXCEPTION 'RW-04 preflight: Component content Evidence references must be an array'; END IF;

  IF EXISTS (
    SELECT 1 FROM foundry_product.component_versions v
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.content->'evidenceRefs','[]'::jsonb)) reference
    WHERE jsonb_typeof(reference)<>'object'
      OR NOT (reference ? 'evidenceUnitId')
      OR COALESCE(reference->>'evidenceUnitId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) THEN RAISE EXCEPTION 'RW-04 preflight: Component content Evidence references have an invalid item shape or UUID'; END IF;

  IF EXISTS (
    SELECT 1 FROM foundry_product.component_versions v
    JOIN foundry_product.components c ON c.id=v.component_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.content->'evidenceRefs','[]'::jsonb)) reference
    WHERE NOT foundry_private.entity_in_tenant('EVIDENCE',(reference->>'evidenceUnitId')::uuid,c.institution_id)
  ) THEN RAISE EXCEPTION 'RW-04 preflight: Component content Evidence reference is outside its tenant/source authority'; END IF;

  IF EXISTS (
    SELECT 1 FROM foundry_product.component_evaluations e
    JOIN foundry_product.component_versions v ON v.id=e.component_version_id
    JOIN foundry_product.components c ON c.id=v.component_id
    WHERE e.institution_id<>c.institution_id OR e.course_id<>c.course_id OR e.content_hash<>v.content_hash
  ) THEN RAISE EXCEPTION 'RW-04 preflight: ComponentEvaluationRun is not exact-version/hash bound'; END IF;

  IF EXISTS (
    SELECT 1 FROM foundry_product.publication_decisions d
    JOIN foundry_product.component_versions v ON v.id=d.component_version_id
    JOIN foundry_product.components c ON c.id=v.component_id
    LEFT JOIN foundry_product.component_evaluations e ON e.id=d.evaluation_id AND e.component_version_id=v.id
    WHERE d.action IN ('APPROVE','REJECT') AND (
      e.id IS NULL OR e.content_hash<>v.content_hash
      OR d.actor_provenance->>'userId'<>d.expert_id::text
      OR d.actor_provenance->>'institutionId'<>c.institution_id::text
      OR length(COALESCE(d.actor_provenance->>'sessionId',''))=0
      OR COALESCE(d.actor_provenance->>'authMethod','') LIKE 'migrated-%'
    )
  ) THEN RAISE EXCEPTION 'RW-04 preflight: terminal publication decision lacks authenticated human/exact-hash evidence'; END IF;

  IF EXISTS (
    SELECT 1 FROM foundry_product.component_versions v
    WHERE v.status='PUBLISHED' AND (SELECT count(*) FROM foundry_product.publication_decisions d WHERE d.component_version_id=v.id AND d.action='APPROVE')<>1
  ) THEN RAISE EXCEPTION 'RW-04 preflight: published ComponentVersion lacks one exact approval decision'; END IF;

  IF EXISTS (
    SELECT 1 FROM foundry_product.publication_decisions d
    JOIN foundry_product.component_versions target ON target.id=d.component_version_id
    LEFT JOIN foundry_product.component_versions previous ON previous.id=d.previous_active_version_id
    WHERE d.action='ROLLBACK' AND (previous.id IS NULL OR previous.component_id<>target.component_id OR target.status<>'PUBLISHED')
  ) THEN RAISE EXCEPTION 'RW-04 preflight: rollback lineage is incomplete or cross-Component'; END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "foundry_product"."component_versions" ADD COLUMN "draft_revision_id" uuid;
ALTER TABLE "foundry_product"."component_versions" ADD COLUMN "publication_scope" text;
ALTER TABLE "foundry_product"."component_versions" ADD COLUMN "published_by" uuid;
ALTER TABLE "foundry_product"."component_versions" ADD COLUMN "published_at" timestamptz;
ALTER TABLE "foundry_product"."component_versions" ADD COLUMN "publication_decision_id" uuid;
ALTER TABLE "foundry_product"."component_evaluations" ADD COLUMN "draft_revision_id" uuid;
ALTER TABLE "foundry_product"."publication_decisions" ADD COLUMN "draft_revision_id" uuid;
ALTER TABLE "foundry_product"."publication_decisions" ADD COLUMN "review_decision_id" uuid;
ALTER TABLE "foundry_product"."publication_decisions" ADD COLUMN "revision_content_hash" text;
--> statement-breakpoint

CREATE TABLE "foundry_product"."component_draft_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id"),
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"),
  "revision_number" integer NOT NULL,
  "predecessor_revision_id" uuid,
  "derived_from_version_id" uuid REFERENCES "foundry_product"."component_versions"("id"),
  "contract" jsonb NOT NULL,
  "content" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "source_observation_ids" uuid[] NOT NULL,
  "source_review_ids" uuid[] NOT NULL,
  "source_asset_version_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "evidence_unit_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "context_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "lifecycle_state" text DEFAULT 'DRAFT' NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "change_reason" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "component_draft_revision_number_ck" CHECK ("revision_number">0),
  CONSTRAINT "component_draft_revision_state_ck" CHECK ("lifecycle_state" IN ('DRAFT','CHECK_FAILED','READY_FOR_REVIEW','IN_REVIEW','CHANGES_REQUESTED','APPROVED','REJECTED','WITHDRAWN')),
  CONSTRAINT "component_draft_revision_reason_ck" CHECK (length(btrim("change_reason"))>0)
);
ALTER TABLE "foundry_product"."component_draft_revisions" ADD CONSTRAINT "component_draft_revision_predecessor_fk" FOREIGN KEY ("predecessor_revision_id") REFERENCES "foundry_product"."component_draft_revisions"("id");
CREATE UNIQUE INDEX "component_draft_revision_number_uq" ON "foundry_product"."component_draft_revisions" ("component_id","revision_number");
--> statement-breakpoint

CREATE TABLE "foundry_product"."component_review_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id"),
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"),
  "draft_revision_id" uuid NOT NULL REFERENCES "foundry_product"."component_draft_revisions"("id"),
  "revision_content_hash" text NOT NULL,
  "assigned_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "reviewer_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "review_scope" jsonb NOT NULL,
  "conflict_state" text NOT NULL,
  "status" text DEFAULT 'ASSIGNED' NOT NULL,
  "assigned_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "component_review_assignment_conflict_ck" CHECK ("conflict_state" IN ('DECLARED_NONE','DISCLOSED','UNRESOLVED_PRIVATE_COMPATIBILITY','MIGRATED_COMPATIBILITY')),
  CONSTRAINT "component_review_assignment_status_ck" CHECK ("status" IN ('ASSIGNED','COMPLETED','CANCELLED')),
  CONSTRAINT "component_review_assignment_completion_ck" CHECK (("status"='COMPLETED' AND "completed_at" IS NOT NULL) OR ("status"<>'COMPLETED' AND "completed_at" IS NULL))
);
--> statement-breakpoint

CREATE TABLE "foundry_product"."component_review_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id"),
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"),
  "draft_revision_id" uuid NOT NULL REFERENCES "foundry_product"."component_draft_revisions"("id"),
  "assignment_id" uuid NOT NULL REFERENCES "foundry_product"."component_review_assignments"("id"),
  "revision_content_hash" text NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "comment_kind" text NOT NULL,
  "target_kind" text NOT NULL,
  "target_ref" text,
  "parent_comment_id" uuid REFERENCES "foundry_product"."component_review_comments"("id"),
  "body" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "component_review_comment_kind_ck" CHECK ("comment_kind" IN ('COMMENT','REPLY','RESOLUTION')),
  CONSTRAINT "component_review_comment_target_ck" CHECK ("target_kind" IN ('GENERAL','FIELD','BLOCK')),
  CONSTRAINT "component_review_comment_body_ck" CHECK (length(btrim("body"))>0)
);
--> statement-breakpoint

CREATE TABLE "foundry_product"."component_change_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id"),
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"),
  "draft_revision_id" uuid NOT NULL REFERENCES "foundry_product"."component_draft_revisions"("id"),
  "assignment_id" uuid NOT NULL REFERENCES "foundry_product"."component_review_assignments"("id"),
  "revision_content_hash" text NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "reason" text NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "successor_revision_id" uuid REFERENCES "foundry_product"."component_draft_revisions"("id"),
  "responded_by" uuid REFERENCES "foundry_product"."users"("id"),
  "responded_at" timestamptz,
  "idempotency_key" text NOT NULL UNIQUE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "component_change_request_status_ck" CHECK ("status" IN ('OPEN','RESPONDED','WITHDRAWN')),
  CONSTRAINT "component_change_request_reason_ck" CHECK (length(btrim("reason"))>0)
);
--> statement-breakpoint

CREATE TABLE "foundry_product"."component_review_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id"),
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"),
  "draft_revision_id" uuid NOT NULL REFERENCES "foundry_product"."component_draft_revisions"("id"),
  "assignment_id" uuid NOT NULL REFERENCES "foundry_product"."component_review_assignments"("id"),
  "revision_content_hash" text NOT NULL,
  "reviewer_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "action" text NOT NULL,
  "reason" text NOT NULL,
  "actor_provenance" jsonb NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "component_review_decision_action_ck" CHECK ("action" IN ('APPROVE','REJECT','CHANGES_REQUESTED')),
  CONSTRAINT "component_review_decision_reason_ck" CHECK (length(btrim("reason"))>0),
  CONSTRAINT "component_review_decision_assignment_uq" UNIQUE ("assignment_id")
);
--> statement-breakpoint

CREATE TABLE "foundry_product"."component_deprecation_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id"), "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"), "component_version_id" uuid NOT NULL REFERENCES "foundry_product"."component_versions"("id"),
  "successor_version_id" uuid REFERENCES "foundry_product"."component_versions"("id"), "action" text NOT NULL, "migration_guidance" text NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"), "reason" text NOT NULL, "actor_provenance" jsonb NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE, "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "component_deprecation_action_ck" CHECK ("action" IN ('DEPRECATE','RETIRE')),
  CONSTRAINT "component_deprecation_required_text_ck" CHECK (length(btrim("reason"))>4 AND length(btrim("migration_guidance"))>4),
  CONSTRAINT "component_deprecation_successor_ck" CHECK (("action"='DEPRECATE' AND "successor_version_id" IS NOT NULL) OR ("action"='RETIRE' AND "successor_version_id" IS NULL))
);

CREATE TABLE "foundry_product"."component_disable_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id"), "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"), "component_version_id" uuid NOT NULL REFERENCES "foundry_product"."component_versions"("id"),
  "action" text NOT NULL, "actor_user_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"), "reason" text NOT NULL, "actor_provenance" jsonb NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE, "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "component_disable_action_ck" CHECK ("action"='EMERGENCY_DISABLE'), CONSTRAINT "component_disable_reason_ck" CHECK (length(btrim("reason"))>4)
);

CREATE TABLE "foundry_product"."component_rollback_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id"), "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"), "previous_version_id" uuid NOT NULL REFERENCES "foundry_product"."component_versions"("id"),
  "target_version_id" uuid NOT NULL REFERENCES "foundry_product"."component_versions"("id"), "actor_user_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "reason" text NOT NULL, "actor_provenance" jsonb NOT NULL, "idempotency_key" text NOT NULL UNIQUE, "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "component_rollback_changes_version_ck" CHECK ("previous_version_id"<>"target_version_id"), CONSTRAINT "component_rollback_reason_ck" CHECK (length(btrim("reason"))>4)
);
--> statement-breakpoint

WITH RECURSIVE lineage AS (
  SELECT root.*,0::int AS lineage_depth,ARRAY[root.id::text]::text[] AS lineage_path
  FROM foundry_product.component_versions root WHERE root.successor_of_version_id IS NULL
  UNION ALL
  SELECT child.*,parent.lineage_depth+1,parent.lineage_path||child.id::text
  FROM foundry_product.component_versions child
  JOIN lineage parent ON child.successor_of_version_id=parent.id
), ordered AS (
  SELECT lineage.*,c.institution_id,c.course_id,
    row_number() OVER (PARTITION BY lineage.component_id ORDER BY lineage.lineage_path)::int AS revision_number
  FROM lineage JOIN foundry_product.components c ON c.id=lineage.component_id
), mapped AS (
  SELECT ordered.*, foundry_private.deterministic_uuid('rw04-draft-revision|'||id::text) AS revision_id,
    foundry_private.deterministic_uuid('rw04-draft-revision|'||successor_of_version_id::text) AS predecessor_revision
  FROM ordered
)
INSERT INTO foundry_product.component_draft_revisions
  (id,institution_id,course_id,component_id,revision_number,predecessor_revision_id,derived_from_version_id,contract,content,content_hash,
   source_observation_ids,source_review_ids,source_asset_version_ids,evidence_unit_ids,context_item_ids,lifecycle_state,created_by,change_reason,created_at)
SELECT revision_id,institution_id,course_id,component_id,revision_number,
  CASE WHEN successor_of_version_id IS NULL THEN NULL ELSE predecessor_revision END,
  NULL,contract,content,content_hash,source_observation_ids,source_review_ids,'{}',
  ARRAY(SELECT DISTINCT (reference->>'evidenceUnitId')::uuid FROM jsonb_array_elements(COALESCE(mapped.content->'evidenceRefs','[]'::jsonb)) reference ORDER BY 1),
  '{}',
  CASE status WHEN 'PUBLISHED' THEN 'APPROVED' WHEN 'REJECTED' THEN 'REJECTED'
    ELSE CASE WHEN EXISTS (SELECT 1 FROM foundry_product.component_evaluations e WHERE e.component_version_id=mapped.id AND e.content_hash=mapped.content_hash) THEN 'READY_FOR_REVIEW' ELSE 'DRAFT' END END,
  created_by,'MIGRATED_COMPATIBILITY: exact pre-RW-04 ComponentVersion authored state',created_at
FROM mapped ORDER BY component_id,revision_number;

-- The existing guards correctly protect terminal runtime facts. This bounded
-- migration disables only those three domain immutability triggers while it
-- attaches additive canonical links; original content/status/decisions are not
-- rewritten. All triggers are restored before postflight.
ALTER TABLE foundry_product.component_versions DISABLE TRIGGER component_version_immutable_guard;
ALTER TABLE foundry_product.component_versions DISABLE TRIGGER published_component_version_immutable_guard;
ALTER TABLE foundry_product.component_evaluations DISABLE TRIGGER component_evaluation_immutable_guard;
ALTER TABLE foundry_product.publication_decisions DISABLE TRIGGER publication_decision_immutable_guard;
UPDATE foundry_product.component_versions v SET draft_revision_id=foundry_private.deterministic_uuid('rw04-draft-revision|'||v.id::text);
UPDATE foundry_product.component_evaluations e SET draft_revision_id=v.draft_revision_id FROM foundry_product.component_versions v WHERE v.id=e.component_version_id;
UPDATE foundry_product.publication_decisions d SET draft_revision_id=v.draft_revision_id,revision_content_hash=v.content_hash FROM foundry_product.component_versions v WHERE v.id=d.component_version_id;
UPDATE foundry_product.component_versions v SET publication_scope='PRIVATE_INTERNAL',published_by=d.expert_id,published_at=d.created_at,publication_decision_id=d.id
FROM foundry_product.publication_decisions d WHERE d.component_version_id=v.id AND d.action='APPROVE' AND v.status='PUBLISHED';
ALTER TABLE foundry_product.component_versions ENABLE TRIGGER component_version_immutable_guard;
ALTER TABLE foundry_product.component_versions ENABLE TRIGGER published_component_version_immutable_guard;
ALTER TABLE foundry_product.component_evaluations ENABLE TRIGGER component_evaluation_immutable_guard;
--> statement-breakpoint

INSERT INTO foundry_product.component_review_assignments
  (id,institution_id,course_id,component_id,draft_revision_id,revision_content_hash,assigned_by,reviewer_id,review_scope,conflict_state,status,assigned_at,completed_at)
SELECT foundry_private.deterministic_uuid('rw04-migrated-assignment|'||d.id::text),c.institution_id,c.course_id,c.id,v.draft_revision_id,v.content_hash,
  d.expert_id,d.expert_id,jsonb_build_object('mode','MIGRATED_COMPATIBILITY','publicationDecisionId',d.id::text,'scope','PRIVATE_INTERNAL'),
  'MIGRATED_COMPATIBILITY','COMPLETED',d.created_at,d.created_at
FROM foundry_product.publication_decisions d
JOIN foundry_product.component_versions v ON v.id=d.component_version_id JOIN foundry_product.components c ON c.id=v.component_id
WHERE d.action IN ('APPROVE','REJECT');

INSERT INTO foundry_product.component_review_decisions
  (id,institution_id,course_id,component_id,draft_revision_id,assignment_id,revision_content_hash,reviewer_id,action,reason,actor_provenance,idempotency_key,created_at)
SELECT foundry_private.deterministic_uuid('rw04-migrated-review-decision|'||d.id::text),c.institution_id,c.course_id,c.id,v.draft_revision_id,
  foundry_private.deterministic_uuid('rw04-migrated-assignment|'||d.id::text),v.content_hash,d.expert_id,d.action,d.rationale,d.actor_provenance,
  'rw04-migrated-review:'||d.id::text,d.created_at
FROM foundry_product.publication_decisions d
JOIN foundry_product.component_versions v ON v.id=d.component_version_id JOIN foundry_product.components c ON c.id=v.component_id
WHERE d.action IN ('APPROVE','REJECT');

UPDATE foundry_product.publication_decisions d SET review_decision_id=foundry_private.deterministic_uuid('rw04-migrated-review-decision|'||d.id::text)
WHERE d.action IN ('APPROVE','REJECT');
ALTER TABLE foundry_product.publication_decisions ENABLE TRIGGER publication_decision_immutable_guard;

INSERT INTO foundry_product.component_rollback_decisions
  (id,institution_id,course_id,component_id,previous_version_id,target_version_id,actor_user_id,reason,actor_provenance,idempotency_key,created_at)
SELECT foundry_private.deterministic_uuid('rw04-migrated-rollback|'||d.id::text),c.institution_id,c.course_id,c.id,d.previous_active_version_id,d.component_version_id,
  d.expert_id,d.rationale,d.actor_provenance,'rw04-migrated-rollback:'||d.id::text,d.created_at
FROM foundry_product.publication_decisions d
JOIN foundry_product.component_versions v ON v.id=d.component_version_id JOIN foundry_product.components c ON c.id=v.component_id
WHERE d.action='ROLLBACK';
--> statement-breakpoint

ALTER TABLE "foundry_product"."component_versions" ALTER COLUMN "draft_revision_id" SET NOT NULL;
ALTER TABLE "foundry_product"."component_evaluations" ALTER COLUMN "draft_revision_id" SET NOT NULL;
ALTER TABLE "foundry_product"."publication_decisions" ALTER COLUMN "draft_revision_id" SET NOT NULL;
ALTER TABLE "foundry_product"."publication_decisions" ALTER COLUMN "revision_content_hash" SET NOT NULL;
ALTER TABLE "foundry_product"."component_versions" ADD CONSTRAINT "component_versions_draft_revision_fk" FOREIGN KEY ("draft_revision_id") REFERENCES "foundry_product"."component_draft_revisions"("id");
ALTER TABLE "foundry_product"."component_versions" ADD CONSTRAINT "component_versions_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "foundry_product"."users"("id");
ALTER TABLE "foundry_product"."component_versions" ADD CONSTRAINT "component_versions_publication_decision_fk" FOREIGN KEY ("publication_decision_id") REFERENCES "foundry_product"."publication_decisions"("id");
ALTER TABLE "foundry_product"."component_versions" ADD CONSTRAINT "component_version_publication_scope_ck" CHECK ("publication_scope" IS NULL OR "publication_scope"='PRIVATE_INTERNAL');
ALTER TABLE "foundry_product"."component_versions" ADD CONSTRAINT "component_version_publication_fact_ck" CHECK (("status"='PUBLISHED' AND "publication_scope"='PRIVATE_INTERNAL' AND "published_by" IS NOT NULL AND "published_at" IS NOT NULL AND "publication_decision_id" IS NOT NULL) OR ("status"<>'PUBLISHED' AND "publication_scope" IS NULL AND "published_by" IS NULL AND "published_at" IS NULL AND "publication_decision_id" IS NULL));
ALTER TABLE "foundry_product"."components" ADD CONSTRAINT "component_lifecycle_status_ck" CHECK ("status" IN ('CANDIDATE','PUBLISHED','REJECTED','DEPRECATED','RETIRED','EMERGENCY_DISABLED'));
ALTER TABLE "foundry_product"."component_evaluations" ADD CONSTRAINT "component_evaluations_draft_revision_fk" FOREIGN KEY ("draft_revision_id") REFERENCES "foundry_product"."component_draft_revisions"("id");
ALTER TABLE "foundry_product"."publication_decisions" ADD CONSTRAINT "publication_decisions_draft_revision_fk" FOREIGN KEY ("draft_revision_id") REFERENCES "foundry_product"."component_draft_revisions"("id");
ALTER TABLE "foundry_product"."publication_decisions" ADD CONSTRAINT "publication_decisions_review_decision_fk" FOREIGN KEY ("review_decision_id") REFERENCES "foundry_product"."component_review_decisions"("id");
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.component_draft_revisions r ON r.id=v.draft_revision_id
    WHERE r.component_id<>v.component_id OR r.content_hash<>v.content_hash OR r.contract<>v.contract OR r.content<>v.content
  ) OR EXISTS (
    SELECT 1 FROM foundry_product.component_evaluations e JOIN foundry_product.component_draft_revisions r ON r.id=e.draft_revision_id
    WHERE r.component_id<>(SELECT component_id FROM foundry_product.component_versions WHERE id=e.component_version_id) OR r.content_hash<>e.content_hash
  ) OR EXISTS (
    SELECT 1 FROM foundry_product.publication_decisions d JOIN foundry_product.component_draft_revisions r ON r.id=d.draft_revision_id
    WHERE r.content_hash<>d.revision_content_hash OR (d.action IN ('APPROVE','REJECT') AND d.review_decision_id IS NULL)
  ) OR EXISTS (
    SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.component_draft_revisions r ON r.id=v.draft_revision_id
    WHERE r.evidence_unit_ids IS DISTINCT FROM ARRAY(
      SELECT DISTINCT (reference->>'evidenceUnitId')::uuid
      FROM jsonb_array_elements(COALESCE(v.content->'evidenceRefs','[]'::jsonb)) reference ORDER BY 1
    ) OR EXISTS (SELECT 1 FROM unnest(r.evidence_unit_ids) evidence_id WHERE NOT foundry_private.entity_in_tenant('EVIDENCE',evidence_id,r.institution_id))
  ) OR EXISTS (
    SELECT 1 FROM foundry_product.component_draft_revisions child
    JOIN foundry_product.component_draft_revisions parent ON parent.id=child.predecessor_revision_id
    WHERE parent.revision_number>=child.revision_number
  ) THEN RAISE EXCEPTION 'RW-04 postflight: exact revision compatibility binding failed'; END IF;
END $$;
--> statement-breakpoint

-- New objects are Class A. Existing physical ComponentEvaluation remains Class B.
INSERT INTO foundry_private.table_authority_catalog (schema_name,table_name,classification,policy_required) VALUES
('foundry_product','component_draft_revisions','TENANT_DIRECT_CLASS_A',true),
('foundry_product','component_review_assignments','TENANT_DIRECT_CLASS_A',true),
('foundry_product','component_review_comments','TENANT_DIRECT_CLASS_A',true),
('foundry_product','component_change_requests','TENANT_DIRECT_CLASS_A',true),
('foundry_product','component_review_decisions','TENANT_DIRECT_CLASS_A',true),
('foundry_product','component_deprecation_decisions','TENANT_DIRECT_CLASS_A',true),
('foundry_product','component_disable_decisions','TENANT_DIRECT_CLASS_A',true),
('foundry_product','component_rollback_decisions','TENANT_DIRECT_CLASS_A',true);

INSERT INTO foundry_private.writable_lineage_catalog (schema_name,table_name,writable_roles,tenant_references,enforcement) VALUES
('foundry_product','component_draft_revisions',ARRAY['foundry_product_runtime'],'institution; course; Component; predecessor; source/Evidence/Context; creator','FORCED_RLS + _authority_tenant_lineage_guard + immutable payload'),
('foundry_product','component_review_assignments',ARRAY['foundry_product_runtime'],'institution; course; exact Component revision/hash; assigner/reviewer','FORCED_RLS + _authority_tenant_lineage_guard'),
('foundry_product','component_review_comments',ARRAY['foundry_product_runtime'],'institution; course; assignment; exact revision/hash; author; parent','FORCED_RLS + _authority_tenant_lineage_guard + append-only'),
('foundry_product','component_change_requests',ARRAY['foundry_product_runtime'],'institution; course; assignment; exact revision/hash; requestor; successor','FORCED_RLS + _authority_tenant_lineage_guard'),
('foundry_product','component_review_decisions',ARRAY['foundry_product_runtime'],'institution; course; assignment; exact revision/hash; authenticated reviewer','FORCED_RLS + _authority_tenant_lineage_guard + append-only'),
('foundry_product','component_deprecation_decisions',ARRAY['foundry_product_runtime'],'institution; course; Component; exact target/successor versions; authenticated actor','FORCED_RLS + _authority_tenant_lineage_guard + append-only'),
('foundry_product','component_disable_decisions',ARRAY['foundry_product_runtime'],'institution; course; Component; exact target version; authenticated actor','FORCED_RLS + _authority_tenant_lineage_guard + append-only'),
('foundry_product','component_rollback_decisions',ARRAY['foundry_product_runtime'],'institution; course; Component; exact previous/target versions; authenticated actor','FORCED_RLS + _authority_tenant_lineage_guard + append-only');
--> statement-breakpoint

REVOKE ALL ON foundry_product.component_draft_revisions,foundry_product.component_review_assignments,foundry_product.component_review_comments,
 foundry_product.component_change_requests,foundry_product.component_review_decisions,foundry_product.component_deprecation_decisions,
 foundry_product.component_disable_decisions,foundry_product.component_rollback_decisions FROM PUBLIC;
GRANT SELECT,INSERT ON foundry_product.component_draft_revisions,foundry_product.component_review_assignments,foundry_product.component_review_comments,
 foundry_product.component_change_requests,foundry_product.component_review_decisions,foundry_product.component_deprecation_decisions,
 foundry_product.component_disable_decisions,foundry_product.component_rollback_decisions TO foundry_product_runtime;
GRANT UPDATE (lifecycle_state) ON foundry_product.component_draft_revisions TO foundry_product_runtime;
GRANT UPDATE (status,completed_at) ON foundry_product.component_review_assignments TO foundry_product_runtime;
GRANT UPDATE (status,successor_revision_id,responded_by,responded_at) ON foundry_product.component_change_requests TO foundry_product_runtime;

ALTER TABLE foundry_product.component_draft_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE foundry_product.component_draft_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE foundry_product.component_review_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE foundry_product.component_review_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE foundry_product.component_review_comments ENABLE ROW LEVEL SECURITY; ALTER TABLE foundry_product.component_review_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE foundry_product.component_change_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE foundry_product.component_change_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE foundry_product.component_review_decisions ENABLE ROW LEVEL SECURITY; ALTER TABLE foundry_product.component_review_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE foundry_product.component_deprecation_decisions ENABLE ROW LEVEL SECURITY; ALTER TABLE foundry_product.component_deprecation_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE foundry_product.component_disable_decisions ENABLE ROW LEVEL SECURITY; ALTER TABLE foundry_product.component_disable_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE foundry_product.component_rollback_decisions ENABLE ROW LEVEL SECURITY; ALTER TABLE foundry_product.component_rollback_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON foundry_product.component_draft_revisions TO foundry_product_runtime USING (institution_id=foundry_private.current_institution_id()) WITH CHECK (institution_id=foundry_private.current_institution_id());
CREATE POLICY tenant_scope ON foundry_product.component_review_assignments TO foundry_product_runtime USING (institution_id=foundry_private.current_institution_id()) WITH CHECK (institution_id=foundry_private.current_institution_id());
CREATE POLICY tenant_scope ON foundry_product.component_review_comments TO foundry_product_runtime USING (institution_id=foundry_private.current_institution_id()) WITH CHECK (institution_id=foundry_private.current_institution_id());
CREATE POLICY tenant_scope ON foundry_product.component_change_requests TO foundry_product_runtime USING (institution_id=foundry_private.current_institution_id()) WITH CHECK (institution_id=foundry_private.current_institution_id());
CREATE POLICY tenant_scope ON foundry_product.component_review_decisions TO foundry_product_runtime USING (institution_id=foundry_private.current_institution_id()) WITH CHECK (institution_id=foundry_private.current_institution_id());
CREATE POLICY tenant_scope ON foundry_product.component_deprecation_decisions TO foundry_product_runtime USING (institution_id=foundry_private.current_institution_id()) WITH CHECK (institution_id=foundry_private.current_institution_id());
CREATE POLICY tenant_scope ON foundry_product.component_disable_decisions TO foundry_product_runtime USING (institution_id=foundry_private.current_institution_id()) WITH CHECK (institution_id=foundry_private.current_institution_id());
CREATE POLICY tenant_scope ON foundry_product.component_rollback_decisions TO foundry_product_runtime USING (institution_id=foundry_private.current_institution_id()) WITH CHECK (institution_id=foundry_private.current_institution_id());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.assert_rw04_component_lineage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid; r foundry_product.component_draft_revisions%ROWTYPE; a foundry_product.component_review_assignments%ROWTYPE;
BEGIN
  IF tenant_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=c.relowner WHERE n.nspname=TG_TABLE_SCHEMA AND c.relname=TG_TABLE_NAME AND owner_role.rolname=session_user)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles role_row WHERE role_row.rolname=session_user AND role_row.rolsuper) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'RW-04 tenant context is required' USING ERRCODE='42501';
  END IF;
  IF NEW.institution_id<>tenant_id OR NOT foundry_private.entity_in_tenant('COURSE',NEW.course_id,tenant_id) THEN RAISE EXCEPTION 'RW-04 institution/course lineage mismatch' USING ERRCODE='23514'; END IF;
  CASE TG_TABLE_NAME
    WHEN 'component_draft_revisions' THEN
      IF NOT EXISTS (SELECT 1 FROM foundry_product.components c WHERE c.id=NEW.component_id AND c.institution_id=tenant_id AND c.course_id=NEW.course_id)
        OR NOT foundry_private.entity_in_tenant('USER',NEW.created_by,tenant_id)
        OR (NEW.predecessor_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.component_draft_revisions p WHERE p.id=NEW.predecessor_revision_id AND p.component_id=NEW.component_id AND p.revision_number<NEW.revision_number))
        OR (NEW.derived_from_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.component_versions v WHERE v.id=NEW.derived_from_version_id AND v.component_id=NEW.component_id AND v.status='PUBLISHED'))
        OR NOT foundry_private.uuid_array_in_tenant(to_jsonb(NEW.source_observation_ids),'OBSERVATION',tenant_id)
        OR NOT foundry_private.uuid_array_in_tenant(to_jsonb(NEW.source_review_ids),'REVIEW',tenant_id)
        OR NOT foundry_private.uuid_array_in_tenant(to_jsonb(NEW.evidence_unit_ids),'EVIDENCE',tenant_id)
        OR EXISTS (SELECT 1 FROM unnest(NEW.source_asset_version_ids) id WHERE NOT EXISTS (SELECT 1 FROM foundry_product.source_asset_versions s WHERE s.id=id AND s.institution_id=tenant_id))
        OR EXISTS (SELECT 1 FROM unnest(NEW.context_item_ids) id WHERE NOT EXISTS (SELECT 1 FROM foundry_product.context_items c WHERE c.id=id AND c.institution_id=tenant_id))
        THEN RAISE EXCEPTION 'ComponentDraftRevision exact tenant/lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'component_review_assignments' THEN
      SELECT * INTO r FROM foundry_product.component_draft_revisions WHERE id=NEW.draft_revision_id;
      IF r.id IS NULL OR r.component_id<>NEW.component_id OR r.institution_id<>tenant_id OR r.course_id<>NEW.course_id OR r.content_hash<>NEW.revision_content_hash
        OR NOT foundry_private.entity_in_tenant('USER',NEW.assigned_by,tenant_id) OR NOT foundry_private.entity_in_tenant('USER',NEW.reviewer_id,tenant_id)
        THEN RAISE EXCEPTION 'ComponentReviewAssignment exact revision/reviewer lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'component_review_comments' THEN
      SELECT * INTO a FROM foundry_product.component_review_assignments WHERE id=NEW.assignment_id; SELECT * INTO r FROM foundry_product.component_draft_revisions WHERE id=NEW.draft_revision_id;
      IF a.id IS NULL OR r.id IS NULL OR a.draft_revision_id<>r.id OR a.component_id<>NEW.component_id OR a.institution_id<>tenant_id OR a.course_id<>NEW.course_id OR r.content_hash<>NEW.revision_content_hash
        OR NOT foundry_private.entity_in_tenant('USER',NEW.author_id,tenant_id)
        OR (NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.component_review_comments p WHERE p.id=NEW.parent_comment_id AND p.assignment_id=NEW.assignment_id AND p.draft_revision_id=NEW.draft_revision_id))
        OR (NEW.comment_kind IN ('REPLY','RESOLUTION') AND NEW.parent_comment_id IS NULL)
        OR (NEW.target_kind IN ('FIELD','BLOCK') AND length(COALESCE(NEW.target_ref,''))=0)
        THEN RAISE EXCEPTION 'ComponentReviewComment exact revision/target lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'component_change_requests' THEN
      SELECT * INTO a FROM foundry_product.component_review_assignments WHERE id=NEW.assignment_id; SELECT * INTO r FROM foundry_product.component_draft_revisions WHERE id=NEW.draft_revision_id;
      IF a.id IS NULL OR r.id IS NULL OR a.draft_revision_id<>r.id OR r.component_id<>NEW.component_id OR r.content_hash<>NEW.revision_content_hash
        OR NOT foundry_private.entity_in_tenant('USER',NEW.requested_by,tenant_id)
        OR (NEW.successor_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.component_draft_revisions s WHERE s.id=NEW.successor_revision_id AND s.predecessor_revision_id=NEW.draft_revision_id AND s.component_id=NEW.component_id))
        OR (NEW.responded_by IS NOT NULL AND NOT foundry_private.entity_in_tenant('USER',NEW.responded_by,tenant_id))
        THEN RAISE EXCEPTION 'ComponentChangeRequest exact revision/successor lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'component_review_decisions' THEN
      SELECT * INTO a FROM foundry_product.component_review_assignments WHERE id=NEW.assignment_id; SELECT * INTO r FROM foundry_product.component_draft_revisions WHERE id=NEW.draft_revision_id;
      IF a.id IS NULL OR r.id IS NULL OR a.draft_revision_id<>r.id OR a.reviewer_id<>NEW.reviewer_id OR r.component_id<>NEW.component_id OR r.content_hash<>NEW.revision_content_hash
        OR NEW.actor_provenance->>'userId'<>NEW.reviewer_id::text OR NEW.actor_provenance->>'institutionId'<>tenant_id::text
        OR length(COALESCE(NEW.actor_provenance->>'sessionId',''))=0 OR COALESCE(NEW.actor_provenance->>'authMethod','') LIKE 'migrated-%'
        THEN RAISE EXCEPTION 'ComponentReviewDecision authenticated exact-revision lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'component_deprecation_decisions' THEN
      IF NOT EXISTS (SELECT 1 FROM foundry_product.components c JOIN foundry_product.component_versions v ON v.component_id=c.id WHERE c.id=NEW.component_id AND c.institution_id=tenant_id AND c.course_id=NEW.course_id AND v.id=NEW.component_version_id AND v.status='PUBLISHED')
        OR (NEW.successor_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.component_versions s WHERE s.id=NEW.successor_version_id AND s.component_id=NEW.component_id AND s.status='PUBLISHED' AND s.successor_of_version_id=NEW.component_version_id))
        OR NOT foundry_private.entity_in_tenant('USER',NEW.actor_user_id,tenant_id) OR NEW.actor_provenance->>'userId'<>NEW.actor_user_id::text OR NEW.actor_provenance->>'institutionId'<>tenant_id::text
        THEN RAISE EXCEPTION 'ComponentDeprecationDecision exact-version lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'component_disable_decisions' THEN
      IF NOT EXISTS (SELECT 1 FROM foundry_product.components c JOIN foundry_product.component_versions v ON v.component_id=c.id WHERE c.id=NEW.component_id AND c.institution_id=tenant_id AND c.course_id=NEW.course_id AND v.id=NEW.component_version_id AND v.status='PUBLISHED')
        OR NOT foundry_private.entity_in_tenant('USER',NEW.actor_user_id,tenant_id) OR NEW.actor_provenance->>'userId'<>NEW.actor_user_id::text OR NEW.actor_provenance->>'institutionId'<>tenant_id::text
        THEN RAISE EXCEPTION 'ComponentDisableDecision exact-version lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'component_rollback_decisions' THEN
      IF NOT EXISTS (SELECT 1 FROM foundry_product.components c JOIN foundry_product.component_versions p ON p.component_id=c.id JOIN foundry_product.component_versions t ON t.component_id=c.id WHERE c.id=NEW.component_id AND c.institution_id=tenant_id AND c.course_id=NEW.course_id AND c.active_version_id=NEW.previous_version_id AND p.id=NEW.previous_version_id AND t.id=NEW.target_version_id AND p.status='PUBLISHED' AND t.status='PUBLISHED')
        OR EXISTS (SELECT 1 FROM foundry_product.component_deprecation_decisions d WHERE d.component_version_id=NEW.target_version_id)
        OR EXISTS (SELECT 1 FROM foundry_product.component_disable_decisions d WHERE d.component_version_id=NEW.target_version_id)
        OR NOT foundry_private.entity_in_tenant('USER',NEW.actor_user_id,tenant_id) OR NEW.actor_provenance->>'userId'<>NEW.actor_user_id::text OR NEW.actor_provenance->>'institutionId'<>tenant_id::text
        THEN RAISE EXCEPTION 'ComponentRollbackDecision exact-version lineage mismatch' USING ERRCODE='23514'; END IF;
  END CASE;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.assert_rw04_component_lineage() FROM PUBLIC;
--> statement-breakpoint

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['component_draft_revisions','component_review_assignments','component_review_comments','component_change_requests','component_review_decisions','component_deprecation_decisions','component_disable_decisions','component_rollback_decisions'] LOOP
    EXECUTE format('CREATE TRIGGER _authority_tenant_lineage_guard BEFORE INSERT OR UPDATE ON foundry_product.%I FOR EACH ROW EXECUTE FUNCTION foundry_private.assert_rw04_component_lineage()',table_name);
  END LOOP;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.rw04_immutable_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION '% is append-only immutable history',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION foundry_private.rw04_immutable_history_guard() FROM PUBLIC;
CREATE TRIGGER component_review_comment_immutable_guard BEFORE UPDATE OR DELETE ON foundry_product.component_review_comments FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_immutable_history_guard();
CREATE TRIGGER component_review_decision_immutable_guard BEFORE UPDATE OR DELETE ON foundry_product.component_review_decisions FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_immutable_history_guard();
CREATE TRIGGER component_deprecation_decision_immutable_guard BEFORE UPDATE OR DELETE ON foundry_product.component_deprecation_decisions FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_immutable_history_guard();
CREATE TRIGGER component_disable_decision_immutable_guard BEFORE UPDATE OR DELETE ON foundry_product.component_disable_decisions FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_immutable_history_guard();
CREATE TRIGGER component_rollback_decision_immutable_guard BEFORE UPDATE OR DELETE ON foundry_product.component_rollback_decisions FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_immutable_history_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.rw04_draft_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE valid boolean:=false;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ComponentDraftRevision is immutable history' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(OLD)-'lifecycle_state') IS DISTINCT FROM (to_jsonb(NEW)-'lifecycle_state') THEN RAISE EXCEPTION 'ComponentDraftRevision authored payload is immutable; append a successor' USING ERRCODE='23514'; END IF;
  valid:=CASE OLD.lifecycle_state
    WHEN 'DRAFT' THEN NEW.lifecycle_state IN ('CHECK_FAILED','READY_FOR_REVIEW','WITHDRAWN')
    WHEN 'CHECK_FAILED' THEN NEW.lifecycle_state IN ('READY_FOR_REVIEW','WITHDRAWN')
    WHEN 'READY_FOR_REVIEW' THEN NEW.lifecycle_state IN ('IN_REVIEW','WITHDRAWN')
    WHEN 'IN_REVIEW' THEN NEW.lifecycle_state IN ('CHANGES_REQUESTED','APPROVED','REJECTED','WITHDRAWN')
    WHEN 'CHANGES_REQUESTED' THEN false ELSE false END;
  IF NEW.lifecycle_state<>OLD.lifecycle_state AND NOT valid THEN RAISE EXCEPTION 'Illegal ComponentDraftRevision lifecycle transition: % -> %',OLD.lifecycle_state,NEW.lifecycle_state USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.rw04_draft_revision_guard() FROM PUBLIC;
CREATE TRIGGER component_draft_revision_immutable_guard BEFORE UPDATE OR DELETE ON foundry_product.component_draft_revisions FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_draft_revision_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.rw04_assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(OLD)-'status'-'completed_at') IS DISTINCT FROM (to_jsonb(NEW)-'status'-'completed_at')
    OR OLD.status<>'ASSIGNED' OR NEW.status NOT IN ('COMPLETED','CANCELLED') OR (NEW.status='COMPLETED' AND NEW.completed_at IS NULL)
    THEN RAISE EXCEPTION 'ComponentReviewAssignment identity or lifecycle is immutable/illegal' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.rw04_assignment_guard() FROM PUBLIC;
CREATE TRIGGER component_review_assignment_lifecycle_guard BEFORE UPDATE OR DELETE ON foundry_product.component_review_assignments FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_assignment_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.rw04_change_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(OLD)-'status'-'successor_revision_id'-'responded_by'-'responded_at') IS DISTINCT FROM (to_jsonb(NEW)-'status'-'successor_revision_id'-'responded_by'-'responded_at')
    OR OLD.status<>'OPEN' OR NEW.status NOT IN ('RESPONDED','WITHDRAWN')
    OR (NEW.status='RESPONDED' AND (NEW.successor_revision_id IS NULL OR NEW.responded_by IS NULL OR NEW.responded_at IS NULL))
    THEN RAISE EXCEPTION 'ComponentChangeRequest identity or response lifecycle is immutable/illegal' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.rw04_change_request_guard() FROM PUBLIC;
CREATE TRIGGER component_change_request_lifecycle_guard BEFORE UPDATE OR DELETE ON foundry_product.component_change_requests FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_change_request_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.rw04_existing_binding_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE revision foundry_product.component_draft_revisions%ROWTYPE; review_decision foundry_product.component_review_decisions%ROWTYPE;
BEGIN
  SELECT * INTO revision FROM foundry_product.component_draft_revisions WHERE id=NEW.draft_revision_id;
  IF TG_TABLE_NAME='component_versions' THEN
    IF revision.id IS NULL OR revision.component_id<>NEW.component_id OR revision.content_hash<>NEW.content_hash OR revision.contract<>NEW.contract OR revision.content<>NEW.content THEN RAISE EXCEPTION 'ComponentVersion compatibility shell must bind its exact immutable DraftRevision' USING ERRCODE='23514'; END IF;
    IF NEW.status='PUBLISHED' AND NOT EXISTS (SELECT 1 FROM foundry_product.publication_decisions d WHERE d.id=NEW.publication_decision_id AND d.component_version_id=NEW.id AND d.action='APPROVE' AND d.expert_id=NEW.published_by AND d.created_at=NEW.published_at AND d.revision_content_hash=NEW.content_hash)
      THEN RAISE EXCEPTION 'Published ComponentVersion requires exact private scope, publisher/time, and PublicationDecision binding' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='component_evaluations' THEN
    IF revision.id IS NULL OR revision.id<>(SELECT draft_revision_id FROM foundry_product.component_versions WHERE id=NEW.component_version_id) OR revision.content_hash<>NEW.content_hash THEN RAISE EXCEPTION 'ComponentEvaluationRun must bind the exact current DraftRevision hash' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='publication_decisions' THEN
    IF revision.id IS NULL OR revision.id<>(SELECT draft_revision_id FROM foundry_product.component_versions WHERE id=NEW.component_version_id) OR revision.content_hash<>NEW.revision_content_hash THEN RAISE EXCEPTION 'PublicationDecision must bind the exact DraftRevision hash' USING ERRCODE='23514'; END IF;
    IF NEW.action IN ('APPROVE','REJECT') THEN
      SELECT * INTO review_decision FROM foundry_product.component_review_decisions WHERE id=NEW.review_decision_id;
      IF review_decision.id IS NULL OR review_decision.draft_revision_id<>revision.id OR review_decision.revision_content_hash<>revision.content_hash OR review_decision.action<>NEW.action OR review_decision.reviewer_id<>NEW.expert_id THEN RAISE EXCEPTION 'PublicationDecision requires a matching exact-revision human ReviewDecision' USING ERRCODE='23514'; END IF;
    ELSIF NEW.review_decision_id IS NOT NULL THEN RAISE EXCEPTION 'Rollback is not a ComponentReviewDecision' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.rw04_existing_binding_guard() FROM PUBLIC;
CREATE TRIGGER rw04_exact_revision_guard BEFORE INSERT OR UPDATE ON foundry_product.component_versions FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_existing_binding_guard();
CREATE TRIGGER rw04_exact_revision_guard BEFORE INSERT ON foundry_product.component_evaluations FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_existing_binding_guard();
CREATE TRIGGER rw04_exact_revision_guard BEFORE INSERT ON foundry_product.publication_decisions FOR EACH ROW EXECUTE FUNCTION foundry_private.rw04_existing_binding_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.idempotency_result_in_tenant(command_name text,result_id uuid,tenant_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF result_id IS NULL THEN RETURN true; END IF;
  CASE command_name
    WHEN 'CREATE_TASK' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learning_tasks WHERE id=result_id) OR foundry_private.entity_in_tenant('TASK',result_id,tenant_id);
    WHEN 'APPEND_CONVERSATION_EVENT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.conversation_events WHERE id=result_id) OR foundry_private.entity_in_tenant('EVENT',result_id,tenant_id);
    WHEN 'CAPTURE_ATTEMPT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learner_attempts WHERE id=result_id) OR foundry_private.entity_in_tenant('ATTEMPT',result_id,tenant_id);
    WHEN 'UPLOAD_IMAGE_ATTEMPT','UPLOAD_LEARNING_MATERIAL' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.file_assets WHERE id=result_id) OR foundry_private.entity_in_tenant('FILE',result_id,tenant_id);
    WHEN 'REVIEW_SOURCE_RIGHTS' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.source_records WHERE id=result_id) OR foundry_private.entity_in_tenant('SOURCE',result_id,tenant_id);
    WHEN 'TEACHER_REVIEW','RETRY_RESULT_REVIEW' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.teacher_reviews WHERE id=result_id) OR foundry_private.entity_in_tenant('REVIEW',result_id,tenant_id);
    WHEN 'CREATE_RETRY' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.retry_attempts WHERE id=result_id) OR foundry_private.entity_in_tenant('RETRY',result_id,tenant_id);
    WHEN 'LEARNING_OUTCOME' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learning_outcomes WHERE id=result_id) OR foundry_private.entity_in_tenant('OUTCOME',result_id,tenant_id);
    WHEN 'COMPONENT_CANDIDATE' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.components WHERE id=result_id) OR foundry_private.entity_in_tenant('COMPONENT',result_id,tenant_id);
    WHEN 'UPDATE_COMPONENT_VERSION' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_versions WHERE id=result_id) OR foundry_private.entity_in_tenant('VERSION',result_id,tenant_id);
    WHEN 'COMPONENT_PUBLICATION_DECISION' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.publication_decisions WHERE id=result_id) OR foundry_private.entity_in_tenant('DECISION',result_id,tenant_id);
    WHEN 'COMPONENT_ROLLBACK' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_rollback_decisions WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.component_rollback_decisions d WHERE d.id=result_id AND d.institution_id=tenant_id);
    WHEN 'COMPONENT_DEPRECATION' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_deprecation_decisions WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.component_deprecation_decisions d WHERE d.id=result_id AND d.institution_id=tenant_id);
    WHEN 'COMPONENT_DISABLE' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_disable_decisions WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.component_disable_decisions d WHERE d.id=result_id AND d.institution_id=tenant_id);
    WHEN 'DELIVER_COMPONENT_SUPPORT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_deliveries WHERE id=result_id) OR foundry_private.entity_in_tenant('DELIVERY',result_id,tenant_id);
    WHEN 'ADD_LIBRARY_ITEM' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.library_items WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.library_items i JOIN foundry_product.course_enrollments e ON e.course_id=i.course_id AND e.user_id=i.learner_id WHERE i.id=result_id AND e.institution_id=tenant_id);
    WHEN 'SCHEDULE_STUDY_REVIEW' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.schedule_items WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.schedule_items s JOIN foundry_product.learning_tasks t ON t.id=s.task_id WHERE s.id=result_id AND t.institution_id=tenant_id);
    ELSE RETURN false;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION foundry_private.idempotency_result_in_tenant(text,uuid,uuid) FROM PUBLIC;
--> statement-breakpoint

-- Maintenance changes only future delivery eligibility. Historical versions and
-- RuntimeDelivery records remain unchanged.
CREATE OR REPLACE FUNCTION foundry_product.assert_component_active_version() RETURNS trigger AS $$
DECLARE governance_command text:=current_setting('foundry.governance_command',true); target_component uuid; target_status text; candidate_lineage_valid boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    IF governance_command<>'component_candidate' OR NEW.status<>'CANDIDATE' OR NEW.active_version_id IS NOT NULL THEN RAISE EXCEPTION 'Components must begin as governed Candidates without an active version' USING ERRCODE='23514'; END IF;
    SELECT EXISTS (SELECT 1 FROM foundry_product.diagnostic_observations o JOIN foundry_product.learner_attempts a ON a.id=o.attempt_id JOIN foundry_product.learning_tasks t ON t.id=a.task_id JOIN foundry_product.courses course_scope ON course_scope.id=t.course_id JOIN foundry_product.subjects s ON s.id=course_scope.subject_id JOIN foundry_product.capabilities cap ON cap.id=a.capability_id JOIN foundry_product.teacher_reviews r ON r.observation_id=o.id WHERE o.id=NULLIF(NEW.source_signal->>'observationId','')::uuid AND r.id=NULLIF(NEW.source_signal->>'reviewId','')::uuid AND t.institution_id=NEW.institution_id AND t.course_id=NEW.course_id AND cap.id=NEW.capability_id AND cap.active_version_id=o.capability_version_id AND s.reference_pack_key=NEW.reference_pack_key AND cap.reference_pack_key=NEW.reference_pack_key AND o.observation_source='CAPABILITY' AND o.failure_code=NEW.failure_code AND o.superseded_by_id IS NULL AND r.decision IN ('ACCEPT','CORRECT','SUPPLEMENT') AND r.actor_provenance->>'userId'=r.teacher_id::text AND r.actor_provenance->>'institutionId'=NEW.institution_id::text AND length(COALESCE(r.actor_provenance->>'sessionId',''))>0 AND COALESCE(r.actor_provenance->>'authMethod','') NOT LIKE 'migrated-%') INTO candidate_lineage_valid;
    IF NOT candidate_lineage_valid THEN RAISE EXCEPTION 'Component Candidate requires current governed signal and authenticated Review lineage' USING ERRCODE='23514'; END IF; RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF governance_command NOT IN ('component_publication','component_rollback','component_maintenance') THEN RAISE EXCEPTION 'Component lifecycle status requires a governed publication, rollback, or maintenance command' USING ERRCODE='23514'; END IF;
    IF governance_command='component_maintenance' AND NOT ((OLD.status='PUBLISHED' AND NEW.status IN ('DEPRECATED','RETIRED','EMERGENCY_DISABLED')) OR (OLD.status='DEPRECATED' AND NEW.status IN ('RETIRED','EMERGENCY_DISABLED'))) THEN RAISE EXCEPTION 'Illegal Component maintenance lifecycle transition: % -> %',OLD.status,NEW.status USING ERRCODE='23514'; END IF;
    IF governance_command='component_rollback' AND NEW.status<>'PUBLISHED' THEN RAISE EXCEPTION 'Rollback must restore PUBLISHED future-delivery status' USING ERRCODE='23514'; END IF;
    IF governance_command='component_publication' AND NEW.status NOT IN ('PUBLISHED','REJECTED') THEN RAISE EXCEPTION 'Publication must create a PUBLISHED or REJECTED status' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.active_version_id IS DISTINCT FROM OLD.active_version_id THEN
    IF governance_command NOT IN ('component_publication','component_rollback') THEN RAISE EXCEPTION 'Component active version requires a governed publication or rollback command' USING ERRCODE='23514'; END IF;
    SELECT v.component_id,v.status INTO target_component,target_status FROM foundry_product.component_versions v WHERE v.id=NEW.active_version_id;
    IF target_component IS NULL OR target_component<>NEW.id OR target_status<>'PUBLISHED' THEN RAISE EXCEPTION 'Component active version must be a published version from the same Component' USING ERRCODE='23514'; END IF;
  END IF;
  IF OLD.active_version_id IS NOT NULL AND NEW.title IS DISTINCT FROM OLD.title AND governance_command NOT IN ('component_publication','component_rollback') THEN RAISE EXCEPTION 'Active Component presentation changes only with publication or rollback' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Rollback boundary: revert application use first. Export new Class A records
-- before operator-reviewed removal of additive triggers, links, grants and tables.
