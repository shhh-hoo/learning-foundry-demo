-- CAP-05: append-only teacher assignment and bounded Capability intervention.
CREATE TABLE "foundry_product"."teacher_assignments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "learner_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade,
  "teacher_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "status" text DEFAULT 'ASSIGNED' NOT NULL,
  "instructions" text NOT NULL,
  "completion_rule" text NOT NULL,
  "due_at" timestamp with time zone,
  "actor_provenance" jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "teacher_assignment_status_ck" CHECK ("status"='ASSIGNED'),
  CONSTRAINT "teacher_assignment_payload_ck" CHECK (length(btrim("instructions"))>0 AND length(btrim("completion_rule"))>0),
  CONSTRAINT "teacher_assignment_provenance_ck" CHECK (length("actor_provenance"->>'userId')>0 AND length("actor_provenance"->>'institutionId')>0 AND length("actor_provenance"->>'authMethod')>0 AND length("actor_provenance"->>'sessionId')>0 AND length("actor_provenance"->>'authenticatedAt')>0 AND jsonb_typeof("actor_provenance"->'roles')='array' AND "actor_provenance"->'roles' @> '["TEACHER"]'::jsonb AND "actor_provenance"->>'authMethod' NOT LIKE 'migrated-%')
);
CREATE UNIQUE INDEX "teacher_assignment_task_uq" ON "foundry_product"."teacher_assignments" ("task_id");
CREATE UNIQUE INDEX "teacher_assignment_actor_key_uq" ON "foundry_product"."teacher_assignments" ("institution_id","teacher_id","idempotency_key");
CREATE INDEX "teacher_assignment_course_idx" ON "foundry_product"."teacher_assignments" ("institution_id","course_id","created_at");
--> statement-breakpoint

CREATE TABLE "foundry_product"."teacher_interventions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade,
  "episode_id" uuid NOT NULL REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade,
  "runtime_delivery_id" uuid NOT NULL REFERENCES "foundry_product"."runtime_deliveries"("id"),
  "learner_attempt_id" uuid NOT NULL REFERENCES "foundry_product"."learner_attempts"("id"),
  "activity_plan_id" uuid NOT NULL REFERENCES "foundry_product"."activity_plans"("id"),
  "diagnostic_observation_id" uuid NOT NULL REFERENCES "foundry_product"."diagnostic_observations"("id"),
  "context_compilation_id" uuid NOT NULL REFERENCES "foundry_product"."context_compilations"("id"),
  "capability_resolution_id" uuid NOT NULL REFERENCES "foundry_product"."capability_resolutions"("id"),
  "capability_version_id" uuid NOT NULL REFERENCES "foundry_product"."capability_versions"("id"),
  "constraint_capability_id" uuid NOT NULL REFERENCES "foundry_product"."capabilities"("id"),
  "constraint_capability_key_snapshot" text NOT NULL,
  "teacher_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "action_type" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'RECORDED' NOT NULL,
  "target_lineage" jsonb NOT NULL,
  "actor_provenance" jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "teacher_intervention_action_ck" CHECK ("action_type" IN ('REQUIRE_CAPABILITY','EXCLUDE_CAPABILITY')),
  CONSTRAINT "teacher_intervention_status_ck" CHECK ("status"='RECORDED'),
  CONSTRAINT "teacher_intervention_payload_ck" CHECK (length(btrim("reason"))>0 AND length(btrim("constraint_capability_key_snapshot"))>0 AND jsonb_typeof("target_lineage")='object' AND "target_lineage"<>'{}'::jsonb),
  CONSTRAINT "teacher_intervention_provenance_ck" CHECK (length("actor_provenance"->>'userId')>0 AND length("actor_provenance"->>'institutionId')>0 AND length("actor_provenance"->>'authMethod')>0 AND length("actor_provenance"->>'sessionId')>0 AND length("actor_provenance"->>'authenticatedAt')>0 AND jsonb_typeof("actor_provenance"->'roles')='array' AND "actor_provenance"->'roles' @> '["TEACHER"]'::jsonb AND "actor_provenance"->>'authMethod' NOT LIKE 'migrated-%')
);
CREATE INDEX "teacher_intervention_task_idx" ON "foundry_product"."teacher_interventions" ("task_id","episode_id","created_at");
CREATE UNIQUE INDEX "teacher_intervention_actor_key_uq" ON "foundry_product"."teacher_interventions" ("institution_id","teacher_id","idempotency_key");
--> statement-breakpoint

CREATE TABLE "foundry_product"."teacher_capability_constraints" (
  "id" uuid PRIMARY KEY NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade,
  "episode_id" uuid NOT NULL REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade,
  "teacher_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "effect" text NOT NULL,
  "capability_id" uuid NOT NULL REFERENCES "foundry_product"."capabilities"("id"),
  "capability_key_snapshot" text NOT NULL,
  "reason" text NOT NULL,
  "source_assignment_id" uuid REFERENCES "foundry_product"."teacher_assignments"("id"),
  "source_intervention_id" uuid REFERENCES "foundry_product"."teacher_interventions"("id"),
  "supersedes_constraint_id" uuid REFERENCES "foundry_product"."teacher_capability_constraints"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "teacher_constraint_effect_ck" CHECK ("effect" IN ('REQUIRE','EXCLUDE')),
  CONSTRAINT "teacher_constraint_source_ck" CHECK (("source_assignment_id" IS NOT NULL)<>("source_intervention_id" IS NOT NULL)),
  CONSTRAINT "teacher_constraint_payload_ck" CHECK (length(btrim("capability_key_snapshot"))>0 AND length(btrim("reason"))>0 AND ("supersedes_constraint_id" IS NULL OR "supersedes_constraint_id"<>"id"))
);
CREATE INDEX "teacher_constraint_task_idx" ON "foundry_product"."teacher_capability_constraints" ("task_id","episode_id","created_at");
CREATE UNIQUE INDEX "teacher_constraint_one_successor_uq" ON "foundry_product"."teacher_capability_constraints" ("supersedes_constraint_id") WHERE "supersedes_constraint_id" IS NOT NULL;
CREATE UNIQUE INDEX "teacher_constraint_assignment_uq" ON "foundry_product"."teacher_capability_constraints" ("source_assignment_id","effect","capability_id") WHERE "source_assignment_id" IS NOT NULL;
CREATE UNIQUE INDEX "teacher_constraint_intervention_uq" ON "foundry_product"."teacher_capability_constraints" ("source_intervention_id") WHERE "source_intervention_id" IS NOT NULL;
--> statement-breakpoint

INSERT INTO "foundry_private"."table_authority_catalog" ("schema_name","table_name","classification","policy_required") VALUES
('foundry_product','teacher_assignments','TENANT_DIRECT_CLASS_A',true),
('foundry_product','teacher_interventions','TENANT_DIRECT_CLASS_A',true),
('foundry_product','teacher_capability_constraints','TENANT_DIRECT_CLASS_A',true);
INSERT INTO "foundry_private"."writable_lineage_catalog" ("schema_name","table_name","writable_roles","tenant_references","enforcement") VALUES
('foundry_product','teacher_assignments',ARRAY['foundry_product_runtime'],'institution; authorized course teacher; enrolled learner; exact Task; actor/session provenance','FORCED_RLS + CAP-05 lineage guard + immutable'),
('foundry_product','teacher_interventions',ARRAY['foundry_product_runtime'],'institution; authorized course teacher; exact terminal RuntimeDelivery/Attempt/Plan/Diagnosis/Context/Resolution/version; actor/session provenance','FORCED_RLS + CAP-05 lineage guard + immutable'),
('foundry_product','teacher_capability_constraints',ARRAY['foundry_product_runtime'],'institution; Task/Episode; Registry Capability; exact Assignment or Intervention source; optional predecessor','FORCED_RLS + CAP-05 lineage guard + immutable');

REVOKE ALL ON "foundry_product"."teacher_assignments", "foundry_product"."teacher_interventions", "foundry_product"."teacher_capability_constraints" FROM PUBLIC;
GRANT SELECT, INSERT ON "foundry_product"."teacher_assignments", "foundry_product"."teacher_interventions", "foundry_product"."teacher_capability_constraints" TO foundry_product_runtime;

ALTER TABLE "foundry_product"."teacher_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."teacher_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."teacher_assignments" TO foundry_product_runtime USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."teacher_interventions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."teacher_interventions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."teacher_interventions" TO foundry_product_runtime USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."teacher_capability_constraints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."teacher_capability_constraints" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."teacher_capability_constraints" TO foundry_product_runtime USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap05_teacher_actor_ok"(tenant_id uuid, course_id uuid, teacher_id uuid, provenance jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT tenant_id=foundry_private.current_institution_id()
    AND teacher_id=foundry_private.current_user_id()
    AND position('TEACHER' in COALESCE(current_setting('foundry.roles',true),''))>0
    AND provenance->>'institutionId'=tenant_id::text
    AND provenance->>'userId'=teacher_id::text
    AND provenance->>'sessionId'=COALESCE(current_setting('foundry.session_id',true),'')
    AND provenance->'roles' @> '["TEACHER"]'::jsonb
    AND length(provenance->>'authenticatedAt')>0
    AND EXISTS (
      SELECT 1 FROM foundry_product.institution_memberships membership
      JOIN foundry_product.course_enrollments enrollment ON enrollment.institution_id=membership.institution_id AND enrollment.user_id=membership.user_id
      WHERE membership.institution_id=tenant_id AND membership.user_id=teacher_id AND membership.role='TEACHER'
        AND enrollment.course_id=course_id AND enrollment.role='TEACHER'
    )
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap05_teacher_actor_ok"(uuid,uuid,uuid,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "foundry_private"."cap05_assignment_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT foundry_private.cap05_teacher_actor_ok(NEW.institution_id,NEW.course_id,NEW.teacher_id,NEW.actor_provenance) THEN RAISE EXCEPTION 'CAP-05 assignment actor/course denied' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.learning_tasks task
    JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id AND episode.sequence=1
    JOIN foundry_product.course_enrollments enrollment ON enrollment.institution_id=task.institution_id AND enrollment.course_id=task.course_id AND enrollment.user_id=task.learner_id AND enrollment.role='LEARNER'
    JOIN foundry_product.institution_memberships membership ON membership.institution_id=task.institution_id AND membership.user_id=task.learner_id AND membership.role='LEARNER'
    JOIN foundry_product.learner_profiles profile ON profile.id=task.learner_profile_id AND profile.institution_id=task.institution_id AND profile.learner_id=task.learner_id
    WHERE task.id=NEW.task_id AND task.institution_id=NEW.institution_id AND task.course_id=NEW.course_id
      AND task.learner_id=NEW.learner_id AND task.status='OPEN' AND episode.status='ACTIVE'
  ) THEN RAISE EXCEPTION 'CAP-05 assignment Task/learner lineage mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap05_assignment_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT ON "foundry_product"."teacher_assignments" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap05_assignment_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap05_intervention_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT foundry_private.cap05_teacher_actor_ok(NEW.institution_id,NEW.course_id,NEW.teacher_id,NEW.actor_provenance) THEN RAISE EXCEPTION 'CAP-05 intervention actor/course denied' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.runtime_deliveries delivery
    JOIN foundry_product.activity_plans plan ON plan.id=delivery.activity_plan_id
    JOIN foundry_product.learner_attempts attempt ON attempt.runtime_delivery_id=delivery.id
    JOIN foundry_product.diagnostic_observations diagnosis ON diagnosis.id=plan.diagnostic_observation_id
    JOIN foundry_product.context_compilations context ON context.id=plan.context_compilation_id
    JOIN foundry_product.capability_resolutions resolution ON resolution.id=plan.capability_resolution_id
    JOIN foundry_product.learning_tasks task ON task.id=delivery.task_id
    JOIN foundry_product.learning_episodes episode ON episode.id=delivery.episode_id AND episode.task_id=task.id
    WHERE delivery.id=NEW.runtime_delivery_id AND delivery.institution_id=NEW.institution_id AND delivery.course_id=NEW.course_id
      AND delivery.task_id=NEW.task_id AND delivery.episode_id=NEW.episode_id AND delivery.status IN ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED')
      AND plan.id=NEW.activity_plan_id AND attempt.id=NEW.learner_attempt_id AND diagnosis.id=NEW.diagnostic_observation_id
      AND context.id=NEW.context_compilation_id AND resolution.id=NEW.capability_resolution_id
      AND plan.capability_version_id=NEW.capability_version_id AND delivery.capability_version_id=NEW.capability_version_id
      AND NEW.target_lineage->>'taskId'=task.id::text AND NEW.target_lineage->>'episodeId'=episode.id::text
      AND NEW.target_lineage->>'activityPlanId'=plan.id::text AND NEW.target_lineage->>'activityPlanInputHash'=plan.input_hash
      AND NEW.target_lineage->>'runtimeDeliveryId'=delivery.id::text AND NEW.target_lineage->>'runtimeStatus'=delivery.status
      AND NEW.target_lineage->>'runtimeRequestHash'=delivery.request_hash AND NEW.target_lineage->>'learnerAttemptId'=attempt.id::text
      AND NEW.target_lineage->>'diagnosticObservationId'=diagnosis.id::text AND NEW.target_lineage->>'contextCompilationId'=context.id::text
      AND NEW.target_lineage->>'contextSnapshotHash'=context.snapshot_hash AND NEW.target_lineage->>'capabilityResolutionId'=resolution.id::text
      AND NEW.target_lineage->>'deliveredCapabilityVersionId'=delivery.capability_version_id::text
      AND NEW.target_lineage->>'deliveredCapabilityVersionContentHash'=delivery.capability_version_content_hash
      AND NEW.target_lineage->>'runtimeContractHash'=delivery.runtime_contract_hash
      AND task.status='OPEN' AND episode.status='ACTIVE' AND diagnosis.superseded_by_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM foundry_product.runtime_deliveries newer WHERE newer.task_id=delivery.task_id AND newer.episode_id=delivery.episode_id AND (newer.started_at,newer.id)>(delivery.started_at,delivery.id))
  ) THEN RAISE EXCEPTION 'CAP-05 intervention runtime lineage is stale or inconsistent' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.capabilities capability
    JOIN foundry_product.capability_versions version ON version.id=capability.active_version_id AND version.status='ACTIVE'
    JOIN foundry_product.courses course ON course.id=NEW.course_id
    JOIN foundry_product.subjects subject ON subject.id=course.subject_id
    WHERE capability.id=NEW.constraint_capability_id AND capability.key=NEW.constraint_capability_key_snapshot
      AND capability.reference_pack_key=subject.reference_pack_key
  ) THEN RAISE EXCEPTION 'CAP-05 intervention Capability is unavailable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap05_intervention_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT ON "foundry_product"."teacher_interventions" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap05_intervention_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap05_constraint_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source_action text; source_provenance jsonb; source_reason text; source_capability_key text;
BEGIN
  IF NEW.institution_id<>foundry_private.current_institution_id() OR NEW.teacher_id<>foundry_private.current_user_id() THEN RAISE EXCEPTION 'CAP-05 constraint actor/tenant denied' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM foundry_product.learning_tasks task JOIN foundry_product.learning_episodes episode ON episode.id=NEW.episode_id AND episode.task_id=task.id WHERE task.id=NEW.task_id AND task.institution_id=NEW.institution_id AND task.course_id=NEW.course_id) THEN RAISE EXCEPTION 'CAP-05 constraint Task/Episode mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM foundry_product.capabilities capability JOIN foundry_product.capability_versions version ON version.id=capability.active_version_id AND version.status='ACTIVE' JOIN foundry_product.courses course ON course.id=NEW.course_id JOIN foundry_product.subjects subject ON subject.id=course.subject_id WHERE capability.id=NEW.capability_id AND capability.key=NEW.capability_key_snapshot AND capability.reference_pack_key=subject.reference_pack_key) THEN RAISE EXCEPTION 'CAP-05 constraint Capability mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.source_assignment_id IS NOT NULL THEN
    SELECT assignment.actor_provenance,
      (CASE WHEN NEW.effect='REQUIRE' THEN 'Required' ELSE 'Excluded' END)||' by teacher assignment: '||assignment.instructions
      INTO source_provenance, source_reason
    FROM foundry_product.teacher_assignments assignment
    JOIN foundry_product.learning_episodes episode ON episode.task_id=assignment.task_id AND episode.sequence=1 AND episode.id=NEW.episode_id
    WHERE assignment.id=NEW.source_assignment_id AND assignment.institution_id=NEW.institution_id AND assignment.course_id=NEW.course_id AND assignment.task_id=NEW.task_id AND assignment.teacher_id=NEW.teacher_id;
    IF source_provenance IS NULL OR source_reason<>NEW.reason THEN RAISE EXCEPTION 'CAP-05 constraint Assignment source/Episode mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.source_intervention_id IS NOT NULL THEN
    SELECT intervention.action_type, intervention.actor_provenance, intervention.reason, intervention.constraint_capability_key_snapshot
      INTO source_action, source_provenance, source_reason, source_capability_key
      FROM foundry_product.teacher_interventions intervention WHERE intervention.id=NEW.source_intervention_id AND intervention.institution_id=NEW.institution_id AND intervention.course_id=NEW.course_id AND intervention.task_id=NEW.task_id AND intervention.episode_id=NEW.episode_id AND intervention.teacher_id=NEW.teacher_id AND intervention.constraint_capability_id=NEW.capability_id;
    IF source_action IS NULL OR (source_action='REQUIRE_CAPABILITY')<>(NEW.effect='REQUIRE') OR source_reason<>NEW.reason OR source_capability_key<>NEW.capability_key_snapshot THEN RAISE EXCEPTION 'CAP-05 constraint Intervention source mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF source_provenance IS NULL OR NOT foundry_private.cap05_teacher_actor_ok(NEW.institution_id,NEW.course_id,NEW.teacher_id,source_provenance) THEN RAISE EXCEPTION 'CAP-05 constraint current teacher/course authority denied' USING ERRCODE='23514'; END IF;
  IF NEW.supersedes_constraint_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.teacher_capability_constraints prior WHERE prior.id=NEW.supersedes_constraint_id AND prior.institution_id=NEW.institution_id AND prior.course_id=NEW.course_id AND prior.task_id=NEW.task_id AND prior.episode_id=NEW.episode_id AND prior.capability_id=NEW.capability_id) THEN RAISE EXCEPTION 'CAP-05 constraint predecessor mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap05_constraint_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT ON "foundry_product"."teacher_capability_constraints" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap05_constraint_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap05_teacher_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'CAP-05 human governance rows are immutable' USING ERRCODE='23514'; END; $$;
REVOKE ALL ON FUNCTION "foundry_private"."cap05_teacher_immutable"() FROM PUBLIC;
CREATE TRIGGER "cap05_assignment_immutable" BEFORE UPDATE OR DELETE ON "foundry_product"."teacher_assignments" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap05_teacher_immutable"();
CREATE TRIGGER "cap05_intervention_immutable" BEFORE UPDATE OR DELETE ON "foundry_product"."teacher_interventions" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap05_teacher_immutable"();
CREATE TRIGGER "cap05_constraint_immutable" BEFORE UPDATE OR DELETE ON "foundry_product"."teacher_capability_constraints" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap05_teacher_immutable"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."idempotency_result_in_tenant"("command_name" text, "result_id" uuid, "tenant_id" uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF result_id IS NULL THEN RETURN true; END IF;
  CASE command_name
    WHEN 'CREATE_TASK' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learning_tasks WHERE id=result_id) OR foundry_private.entity_in_tenant('TASK',result_id,tenant_id);
    WHEN 'APPEND_CONVERSATION_EVENT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.conversation_events WHERE id=result_id) OR foundry_private.entity_in_tenant('EVENT',result_id,tenant_id);
    WHEN 'CAPTURE_ATTEMPT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learner_attempts WHERE id=result_id) OR foundry_private.entity_in_tenant('ATTEMPT',result_id,tenant_id);
    WHEN 'UPLOAD_IMAGE_ATTEMPT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.file_assets WHERE id=result_id) OR foundry_private.entity_in_tenant('FILE',result_id,tenant_id);
    WHEN 'UPLOAD_LEARNING_MATERIAL' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.file_assets WHERE id=result_id) OR foundry_private.entity_in_tenant('FILE',result_id,tenant_id);
    WHEN 'REVIEW_SOURCE_RIGHTS' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.source_records WHERE id=result_id) OR foundry_private.entity_in_tenant('SOURCE',result_id,tenant_id);
    WHEN 'TEACHER_REVIEW' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.teacher_reviews WHERE id=result_id) OR foundry_private.entity_in_tenant('REVIEW',result_id,tenant_id);
    WHEN 'RETRY_RESULT_REVIEW' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.teacher_reviews WHERE id=result_id) OR foundry_private.entity_in_tenant('REVIEW',result_id,tenant_id);
    WHEN 'CREATE_RETRY' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.retry_attempts WHERE id=result_id) OR foundry_private.entity_in_tenant('RETRY',result_id,tenant_id);
    WHEN 'LEARNING_OUTCOME' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learning_outcomes WHERE id=result_id) OR foundry_private.entity_in_tenant('OUTCOME',result_id,tenant_id);
    WHEN 'COMPONENT_CANDIDATE' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.components WHERE id=result_id) OR foundry_private.entity_in_tenant('COMPONENT',result_id,tenant_id);
    WHEN 'UPDATE_COMPONENT_VERSION' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_versions WHERE id=result_id) OR foundry_private.entity_in_tenant('VERSION',result_id,tenant_id);
    WHEN 'COMPONENT_PUBLICATION_DECISION' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.publication_decisions WHERE id=result_id) OR foundry_private.entity_in_tenant('DECISION',result_id,tenant_id);
    WHEN 'COMPONENT_ROLLBACK' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.publication_decisions WHERE id=result_id) OR foundry_private.entity_in_tenant('DECISION',result_id,tenant_id);
    WHEN 'DELIVER_COMPONENT_SUPPORT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_deliveries WHERE id=result_id) OR foundry_private.entity_in_tenant('DELIVERY',result_id,tenant_id);
    WHEN 'TEACHER_ASSIGN_TASK' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.teacher_assignments WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.teacher_assignments assignment WHERE assignment.id=result_id AND assignment.institution_id=tenant_id);
    WHEN 'TEACHER_INTERVENE_RUNTIME' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.teacher_interventions WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.teacher_interventions intervention WHERE intervention.id=result_id AND intervention.institution_id=tenant_id);
    ELSE RETURN false;
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."idempotency_result_in_tenant"(text,uuid,uuid) FROM PUBLIC;

-- Extend CAP-01 snapshot validation for CAP-05 provenance without weakening any
-- pre-existing Context reference check. New refs are validated here, removed
-- from a validation copy, and every remaining ref is delegated to CAP-01.
CREATE OR REPLACE FUNCTION "foundry_private"."cap05_context_items_in_tenant"("items" jsonb, "tenant_id" uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb; reference_item jsonb; reference_id uuid; item_task uuid; item_episode uuid; item_course uuid; normalized_items jsonb := '[]'::jsonb; normalized_refs jsonb;
BEGIN
  IF items IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(items)<>'array' THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF jsonb_typeof(item)<>'object' THEN RETURN false; END IF;
    BEGIN
      item_task := NULLIF(item->>'taskId','')::uuid;
      item_episode := NULLIF(item->>'episodeId','')::uuid;
      item_course := NULLIF(item->>'courseId','')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
    IF NOT (item ? 'provenanceRefs') THEN
      normalized_items := normalized_items || jsonb_build_array(item);
      CONTINUE;
    END IF;
    IF jsonb_typeof(item->'provenanceRefs')<>'array' THEN RETURN false; END IF;
    normalized_refs := '[]'::jsonb;
    FOR reference_item IN SELECT value FROM jsonb_array_elements(item->'provenanceRefs') LOOP
      IF jsonb_typeof(reference_item)<>'object' THEN RETURN false; END IF;
      BEGIN reference_id := NULLIF(reference_item->>'id','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
      IF reference_item->>'type' IN ('TEACHER_ASSIGNMENT','TEACHER_INTERVENTION','CAPABILITY_CONSTRAINT')
        AND (item_task IS NULL OR item_episode IS NULL OR item_course IS NULL) THEN RETURN false; END IF;
      CASE reference_item->>'type'
        WHEN 'TEACHER_ASSIGNMENT' THEN
          IF NOT EXISTS (
            SELECT 1 FROM foundry_product.teacher_assignments assignment
            WHERE assignment.id=reference_id AND assignment.institution_id=tenant_id
              AND assignment.task_id=item_task AND assignment.course_id=item_course
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(item->'provenanceRefs') constraint_ref
                JOIN foundry_product.teacher_capability_constraints constraint_row
                  ON constraint_ref->>'type'='CAPABILITY_CONSTRAINT' AND constraint_row.id=(constraint_ref->>'id')::uuid
                WHERE constraint_row.source_assignment_id=assignment.id
                  AND constraint_row.episode_id=item_episode AND constraint_row.course_id=item_course
              )
          ) THEN RETURN false; END IF;
        WHEN 'TEACHER_INTERVENTION' THEN
          IF NOT EXISTS (
            SELECT 1 FROM foundry_product.teacher_interventions intervention
            WHERE intervention.id=reference_id AND intervention.institution_id=tenant_id
              AND intervention.task_id=item_task AND intervention.episode_id=item_episode
              AND intervention.course_id=item_course
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(item->'provenanceRefs') constraint_ref
                JOIN foundry_product.teacher_capability_constraints constraint_row
                  ON constraint_ref->>'type'='CAPABILITY_CONSTRAINT' AND constraint_row.id=(constraint_ref->>'id')::uuid
                WHERE constraint_row.source_intervention_id=intervention.id
                  AND constraint_row.episode_id=item_episode AND constraint_row.course_id=item_course
              )
          ) THEN RETURN false; END IF;
        WHEN 'CAPABILITY_CONSTRAINT' THEN
          IF NOT EXISTS (
            SELECT 1 FROM foundry_product.teacher_capability_constraints constraint_row
            WHERE constraint_row.id=reference_id AND constraint_row.institution_id=tenant_id
              AND constraint_row.task_id=item_task AND constraint_row.episode_id=item_episode
              AND constraint_row.course_id=item_course
              AND jsonb_typeof(item->'payload')='object'
              AND (
                (constraint_row.effect='REQUIRE' AND item->>'kind'='CAPABILITY_REQUIREMENT'
                  AND item->'payload'->>'requiredCapabilityKey'=constraint_row.capability_key_snapshot
                  AND item->'payload'->>'capabilityId'=constraint_row.capability_id::text
                  AND item->'payload'->>'reason'=constraint_row.reason)
                OR (constraint_row.effect='EXCLUDE' AND item->>'kind'='CAPABILITY_EXCLUSION'
                  AND item->'payload'->>'excludedCapabilityKey'=constraint_row.capability_key_snapshot
                  AND item->'payload'->>'capabilityId'=constraint_row.capability_id::text
                  AND item->'payload'->>'reason'=constraint_row.reason)
              )
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(item->'provenanceRefs') source_ref
                WHERE (constraint_row.source_assignment_id IS NOT NULL AND source_ref->>'type'='TEACHER_ASSIGNMENT' AND source_ref->>'id'=constraint_row.source_assignment_id::text)
                   OR (constraint_row.source_intervention_id IS NOT NULL AND source_ref->>'type'='TEACHER_INTERVENTION' AND source_ref->>'id'=constraint_row.source_intervention_id::text)
              )
          ) THEN RETURN false; END IF;
        ELSE normalized_refs := normalized_refs || jsonb_build_array(reference_item);
      END CASE;
    END LOOP;
    normalized_items := normalized_items || jsonb_build_array(jsonb_set(item,'{provenanceRefs}',normalized_refs,true));
  END LOOP;
  RETURN foundry_private.context_items_in_tenant(normalized_items,tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap05_context_items_in_tenant"(jsonb,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "foundry_private"."cap05_provenance_matches_candidates"("refs" jsonb, "items" jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH top_refs AS (
    SELECT value->>'type' AS type, value->>'id' AS id
    FROM jsonb_array_elements(refs)
    WHERE value->>'type' IN ('TEACHER_ASSIGNMENT','TEACHER_INTERVENTION','CAPABILITY_CONSTRAINT')
  ), item_refs AS (
    SELECT reference->>'type' AS type, reference->>'id' AS id
    FROM jsonb_array_elements(items) item
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(item->'provenanceRefs','[]'::jsonb)) reference
    WHERE reference->>'type' IN ('TEACHER_ASSIGNMENT','TEACHER_INTERVENTION','CAPABILITY_CONSTRAINT')
  )
  SELECT NOT EXISTS (SELECT type,id FROM top_refs EXCEPT SELECT type,id FROM item_refs)
    AND NOT EXISTS (SELECT type,id FROM item_refs EXCEPT SELECT type,id FROM top_refs)
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap05_provenance_matches_candidates"(jsonb,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "foundry_private"."cap01_context_compilation_lineage_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid; task_course_id uuid; normalized_provenance_refs jsonb; candidate_count integer; decision_count integer; distinct_candidate_count integer; distinct_decision_count integer;
BEGIN
  IF tenant_id IS NULL THEN RAISE EXCEPTION 'CAP-01 ContextCompilation tenant context is required' USING ERRCODE='42501'; END IF;
  SELECT task.course_id INTO task_course_id FROM foundry_product.learning_tasks task
    JOIN foundry_product.learning_episodes episode ON episode.id=NEW.episode_id AND episode.task_id=task.id
    WHERE task.id=NEW.task_id AND task.institution_id=tenant_id;
  IF task_course_id IS NULL THEN RAISE EXCEPTION 'CAP-01 ContextCompilation Task/Episode lineage mismatch' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(NEW.candidate_items)<>'array' OR jsonb_typeof(NEW.selected_items)<>'array' OR jsonb_typeof(NEW.excluded_items)<>'array'
    OR jsonb_typeof(NEW.provenance_refs)<>'array' OR jsonb_typeof(NEW.referenced_prior_task_ids)<>'array'
  THEN RAISE EXCEPTION 'CAP-01 ContextCompilation tenant lineage mismatch' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO normalized_provenance_refs
    FROM jsonb_array_elements(NEW.provenance_refs)
    WHERE value->>'type' NOT IN ('TEACHER_ASSIGNMENT','TEACHER_INTERVENTION','CAPABILITY_CONSTRAINT');
  IF NOT foundry_private.cap05_context_items_in_tenant(NEW.candidate_items,tenant_id)
    OR NOT foundry_private.cap05_context_items_in_tenant(NEW.selected_items,tenant_id)
    OR NOT foundry_private.cap05_context_items_in_tenant(NEW.excluded_items,tenant_id)
    OR NOT foundry_private.cap05_provenance_matches_candidates(NEW.provenance_refs,NEW.candidate_items)
    OR NOT foundry_private.uuid_array_in_tenant(NEW.referenced_prior_task_ids,'TASK',tenant_id)
    OR (NEW.consumer<>'LEGACY_COMPATIBILITY' AND NOT foundry_private.context_items_in_tenant(jsonb_build_array(jsonb_build_object('taskId',NEW.task_id::text,'provenanceRefs',normalized_provenance_refs)),tenant_id))
  THEN RAISE EXCEPTION 'CAP-01 ContextCompilation tenant lineage mismatch' USING ERRCODE='23514'; END IF;
  candidate_count := jsonb_array_length(NEW.candidate_items);
  decision_count := jsonb_array_length(NEW.selected_items)+jsonb_array_length(NEW.excluded_items);
  SELECT count(DISTINCT value->>'id') INTO distinct_candidate_count FROM jsonb_array_elements(NEW.candidate_items);
  SELECT count(DISTINCT value->>'id') INTO distinct_decision_count FROM jsonb_array_elements(NEW.selected_items || NEW.excluded_items);
  IF candidate_count<>decision_count OR candidate_count<>distinct_candidate_count OR decision_count<>distinct_decision_count
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.candidate_items) candidate WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.selected_items || NEW.excluded_items) decision WHERE decision->>'id'=candidate->>'id'))
  THEN RAISE EXCEPTION 'CAP-01 ContextCompilation candidate decisions are incomplete or duplicated' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap01_context_compilation_lineage_guard"() FROM PUBLIC;

-- The typed human records are the audit authority; their rows carry exact actor,
-- session, time and lineage, and cannot be rewritten. GovernanceEvent insertion
-- is intentionally not required to avoid creating a second human-action truth.
