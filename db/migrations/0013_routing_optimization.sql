CREATE TABLE "foundry_product"."routing_optimization_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id") ON DELETE CASCADE,
  "task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE CASCADE,
  "episode_id" uuid NOT NULL REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE CASCADE,
  "context_compilation_id" uuid NOT NULL REFERENCES "foundry_product"."context_compilations"("id"),
  "context_snapshot_hash" text NOT NULL,
  "diagnostic_observation_id" uuid NOT NULL REFERENCES "foundry_product"."diagnostic_observations"("id"),
  "capability_resolution_id" uuid NOT NULL REFERENCES "foundry_product"."capability_resolutions"("id"),
  "capability_resolution_input_hash" text NOT NULL,
  "selected_capability_id" uuid NOT NULL REFERENCES "foundry_product"."capabilities"("id"),
  "selected_capability_version_id" uuid NOT NULL REFERENCES "foundry_product"."capability_versions"("id"),
  "selected_capability_version_content_hash" text NOT NULL,
  "activity_plan_id" uuid NOT NULL REFERENCES "foundry_product"."activity_plans"("id"),
  "runtime_delivery_id" uuid NOT NULL REFERENCES "foundry_product"."runtime_deliveries"("id"),
  "learner_attempt_id" uuid NOT NULL REFERENCES "foundry_product"."learner_attempts"("id"),
  "learner_attempt_content_hash" text NOT NULL,
  "teacher_intervention_id" uuid NOT NULL REFERENCES "foundry_product"."teacher_interventions"("id"),
  "proposal_type" text NOT NULL,
  "signal_kind" text NOT NULL,
  "rationale" text NOT NULL,
  "proposed_change" jsonb NOT NULL,
  "evidence_snapshot" jsonb NOT NULL,
  "evidence_refs" jsonb NOT NULL,
  "evidence_hash" text NOT NULL,
  "limitations" jsonb NOT NULL,
  "rule_key" text NOT NULL,
  "rule_version" text NOT NULL,
  "confidence" real NOT NULL,
  "state" text NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "requester_provenance" jsonb NOT NULL,
  "request_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "routing_optimization_type_ck" CHECK ("proposal_type"='ROUTING' AND "signal_kind"='TEACHER_EXCLUSION_OVERRIDE'),
  CONSTRAINT "routing_optimization_state_ck" CHECK ("state"='PENDING_GOVERNANCE'),
  CONSTRAINT "routing_optimization_confidence_ck" CHECK ("confidence">=0 AND "confidence"<=1),
  CONSTRAINT "routing_optimization_json_ck" CHECK (jsonb_typeof("proposed_change")='object' AND jsonb_typeof("evidence_snapshot")='object' AND jsonb_typeof("evidence_refs")='array' AND jsonb_typeof("limitations")='array'),
  CONSTRAINT "routing_optimization_hash_ck" CHECK (length("context_snapshot_hash")>7 AND length("capability_resolution_input_hash")>7 AND length("selected_capability_version_content_hash")>7 AND length("learner_attempt_content_hash")>7 AND length("evidence_hash")>7 AND length("request_hash")>7)
);
CREATE UNIQUE INDEX "routing_optimization_intervention_uq" ON "foundry_product"."routing_optimization_proposals" ("teacher_intervention_id");
CREATE UNIQUE INDEX "routing_optimization_request_hash_uq" ON "foundry_product"."routing_optimization_proposals" ("institution_id","request_hash");
CREATE INDEX "routing_optimization_course_idx" ON "foundry_product"."routing_optimization_proposals" ("institution_id","course_id","created_at");
--> statement-breakpoint

CREATE TABLE "foundry_product"."routing_optimization_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "foundry_product"."routing_optimization_proposals"("id"),
  "task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id"),
  "capability_resolution_id" uuid NOT NULL REFERENCES "foundry_product"."capability_resolutions"("id"),
  "action" text NOT NULL,
  "rationale" text NOT NULL,
  "decided_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "actor_provenance" jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "routing_optimization_decision_action_ck" CHECK ("action" IN ('REQUEST_POLICY_REVIEW','KEEP_CURRENT_POLICY')),
  CONSTRAINT "routing_optimization_decision_payload_ck" CHECK (length(btrim("rationale"))>=5 AND length("request_hash")>7)
);
CREATE UNIQUE INDEX "routing_optimization_decision_proposal_uq" ON "foundry_product"."routing_optimization_decisions" ("proposal_id");
CREATE UNIQUE INDEX "routing_optimization_decision_actor_key_uq" ON "foundry_product"."routing_optimization_decisions" ("institution_id","decided_by","idempotency_key");
--> statement-breakpoint

ALTER TABLE "foundry_product"."routing_optimization_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."routing_optimization_proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "routing_optimization_governor_read" ON "foundry_product"."routing_optimization_proposals" FOR SELECT TO foundry_product_runtime
  USING (foundry_product.cap07_actor_has_course("institution_id","course_id")
    AND string_to_array(COALESCE(current_setting('foundry.roles',true),''),',') && ARRAY['TEACHER','EXPERT','ADMIN']);
CREATE POLICY "routing_optimization_governor_insert" ON "foundry_product"."routing_optimization_proposals" FOR INSERT TO foundry_product_runtime
  WITH CHECK (foundry_product.cap07_actor_has_course("institution_id","course_id")
    AND string_to_array(COALESCE(current_setting('foundry.roles',true),''),',') && ARRAY['TEACHER','EXPERT','ADMIN']);
ALTER TABLE "foundry_product"."routing_optimization_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."routing_optimization_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "routing_optimization_decision_governor_read" ON "foundry_product"."routing_optimization_decisions" FOR SELECT TO foundry_product_runtime
  USING (foundry_product.cap07_actor_has_course("institution_id","course_id")
    AND string_to_array(COALESCE(current_setting('foundry.roles',true),''),',') && ARRAY['TEACHER','EXPERT','ADMIN']);
CREATE POLICY "routing_optimization_decision_governor_insert" ON "foundry_product"."routing_optimization_decisions" FOR INSERT TO foundry_product_runtime
  WITH CHECK (foundry_product.cap07_actor_has_course("institution_id","course_id")
    AND string_to_array(COALESCE(current_setting('foundry.roles',true),''),',') && ARRAY['TEACHER','EXPERT','ADMIN']);
GRANT SELECT, INSERT ON "foundry_product"."routing_optimization_proposals" TO foundry_product_runtime;
GRANT SELECT, INSERT ON "foundry_product"."routing_optimization_decisions" TO foundry_product_runtime;
--> statement-breakpoint

INSERT INTO foundry_private.table_authority_catalog(schema_name,table_name,classification,policy_required) VALUES
  ('foundry_product','routing_optimization_proposals','TENANT_DIRECT_CLASS_B',true),
  ('foundry_product','routing_optimization_decisions','TENANT_DIRECT_HUMAN_DECISION',true)
ON CONFLICT (schema_name,table_name) DO UPDATE SET classification=EXCLUDED.classification,policy_required=EXCLUDED.policy_required;
INSERT INTO foundry_private.writable_lineage_catalog(schema_name,table_name,writable_roles,tenant_references) VALUES
  ('foundry_product','routing_optimization_proposals',ARRAY['foundry_product_runtime'],'institution; course; Task/Episode; exact Context/Diagnosis/CapabilityResolution candidate set and selected CapabilityVersion; ActivityPlan; RuntimeDelivery; LearnerAttempt; TeacherIntervention'),
  ('foundry_product','routing_optimization_decisions',ARRAY['foundry_product_runtime'],'institution; course; exact RoutingOptimizationProposal; authenticated teacher/expert next action')
ON CONFLICT (schema_name,table_name) DO UPDATE SET writable_roles=EXCLUDED.writable_roles,tenant_references=EXCLUDED.tenant_references;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."idempotency_result_in_tenant"("command_name" text,"result_id" uuid,"tenant_id" uuid)
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
    WHEN 'CREATE_GOVERNED_FOLLOWUP' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.retry_attempts WHERE id=result_id) OR foundry_private.entity_in_tenant('RETRY',result_id,tenant_id);
    WHEN 'LEARNING_OUTCOME' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learning_outcomes WHERE id=result_id) OR foundry_private.entity_in_tenant('OUTCOME',result_id,tenant_id);
    WHEN 'COMPONENT_CANDIDATE' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.components WHERE id=result_id) OR foundry_private.entity_in_tenant('COMPONENT',result_id,tenant_id);
    WHEN 'UPDATE_COMPONENT_VERSION' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_versions WHERE id=result_id) OR foundry_private.entity_in_tenant('VERSION',result_id,tenant_id);
    WHEN 'COMPONENT_PUBLICATION_DECISION' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.publication_decisions WHERE id=result_id) OR foundry_private.entity_in_tenant('DECISION',result_id,tenant_id);
    WHEN 'COMPONENT_ROLLBACK' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.publication_decisions WHERE id=result_id) OR foundry_private.entity_in_tenant('DECISION',result_id,tenant_id);
    WHEN 'DELIVER_COMPONENT_SUPPORT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_deliveries WHERE id=result_id) OR foundry_private.entity_in_tenant('DELIVERY',result_id,tenant_id);
    WHEN 'TEACHER_ASSIGN_TASK' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.teacher_assignments WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.teacher_assignments WHERE id=result_id AND institution_id=tenant_id);
    WHEN 'TEACHER_INTERVENE_RUNTIME' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.teacher_interventions WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.teacher_interventions WHERE id=result_id AND institution_id=tenant_id);
    WHEN 'CREATE_ASSET_OPTIMIZATION_PROPOSAL' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.asset_optimization_proposals WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.asset_optimization_proposals WHERE id=result_id AND institution_id=tenant_id);
    WHEN 'DECIDE_ASSET_OPTIMIZATION_PROPOSAL' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.asset_optimization_decisions WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.asset_optimization_decisions WHERE id=result_id AND institution_id=tenant_id);
    WHEN 'CREATE_ROUTING_OPTIMIZATION_PROPOSAL' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.routing_optimization_proposals WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.routing_optimization_proposals WHERE id=result_id AND institution_id=tenant_id);
    WHEN 'DECIDE_ROUTING_OPTIMIZATION_PROPOSAL' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.routing_optimization_decisions WHERE id=result_id) OR EXISTS (SELECT 1 FROM foundry_product.routing_optimization_decisions WHERE id=result_id AND institution_id=tenant_id);
    ELSE RETURN false;
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."idempotency_result_in_tenant"(text,uuid,uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_idempotency_reservation_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_id uuid := NULLIF(current_setting('foundry.user_id',true),'')::uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.command_type='CREATE_GOVERNED_FOLLOWUP' THEN
      RAISE EXCEPTION 'Governed follow-up idempotency reservation is immutable' USING ERRCODE='23514';
    ELSIF OLD.command_type IN ('CREATE_ASSET_OPTIMIZATION_PROPOSAL','DECIDE_ASSET_OPTIMIZATION_PROPOSAL') THEN
      RAISE EXCEPTION 'Asset Optimization idempotency reservation is immutable' USING ERRCODE='23514';
    ELSIF OLD.command_type IN ('CREATE_ROUTING_OPTIMIZATION_PROPOSAL','DECIDE_ROUTING_OPTIMIZATION_PROPOSAL') THEN
      RAISE EXCEPTION 'Routing Optimization idempotency reservation is immutable' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.command_type='CREATE_GOVERNED_FOLLOWUP' THEN
    RAISE EXCEPTION 'Governed follow-up idempotency reservation is immutable' USING ERRCODE='23514';
  ELSIF TG_OP='UPDATE' AND (OLD.command_type IN ('CREATE_ASSET_OPTIMIZATION_PROPOSAL','DECIDE_ASSET_OPTIMIZATION_PROPOSAL')
      OR NEW.command_type IN ('CREATE_ASSET_OPTIMIZATION_PROPOSAL','DECIDE_ASSET_OPTIMIZATION_PROPOSAL')) THEN
    RAISE EXCEPTION 'Asset Optimization idempotency reservation is immutable' USING ERRCODE='23514';
  ELSIF TG_OP='UPDATE' AND (OLD.command_type IN ('CREATE_ROUTING_OPTIMIZATION_PROPOSAL','DECIDE_ROUTING_OPTIMIZATION_PROPOSAL')
      OR NEW.command_type IN ('CREATE_ROUTING_OPTIMIZATION_PROPOSAL','DECIDE_ROUTING_OPTIMIZATION_PROPOSAL')) THEN
    RAISE EXCEPTION 'Routing Optimization idempotency reservation is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.command_type IN ('CREATE_GOVERNED_FOLLOWUP','CREATE_ASSET_OPTIMIZATION_PROPOSAL','DECIDE_ASSET_OPTIMIZATION_PROPOSAL','CREATE_ROUTING_OPTIMIZATION_PROPOSAL','DECIDE_ROUTING_OPTIMIZATION_PROPOSAL') THEN
    IF actor_id IS NULL THEN
      RAISE EXCEPTION 'Governed reservation requires an authenticated actor' USING ERRCODE='23514';
    END IF;
    IF NEW.actor_user_id IS NULL THEN NEW.actor_user_id := actor_id; END IF;
    IF NEW.actor_user_id<>actor_id OR length(btrim(NEW.request_hash))<=7 THEN
      RAISE EXCEPTION 'Governed reservation actor/request identity mismatch' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.actor_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only governed follow-up or Optimization reservations may carry actor identity' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_idempotency_reservation_guard"() FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.assert_routing_optimization_proposal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid;
  tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  roles text[]:=string_to_array(COALESCE(current_setting('foundry.roles',true),''),',');
  lineage record;
  selected_candidate jsonb;
  expected_snapshot jsonb;
  expected_refs jsonb;
  expected_change jsonb;
  expected_evidence_hash text;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR length(COALESCE(current_setting('foundry.session_id',true),''))=0
    OR NOT roles && ARRAY['TEACHER','EXPERT','ADMIN'] THEN
    RAISE EXCEPTION 'Routing Optimization Proposal requires an authenticated teacher or expert command' USING ERRCODE='42501';
  END IF;
  SELECT intervention.institution_id, intervention.course_id, intervention.task_id, intervention.episode_id,
    intervention.runtime_delivery_id, intervention.learner_attempt_id, intervention.activity_plan_id,
    intervention.diagnostic_observation_id, intervention.context_compilation_id, intervention.capability_resolution_id,
    intervention.capability_version_id AS intervention_capability_version_id,
    intervention.constraint_capability_id, intervention.action_type, intervention.reason AS intervention_reason,
    intervention.teacher_id, intervention.target_lineage,
    constraint_row.id AS constraint_id, constraint_row.effect AS constraint_effect,
    task.status AS task_status, episode.status AS episode_status,
    context.consumer AS context_consumer, context.compiler_version, context.context_policy_version,
    context.input_hash AS context_input_hash, context.snapshot_hash AS exact_context_snapshot_hash,
    context.selected_items, context.excluded_items,
    diagnosis.attempt_id AS diagnosis_attempt_id, diagnosis.status AS diagnosis_status,
    diagnosis.failure_code, diagnosis.summary AS diagnosis_summary, diagnosis.structured_result,
    diagnosis.input_lineage AS diagnosis_input_lineage, diagnosis.output_lineage AS diagnosis_output_lineage,
    diagnosis.superseded_by_id,
    resolution.policy_version, resolution.input_hash AS exact_resolution_input_hash,
    resolution.decision AS resolution_decision, resolution.candidate_set,
    resolution.selected_capability_id, resolution.selected_capability_version_id,
    resolution.selection_rationale, resolution.no_match,
    plan.input_hash AS activity_plan_input_hash, plan.capability_version_content_hash AS plan_capability_hash,
    delivery.status AS delivery_status, delivery.request_hash AS delivery_request_hash,
    delivery.output_hash AS delivery_output_hash, delivery.capability_version_content_hash AS delivery_capability_hash,
    attempt.content_hash AS attempt_content_hash, attempt.modality AS attempt_modality,
    capability.key AS selected_capability_key, capability.name AS selected_capability_name,
    capability.active_version_id, capability_version.version AS selected_capability_version,
    capability_version.status AS selected_capability_version_status, capability_version.content_hash AS exact_capability_hash,
    COALESCE((SELECT jsonb_agg(review.id::text ORDER BY review.created_at,review.id)
      FROM foundry_product.teacher_reviews review WHERE review.observation_id=diagnosis.id),'[]'::jsonb) AS teacher_review_ids,
    COALESCE((SELECT jsonb_agg(outcome.id::text ORDER BY outcome.created_at,outcome.id)
      FROM foundry_product.learning_outcomes outcome
      JOIN foundry_product.retry_attempts retry ON retry.id=outcome.retry_id
      WHERE outcome.task_id=task.id AND retry.original_attempt_id IN (diagnosis.attempt_id,attempt.id)),'[]'::jsonb) AS learning_outcome_ids
  INTO lineage
  FROM foundry_product.teacher_interventions intervention
  JOIN foundry_product.teacher_capability_constraints constraint_row ON constraint_row.source_intervention_id=intervention.id
  JOIN foundry_product.learning_tasks task ON task.id=intervention.task_id AND task.institution_id=intervention.institution_id AND task.course_id=intervention.course_id
  JOIN foundry_product.learning_episodes episode ON episode.id=intervention.episode_id AND episode.task_id=task.id
  JOIN foundry_product.context_compilations context ON context.id=intervention.context_compilation_id AND context.task_id=task.id AND context.episode_id=episode.id
  JOIN foundry_product.diagnostic_observations diagnosis ON diagnosis.id=intervention.diagnostic_observation_id
  JOIN foundry_product.capability_resolutions resolution ON resolution.id=intervention.capability_resolution_id
    AND resolution.institution_id=intervention.institution_id AND resolution.course_id=intervention.course_id
    AND resolution.task_id=task.id AND resolution.episode_id=episode.id
    AND resolution.context_compilation_id=context.id AND resolution.diagnostic_observation_id=diagnosis.id
  JOIN foundry_product.activity_plans plan ON plan.id=intervention.activity_plan_id
    AND plan.task_id=task.id AND plan.episode_id=episode.id AND plan.context_compilation_id=context.id
    AND plan.diagnostic_observation_id=diagnosis.id AND plan.capability_resolution_id=resolution.id
  JOIN foundry_product.runtime_deliveries delivery ON delivery.id=intervention.runtime_delivery_id
    AND delivery.activity_plan_id=plan.id AND delivery.task_id=task.id AND delivery.episode_id=episode.id
  JOIN foundry_product.learner_attempts attempt ON attempt.id=intervention.learner_attempt_id
    AND attempt.runtime_delivery_id=delivery.id AND attempt.activity_plan_id=plan.id
  JOIN foundry_product.capabilities capability ON capability.id=resolution.selected_capability_id AND capability.id=plan.capability_id AND capability.id=delivery.capability_id
  JOIN foundry_product.capability_versions capability_version ON capability_version.id=resolution.selected_capability_version_id
    AND capability_version.id=plan.capability_version_id AND capability_version.id=delivery.capability_version_id
    AND capability_version.capability_id=capability.id
  WHERE intervention.id=NEW.teacher_intervention_id
    AND intervention.institution_id=NEW.institution_id AND intervention.course_id=NEW.course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Routing Optimization Proposal exact Context, Diagnosis, Resolution, Plan, Delivery, Attempt or Intervention lineage mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.institution_id<>tenant_id OR NEW.requested_by<>actor_id OR NOT foundry_product.cap07_actor_has_course(NEW.institution_id,NEW.course_id) THEN
    RAISE EXCEPTION 'Routing Optimization Proposal actor lacks current course authority' USING ERRCODE='42501';
  END IF;
  SELECT candidate INTO selected_candidate FROM jsonb_array_elements(lineage.candidate_set) candidate
  WHERE candidate->>'capabilityId'=lineage.selected_capability_id::text
    AND candidate->>'versionId'=lineage.selected_capability_version_id::text
    AND candidate->>'eligibility'='ELIGIBLE' LIMIT 1;
  IF selected_candidate IS NULL OR selected_candidate->>'contentHash' IS DISTINCT FROM lineage.exact_capability_hash THEN
    RAISE EXCEPTION 'Routing Optimization requires the exact eligible selected candidate and complete candidate/exclusion set' USING ERRCODE='23514';
  END IF;
  IF lineage.action_type<>'EXCLUDE_CAPABILITY' OR lineage.constraint_effect<>'EXCLUDE'
    OR lineage.constraint_capability_id<>lineage.selected_capability_id
    OR lineage.intervention_capability_version_id<>lineage.selected_capability_version_id
    OR lineage.resolution_decision<>'EXISTING' OR lineage.no_match THEN
    RAISE EXCEPTION 'Routing Optimization requires an explicit teacher exclusion of the exact selected Capability, independent of Attempt correctness' USING ERRCODE='23514';
  END IF;
  IF NEW.task_id<>lineage.task_id OR NEW.episode_id<>lineage.episode_id
    OR NEW.context_compilation_id<>lineage.context_compilation_id OR NEW.context_snapshot_hash<>lineage.exact_context_snapshot_hash
    OR NEW.diagnostic_observation_id<>lineage.diagnostic_observation_id
    OR NEW.capability_resolution_id<>lineage.capability_resolution_id OR NEW.capability_resolution_input_hash<>lineage.exact_resolution_input_hash
    OR NEW.selected_capability_id<>lineage.selected_capability_id OR NEW.selected_capability_version_id<>lineage.selected_capability_version_id
    OR NEW.selected_capability_version_content_hash<>lineage.exact_capability_hash
    OR NEW.activity_plan_id<>lineage.activity_plan_id OR NEW.runtime_delivery_id<>lineage.runtime_delivery_id
    OR NEW.learner_attempt_id<>lineage.learner_attempt_id OR NEW.learner_attempt_content_hash<>lineage.attempt_content_hash
    OR lineage.plan_capability_hash<>lineage.exact_capability_hash OR lineage.delivery_capability_hash<>lineage.exact_capability_hash THEN
    RAISE EXCEPTION 'Routing Optimization Proposal exact lineage identity or hash mismatch' USING ERRCODE='23514';
  END IF;
  IF lineage.task_status<>'OPEN' OR lineage.episode_status<>'ACTIVE' OR lineage.superseded_by_id IS NOT NULL
    OR lineage.active_version_id IS DISTINCT FROM lineage.selected_capability_version_id
    OR lineage.selected_capability_version_status<>'ACTIVE'
    OR lineage.delivery_status NOT IN ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED')
    OR lineage.attempt_content_hash IS NULL
    OR EXISTS (SELECT 1 FROM foundry_product.teacher_capability_constraints successor WHERE successor.supersedes_constraint_id=lineage.constraint_id) THEN
    RAISE EXCEPTION 'Routing Optimization source is stale, inactive, non-terminal or superseded' USING ERRCODE='23514';
  END IF;
  IF lineage.target_lineage->>'taskId' IS DISTINCT FROM lineage.task_id::text
    OR lineage.target_lineage->>'episodeId' IS DISTINCT FROM lineage.episode_id::text
    OR lineage.target_lineage->>'contextCompilationId' IS DISTINCT FROM lineage.context_compilation_id::text
    OR lineage.target_lineage->>'contextSnapshotHash' IS DISTINCT FROM lineage.exact_context_snapshot_hash
    OR lineage.target_lineage->>'diagnosticObservationId' IS DISTINCT FROM lineage.diagnostic_observation_id::text
    OR lineage.target_lineage->>'capabilityResolutionId' IS DISTINCT FROM lineage.capability_resolution_id::text
    OR lineage.target_lineage->>'activityPlanId' IS DISTINCT FROM lineage.activity_plan_id::text
    OR lineage.target_lineage->>'runtimeDeliveryId' IS DISTINCT FROM lineage.runtime_delivery_id::text
    OR lineage.target_lineage->>'learnerAttemptId' IS DISTINCT FROM lineage.learner_attempt_id::text
    OR lineage.target_lineage->>'deliveredCapabilityVersionId' IS DISTINCT FROM lineage.selected_capability_version_id::text
    OR lineage.target_lineage->>'deliveredCapabilityVersionContentHash' IS DISTINCT FROM lineage.exact_capability_hash THEN
    RAISE EXCEPTION 'Routing Optimization teacher Intervention target lineage is inconsistent' USING ERRCODE='23514';
  END IF;
  expected_change:=jsonb_build_object(
    'optimizationDomain','ROUTING','changeKind','REVIEW_SELECTION_POLICY_FOR_TEACHER_EXCLUSION','target','CAPABILITY_RESOLUTION_POLICY_SUCCESSOR',
    'contextComparisonScope','COMPARABLE_AUTHORIZED_CONTEXT_ONLY','capabilityResolutionId',lineage.capability_resolution_id::text,
    'policyVersion',lineage.policy_version,'selectedCapabilityId',lineage.selected_capability_id::text,
    'selectedCapabilityVersionId',lineage.selected_capability_version_id::text,'selectedCapabilityKey',selected_candidate->>'capabilityKey',
    'selectedCapabilityVersion',selected_candidate->>'version','teacherInterventionId',NEW.teacher_intervention_id::text,
    'teacherReason',lineage.intervention_reason,
    'description','Review whether a successor to selection policy ' || lineage.policy_version || ' should avoid ' || (selected_candidate->>'capabilityKey') || '@' || (selected_candidate->>'version') || ' for future authorized Contexts comparable to this exact snapshot when the same teacher exclusion applies. The current policy and rankings remain unchanged.',
    'currentPolicyRemainsActive',true,'rankingChanged',false,'eligibilityRuleChanged',false,'automaticApproval',false);
  IF NEW.proposal_type<>'ROUTING' OR NEW.signal_kind<>'TEACHER_EXCLUSION_OVERRIDE' OR NEW.state<>'PENDING_GOVERNANCE'
    OR NEW.proposed_change IS DISTINCT FROM expected_change
    OR NEW.rationale IS DISTINCT FROM 'An authenticated teacher explicitly excluded the exact Capability selected by this recorded Resolution for the next cycle. This independent human intervention supports review of selection policy for comparable authorized Context; the Attempt is lineage only and does not establish a routing failure, asset defect, causation, or learning effectiveness.'
    OR NEW.limitations IS DISTINCT FROM '["ONE_TEACHER_OVERRIDE_ONLY","ATTEMPT_LINEAGE_NOT_ROUTING_VERDICT","NO_EFFECTIVENESS_CLAIM","NO_CAUSAL_ATTRIBUTION","NO_ASSET_OPTIMIZATION","NO_LEARNING_STRATEGY_OPTIMIZATION","NO_AUTOMATIC_POLICY_CHANGE","CURRENT_POLICY_REMAINS_ACTIVE"]'::jsonb
    OR NEW.rule_key<>'cap08b.teacher-exclusion-selected-route-review' OR NEW.rule_version<>'1.0.0' OR abs(NEW.confidence-0.55)>0.000001 THEN
    RAISE EXCEPTION 'Routing Optimization Proposal widened beyond the bounded Routing-only evidence claim' USING ERRCODE='23514';
  END IF;
  expected_snapshot:=jsonb_build_object(
    'context',jsonb_build_object('id',lineage.context_compilation_id::text,'consumer',lineage.context_consumer,
      'compilerVersion',lineage.compiler_version,'contextPolicyVersion',lineage.context_policy_version,
      'inputHash',lineage.context_input_hash,'snapshotHash',lineage.exact_context_snapshot_hash,
      'selectedItemsHash',encode(public.digest(convert_to(lineage.selected_items::text,'UTF8'),'sha256'),'hex'),
      'excludedItemsHash',encode(public.digest(convert_to(lineage.excluded_items::text,'UTF8'),'sha256'),'hex')),
    'diagnosis',jsonb_build_object('id',lineage.diagnostic_observation_id::text,'attemptId',lineage.diagnosis_attempt_id::text,
      'status',lineage.diagnosis_status,'failureCode',lineage.failure_code,'summary',lineage.diagnosis_summary,
      'structuredResultHash',encode(public.digest(convert_to(lineage.structured_result::text,'UTF8'),'sha256'),'hex'),
      'inputLineageHash',encode(public.digest(convert_to(lineage.diagnosis_input_lineage::text,'UTF8'),'sha256'),'hex'),
      'outputLineageHash',encode(public.digest(convert_to(lineage.diagnosis_output_lineage::text,'UTF8'),'sha256'),'hex')),
    'capabilityResolution',jsonb_build_object('id',lineage.capability_resolution_id::text,'policyVersion',lineage.policy_version,
      'inputHash',lineage.exact_resolution_input_hash,'decision',lineage.resolution_decision,
      'candidateSet',lineage.candidate_set,'candidateSetHash',encode(public.digest(convert_to(lineage.candidate_set::text,'UTF8'),'sha256'),'hex'),
      'selectedCapabilityId',lineage.selected_capability_id::text,'selectedCapabilityVersionId',lineage.selected_capability_version_id::text,
      'selectionRationale',lineage.selection_rationale),
    'activityPlan',jsonb_build_object('id',lineage.activity_plan_id::text,'inputHash',lineage.activity_plan_input_hash,
      'capabilityVersionId',lineage.selected_capability_version_id::text,'capabilityVersionContentHash',lineage.exact_capability_hash),
    'runtimeDelivery',jsonb_build_object('id',lineage.runtime_delivery_id::text,'status',lineage.delivery_status,
      'requestHash',lineage.delivery_request_hash,'outputHash',lineage.delivery_output_hash),
    'learnerAttempt',jsonb_build_object('id',lineage.learner_attempt_id::text,'contentHash',lineage.attempt_content_hash,
      'modality',lineage.attempt_modality,'interpretation','LINEAGE_ONLY_NOT_ROUTING_VERDICT'),
    'teacherIntervention',jsonb_build_object('id',NEW.teacher_intervention_id::text,'actionType',lineage.action_type,
      'reason',lineage.intervention_reason,'constraintCapabilityId',lineage.constraint_capability_id::text,
      'teacherId',lineage.teacher_id::text,'targetLineageHash',encode(public.digest(convert_to(lineage.target_lineage::text,'UTF8'),'sha256'),'hex')),
    'teacherReviewIds',lineage.teacher_review_ids,'learningOutcomeIds',lineage.learning_outcome_ids,'outcomeEvidenceUsed',false);
  expected_refs:=jsonb_build_array(
    jsonb_build_object('kind','CONTEXT_COMPILATION','id',lineage.context_compilation_id::text),
    jsonb_build_object('kind','DIAGNOSTIC_OBSERVATION_PROPOSAL','id',lineage.diagnostic_observation_id::text),
    jsonb_build_object('kind','CAPABILITY_RESOLUTION','id',lineage.capability_resolution_id::text),
    jsonb_build_object('kind','CAPABILITY_VERSION','id',lineage.selected_capability_version_id::text),
    jsonb_build_object('kind','ACTIVITY_PLAN','id',lineage.activity_plan_id::text),
    jsonb_build_object('kind','RUNTIME_DELIVERY','id',lineage.runtime_delivery_id::text),
    jsonb_build_object('kind','LEARNER_ATTEMPT','id',lineage.learner_attempt_id::text),
    jsonb_build_object('kind','TEACHER_INTERVENTION','id',NEW.teacher_intervention_id::text))
    || COALESCE((SELECT jsonb_agg(jsonb_build_object('kind','TEACHER_REVIEW','id',ref.value) ORDER BY ref.ordinal)
      FROM jsonb_array_elements_text(lineage.teacher_review_ids) WITH ORDINALITY AS ref(value,ordinal)),'[]'::jsonb)
    || COALESCE((SELECT jsonb_agg(jsonb_build_object('kind','LEARNING_OUTCOME','id',ref.value) ORDER BY ref.ordinal)
      FROM jsonb_array_elements_text(lineage.learning_outcome_ids) WITH ORDINALITY AS ref(value,ordinal)),'[]'::jsonb);
  expected_evidence_hash:=encode(public.digest(convert_to(expected_snapshot::text,'UTF8'),'sha256'),'hex');
  IF NEW.evidence_snapshot IS DISTINCT FROM expected_snapshot OR NEW.evidence_refs IS DISTINCT FROM expected_refs
    OR NEW.evidence_hash IS DISTINCT FROM expected_evidence_hash THEN
    RAISE EXCEPTION 'Routing Optimization Proposal evidence snapshot is not bound to the exact questioned route' USING ERRCODE='23514';
  END IF;
  IF NEW.requester_provenance->>'userId' IS DISTINCT FROM actor_id::text OR NEW.requester_provenance->>'institutionId' IS DISTINCT FROM tenant_id::text
    OR COALESCE(NEW.requester_provenance->>'authMethod','')='' OR COALESCE(NEW.requester_provenance->>'sessionId','')<>current_setting('foundry.session_id',true) THEN
    RAISE EXCEPTION 'Routing Optimization Proposal requester provenance mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM foundry_product.idempotency_keys reservation
    WHERE reservation.institution_id=NEW.institution_id AND reservation.command_type='CREATE_ROUTING_OPTIMIZATION_PROPOSAL'
      AND reservation.result_id=NEW.id AND reservation.request_hash=NEW.request_hash AND reservation.actor_user_id=actor_id) THEN
    RAISE EXCEPTION 'Routing Optimization Proposal requires its exact actor-bound idempotency reservation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.assert_routing_optimization_proposal() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT ON "foundry_product"."routing_optimization_proposals"
FOR EACH ROW EXECUTE FUNCTION foundry_private.assert_routing_optimization_proposal();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.assert_routing_optimization_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid;
  tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  roles text[]:=string_to_array(COALESCE(current_setting('foundry.roles',true),''),',');
  subject record;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR length(COALESCE(current_setting('foundry.session_id',true),''))=0
    OR NOT roles && ARRAY['TEACHER','EXPERT','ADMIN'] THEN
    RAISE EXCEPTION 'Routing Optimization decision requires an authenticated teacher or expert command' USING ERRCODE='42501';
  END IF;
  SELECT proposal.*, task.status AS task_status, episode.status AS episode_status,
    diagnosis.superseded_by_id, capability.active_version_id, capability_version.status AS capability_version_status,
    constraint_row.id AS constraint_id
  INTO subject
  FROM foundry_product.routing_optimization_proposals proposal
  JOIN foundry_product.learning_tasks task ON task.id=proposal.task_id
  JOIN foundry_product.learning_episodes episode ON episode.id=proposal.episode_id AND episode.task_id=task.id
  JOIN foundry_product.diagnostic_observations diagnosis ON diagnosis.id=proposal.diagnostic_observation_id
  JOIN foundry_product.capabilities capability ON capability.id=proposal.selected_capability_id
  JOIN foundry_product.capability_versions capability_version ON capability_version.id=proposal.selected_capability_version_id AND capability_version.capability_id=capability.id
  JOIN foundry_product.teacher_capability_constraints constraint_row ON constraint_row.source_intervention_id=proposal.teacher_intervention_id
  WHERE proposal.id=NEW.proposal_id AND proposal.institution_id=NEW.institution_id AND proposal.course_id=NEW.course_id;
  IF NOT FOUND OR NEW.task_id<>subject.task_id OR NEW.capability_resolution_id<>subject.capability_resolution_id THEN
    RAISE EXCEPTION 'Routing Optimization decision exact proposal subject mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.institution_id<>tenant_id OR NEW.decided_by<>actor_id OR NOT foundry_product.cap07_actor_has_course(NEW.institution_id,NEW.course_id) THEN
    RAISE EXCEPTION 'Routing Optimization decision actor lacks current course authority' USING ERRCODE='42501';
  END IF;
  IF subject.task_status<>'OPEN' OR subject.episode_status<>'ACTIVE' OR subject.superseded_by_id IS NOT NULL
    OR subject.active_version_id IS DISTINCT FROM subject.selected_capability_version_id
    OR subject.capability_version_status<>'ACTIVE'
    OR EXISTS (SELECT 1 FROM foundry_product.teacher_capability_constraints successor WHERE successor.supersedes_constraint_id=subject.constraint_id) THEN
    RAISE EXCEPTION 'Routing Optimization source is no longer current; no current-policy decision can be recorded from stale evidence' USING ERRCODE='23514';
  END IF;
  IF NEW.actor_provenance->>'userId' IS DISTINCT FROM actor_id::text OR NEW.actor_provenance->>'institutionId' IS DISTINCT FROM tenant_id::text
    OR COALESCE(NEW.actor_provenance->>'authMethod','')='' OR COALESCE(NEW.actor_provenance->>'sessionId','')<>current_setting('foundry.session_id',true) THEN
    RAISE EXCEPTION 'Routing Optimization decision actor provenance mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM foundry_product.idempotency_keys reservation
    WHERE reservation.institution_id=NEW.institution_id AND reservation.command_type='DECIDE_ROUTING_OPTIMIZATION_PROPOSAL'
      AND reservation.key=NEW.idempotency_key AND reservation.result_id=NEW.id
      AND reservation.request_hash=NEW.request_hash AND reservation.actor_user_id=actor_id) THEN
    RAISE EXCEPTION 'Routing Optimization decision requires its exact actor-bound idempotency reservation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.assert_routing_optimization_decision() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT ON "foundry_product"."routing_optimization_decisions"
FOR EACH ROW EXECUTE FUNCTION foundry_private.assert_routing_optimization_decision();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.reject_routing_optimization_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Routing Optimization evidence and governance are append-only' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION foundry_private.reject_routing_optimization_mutation() FROM PUBLIC;
CREATE TRIGGER "routing_optimization_proposal_immutable" BEFORE UPDATE OR DELETE ON "foundry_product"."routing_optimization_proposals"
FOR EACH ROW EXECUTE FUNCTION foundry_private.reject_routing_optimization_mutation();
CREATE TRIGGER "routing_optimization_decision_immutable" BEFORE UPDATE OR DELETE ON "foundry_product"."routing_optimization_decisions"
FOR EACH ROW EXECUTE FUNCTION foundry_private.reject_routing_optimization_mutation();
