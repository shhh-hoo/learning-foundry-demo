-- CAP-02: add one immutable Class-B resolution assertion over the existing
-- Context, Diagnosis and canonical Registry objects. Existing rows are not
-- rewritten and legacy support Components do not enter the Registry.
CREATE TABLE "foundry_product"."capability_resolutions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "institution_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "episode_id" uuid NOT NULL,
  "context_compilation_id" uuid NOT NULL,
  "diagnostic_observation_id" uuid NOT NULL,
  "policy_version" text NOT NULL,
  "input_hash" text NOT NULL,
  "decision" text NOT NULL,
  "candidate_set" jsonb NOT NULL,
  "selected_capability_id" uuid,
  "selected_capability_version_id" uuid,
  "selection_rationale" text NOT NULL,
  "parameterization_recommendation" jsonb,
  "composition_recommendation" jsonb,
  "gap_signal" jsonb,
  "no_match" boolean NOT NULL,
  "teacher_escalation" boolean NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "capability_resolution_decision_ck" CHECK ("decision" IN ('EXISTING','PARAMETERIZE','COMPOSE','ADAPT','GENERATE','NO_MATCH')),
  CONSTRAINT "capability_resolution_hash_ck" CHECK (length("input_hash") > 7 AND length("policy_version") > 0 AND length(btrim("selection_rationale")) > 0),
  CONSTRAINT "capability_resolution_selection_ck" CHECK (
    ("decision"='EXISTING' AND "selected_capability_id" IS NOT NULL AND "selected_capability_version_id" IS NOT NULL AND NOT "no_match")
    OR ("decision"<>'EXISTING' AND "selected_capability_id" IS NULL AND "selected_capability_version_id" IS NULL)
  ),
  CONSTRAINT "capability_resolution_payload_ck" CHECK (
    ("decision"='EXISTING' AND NOT "no_match" AND NOT "teacher_escalation"
      AND "parameterization_recommendation" IS NULL AND "composition_recommendation" IS NULL AND "gap_signal" IS NULL)
    OR ("decision"='PARAMETERIZE' AND NOT "no_match" AND "teacher_escalation"
      AND "parameterization_recommendation" IS NOT NULL AND "composition_recommendation" IS NULL AND "gap_signal" IS NULL)
    OR ("decision"='COMPOSE' AND NOT "no_match" AND "teacher_escalation"
      AND "parameterization_recommendation" IS NULL AND "composition_recommendation" IS NOT NULL AND "gap_signal" IS NULL)
    OR ("decision" IN ('ADAPT','GENERATE','NO_MATCH') AND "no_match" AND "teacher_escalation"
      AND "parameterization_recommendation" IS NULL AND "composition_recommendation" IS NULL AND "gap_signal" IS NOT NULL)
  ),
  CONSTRAINT "capability_resolutions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  CONSTRAINT "capability_resolutions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id"),
  CONSTRAINT "capability_resolutions_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade,
  CONSTRAINT "capability_resolutions_episode_id_learning_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade,
  CONSTRAINT "capability_resolutions_context_compilation_id_context_compilations_id_fk" FOREIGN KEY ("context_compilation_id") REFERENCES "foundry_product"."context_compilations"("id"),
  CONSTRAINT "capability_resolutions_diagnostic_observation_id_diagnostic_observations_id_fk" FOREIGN KEY ("diagnostic_observation_id") REFERENCES "foundry_product"."diagnostic_observations"("id"),
  CONSTRAINT "capability_resolutions_selected_capability_id_capabilities_id_fk" FOREIGN KEY ("selected_capability_id") REFERENCES "foundry_product"."capabilities"("id"),
  CONSTRAINT "capability_resolutions_selected_version_id_capability_versions_id_fk" FOREIGN KEY ("selected_capability_version_id") REFERENCES "foundry_product"."capability_versions"("id"),
  CONSTRAINT "capability_resolutions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "foundry_product"."users"("id")
);
CREATE UNIQUE INDEX "capability_resolution_replay_uq" ON "foundry_product"."capability_resolutions" ("institution_id","input_hash");
CREATE INDEX "capability_resolution_task_idx" ON "foundry_product"."capability_resolutions" ("task_id","episode_id","created_at");
--> statement-breakpoint

INSERT INTO "foundry_private"."table_authority_catalog" ("schema_name","table_name","classification","policy_required") VALUES
('foundry_product','capability_resolutions','TENANT_DIRECT_CLASS_B',true);
INSERT INTO "foundry_private"."writable_lineage_catalog" ("schema_name","table_name","writable_roles","tenant_references","enforcement") VALUES
('foundry_product','capability_resolutions',ARRAY['foundry_product_runtime'],'institution; course; Task/Episode; exact Context snapshot; current Diagnosis Proposal; complete Registry versions; creator','FORCED_RLS + _authority_tenant_lineage_guard');

REVOKE ALL ON "foundry_product"."capability_resolutions" FROM PUBLIC;
GRANT SELECT, INSERT ON "foundry_product"."capability_resolutions" TO foundry_product_runtime;

ALTER TABLE "foundry_product"."capability_resolutions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."capability_resolutions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."capability_resolutions" TO foundry_product_runtime
  USING ("institution_id"="foundry_private"."current_institution_id"())
  WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap02_capability_resolution_lineage_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  candidate_count integer;
  distinct_candidate_count integer;
  registry_count integer;
  distinct_rank_count integer;
  minimum_rank integer;
  maximum_rank integer;
BEGIN
  IF jsonb_typeof(NEW.candidate_set)<>'array' THEN
    RAISE EXCEPTION 'CAP-02 candidate set must be an array' USING ERRCODE='23514';
  END IF;
  IF tenant_id IS NOT NULL AND NEW.institution_id<>tenant_id THEN
    RAISE EXCEPTION 'CAP-02 CapabilityResolution tenant mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.learning_tasks task
    JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id
    JOIN foundry_product.courses course ON course.id=task.course_id
    WHERE task.id=NEW.task_id AND episode.id=NEW.episode_id
      AND task.institution_id=NEW.institution_id AND task.course_id=NEW.course_id
      AND course.institution_id=NEW.institution_id
  ) THEN
    RAISE EXCEPTION 'CAP-02 CapabilityResolution Task/Episode tenant lineage mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.context_compilations context
    WHERE context.id=NEW.context_compilation_id AND context.task_id=NEW.task_id
      AND context.episode_id=NEW.episode_id AND context.consumer='CAPABILITY_RESOLUTION'
  ) THEN
    RAISE EXCEPTION 'CAP-02 CapabilityResolution Context lineage mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.diagnostic_observations observation
    JOIN foundry_product.learner_attempts attempt ON attempt.id=observation.attempt_id
    WHERE observation.id=NEW.diagnostic_observation_id AND observation.superseded_by_id IS NULL
      AND attempt.task_id=NEW.task_id AND attempt.episode_id=NEW.episode_id
  ) THEN
    RAISE EXCEPTION 'CAP-02 CapabilityResolution current Diagnosis lineage mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.institution_memberships membership
    JOIN foundry_product.course_enrollments enrollment
      ON enrollment.user_id=membership.user_id AND enrollment.institution_id=membership.institution_id
    WHERE membership.user_id=NEW.created_by AND membership.institution_id=NEW.institution_id
      AND enrollment.course_id=NEW.course_id
  ) THEN
    RAISE EXCEPTION 'CAP-02 CapabilityResolution actor scope mismatch' USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO candidate_count FROM jsonb_array_elements(NEW.candidate_set);
  SELECT count(DISTINCT candidate->>'versionId') INTO distinct_candidate_count FROM jsonb_array_elements(NEW.candidate_set) candidate;
  SELECT count(*) INTO registry_count FROM foundry_product.capability_versions;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.candidate_set) candidate
    WHERE candidate->>'rank' !~ '^[1-9][0-9]*$'
      OR length(btrim(candidate->>'rationale'))=0
      OR jsonb_typeof(candidate->'compatibility')<>'array'
      OR jsonb_array_length(candidate->'compatibility')=0
      OR jsonb_typeof(candidate->'exclusionReasons')<>'array'
      OR (candidate->>'eligibility'='ELIGIBLE' AND jsonb_array_length(candidate->'exclusionReasons')<>0)
      OR (candidate->>'eligibility'='EXCLUDED' AND jsonb_array_length(candidate->'exclusionReasons')=0)
      OR candidate->>'eligibility' NOT IN ('ELIGIBLE','EXCLUDED')
  ) THEN
    RAISE EXCEPTION 'CAP-02 CapabilityResolution candidate decision detail is incomplete' USING ERRCODE='23514';
  END IF;
  SELECT count(DISTINCT (candidate->>'rank')::integer), min((candidate->>'rank')::integer), max((candidate->>'rank')::integer)
    INTO distinct_rank_count, minimum_rank, maximum_rank FROM jsonb_array_elements(NEW.candidate_set) candidate;
  IF candidate_count<>registry_count OR candidate_count<>distinct_candidate_count
    OR (candidate_count>0 AND (distinct_rank_count<>candidate_count OR minimum_rank<>1 OR maximum_rank<>candidate_count))
    OR EXISTS (
      SELECT 1 FROM foundry_product.capability_versions version
      JOIN foundry_product.capabilities capability ON capability.id=version.capability_id
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.candidate_set) candidate
        WHERE candidate->>'versionId'=version.id::text
          AND candidate->>'capabilityId'=capability.id::text
          AND candidate->>'capabilityKey'=capability.key
          AND candidate->>'version'=version.version
          AND candidate->>'contentHash'=version.content_hash
          AND candidate->>'eligibility' IN ('ELIGIBLE','EXCLUDED')
          AND jsonb_typeof(candidate->'exclusionReasons')='array'
          AND jsonb_typeof(candidate->'compatibility')='array'
      )
    ) THEN
    RAISE EXCEPTION 'CAP-02 CapabilityResolution candidate set is incomplete, duplicated or stale' USING ERRCODE='23514';
  END IF;

  IF NEW.decision='EXISTING' AND NOT EXISTS (
    SELECT 1 FROM foundry_product.capability_versions version
    JOIN foundry_product.capabilities capability ON capability.id=version.capability_id
    WHERE version.id=NEW.selected_capability_version_id
      AND capability.id=NEW.selected_capability_id
      AND capability.active_version_id=version.id AND version.status='ACTIVE'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.candidate_set) candidate
        WHERE candidate->>'versionId'=version.id::text
          AND candidate->>'eligibility'='ELIGIBLE'
          AND jsonb_array_length(candidate->'exclusionReasons')=0
      )
  ) THEN
    RAISE EXCEPTION 'CAP-02 selected CapabilityVersion is not the eligible active exact version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap02_capability_resolution_lineage_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard"
  BEFORE INSERT ON "foundry_product"."capability_resolutions"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap02_capability_resolution_lineage_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap02_capability_resolution_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'CapabilityResolution is immutable; append a new exact decision' USING ERRCODE='23514';
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap02_capability_resolution_immutable"() FROM PUBLIC;
CREATE TRIGGER "cap02_capability_resolution_immutable"
  BEFORE UPDATE OR DELETE ON "foundry_product"."capability_resolutions"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap02_capability_resolution_immutable"();
--> statement-breakpoint

-- Rollback boundary: revert application use first, export any CAP-02 assertions,
-- then remove this additive table, catalog rows and functions. No prior Product
-- State, Registry, Diagnosis or Context row was rewritten by this migration.
