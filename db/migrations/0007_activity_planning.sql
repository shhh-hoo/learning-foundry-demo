-- CAP-03: add one immutable Class-B ActivityPlanProposal over exact CAP-02
-- resolution lineage. It is not a Class-A ActivityPlan or RuntimeDelivery.
CREATE TABLE "foundry_product"."activity_plan_proposals" (
  "id" uuid PRIMARY KEY NOT NULL,
  "institution_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "episode_id" uuid NOT NULL,
  "context_compilation_id" uuid NOT NULL,
  "diagnostic_observation_id" uuid NOT NULL,
  "capability_resolution_id" uuid NOT NULL,
  "policy_version" text NOT NULL,
  "input_hash" text NOT NULL,
  "state" text NOT NULL,
  "resolution_decision" text NOT NULL,
  "selected_capability_id" uuid,
  "selected_capability_version_id" uuid,
  "selected_version_content_hash" text,
  "rationale" text NOT NULL,
  "stages" jsonb NOT NULL,
  "teacher_constraints" jsonb NOT NULL,
  "teacher_intervention" jsonb NOT NULL,
  "retry_intent" jsonb NOT NULL,
  "runtime_handoff" jsonb NOT NULL,
  "block_reasons" jsonb NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "activity_plan_proposal_state_ck" CHECK ("state" IN ('READY','BLOCKED','ESCALATED')),
  CONSTRAINT "activity_plan_proposal_decision_ck" CHECK ("resolution_decision" IN ('EXISTING','PARAMETERIZE','COMPOSE','ADAPT','GENERATE','NO_MATCH')),
  CONSTRAINT "activity_plan_proposal_payload_ck" CHECK (
    ("state"='READY' AND "resolution_decision"='EXISTING'
      AND "selected_capability_id" IS NOT NULL AND "selected_capability_version_id" IS NOT NULL
      AND "selected_version_content_hash" IS NOT NULL AND jsonb_array_length("stages")>0
      AND ("runtime_handoff"->>'executable')::boolean
      AND jsonb_typeof("runtime_handoff"->'capabilityVersionId')='string'
      AND "runtime_handoff"->>'capabilityVersionId'="selected_capability_version_id"::text)
    OR ("state"<>'READY' AND "selected_capability_id" IS NULL AND "selected_capability_version_id" IS NULL
      AND "selected_version_content_hash" IS NULL AND jsonb_array_length("stages")=0
      AND NOT ("runtime_handoff"->>'executable')::boolean
      AND "runtime_handoff" ? 'capabilityVersionId'
      AND "runtime_handoff"->'capabilityVersionId'='null'::jsonb)
  ),
  CONSTRAINT "activity_plan_proposal_json_ck" CHECK (
    jsonb_typeof("stages")='array' AND jsonb_typeof("teacher_constraints")='array'
    AND jsonb_typeof("teacher_intervention")='object' AND jsonb_typeof("retry_intent")='object'
    AND jsonb_typeof("runtime_handoff")='object' AND jsonb_typeof("block_reasons")='array'
    AND jsonb_typeof("runtime_handoff"->'executable')='boolean'
    AND jsonb_typeof("retry_intent"->'formalRetryCreated')='boolean'
    AND NOT ("retry_intent"->>'formalRetryCreated')::boolean
    AND length("input_hash")>7 AND length("policy_version")>0 AND length(btrim("rationale"))>0
  ),
  CONSTRAINT "activity_plan_proposals_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  CONSTRAINT "activity_plan_proposals_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id"),
  CONSTRAINT "activity_plan_proposals_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade,
  CONSTRAINT "activity_plan_proposals_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade,
  CONSTRAINT "activity_plan_proposals_context_compilation_id_fk" FOREIGN KEY ("context_compilation_id") REFERENCES "foundry_product"."context_compilations"("id"),
  CONSTRAINT "activity_plan_proposals_diagnostic_observation_id_fk" FOREIGN KEY ("diagnostic_observation_id") REFERENCES "foundry_product"."diagnostic_observations"("id"),
  CONSTRAINT "activity_plan_proposals_capability_resolution_id_fk" FOREIGN KEY ("capability_resolution_id") REFERENCES "foundry_product"."capability_resolutions"("id"),
  CONSTRAINT "activity_plan_proposals_selected_capability_id_fk" FOREIGN KEY ("selected_capability_id") REFERENCES "foundry_product"."capabilities"("id"),
  CONSTRAINT "activity_plan_proposals_selected_version_id_fk" FOREIGN KEY ("selected_capability_version_id") REFERENCES "foundry_product"."capability_versions"("id"),
  CONSTRAINT "activity_plan_proposals_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "foundry_product"."users"("id")
);
CREATE UNIQUE INDEX "activity_plan_proposal_resolution_uq" ON "foundry_product"."activity_plan_proposals" ("capability_resolution_id");
CREATE UNIQUE INDEX "activity_plan_proposal_replay_uq" ON "foundry_product"."activity_plan_proposals" ("institution_id","input_hash");
CREATE INDEX "activity_plan_proposal_task_idx" ON "foundry_product"."activity_plan_proposals" ("task_id","episode_id","created_at");
--> statement-breakpoint

INSERT INTO "foundry_private"."table_authority_catalog" ("schema_name","table_name","classification","policy_required") VALUES
('foundry_product','activity_plan_proposals','TENANT_DIRECT_CLASS_B',true);
INSERT INTO "foundry_private"."writable_lineage_catalog" ("schema_name","table_name","writable_roles","tenant_references","enforcement") VALUES
('foundry_product','activity_plan_proposals',ARRAY['foundry_product_runtime'],'institution; course; Task/Episode; exact CAP-02 resolution/Context/current Diagnosis; selected exact Registry version; creator','FORCED_RLS + _authority_tenant_lineage_guard');

REVOKE ALL ON "foundry_product"."activity_plan_proposals" FROM PUBLIC;
GRANT SELECT, INSERT ON "foundry_product"."activity_plan_proposals" TO foundry_product_runtime;

ALTER TABLE "foundry_product"."activity_plan_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."activity_plan_proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."activity_plan_proposals" TO foundry_product_runtime
  USING ("institution_id"="foundry_private"."current_institution_id"())
  WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap03_activity_plan_lineage_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
BEGIN
  IF tenant_id IS NOT NULL AND NEW.institution_id<>tenant_id THEN
    RAISE EXCEPTION 'CAP-03 ActivityPlanProposal tenant mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.learning_tasks task
    JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id
    JOIN foundry_product.courses course ON course.id=task.course_id
    WHERE task.id=NEW.task_id AND episode.id=NEW.episode_id
      AND task.institution_id=NEW.institution_id AND task.course_id=NEW.course_id
      AND course.institution_id=NEW.institution_id
  ) THEN
    RAISE EXCEPTION 'CAP-03 ActivityPlanProposal Task/Episode tenant lineage mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.capability_resolutions resolution
    JOIN foundry_product.context_compilations context ON context.id=resolution.context_compilation_id
    JOIN foundry_product.diagnostic_observations observation ON observation.id=resolution.diagnostic_observation_id
    JOIN foundry_product.learner_attempts attempt ON attempt.id=observation.attempt_id
    WHERE resolution.id=NEW.capability_resolution_id
      AND resolution.institution_id=NEW.institution_id AND resolution.course_id=NEW.course_id
      AND resolution.task_id=NEW.task_id AND resolution.episode_id=NEW.episode_id
      AND resolution.context_compilation_id=NEW.context_compilation_id
      AND resolution.diagnostic_observation_id=NEW.diagnostic_observation_id
      AND resolution.decision=NEW.resolution_decision
      AND context.id=NEW.context_compilation_id AND context.consumer='CAPABILITY_RESOLUTION'
      AND context.task_id=NEW.task_id AND context.episode_id=NEW.episode_id
      AND observation.superseded_by_id IS NULL
      AND attempt.task_id=NEW.task_id AND attempt.episode_id=NEW.episode_id
      AND NOT EXISTS (
        SELECT 1 FROM foundry_product.diagnostic_observations other
        WHERE other.attempt_id=attempt.id AND other.superseded_by_id IS NULL AND other.id<>observation.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM foundry_product.capability_resolutions newer
        WHERE newer.task_id=resolution.task_id AND newer.episode_id=resolution.episode_id
          AND (newer.created_at,newer.id)>(resolution.created_at,resolution.id)
      )
  ) THEN
    RAISE EXCEPTION 'CAP-03 ActivityPlanProposal resolution/Context/Diagnosis lineage mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.institution_memberships membership
    JOIN foundry_product.course_enrollments enrollment
      ON enrollment.user_id=membership.user_id AND enrollment.institution_id=membership.institution_id
    WHERE membership.user_id=NEW.created_by AND membership.institution_id=NEW.institution_id
      AND enrollment.course_id=NEW.course_id
  ) THEN
    RAISE EXCEPTION 'CAP-03 ActivityPlanProposal actor scope mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.state='READY' AND NOT EXISTS (
    SELECT 1 FROM foundry_product.capability_resolutions resolution
    JOIN foundry_product.context_compilations context ON context.id=resolution.context_compilation_id
    JOIN foundry_product.capability_versions version ON version.id=resolution.selected_capability_version_id
    JOIN foundry_product.capabilities capability ON capability.id=resolution.selected_capability_id
    WHERE resolution.id=NEW.capability_resolution_id AND resolution.decision='EXISTING'
      AND NOT resolution.no_match AND NOT resolution.teacher_escalation
      AND NEW.selected_capability_id=resolution.selected_capability_id
      AND NEW.selected_capability_version_id=resolution.selected_capability_version_id
      AND version.capability_id=capability.id AND version.status='ACTIVE'
      AND capability.active_version_id=version.id AND NEW.selected_version_content_hash=version.content_hash
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
      AND jsonb_array_length(NEW.stages)=1
      AND NEW.stages->0->>'kind'='CAPABILITY_ACTIVITY'
      AND (NEW.stages->0->>'order')::integer=1
      AND NEW.stages->0->>'capabilityId'=capability.id::text
      AND NEW.stages->0->>'capabilityVersionId'=version.id::text
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(resolution.candidate_set) candidate
        WHERE candidate->>'capabilityId'=capability.id::text AND candidate->>'versionId'=version.id::text
          AND candidate->>'eligibility'='ELIGIBLE' AND jsonb_array_length(candidate->'exclusionReasons')=0
          AND candidate->'contract'=version.contract
      )
  ) THEN
    RAISE EXCEPTION 'CAP-03 READY plan does not pin the eligible active exact version' USING ERRCODE='23514';
  END IF;
  IF NEW.state='BLOCKED' AND NEW.resolution_decision NOT IN ('PARAMETERIZE','COMPOSE','ADAPT','GENERATE') THEN
    RAISE EXCEPTION 'CAP-03 BLOCKED plan requires an unexecuted supply recommendation' USING ERRCODE='23514';
  END IF;
  IF NEW.state='ESCALATED' AND NEW.resolution_decision NOT IN ('EXISTING','NO_MATCH') THEN
    RAISE EXCEPTION 'CAP-03 ESCALATED plan has an invalid source decision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap03_activity_plan_lineage_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard"
  BEFORE INSERT ON "foundry_product"."activity_plan_proposals"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap03_activity_plan_lineage_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap03_activity_plan_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'ActivityPlanProposal is immutable; append from a new exact resolution' USING ERRCODE='23514';
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap03_activity_plan_immutable"() FROM PUBLIC;
CREATE TRIGGER "cap03_activity_plan_immutable"
  BEFORE UPDATE OR DELETE ON "foundry_product"."activity_plan_proposals"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap03_activity_plan_immutable"();
--> statement-breakpoint

-- Rollback boundary: revert application use first, export any CAP-03 proposals,
-- then remove this additive table, catalog rows and functions. No prior Product
-- State, CAP-02 resolution, Diagnosis, Context or Registry row was rewritten.
