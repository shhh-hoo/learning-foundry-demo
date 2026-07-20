-- CAP-04: promote one current READY ActivityPlanProposal into one immutable
-- Class-A ActivityPlan and record one bounded RuntimeDelivery, ordered
-- LearningEvents and one runtime-linked LearnerAttempt.
CREATE TABLE "foundry_product"."activity_plans" (
  "id" uuid PRIMARY KEY NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade,
  "episode_id" uuid NOT NULL REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade,
  "activity_plan_proposal_id" uuid NOT NULL REFERENCES "foundry_product"."activity_plan_proposals"("id"),
  "context_compilation_id" uuid NOT NULL REFERENCES "foundry_product"."context_compilations"("id"),
  "diagnostic_observation_id" uuid NOT NULL REFERENCES "foundry_product"."diagnostic_observations"("id"),
  "capability_resolution_id" uuid NOT NULL REFERENCES "foundry_product"."capability_resolutions"("id"),
  "capability_id" uuid NOT NULL REFERENCES "foundry_product"."capabilities"("id"),
  "capability_version_id" uuid NOT NULL REFERENCES "foundry_product"."capability_versions"("id"),
  "capability_version_content_hash" text NOT NULL,
  "runtime_contract_hash" text NOT NULL,
  "implementation_key" text NOT NULL,
  "runtime_kind" text NOT NULL,
  "stage_order" integer NOT NULL,
  "stage_snapshot" jsonb NOT NULL,
  "runtime_contract" jsonb NOT NULL,
  "evidence_provenance" jsonb NOT NULL,
  "input_hash" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "activity_plan_exact_stage_ck" CHECK ("stage_order"=1 AND length("capability_version_content_hash")>7 AND length("runtime_contract_hash")>7 AND length("input_hash")>7),
  CONSTRAINT "activity_plan_runtime_json_ck" CHECK (jsonb_typeof("stage_snapshot")='object' AND jsonb_typeof("runtime_contract")='object' AND jsonb_typeof("evidence_provenance")='object')
);
CREATE UNIQUE INDEX "activity_plan_proposal_uq" ON "foundry_product"."activity_plans" ("activity_plan_proposal_id");
CREATE UNIQUE INDEX "activity_plan_input_hash_uq" ON "foundry_product"."activity_plans" ("institution_id","input_hash");
CREATE INDEX "activity_plan_task_idx" ON "foundry_product"."activity_plans" ("task_id","episode_id","created_at");
--> statement-breakpoint

CREATE TABLE "foundry_product"."runtime_deliveries" (
  "id" uuid PRIMARY KEY NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade,
  "episode_id" uuid NOT NULL REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade,
  "learner_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "activity_plan_id" uuid NOT NULL REFERENCES "foundry_product"."activity_plans"("id"),
  "capability_id" uuid NOT NULL REFERENCES "foundry_product"."capabilities"("id"),
  "capability_version_id" uuid NOT NULL REFERENCES "foundry_product"."capability_versions"("id"),
  "capability_version_content_hash" text NOT NULL,
  "runtime_contract_hash" text NOT NULL,
  "implementation_key" text NOT NULL,
  "runtime_kind" text NOT NULL,
  "request_hash" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text NOT NULL,
  "deadline_ms" integer NOT NULL,
  "normalized_output" jsonb,
  "normalized_error" jsonb,
  "output_hash" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  CONSTRAINT "runtime_delivery_status_ck" CHECK ("status" IN ('PENDING','RUNNING','SUCCEEDED','FAILED','TIMED_OUT','CANCELLED')),
  CONSTRAINT "runtime_delivery_deadline_ck" CHECK ("deadline_ms">0 AND "deadline_ms"<=120000),
  CONSTRAINT "runtime_delivery_terminal_ck" CHECK (
    ("status" IN ('PENDING','RUNNING') AND "finished_at" IS NULL AND "normalized_output" IS NULL AND "normalized_error" IS NULL AND "output_hash" IS NULL)
    OR ("status"='SUCCEEDED' AND "finished_at" IS NOT NULL AND "normalized_output" IS NOT NULL AND "normalized_error" IS NULL AND "output_hash" IS NOT NULL)
    OR ("status" IN ('FAILED','TIMED_OUT','CANCELLED') AND "finished_at" IS NOT NULL AND "normalized_output" IS NULL AND "normalized_error" IS NOT NULL AND "output_hash" IS NULL)
  )
);
CREATE UNIQUE INDEX "runtime_delivery_activity_plan_uq" ON "foundry_product"."runtime_deliveries" ("activity_plan_id");
CREATE UNIQUE INDEX "runtime_delivery_replay_uq" ON "foundry_product"."runtime_deliveries" ("institution_id","idempotency_key");
CREATE INDEX "runtime_delivery_task_idx" ON "foundry_product"."runtime_deliveries" ("task_id","episode_id","started_at");
--> statement-breakpoint

ALTER TABLE "foundry_product"."learner_attempts" ADD COLUMN "capability_version_id" uuid REFERENCES "foundry_product"."capability_versions"("id");
ALTER TABLE "foundry_product"."learner_attempts" ADD COLUMN "activity_plan_id" uuid REFERENCES "foundry_product"."activity_plans"("id");
ALTER TABLE "foundry_product"."learner_attempts" ADD COLUMN "runtime_delivery_id" uuid REFERENCES "foundry_product"."runtime_deliveries"("id");
ALTER TABLE "foundry_product"."learner_attempts" ADD COLUMN "modality" text;
ALTER TABLE "foundry_product"."learner_attempts" ADD COLUMN "content_hash" text;
ALTER TABLE "foundry_product"."learner_attempts" ADD COLUMN "assistance_provenance" jsonb;
ALTER TABLE "foundry_product"."learner_attempts" ADD CONSTRAINT "learner_attempt_runtime_lineage_ck" CHECK (
  ("runtime_delivery_id" IS NULL AND "activity_plan_id" IS NULL AND "capability_version_id" IS NULL AND "modality" IS NULL AND "content_hash" IS NULL AND "assistance_provenance" IS NULL)
  OR ("runtime_delivery_id" IS NOT NULL AND "activity_plan_id" IS NOT NULL AND "capability_version_id" IS NOT NULL
    AND length(btrim("modality"))>0 AND length("content_hash")>7
    AND jsonb_typeof("assistance_provenance")='object' AND "assistance_provenance"<>'{}'::jsonb)
);
CREATE UNIQUE INDEX "learner_attempt_runtime_delivery_uq" ON "foundry_product"."learner_attempts" ("runtime_delivery_id") WHERE "runtime_delivery_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "foundry_product"."learning_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade,
  "episode_id" uuid NOT NULL REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade,
  "activity_plan_id" uuid NOT NULL REFERENCES "foundry_product"."activity_plans"("id"),
  "runtime_delivery_id" uuid NOT NULL REFERENCES "foundry_product"."runtime_deliveries"("id") ON DELETE cascade,
  "sequence" integer NOT NULL,
  "event_key" text NOT NULL,
  "event_type" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_user_id" uuid REFERENCES "foundry_product"."users"("id"),
  "payload" jsonb NOT NULL,
  "evidence_refs" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "learning_event_sequence_ck" CHECK ("sequence" BETWEEN 1 AND 5),
  CONSTRAINT "learning_event_actor_ck" CHECK (("actor_type"='SYSTEM' AND "actor_user_id" IS NULL) OR ("actor_type"='LEARNER' AND "actor_user_id" IS NOT NULL)),
  CONSTRAINT "learning_event_json_ck" CHECK (jsonb_typeof("payload")='object' AND jsonb_typeof("evidence_refs")='array' AND length(btrim("event_key"))>0 AND length(btrim("event_type"))>0)
);
CREATE UNIQUE INDEX "learning_event_delivery_sequence_uq" ON "foundry_product"."learning_events" ("runtime_delivery_id","sequence");
CREATE UNIQUE INDEX "learning_event_delivery_key_uq" ON "foundry_product"."learning_events" ("runtime_delivery_id","event_key");
CREATE INDEX "learning_event_task_idx" ON "foundry_product"."learning_events" ("task_id","episode_id","created_at");
--> statement-breakpoint

INSERT INTO "foundry_private"."table_authority_catalog" ("schema_name","table_name","classification","policy_required") VALUES
('foundry_product','activity_plans','TENANT_DIRECT_CLASS_A',true),
('foundry_product','runtime_deliveries','TENANT_DIRECT_CLASS_A',true),
('foundry_product','learning_events','TENANT_DIRECT_CLASS_A',true);
INSERT INTO "foundry_private"."writable_lineage_catalog" ("schema_name","table_name","writable_roles","tenant_references","enforcement") VALUES
('foundry_product','activity_plans',ARRAY['foundry_product_runtime'],'institution; course; Task/Episode; READY proposal; current Context/Diagnosis/resolution; exact CapabilityVersion; creator','FORCED_RLS + _authority_tenant_lineage_guard (cap04_activity_plan_guard)'),
('foundry_product','runtime_deliveries',ARRAY['foundry_product_runtime'],'institution; course; Task/Episode; learner; immutable ActivityPlan; exact CapabilityVersion','FORCED_RLS + _authority_tenant_lineage_guard (cap04_runtime_delivery_guard)'),
('foundry_product','learning_events',ARRAY['foundry_product_runtime'],'institution; course; Task/Episode; ActivityPlan; RuntimeDelivery; actor','FORCED_RLS + _authority_tenant_lineage_guard (cap04_learning_event_guard)');

REVOKE ALL ON "foundry_product"."activity_plans", "foundry_product"."runtime_deliveries", "foundry_product"."learning_events" FROM PUBLIC;
GRANT SELECT, INSERT ON "foundry_product"."activity_plans", "foundry_product"."learning_events" TO foundry_product_runtime;
GRANT SELECT, INSERT, UPDATE ON "foundry_product"."runtime_deliveries" TO foundry_product_runtime;

ALTER TABLE "foundry_product"."activity_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."activity_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."activity_plans" TO foundry_product_runtime
  USING ("institution_id"="foundry_private"."current_institution_id"())
  WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."runtime_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."runtime_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."runtime_deliveries" TO foundry_product_runtime
  USING ("institution_id"="foundry_private"."current_institution_id"())
  WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."learning_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."learning_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."learning_events" TO foundry_product_runtime
  USING ("institution_id"="foundry_private"."current_institution_id"())
  WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap04_activity_plan_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  actor_id uuid := NULLIF(current_setting('foundry.user_id',true),'')::uuid;
  actor_roles text := COALESCE(current_setting('foundry.roles',true),'');
BEGIN
  IF tenant_id IS NOT NULL AND NEW.institution_id<>tenant_id THEN RAISE EXCEPTION 'CAP-04 ActivityPlan tenant mismatch' USING ERRCODE='23514'; END IF;
  IF actor_id IS NOT NULL AND NEW.created_by<>actor_id THEN RAISE EXCEPTION 'CAP-04 ActivityPlan actor mismatch' USING ERRCODE='23514'; END IF;
  IF actor_id IS NOT NULL AND position('LEARNER' in actor_roles)=0 AND position('ADMIN' in actor_roles)=0 THEN RAISE EXCEPTION 'CAP-04 ActivityPlan role denied' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM foundry_product.activity_plan_proposals proposal
    JOIN foundry_product.capability_resolutions resolution ON resolution.id=proposal.capability_resolution_id
    JOIN foundry_product.context_compilations context ON context.id=proposal.context_compilation_id
    JOIN foundry_product.diagnostic_observations observation ON observation.id=proposal.diagnostic_observation_id
    JOIN foundry_product.learner_attempts attempt ON attempt.id=observation.attempt_id
    JOIN foundry_product.capabilities capability ON capability.id=proposal.selected_capability_id
    JOIN foundry_product.capability_versions version ON version.id=proposal.selected_capability_version_id
    WHERE proposal.id=NEW.activity_plan_proposal_id AND proposal.state='READY' AND proposal.resolution_decision='EXISTING'
      AND proposal.institution_id=NEW.institution_id AND proposal.course_id=NEW.course_id
      AND proposal.task_id=NEW.task_id AND proposal.episode_id=NEW.episode_id
      AND proposal.context_compilation_id=NEW.context_compilation_id
      AND proposal.diagnostic_observation_id=NEW.diagnostic_observation_id
      AND proposal.capability_resolution_id=NEW.capability_resolution_id
      AND proposal.selected_capability_id=NEW.capability_id AND proposal.selected_capability_version_id=NEW.capability_version_id
      AND proposal.selected_version_content_hash=NEW.capability_version_content_hash
      AND jsonb_array_length(proposal.stages)=1 AND proposal.stages->0=NEW.stage_snapshot
      AND (proposal.runtime_handoff->>'executable')::boolean
      AND proposal.runtime_handoff->>'capabilityVersionId'=NEW.capability_version_id::text
      AND NOT (proposal.teacher_intervention->>'requiredBeforeRuntime')::boolean
      AND resolution.id=NEW.capability_resolution_id AND resolution.selected_capability_id=NEW.capability_id
      AND resolution.selected_capability_version_id=NEW.capability_version_id AND resolution.decision='EXISTING'
      AND NOT resolution.no_match AND NOT resolution.teacher_escalation
      AND context.id=NEW.context_compilation_id AND context.consumer='CAPABILITY_RESOLUTION'
      AND context.task_id=NEW.task_id AND context.episode_id=NEW.episode_id
      AND observation.id=NEW.diagnostic_observation_id AND observation.superseded_by_id IS NULL
      AND attempt.task_id=NEW.task_id AND attempt.episode_id=NEW.episode_id
      AND capability.id=NEW.capability_id AND capability.active_version_id=NEW.capability_version_id
      AND version.id=NEW.capability_version_id AND version.capability_id=NEW.capability_id AND version.status='ACTIVE'
      AND version.content_hash=NEW.capability_version_content_hash AND version.implementation_key=NEW.implementation_key
      AND COALESCE(version.contract->'resolution',version.contract)->'runtime'=NEW.runtime_contract
      AND COALESCE(version.contract->'resolution',version.contract)->'runtime'->>'kind'=NEW.runtime_kind
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(resolution.candidate_set) candidate
        WHERE candidate->>'capabilityId'=NEW.capability_id::text AND candidate->>'versionId'=NEW.capability_version_id::text
          AND candidate->>'eligibility'='ELIGIBLE' AND jsonb_array_length(candidate->'exclusionReasons')=0
          AND candidate->'contract'=version.contract
      )
      AND NOT EXISTS (
        SELECT 1 FROM foundry_product.activity_plan_proposals newer
        WHERE newer.task_id=proposal.task_id AND newer.episode_id=proposal.episode_id
          AND (newer.created_at,newer.id)>(proposal.created_at,proposal.id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM foundry_product.capability_resolutions newer
        WHERE newer.task_id=resolution.task_id AND newer.episode_id=resolution.episode_id
          AND (newer.created_at,newer.id)>(resolution.created_at,resolution.id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM foundry_product.diagnostic_observations other
        WHERE other.attempt_id=attempt.id AND other.superseded_by_id IS NULL AND other.id<>observation.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(context.selected_items) snapshot
        WHERE snapshot->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND NOT EXISTS (
            SELECT 1 FROM foundry_product.context_items item
            WHERE item.id=(snapshot->>'id')::uuid AND item.state IN ('ACTIVE','PROMOTED')
              AND item.invalidated_at IS NULL AND item.successor_id IS NULL
              AND item.payload=COALESCE(snapshot->'payload','{}'::jsonb)
          )
      )
  ) THEN RAISE EXCEPTION 'CAP-04 ActivityPlan exact READY lineage mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.institution_memberships membership
    JOIN foundry_product.course_enrollments enrollment ON enrollment.user_id=membership.user_id AND enrollment.institution_id=membership.institution_id
    WHERE membership.user_id=NEW.created_by AND membership.institution_id=NEW.institution_id AND enrollment.course_id=NEW.course_id
  ) THEN RAISE EXCEPTION 'CAP-04 ActivityPlan actor scope mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap04_activity_plan_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT ON "foundry_product"."activity_plans"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap04_activity_plan_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap04_activity_plan_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'ActivityPlan is immutable' USING ERRCODE='23514'; END; $$;
REVOKE ALL ON FUNCTION "foundry_private"."cap04_activity_plan_immutable"() FROM PUBLIC;
CREATE TRIGGER "cap04_activity_plan_immutable" BEFORE UPDATE OR DELETE ON "foundry_product"."activity_plans"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap04_activity_plan_immutable"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap04_runtime_delivery_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  actor_id uuid := NULLIF(current_setting('foundry.user_id',true),'')::uuid;
  actor_roles text := COALESCE(current_setting('foundry.roles',true),'');
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RuntimeDelivery cannot be deleted' USING ERRCODE='23514'; END IF;
  IF tenant_id IS NOT NULL AND NEW.institution_id<>tenant_id THEN RAISE EXCEPTION 'RuntimeDelivery tenant mismatch' USING ERRCODE='23514'; END IF;
  IF actor_id IS NOT NULL AND actor_id<>NEW.learner_id AND position('ADMIN' in actor_roles)=0 THEN RAISE EXCEPTION 'RuntimeDelivery actor is not the Task learner' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' THEN RAISE EXCEPTION 'RuntimeDelivery must start PENDING' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM foundry_product.activity_plans plan
      JOIN foundry_product.learning_tasks task ON task.id=plan.task_id
      JOIN foundry_product.learning_episodes episode ON episode.id=plan.episode_id AND episode.task_id=task.id
      WHERE plan.id=NEW.activity_plan_id AND plan.institution_id=NEW.institution_id AND plan.course_id=NEW.course_id
        AND plan.task_id=NEW.task_id AND plan.episode_id=NEW.episode_id AND task.learner_id=NEW.learner_id
        AND plan.capability_id=NEW.capability_id AND plan.capability_version_id=NEW.capability_version_id
        AND plan.capability_version_content_hash=NEW.capability_version_content_hash
        AND plan.runtime_contract_hash=NEW.runtime_contract_hash AND plan.implementation_key=NEW.implementation_key AND plan.runtime_kind=NEW.runtime_kind
    ) THEN RAISE EXCEPTION 'RuntimeDelivery ActivityPlan/exact-version lineage mismatch' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED') THEN RAISE EXCEPTION 'RuntimeDelivery terminal state is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='PENDING' AND NEW.status='RUNNING') OR (OLD.status='RUNNING' AND NEW.status IN ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED'))) THEN
    RAISE EXCEPTION 'RuntimeDelivery transition is invalid' USING ERRCODE='23514';
  END IF;
  IF (OLD.id,OLD.institution_id,OLD.course_id,OLD.task_id,OLD.episode_id,OLD.learner_id,OLD.activity_plan_id,OLD.capability_id,OLD.capability_version_id,
      OLD.capability_version_content_hash,OLD.runtime_contract_hash,OLD.implementation_key,OLD.runtime_kind,OLD.request_hash,OLD.idempotency_key,OLD.deadline_ms,OLD.started_at)
     IS DISTINCT FROM
     (NEW.id,NEW.institution_id,NEW.course_id,NEW.task_id,NEW.episode_id,NEW.learner_id,NEW.activity_plan_id,NEW.capability_id,NEW.capability_version_id,
      NEW.capability_version_content_hash,NEW.runtime_contract_hash,NEW.implementation_key,NEW.runtime_kind,NEW.request_hash,NEW.idempotency_key,NEW.deadline_ms,NEW.started_at)
  THEN RAISE EXCEPTION 'RuntimeDelivery exact lineage is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap04_runtime_delivery_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "foundry_product"."runtime_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap04_runtime_delivery_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap04_runtime_attempt_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor_id uuid := NULLIF(current_setting('foundry.user_id',true),'')::uuid;
  actor_roles text := COALESCE(current_setting('foundry.roles',true),'');
BEGIN
  IF TG_OP<>'INSERT' AND OLD.runtime_delivery_id IS NOT NULL THEN RAISE EXCEPTION 'Runtime-linked LearnerAttempt is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.runtime_delivery_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.runtime_deliveries delivery
    JOIN foundry_product.activity_plans plan ON plan.id=delivery.activity_plan_id
    WHERE delivery.id=NEW.runtime_delivery_id AND delivery.activity_plan_id=NEW.activity_plan_id
      AND delivery.task_id=NEW.task_id AND delivery.episode_id=NEW.episode_id AND delivery.learner_id=NEW.learner_id
      AND delivery.capability_id=NEW.capability_id AND delivery.capability_version_id=NEW.capability_version_id
      AND plan.id=NEW.activity_plan_id
      AND (actor_id IS NULL OR actor_id=delivery.learner_id OR position('ADMIN' in actor_roles)>0)
  ) THEN RAISE EXCEPTION 'Runtime-linked LearnerAttempt lineage mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap04_runtime_attempt_guard"() FROM PUBLIC;
CREATE TRIGGER "_cap04_runtime_attempt_guard" BEFORE INSERT OR UPDATE OR DELETE ON "foundry_product"."learner_attempts"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap04_runtime_attempt_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap04_learning_event_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  actor_id uuid := NULLIF(current_setting('foundry.user_id',true),'')::uuid;
  actor_roles text := COALESCE(current_setting('foundry.roles',true),'');
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'LearningEvent is immutable' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.runtime_deliveries delivery
    WHERE delivery.id=NEW.runtime_delivery_id AND delivery.activity_plan_id=NEW.activity_plan_id
      AND delivery.institution_id=NEW.institution_id AND delivery.course_id=NEW.course_id
      AND delivery.task_id=NEW.task_id AND delivery.episode_id=NEW.episode_id
      AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id=delivery.learner_id)
      AND (tenant_id IS NULL OR tenant_id=delivery.institution_id)
      AND (actor_id IS NULL OR actor_id=delivery.learner_id OR position('ADMIN' in actor_roles)>0)
  ) THEN RAISE EXCEPTION 'LearningEvent delivery/actor lineage mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap04_learning_event_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "foundry_product"."learning_events"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap04_learning_event_guard"();
--> statement-breakpoint

-- Rollback boundary: revert CAP-04 application use, export new runtime rows,
-- then remove only these additive tables/columns, catalog rows and functions.
-- CAP-03 proposals and all earlier Product State remain unchanged.
