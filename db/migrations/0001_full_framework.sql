CREATE TABLE "foundry_product"."component_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"component_version_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"delivered_by" uuid NOT NULL,
	"audience" text NOT NULL,
	"support_snapshot" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "component_deliveries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "component_delivery_audience_ck" CHECK ("foundry_product"."component_deliveries"."audience" IN ('LEARNER','TEACHER'))
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."component_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_version_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"evaluator_key" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"system_status" text NOT NULL,
	"system_checks" jsonb NOT NULL,
	"source_observation_ids" uuid[] NOT NULL,
	"source_review_ids" uuid[] NOT NULL,
	"source_attempt_ids" uuid[] NOT NULL,
	"fixture_execution" jsonb NOT NULL,
	"evidence_checks" jsonb NOT NULL,
	"provider_checks" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "component_evaluation_status_ck" CHECK ("foundry_product"."component_evaluations"."system_status" IN ('PASSED','BLOCKED'))
);
--> statement-breakpoint
ALTER TABLE "foundry_product"."component_versions" ADD COLUMN "successor_of_version_id" uuid;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_versions" ADD COLUMN "source_observation_ids" uuid[];--> statement-breakpoint
ALTER TABLE "foundry_product"."component_versions" ADD COLUMN "source_review_ids" uuid[];--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "capability_id" uuid;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "reference_pack_key" text;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "foundry_product"."publication_decisions" ADD COLUMN "evaluation_id" uuid;--> statement-breakpoint
ALTER TABLE "foundry_product"."publication_decisions" ADD COLUMN "previous_active_version_id" uuid;--> statement-breakpoint
ALTER TABLE "foundry_product"."publication_decisions" ADD COLUMN "human_rubric" jsonb;--> statement-breakpoint
ALTER TABLE "foundry_product"."publication_decisions" ADD COLUMN "workflow_thread_id" text;--> statement-breakpoint
UPDATE "foundry_product"."components" c
SET "course_id" = t."course_id",
    "capability_id" = a."capability_id",
    "reference_pack_key" = s."reference_pack_key",
    "failure_code" = o."failure_code"
FROM "foundry_product"."diagnostic_observations" o
JOIN "foundry_product"."learner_attempts" a ON a."id" = o."attempt_id"
JOIN "foundry_product"."learning_tasks" t ON t."id" = a."task_id"
JOIN "foundry_product"."courses" course_scope ON course_scope."id" = t."course_id"
JOIN "foundry_product"."subjects" s ON s."id" = course_scope."subject_id"
JOIN "foundry_product"."capabilities" cap ON cap."id" = a."capability_id"
WHERE o."id" = NULLIF(c."source_signal"->>'observationId', '')::uuid
  AND o."observation_source" = 'CAPABILITY'
  AND o."failure_code" IS NOT NULL
  AND o."superseded_by_id" IS NULL
  AND cap."reference_pack_key" = s."reference_pack_key"
  AND cap."active_version_id" = o."capability_version_id";
--> statement-breakpoint
UPDATE "foundry_product"."component_versions" v
SET "source_observation_ids" = ARRAY[(c."source_signal"->>'observationId')::uuid],
    "source_review_ids" = ARRAY[current_review."id"]
FROM "foundry_product"."components" c
JOIN LATERAL (
  SELECT r."id"
  FROM "foundry_product"."teacher_reviews" r
  WHERE r."observation_id" = NULLIF(c."source_signal"->>'observationId', '')::uuid
    AND r."decision" IN ('ACCEPT','CORRECT','SUPPLEMENT')
    AND r."actor_provenance"->>'userId' = r."teacher_id"::text
    AND r."actor_provenance"->>'institutionId' = c."institution_id"::text
    AND length(COALESCE(r."actor_provenance"->>'sessionId', '')) > 0
    AND COALESCE(r."actor_provenance"->>'authMethod', '') NOT LIKE 'migrated-%'
  ORDER BY r."created_at" DESC, r."id" DESC
  LIMIT 1
) current_review ON true
WHERE c."id" = v."component_id"
  AND c."course_id" IS NOT NULL
  AND NULLIF(c."source_signal"->>'observationId', '') IS NOT NULL;
--> statement-breakpoint
INSERT INTO "foundry_product"."governance_events" ("institution_id", "actor_user_id", "entity_type", "entity_id", "action", "payload")
SELECT c."institution_id", c."created_by", 'COMPONENT', c."id", 'PRE_EVAL_DRAFT_QUARANTINED',
       jsonb_build_object(
         'reason', 'Existing pre-Eval Draft had no governed CAPABILITY failure lineage and cannot receive a fabricated binding.',
         'component', to_jsonb(c),
         'versions', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v."created_at") FROM "foundry_product"."component_versions" v WHERE v."component_id" = c."id"), '[]'::jsonb)
       )
FROM "foundry_product"."components" c
WHERE c."course_id" IS NULL OR c."capability_id" IS NULL OR c."reference_pack_key" IS NULL
   OR EXISTS (
     SELECT 1 FROM "foundry_product"."component_versions" v
     WHERE v."component_id" = c."id"
       AND (v."source_observation_ids" IS NULL OR v."source_review_ids" IS NULL)
   );
--> statement-breakpoint
DELETE FROM "foundry_product"."components" c
WHERE c."course_id" IS NULL OR c."capability_id" IS NULL OR c."reference_pack_key" IS NULL
   OR EXISTS (
     SELECT 1 FROM "foundry_product"."component_versions" v
     WHERE v."component_id" = c."id"
       AND (v."source_observation_ids" IS NULL OR v."source_review_ids" IS NULL)
   );
--> statement-breakpoint
ALTER TABLE "foundry_product"."component_versions" ALTER COLUMN "source_observation_ids" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_versions" ALTER COLUMN "source_review_ids" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ALTER COLUMN "course_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ALTER COLUMN "capability_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ALTER COLUMN "reference_pack_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_deliveries" ADD CONSTRAINT "component_deliveries_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_deliveries" ADD CONSTRAINT "component_deliveries_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_deliveries" ADD CONSTRAINT "component_deliveries_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_deliveries" ADD CONSTRAINT "component_deliveries_episode_id_learning_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_deliveries" ADD CONSTRAINT "component_deliveries_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "foundry_product"."components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_deliveries" ADD CONSTRAINT "component_deliveries_component_version_id_component_versions_id_fk" FOREIGN KEY ("component_version_id") REFERENCES "foundry_product"."component_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_deliveries" ADD CONSTRAINT "component_deliveries_observation_id_diagnostic_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "foundry_product"."diagnostic_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_deliveries" ADD CONSTRAINT "component_deliveries_review_id_teacher_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "foundry_product"."teacher_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_deliveries" ADD CONSTRAINT "component_deliveries_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_evaluations" ADD CONSTRAINT "component_evaluations_component_version_id_component_versions_id_fk" FOREIGN KEY ("component_version_id") REFERENCES "foundry_product"."component_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_evaluations" ADD CONSTRAINT "component_evaluations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_evaluations" ADD CONSTRAINT "component_evaluations_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_evaluations" ADD CONSTRAINT "component_evaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "component_deliveries_task_idx" ON "foundry_product"."component_deliveries" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "component_deliveries_component_idx" ON "foundry_product"."component_deliveries" USING btree ("component_id","component_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "component_evaluations_version_input_hash_uq" ON "foundry_product"."component_evaluations" USING btree ("component_version_id","input_hash");--> statement-breakpoint
CREATE INDEX "component_evaluations_scope_idx" ON "foundry_product"."component_evaluations" USING btree ("institution_id","course_id","created_at");--> statement-breakpoint
ALTER TABLE "foundry_product"."component_versions" ADD CONSTRAINT "component_versions_successor_of_version_id_component_versions_id_fk" FOREIGN KEY ("successor_of_version_id") REFERENCES "foundry_product"."component_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD CONSTRAINT "components_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD CONSTRAINT "components_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "foundry_product"."capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."publication_decisions" ADD CONSTRAINT "publication_decisions_evaluation_id_component_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "foundry_product"."component_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."publication_decisions" ADD CONSTRAINT "publication_decisions_previous_active_version_id_component_versions_id_fk" FOREIGN KEY ("previous_active_version_id") REFERENCES "foundry_product"."component_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publication_terminal_version_uq" ON "foundry_product"."publication_decisions" USING btree ("component_version_id") WHERE "foundry_product"."publication_decisions"."action" IN ('APPROVE','REJECT');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "publication_fail_closed_guard" ON "foundry_product"."publication_decisions";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "foundry_product"."reject_component_publication"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "foundry_product"."assert_component_evaluation_lineage"() RETURNS trigger AS $$
DECLARE
  component_institution uuid;
  component_course uuid;
BEGIN
  SELECT c."institution_id", c."course_id" INTO component_institution, component_course
  FROM "foundry_product"."component_versions" v
  JOIN "foundry_product"."components" c ON c."id" = v."component_id"
  WHERE v."id" = NEW."component_version_id";
  IF component_institution IS NULL OR component_institution <> NEW."institution_id" OR component_course <> NEW."course_id" THEN
    RAISE EXCEPTION 'Component evaluation scope does not match its version' USING ERRCODE = '23514';
  END IF;
  IF cardinality(NEW."source_observation_ids") < 1 OR cardinality(NEW."source_review_ids") < 1 OR cardinality(NEW."source_attempt_ids") < 1 THEN
    RAISE EXCEPTION 'Component evaluation must preserve source lineage' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "component_evaluation_lineage_guard" BEFORE INSERT ON "foundry_product"."component_evaluations" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_component_evaluation_lineage"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "foundry_product"."protect_component_evaluation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Component evaluations are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "component_evaluation_immutable_guard" BEFORE UPDATE OR DELETE ON "foundry_product"."component_evaluations" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."protect_component_evaluation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "foundry_product"."protect_component_version"() RETURNS trigger AS $$
DECLARE
  governance_command text := current_setting('foundry.governance_command', true);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' OR governance_command NOT IN ('component_candidate', 'component_successor') THEN
      RAISE EXCEPTION 'Component versions must begin as governed Drafts' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('PUBLISHED', 'REJECTED') THEN
      RAISE EXCEPTION 'Terminal Component versions are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('PUBLISHED', 'REJECTED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal Component versions are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" <> 'DRAFT' OR NEW."status" NOT IN ('PUBLISHED', 'REJECTED') OR governance_command <> 'component_publication' THEN
      RAISE EXCEPTION 'Terminal Component status requires the governed publication command' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "component_version_immutable_guard" BEFORE INSERT OR UPDATE OR DELETE ON "foundry_product"."component_versions" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."protect_component_version"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "foundry_product"."assert_component_active_version"() RETURNS trigger AS $$
DECLARE
  governance_command text := current_setting('foundry.governance_command', true);
  target_component uuid;
  target_status text;
  candidate_lineage_valid boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF governance_command <> 'component_candidate' OR NEW."status" <> 'CANDIDATE' OR NEW."active_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Components must begin as governed Candidates without an active version' USING ERRCODE = '23514';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM "foundry_product"."diagnostic_observations" o
      JOIN "foundry_product"."learner_attempts" a ON a."id" = o."attempt_id"
      JOIN "foundry_product"."learning_tasks" t ON t."id" = a."task_id"
      JOIN "foundry_product"."courses" course_scope ON course_scope."id" = t."course_id"
      JOIN "foundry_product"."subjects" s ON s."id" = course_scope."subject_id"
      JOIN "foundry_product"."capabilities" cap ON cap."id" = a."capability_id"
      JOIN "foundry_product"."teacher_reviews" r ON r."observation_id" = o."id"
      WHERE o."id" = NULLIF(NEW."source_signal"->>'observationId', '')::uuid
        AND r."id" = NULLIF(NEW."source_signal"->>'reviewId', '')::uuid
        AND t."institution_id" = NEW."institution_id" AND t."course_id" = NEW."course_id"
        AND cap."id" = NEW."capability_id" AND cap."active_version_id" = o."capability_version_id"
        AND s."reference_pack_key" = NEW."reference_pack_key" AND cap."reference_pack_key" = NEW."reference_pack_key"
        AND o."observation_source" = 'CAPABILITY' AND o."failure_code" = NEW."failure_code" AND o."superseded_by_id" IS NULL
        AND r."decision" IN ('ACCEPT','CORRECT','SUPPLEMENT')
        AND r."actor_provenance"->>'userId' = r."teacher_id"::text
        AND r."actor_provenance"->>'institutionId' = NEW."institution_id"::text
        AND length(COALESCE(r."actor_provenance"->>'sessionId', '')) > 0
        AND COALESCE(r."actor_provenance"->>'authMethod', '') NOT LIKE 'migrated-%'
    ) INTO candidate_lineage_valid;
    IF NOT candidate_lineage_valid THEN
      RAISE EXCEPTION 'Component Candidate requires current governed signal and authenticated Review lineage' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND governance_command NOT IN ('component_publication', 'component_rollback') THEN
    RAISE EXCEPTION 'Component lifecycle status requires a governed publication or rollback command' USING ERRCODE = '23514';
  END IF;
  IF NEW."active_version_id" IS DISTINCT FROM OLD."active_version_id" THEN
    IF governance_command NOT IN ('component_publication', 'component_rollback') THEN
      RAISE EXCEPTION 'Component active version requires a governed publication or rollback command' USING ERRCODE = '23514';
    END IF;
    SELECT v."component_id", v."status" INTO target_component, target_status
    FROM "foundry_product"."component_versions" v WHERE v."id" = NEW."active_version_id";
    IF target_component IS NULL OR target_component <> NEW."id" OR target_status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'Component active version must be a published version from the same Component' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD."active_version_id" IS NOT NULL AND NEW."title" IS DISTINCT FROM OLD."title"
     AND governance_command NOT IN ('component_publication', 'component_rollback') THEN
    RAISE EXCEPTION 'Active Component presentation changes only with publication or rollback' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "component_active_version_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."components" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_component_active_version"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "foundry_product"."assert_publication_decision"() RETURNS trigger AS $$
DECLARE
  governance_command text := current_setting('foundry.governance_command', true);
  version_component uuid;
  version_status text;
  component_institution uuid;
  component_active uuid;
  evaluation_status text;
  evaluation_hash text;
  version_hash text;
  workflow_matches boolean := false;
  evaluation_lineage_current boolean := false;
BEGIN
  IF length(btrim(NEW."rationale")) < 5 THEN
    RAISE EXCEPTION 'Publication rationale is required' USING ERRCODE = '23514';
  END IF;
  SELECT v."component_id", v."status", v."content_hash", c."institution_id", c."active_version_id"
    INTO version_component, version_status, version_hash, component_institution, component_active
  FROM "foundry_product"."component_versions" v
  JOIN "foundry_product"."components" c ON c."id" = v."component_id"
  WHERE v."id" = NEW."component_version_id";
  IF NEW."action" IN ('APPROVE', 'REJECT') THEN
    IF governance_command <> 'component_publication' OR version_status <> 'DRAFT'
       OR NEW."evaluation_id" IS NULL OR NEW."workflow_thread_id" IS NULL OR NEW."human_rubric" IS NULL THEN
      RAISE EXCEPTION 'Publication decision requires a current evaluated Draft and expert workflow' USING ERRCODE = '23514';
    END IF;
    SELECT e."system_status", e."content_hash" INTO evaluation_status, evaluation_hash
    FROM "foundry_product"."component_evaluations" e
    WHERE e."id" = NEW."evaluation_id" AND e."component_version_id" = NEW."component_version_id";
    SELECT count(DISTINCT o."id") = cardinality(e."source_observation_ids")
       AND count(DISTINCT r."id") = cardinality(e."source_review_ids")
       AND count(DISTINCT a."id") = cardinality(e."source_attempt_ids")
    INTO evaluation_lineage_current
    FROM "foundry_product"."component_evaluations" e
    JOIN "foundry_product"."diagnostic_observations" o ON o."id" = ANY(e."source_observation_ids") AND o."superseded_by_id" IS NULL
    JOIN "foundry_product"."learner_attempts" a ON a."id" = o."attempt_id" AND a."id" = ANY(e."source_attempt_ids")
    JOIN "foundry_product"."teacher_reviews" r ON r."observation_id" = o."id" AND r."id" = ANY(e."source_review_ids")
    WHERE e."id" = NEW."evaluation_id"
      AND r."decision" IN ('ACCEPT','CORRECT','SUPPLEMENT')
      AND r."actor_provenance"->>'userId' = r."teacher_id"::text
      AND r."actor_provenance"->>'institutionId' = component_institution::text
      AND length(COALESCE(r."actor_provenance"->>'sessionId', '')) > 0
      AND COALESCE(r."actor_provenance"->>'authMethod', '') NOT LIKE 'migrated-%'
    GROUP BY e."source_observation_ids", e."source_review_ids", e."source_attempt_ids";
    SELECT EXISTS (
      SELECT 1 FROM "foundry_operational"."workflow_runs" w
      WHERE w."thread_id" = NEW."workflow_thread_id"
        AND w."institution_id" = component_institution
        AND w."workflow_kind" = 'COMPONENT_LIFECYCLE'
        AND w."status" = 'RESUMING'
        AND w."interrupt_type" = 'EXPERT_PUBLICATION_REVIEW_REQUIRED'
        AND w."interrupt_version" >= 1
        AND w."product_links"->>'componentId' = version_component::text
        AND w."product_links"->>'componentVersionId' = NEW."component_version_id"::text
        AND w."product_links"->>'evaluationId' = NEW."evaluation_id"::text
    ) INTO workflow_matches;
    IF evaluation_status IS NULL OR evaluation_hash <> version_hash OR NOT COALESCE(evaluation_lineage_current, false) OR NOT workflow_matches THEN
      RAISE EXCEPTION 'Publication decision evaluation or workflow lineage is stale' USING ERRCODE = '23514';
    END IF;
    IF NEW."human_rubric"->>'domainCorrectness' NOT IN ('PASS','FAIL')
       OR NEW."human_rubric"->>'pedagogy' NOT IN ('PASS','FAIL')
       OR NEW."human_rubric"->>'safety' NOT IN ('PASS','FAIL')
       OR NEW."human_rubric"->>'reuseReadiness' NOT IN ('PASS','FAIL')
       OR length(btrim(COALESCE(NEW."human_rubric"->>'notes', ''))) < 5 THEN
      RAISE EXCEPTION 'Publication decision requires a complete expert rubric' USING ERRCODE = '23514';
    END IF;
    IF NEW."action" = 'APPROVE' AND (
      evaluation_status <> 'PASSED'
      OR NEW."human_rubric"->>'domainCorrectness' <> 'PASS'
      OR NEW."human_rubric"->>'pedagogy' <> 'PASS'
      OR NEW."human_rubric"->>'safety' <> 'PASS'
      OR NEW."human_rubric"->>'reuseReadiness' <> 'PASS'
    ) THEN
      RAISE EXCEPTION 'Approval requires passed system gates and expert rubric' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."action" = 'ROLLBACK' THEN
    IF governance_command <> 'component_rollback' OR version_status <> 'PUBLISHED'
       OR NEW."previous_active_version_id" IS NULL OR component_active <> NEW."previous_active_version_id"
       OR NEW."evaluation_id" IS NOT NULL OR NEW."workflow_thread_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Rollback requires the current active version and an already-published target' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "publication_decision_governance_guard" BEFORE INSERT ON "foundry_product"."publication_decisions" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_publication_decision"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "foundry_product"."protect_publication_decision"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Publication decisions are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "publication_decision_immutable_guard" BEFORE UPDATE OR DELETE ON "foundry_product"."publication_decisions" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."protect_publication_decision"();
