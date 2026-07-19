-- CAP-01: enrich the existing Context compilation snapshot for deterministic,
-- versioned, provenance-complete replay. Historical rows remain historical.

ALTER TABLE "foundry_product"."context_compilations"
  ADD COLUMN "consumer" text,
  ADD COLUMN "context_policy_version" text,
  ADD COLUMN "input_hash" text,
  ADD COLUMN "snapshot_hash" text,
  ADD COLUMN "candidate_items" jsonb,
  ADD COLUMN "provenance_refs" jsonb,
  ADD COLUMN "referenced_prior_task_ids" jsonb;
--> statement-breakpoint

UPDATE "foundry_product"."context_compilations"
SET
  "consumer" = 'LEGACY_COMPATIBILITY',
  "context_policy_version" = 'legacy-' || "compiler_version",
  "input_hash" = 'legacy-row:' || "id"::text,
  "snapshot_hash" = 'legacy-row:' || "id"::text,
  "candidate_items" = "selected_items" || "excluded_items",
  "provenance_refs" = '[]'::jsonb,
  "referenced_prior_task_ids" = '[]'::jsonb;
--> statement-breakpoint

ALTER TABLE "foundry_product"."context_compilations"
  ALTER COLUMN "consumer" SET NOT NULL,
  ALTER COLUMN "context_policy_version" SET NOT NULL,
  ALTER COLUMN "input_hash" SET NOT NULL,
  ALTER COLUMN "snapshot_hash" SET NOT NULL,
  ALTER COLUMN "candidate_items" SET NOT NULL,
  ALTER COLUMN "provenance_refs" SET NOT NULL,
  ALTER COLUMN "referenced_prior_task_ids" SET NOT NULL,
  ADD CONSTRAINT "context_compilation_consumer_ck" CHECK ("consumer" IN ('LEGACY_COMPATIBILITY','EVIDENCE_RETRIEVAL','DIAGNOSIS','CAPABILITY_RESOLUTION','RUNTIME_ORCHESTRATION')),
  ADD CONSTRAINT "context_compilation_hash_ck" CHECK (length("input_hash") > 0 AND length("snapshot_hash") > 0);
CREATE UNIQUE INDEX "context_compilation_replay_uq"
  ON "foundry_product"."context_compilations" ("task_id","episode_id","consumer","compiler_version","input_hash");
--> statement-breakpoint

-- RW-02 guarded ContextCompilation writes by inspecting legacy EVENT/ATTEMPT
-- snapshots. CAP-01 keeps that same tenant boundary but teaches it the
-- canonical provenance reference types emitted by the existing Context model.
-- Legacy item shapes remain accepted during a rolling application upgrade.
CREATE OR REPLACE FUNCTION "foundry_private"."context_items_in_tenant"("items" jsonb, "tenant_id" uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  item jsonb;
  item_task uuid;
  item_episode uuid;
  item_institution uuid;
  item_course uuid;
  item_profile uuid;
  item_id uuid;
  reference_item jsonb;
  reference_id uuid;
  reference_type text;
BEGIN
  IF items IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(items) <> 'array' THEN RETURN false; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF jsonb_typeof(item) <> 'object' THEN RETURN false; END IF;
    BEGIN
      item_task := NULLIF(item->>'taskId','')::uuid;
      item_episode := NULLIF(item->>'episodeId','')::uuid;
      item_institution := NULLIF(item->>'institutionId','')::uuid;
      item_course := NULLIF(item->>'courseId','')::uuid;
      item_profile := NULLIF(item->>'learnerProfileId','')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN false;
    END;

    IF NOT foundry_private.entity_in_tenant('TASK', item_task, tenant_id) THEN RETURN false; END IF;
    IF item_episode IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM foundry_product.learning_episodes episode
      WHERE episode.id=item_episode AND episode.task_id=item_task
    ) THEN RETURN false; END IF;
    IF item_institution IS NOT NULL AND item_institution<>tenant_id THEN RETURN false; END IF;
    IF item_course IS NOT NULL AND NOT foundry_private.entity_in_tenant('COURSE',item_course,tenant_id) THEN RETURN false; END IF;
    IF item_profile IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM foundry_product.learner_profiles profile
      WHERE profile.id=item_profile AND profile.institution_id=tenant_id
    ) THEN RETURN false; END IF;

    IF item ? 'provenanceRefs' THEN
      IF jsonb_typeof(item->'provenanceRefs') <> 'array'
        OR jsonb_array_length(item->'provenanceRefs')=0 THEN RETURN false; END IF;

      FOR reference_item IN SELECT value FROM jsonb_array_elements(item->'provenanceRefs') LOOP
        IF jsonb_typeof(reference_item) <> 'object' THEN RETURN false; END IF;
        reference_type := NULLIF(reference_item->>'type','');
        BEGIN
          reference_id := NULLIF(reference_item->>'id','')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RETURN false;
        END;
        IF reference_type IS NULL OR reference_id IS NULL THEN RETURN false; END IF;

        CASE reference_type
          WHEN 'LEARNING_TASK' THEN
            IF NOT foundry_private.entity_in_tenant('TASK',reference_id,tenant_id) THEN RETURN false; END IF;
          WHEN 'LEARNING_EPISODE' THEN
            IF NOT foundry_private.entity_in_tenant('EPISODE',reference_id,tenant_id) THEN RETURN false; END IF;
          WHEN 'LEARNER_PROFILE' THEN
            IF NOT EXISTS (SELECT 1 FROM foundry_product.learner_profiles profile WHERE profile.id=reference_id AND profile.institution_id=tenant_id) THEN RETURN false; END IF;
          WHEN 'LEARNER_STRATEGY_VERSION' THEN
            IF NOT EXISTS (
              SELECT 1 FROM foundry_product.learner_strategy_versions strategy
              JOIN foundry_product.learner_profiles profile ON profile.id=strategy.learner_profile_id
              WHERE strategy.id=reference_id AND profile.institution_id=tenant_id
            ) THEN RETURN false; END IF;
          WHEN 'CONTEXT_ITEM' THEN
            IF NOT EXISTS (SELECT 1 FROM foundry_product.context_items context_item WHERE context_item.id=reference_id AND context_item.institution_id=tenant_id) THEN RETURN false; END IF;
          WHEN 'CONTEXT_CARRYOVER_RELATION' THEN
            IF NOT EXISTS (SELECT 1 FROM foundry_product.context_carryover_relations relation WHERE relation.id=reference_id AND relation.institution_id=tenant_id) THEN RETURN false; END IF;
          WHEN 'CONVERSATION_EVENT' THEN
            IF NOT foundry_private.entity_in_tenant('EVENT',reference_id,tenant_id) THEN RETURN false; END IF;
          WHEN 'LEARNER_ATTEMPT' THEN
            IF NOT foundry_private.entity_in_tenant('ATTEMPT',reference_id,tenant_id) THEN RETURN false; END IF;
          WHEN 'SOURCE_RECORD' THEN
            IF NOT foundry_private.entity_in_tenant('SOURCE',reference_id,tenant_id) THEN RETURN false; END IF;
          WHEN 'SOURCE_ASSET_VERSION' THEN
            IF NOT EXISTS (
              SELECT 1 FROM foundry_product.source_asset_versions version
              WHERE version.id=reference_id AND (version.institution_id IS NULL OR version.institution_id=tenant_id)
            ) THEN RETURN false; END IF;
          WHEN 'EVIDENCE_UNIT' THEN
            IF NOT foundry_private.entity_in_tenant('EVIDENCE',reference_id,tenant_id) THEN RETURN false; END IF;
          WHEN 'EVIDENCE_DERIVATIVE' THEN
            IF NOT EXISTS (
              SELECT 1 FROM foundry_product.evidence_derivatives derivative
              WHERE derivative.id=reference_id AND (derivative.institution_id IS NULL OR derivative.institution_id=tenant_id)
            ) THEN RETURN false; END IF;
          WHEN 'ACTOR' THEN
            IF NOT foundry_private.entity_in_tenant('USER',reference_id,tenant_id) THEN RETURN false; END IF;
          ELSE RETURN false;
        END CASE;
      END LOOP;
    ELSIF item->>'kind' IN ('EVENT','ATTEMPT') THEN
      -- Rolling-deploy compatibility for the pre-CAP compiler output.
      IF item_episode IS NULL THEN RETURN false; END IF;
      BEGIN
        item_id := NULLIF(item->>'id','')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RETURN false;
      END;
      IF item->>'kind'='EVENT' AND NOT EXISTS (
        SELECT 1 FROM foundry_product.conversation_events event
        WHERE event.id=item_id AND event.task_id=item_task AND event.episode_id=item_episode
      ) THEN RETURN false; END IF;
      IF item->>'kind'='ATTEMPT' AND NOT EXISTS (
        SELECT 1 FROM foundry_product.learner_attempts attempt
        WHERE attempt.id=item_id AND attempt.task_id=item_task AND attempt.episode_id=item_episode
      ) THEN RETURN false; END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."context_items_in_tenant"(jsonb,uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap01_context_compilation_lineage_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  candidate_count integer;
  decision_count integer;
  distinct_candidate_count integer;
  distinct_decision_count integer;
BEGIN
  IF tenant_id IS NULL THEN
    RAISE EXCEPTION 'CAP-01 ContextCompilation tenant context is required' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(NEW.candidate_items)<>'array'
    OR jsonb_typeof(NEW.selected_items)<>'array'
    OR jsonb_typeof(NEW.excluded_items)<>'array'
    OR jsonb_typeof(NEW.provenance_refs)<>'array'
    OR jsonb_typeof(NEW.referenced_prior_task_ids)<>'array'
    OR NOT foundry_private.context_items_in_tenant(NEW.candidate_items,tenant_id)
    OR NOT foundry_private.context_items_in_tenant(NEW.selected_items,tenant_id)
    OR NOT foundry_private.context_items_in_tenant(NEW.excluded_items,tenant_id)
    OR NOT foundry_private.uuid_array_in_tenant(NEW.referenced_prior_task_ids,'TASK',tenant_id)
    OR (NEW.consumer<>'LEGACY_COMPATIBILITY' AND NOT foundry_private.context_items_in_tenant(
      jsonb_build_array(jsonb_build_object(
        'taskId',NEW.task_id::text,
        'provenanceRefs',NEW.provenance_refs
      )),tenant_id
    )) THEN
    RAISE EXCEPTION 'CAP-01 ContextCompilation tenant lineage mismatch' USING ERRCODE='23514';
  END IF;

  candidate_count := jsonb_array_length(NEW.candidate_items);
  decision_count := jsonb_array_length(NEW.selected_items)+jsonb_array_length(NEW.excluded_items);
  SELECT count(DISTINCT value->>'id') INTO distinct_candidate_count
  FROM jsonb_array_elements(NEW.candidate_items);
  SELECT count(DISTINCT value->>'id') INTO distinct_decision_count
  FROM jsonb_array_elements(NEW.selected_items || NEW.excluded_items);
  IF candidate_count<>decision_count
    OR candidate_count<>distinct_candidate_count
    OR decision_count<>distinct_decision_count
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.candidate_items) candidate
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.selected_items || NEW.excluded_items) decision
        WHERE decision->>'id'=candidate->>'id'
      )
    ) THEN
    RAISE EXCEPTION 'CAP-01 ContextCompilation candidate decisions are incomplete or duplicated' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap01_context_compilation_lineage_guard"() FROM PUBLIC;
CREATE TRIGGER "cap01_context_compilation_lineage_guard"
  BEFORE INSERT ON "foundry_product"."context_compilations"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap01_context_compilation_lineage_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap01_context_snapshot_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Context compilation snapshots are immutable; append a new deterministic snapshot' USING ERRCODE='23514';
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap01_context_snapshot_immutable"() FROM PUBLIC;
CREATE TRIGGER "cap01_context_snapshot_immutable"
  BEFORE UPDATE ON "foundry_product"."context_compilations"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap01_context_snapshot_immutable"();
--> statement-breakpoint

-- Rollback boundary: revert application/schema use first, then restore the RW-02
-- helper and remove the triggers, index and additive columns. No historical
-- snapshot row is deleted or rebound to CAP authority.
