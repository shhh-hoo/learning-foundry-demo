CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
--> statement-breakpoint

CREATE TABLE "foundry_product"."asset_optimization_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id") ON DELETE CASCADE,
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"),
  "component_version_id" uuid NOT NULL REFERENCES "foundry_product"."component_versions"("id"),
  "component_version_content_hash" text NOT NULL,
  "capability_id" uuid NOT NULL REFERENCES "foundry_product"."capabilities"("id"),
  "capability_version_id" uuid NOT NULL REFERENCES "foundry_product"."capability_versions"("id"),
  "capability_version_content_hash" text NOT NULL,
  "capability_supply_relation_id" uuid NOT NULL REFERENCES "foundry_product"."capability_supply_relations"("id"),
  "runtime_delivery_id" uuid NOT NULL REFERENCES "foundry_product"."runtime_deliveries"("id"),
  "learner_attempt_id" uuid NOT NULL REFERENCES "foundry_product"."learner_attempts"("id"),
  "learner_attempt_content_hash" text NOT NULL,
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
  CONSTRAINT "asset_optimization_type_ck" CHECK ("proposal_type"='ASSET' AND "signal_kind"='INCORRECT_ATTEMPT'),
  CONSTRAINT "asset_optimization_state_ck" CHECK ("state"='PENDING_GOVERNANCE'),
  CONSTRAINT "asset_optimization_confidence_ck" CHECK ("confidence">=0 AND "confidence"<=1),
  CONSTRAINT "asset_optimization_json_ck" CHECK (jsonb_typeof("proposed_change")='object' AND jsonb_typeof("evidence_snapshot")='object' AND jsonb_typeof("evidence_refs")='array' AND jsonb_typeof("limitations")='array'),
  CONSTRAINT "asset_optimization_hash_ck" CHECK (length("component_version_content_hash")>7 AND length("capability_version_content_hash")>7 AND length("learner_attempt_content_hash")>7 AND length("evidence_hash")>7 AND length("request_hash")>7)
);
CREATE UNIQUE INDEX "asset_optimization_delivery_uq" ON "foundry_product"."asset_optimization_proposals" ("runtime_delivery_id");
CREATE UNIQUE INDEX "asset_optimization_request_hash_uq" ON "foundry_product"."asset_optimization_proposals" ("institution_id","request_hash");
CREATE INDEX "asset_optimization_course_idx" ON "foundry_product"."asset_optimization_proposals" ("institution_id","course_id","created_at");
--> statement-breakpoint

CREATE TABLE "foundry_product"."asset_optimization_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "foundry_product"."asset_optimization_proposals"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"),
  "component_version_id" uuid NOT NULL REFERENCES "foundry_product"."component_versions"("id"),
  "action" text NOT NULL,
  "rationale" text NOT NULL,
  "decided_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "actor_provenance" jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_optimization_decision_action_ck" CHECK ("action" IN ('REQUEST_SUCCESSOR','KEEP_CURRENT')),
  CONSTRAINT "asset_optimization_decision_payload_ck" CHECK (length(btrim("rationale"))>=5 AND length("request_hash")>7)
);
CREATE UNIQUE INDEX "asset_optimization_decision_proposal_uq" ON "foundry_product"."asset_optimization_decisions" ("proposal_id");
CREATE UNIQUE INDEX "asset_optimization_decision_actor_key_uq" ON "foundry_product"."asset_optimization_decisions" ("institution_id","decided_by","idempotency_key");
--> statement-breakpoint

ALTER TABLE "foundry_product"."asset_optimization_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."asset_optimization_proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "asset_optimization_governor_read" ON "foundry_product"."asset_optimization_proposals" FOR SELECT TO foundry_product_runtime
  USING (foundry_product.cap07_actor_has_course("institution_id","course_id")
    AND string_to_array(COALESCE(current_setting('foundry.roles',true),''),',') && ARRAY['TEACHER','EXPERT','ADMIN']);
CREATE POLICY "asset_optimization_governor_insert" ON "foundry_product"."asset_optimization_proposals" FOR INSERT TO foundry_product_runtime
  WITH CHECK (foundry_product.cap07_actor_has_course("institution_id","course_id")
    AND string_to_array(COALESCE(current_setting('foundry.roles',true),''),',') && ARRAY['TEACHER','EXPERT','ADMIN']);
ALTER TABLE "foundry_product"."asset_optimization_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foundry_product"."asset_optimization_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "asset_optimization_decision_governor_read" ON "foundry_product"."asset_optimization_decisions" FOR SELECT TO foundry_product_runtime
  USING (foundry_product.cap07_actor_has_course("institution_id","course_id")
    AND string_to_array(COALESCE(current_setting('foundry.roles',true),''),',') && ARRAY['TEACHER','EXPERT','ADMIN']);
CREATE POLICY "asset_optimization_decision_governor_insert" ON "foundry_product"."asset_optimization_decisions" FOR INSERT TO foundry_product_runtime
  WITH CHECK (foundry_product.cap07_actor_has_course("institution_id","course_id")
    AND string_to_array(COALESCE(current_setting('foundry.roles',true),''),',') && ARRAY['TEACHER','EXPERT','ADMIN']);
GRANT SELECT, INSERT ON "foundry_product"."asset_optimization_proposals" TO foundry_product_runtime;
GRANT SELECT, INSERT ON "foundry_product"."asset_optimization_decisions" TO foundry_product_runtime;
--> statement-breakpoint

INSERT INTO foundry_private.table_authority_catalog(schema_name,table_name,classification,policy_required) VALUES
  ('foundry_product','asset_optimization_proposals','TENANT_DIRECT_CLASS_B',true),
  ('foundry_product','asset_optimization_decisions','TENANT_DIRECT_HUMAN_DECISION',true)
ON CONFLICT (schema_name,table_name) DO UPDATE SET classification=EXCLUDED.classification,policy_required=EXCLUDED.policy_required;
INSERT INTO foundry_private.writable_lineage_catalog(schema_name,table_name,writable_roles,tenant_references) VALUES
  ('foundry_product','asset_optimization_proposals',ARRAY['foundry_product_runtime'],'institution; course; exact delivered ComponentAssetVersion/CapabilityVersion; supply relation; RuntimeDelivery; LearnerAttempt'),
  ('foundry_product','asset_optimization_decisions',ARRAY['foundry_product_runtime'],'institution; course; exact AssetOptimizationProposal; authenticated teacher/expert next action')
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
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.command_type='CREATE_GOVERNED_FOLLOWUP' THEN
    RAISE EXCEPTION 'Governed follow-up idempotency reservation is immutable' USING ERRCODE='23514';
  ELSIF TG_OP='UPDATE' AND (OLD.command_type IN ('CREATE_ASSET_OPTIMIZATION_PROPOSAL','DECIDE_ASSET_OPTIMIZATION_PROPOSAL')
      OR NEW.command_type IN ('CREATE_ASSET_OPTIMIZATION_PROPOSAL','DECIDE_ASSET_OPTIMIZATION_PROPOSAL')) THEN
    RAISE EXCEPTION 'Asset Optimization idempotency reservation is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.command_type IN ('CREATE_GOVERNED_FOLLOWUP','CREATE_ASSET_OPTIMIZATION_PROPOSAL','DECIDE_ASSET_OPTIMIZATION_PROPOSAL') THEN
    IF actor_id IS NULL THEN
      RAISE EXCEPTION 'Governed reservation requires an authenticated actor' USING ERRCODE='23514';
    END IF;
    IF NEW.actor_user_id IS NULL THEN NEW.actor_user_id := actor_id; END IF;
    IF NEW.actor_user_id<>actor_id OR length(btrim(NEW.request_hash))<=7 THEN
      RAISE EXCEPTION 'Governed reservation actor/request identity mismatch' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.actor_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only governed follow-up or Asset Optimization reservations may carry actor identity' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_idempotency_reservation_guard"() FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.assert_asset_optimization_proposal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid;
  tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  roles text[]:=string_to_array(COALESCE(current_setting('foundry.roles',true),''),',');
  lineage record;
  expected_snapshot jsonb;
  expected_refs jsonb;
  expected_change jsonb;
  expected_evidence_hash text;
  selected_choice_id text;
  selected_choice_label text;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR length(COALESCE(current_setting('foundry.session_id',true),''))=0
    OR NOT roles && ARRAY['TEACHER','EXPERT','ADMIN'] THEN
    RAISE EXCEPTION 'Asset Optimization Proposal requires an authenticated teacher or expert command' USING ERRCODE='42501';
  END IF;
  SELECT delivery.*, attempt.content_hash AS attempt_content_hash, attempt.structured_input AS attempt_structured_input,
    plan.id AS exact_activity_plan_id, plan.capability_version_id AS plan_capability_version_id,
    capability_version.content_hash AS exact_capability_hash, capability_version.component_asset_version_id,
    capability_version.status AS capability_version_status, capability.active_version_id AS active_capability_version_id,
    component_version.component_id AS exact_component_id, component_version.content_hash AS exact_component_hash, component_version.content AS component_package,
    component_version.status AS component_version_status, component.active_version_id AS active_component_version_id,
    supply.id AS exact_supply_id
  INTO lineage
  FROM foundry_product.runtime_deliveries delivery
  JOIN foundry_product.activity_plans plan ON plan.id=delivery.activity_plan_id
    AND plan.capability_id=delivery.capability_id AND plan.capability_version_id=delivery.capability_version_id
  JOIN foundry_product.learner_attempts attempt ON attempt.id=NEW.learner_attempt_id
    AND attempt.runtime_delivery_id=delivery.id AND attempt.activity_plan_id=plan.id
    AND attempt.capability_id=delivery.capability_id AND attempt.capability_version_id=delivery.capability_version_id
  JOIN foundry_product.capability_versions capability_version ON capability_version.id=delivery.capability_version_id
  JOIN foundry_product.capabilities capability ON capability.id=capability_version.capability_id AND capability.id=delivery.capability_id
  JOIN foundry_product.component_versions component_version ON component_version.id=capability_version.component_asset_version_id
  JOIN foundry_product.components component ON component.id=component_version.component_id
  JOIN foundry_product.capability_supply_relations supply ON supply.id=NEW.capability_supply_relation_id
    AND supply.component_id=component.id AND supply.component_version_id=component_version.id
    AND supply.registered_capability_id=delivery.capability_id AND supply.registered_capability_version_id=delivery.capability_version_id
  WHERE delivery.id=NEW.runtime_delivery_id
    AND delivery.institution_id=NEW.institution_id AND delivery.course_id=NEW.course_id
    AND delivery.capability_id=NEW.capability_id AND delivery.capability_version_id=NEW.capability_version_id
    AND component.institution_id=NEW.institution_id AND component.course_id=NEW.course_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset Optimization Proposal exact delivery, Attempt, ComponentAssetVersion or supply lineage mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.institution_id<>tenant_id OR NEW.requested_by<>actor_id OR NOT foundry_product.cap07_actor_has_course(NEW.institution_id,NEW.course_id) THEN
    RAISE EXCEPTION 'Asset Optimization Proposal actor lacks current course authority' USING ERRCODE='42501';
  END IF;
  IF NEW.component_id<>lineage.exact_component_id OR NEW.component_version_id<>lineage.component_asset_version_id
    OR NEW.component_version_content_hash<>lineage.exact_component_hash
    OR NEW.capability_version_content_hash<>lineage.exact_capability_hash
    OR NEW.learner_attempt_content_hash<>lineage.attempt_content_hash
    OR lineage.capability_version_content_hash<>lineage.exact_capability_hash
    OR NEW.capability_supply_relation_id<>lineage.exact_supply_id THEN
    RAISE EXCEPTION 'Asset Optimization Proposal exact version or hash lineage mismatch' USING ERRCODE='23514';
  END IF;
  IF lineage.active_component_version_id IS DISTINCT FROM lineage.component_asset_version_id
    OR lineage.active_capability_version_id IS DISTINCT FROM NEW.capability_version_id
    OR lineage.component_version_status<>'PUBLISHED' OR lineage.capability_version_status<>'ACTIVE' THEN
    RAISE EXCEPTION 'Asset Optimization Proposal requires the current active exact ComponentAssetVersion and CapabilityVersion' USING ERRCODE='23514';
  END IF;
  IF lineage.status<>'SUCCEEDED' OR jsonb_typeof(lineage.normalized_output->'correct') IS DISTINCT FROM 'boolean'
    OR COALESCE((lineage.normalized_output->>'correct')::boolean,true) OR lineage.output_hash IS NULL THEN
    RAISE EXCEPTION 'CAP-08A requires one real successful incorrect learner Attempt, not usage or completion alone' USING ERRCODE='23514';
  END IF;
  selected_choice_id:=lineage.attempt_structured_input->'assetRuntimeInput'->>'selectedChoiceId';
  SELECT choice->>'label' INTO selected_choice_label
  FROM jsonb_array_elements(lineage.component_package->'choices') choice
  WHERE choice->>'id'=selected_choice_id;
  IF selected_choice_id IS NULL OR selected_choice_label IS NULL
    OR selected_choice_id IS NOT DISTINCT FROM lineage.component_package->>'correctChoiceId'
    OR lineage.normalized_output->>'selectedChoiceId' IS DISTINCT FROM selected_choice_id THEN
    RAISE EXCEPTION 'Asset Optimization rule requires the exact declared incorrect choice from the persisted Attempt and runtime result' USING ERRCODE='23514';
  END IF;
  expected_change:=jsonb_build_object(
    'optimizationDomain','ASSET','changeKind','ADD_DISTRACTOR_SPECIFIC_RETRY_FEEDBACK','target','EXACT_COMPONENT_ASSET_SUCCESSOR',
    'selectedChoiceId',selected_choice_id,'selectedChoiceLabel',selected_choice_label,
    'currentRetryFeedback',lineage.component_package->>'retryFeedback',
    'description','Consider a successor that preserves the exact prompt, choices and correct answer, while adding bounded retry feedback specific to the selected incorrect choice “' || selected_choice_label || '”. The current exact package exposes one shared retry-feedback message.',
    'currentVersionRemainsActive',true,'successorCreated',false,'checksRun',false,'availabilityChanged',false);
  IF NEW.proposal_type<>'ASSET' OR NEW.signal_kind<>'INCORRECT_ATTEMPT' OR NEW.state<>'PENDING_GOVERNANCE'
    OR NEW.proposed_change IS DISTINCT FROM expected_change
    OR NEW.rationale IS DISTINCT FROM 'One persisted incorrect learner Attempt on this exact delivered version supports human review of distractor-specific retry feedback. It does not establish an asset defect, a repeated pattern, causation, or learning effectiveness.'
    OR NEW.limitations IS DISTINCT FROM '["ONE_ATTEMPT_ONLY","NO_EFFECTIVENESS_CLAIM","NO_CAUSAL_ATTRIBUTION","NO_ROUTING_OPTIMIZATION","NO_LEARNING_STRATEGY_OPTIMIZATION","CURRENT_VERSION_REMAINS_ACTIVE"]'::jsonb
    OR NEW.rule_key<>'cap08a.incorrect-attempt-distractor-feedback-review' OR NEW.rule_version<>'1.1.0' OR abs(NEW.confidence-0.35)>0.000001 THEN
    RAISE EXCEPTION 'Asset Optimization Proposal widened beyond the bounded Asset-only evidence claim' USING ERRCODE='23514';
  END IF;
  expected_snapshot:=jsonb_build_object(
    'runtimeDeliveryId',NEW.runtime_delivery_id::text,'runtimeStatus',lineage.status,'runtimeOutputHash',lineage.output_hash,
    'learnerAttemptId',NEW.learner_attempt_id::text,'learnerAttemptContentHash',lineage.attempt_content_hash,
    'selectedChoiceId',selected_choice_id,'correct',false,
    'feedback',COALESCE(lineage.normalized_output->>'feedback','No runtime feedback was recorded.'),
    'componentId',NEW.component_id::text,'componentVersionId',NEW.component_version_id::text,
    'componentVersionContentHash',lineage.exact_component_hash,'capabilityId',NEW.capability_id::text,
    'capabilityVersionId',NEW.capability_version_id::text,'capabilityVersionContentHash',lineage.exact_capability_hash,
    'capabilitySupplyRelationId',lineage.exact_supply_id::text,'activityPlanId',lineage.exact_activity_plan_id::text);
  expected_refs:=jsonb_build_array(
    jsonb_build_object('kind','COMPONENT_ASSET_VERSION','id',NEW.component_version_id::text),
    jsonb_build_object('kind','CAPABILITY_VERSION','id',NEW.capability_version_id::text),
    jsonb_build_object('kind','CAPABILITY_SUPPLY_RELATION','id',lineage.exact_supply_id::text),
    jsonb_build_object('kind','ACTIVITY_PLAN','id',lineage.exact_activity_plan_id::text),
    jsonb_build_object('kind','RUNTIME_DELIVERY','id',NEW.runtime_delivery_id::text),
    jsonb_build_object('kind','LEARNER_ATTEMPT','id',NEW.learner_attempt_id::text));
  expected_evidence_hash:=encode(public.digest(convert_to(expected_snapshot::text,'UTF8'),'sha256'),'hex');
  IF NEW.evidence_snapshot IS DISTINCT FROM expected_snapshot OR NEW.evidence_refs IS DISTINCT FROM expected_refs
    OR NEW.evidence_hash IS DISTINCT FROM expected_evidence_hash THEN
    RAISE EXCEPTION 'Asset Optimization Proposal evidence snapshot is not bound to the exact delivered lineage' USING ERRCODE='23514';
  END IF;
  IF NEW.requester_provenance->>'userId' IS DISTINCT FROM actor_id::text OR NEW.requester_provenance->>'institutionId' IS DISTINCT FROM tenant_id::text
    OR COALESCE(NEW.requester_provenance->>'authMethod','')='' OR COALESCE(NEW.requester_provenance->>'sessionId','')<>current_setting('foundry.session_id',true) THEN
    RAISE EXCEPTION 'Asset Optimization Proposal requester provenance mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM foundry_product.idempotency_keys reservation
    WHERE reservation.institution_id=NEW.institution_id AND reservation.command_type='CREATE_ASSET_OPTIMIZATION_PROPOSAL'
      AND reservation.result_id=NEW.id AND reservation.request_hash=NEW.request_hash AND reservation.actor_user_id=actor_id) THEN
    RAISE EXCEPTION 'Asset Optimization Proposal requires its exact actor-bound idempotency reservation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.assert_asset_optimization_proposal() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT ON "foundry_product"."asset_optimization_proposals"
FOR EACH ROW EXECUTE FUNCTION foundry_private.assert_asset_optimization_proposal();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.assert_asset_optimization_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid;
  tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  roles text[]:=string_to_array(COALESCE(current_setting('foundry.roles',true),''),',');
  subject record;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR length(COALESCE(current_setting('foundry.session_id',true),''))=0
    OR NOT roles && ARRAY['TEACHER','EXPERT','ADMIN'] THEN
    RAISE EXCEPTION 'Asset Optimization decision requires an authenticated teacher or expert command' USING ERRCODE='42501';
  END IF;
  SELECT proposal.*, component.active_version_id AS active_component_version_id, component_version.status AS component_version_status,
    capability.active_version_id AS active_capability_version_id, capability_version.status AS capability_version_status
  INTO subject
  FROM foundry_product.asset_optimization_proposals proposal
  JOIN foundry_product.components component ON component.id=proposal.component_id
  JOIN foundry_product.component_versions component_version ON component_version.id=proposal.component_version_id AND component_version.component_id=component.id
  JOIN foundry_product.capabilities capability ON capability.id=proposal.capability_id
  JOIN foundry_product.capability_versions capability_version ON capability_version.id=proposal.capability_version_id AND capability_version.capability_id=capability.id
  WHERE proposal.id=NEW.proposal_id AND proposal.institution_id=NEW.institution_id AND proposal.course_id=NEW.course_id;
  IF NOT FOUND OR NEW.component_id<>subject.component_id OR NEW.component_version_id<>subject.component_version_id THEN
    RAISE EXCEPTION 'Asset Optimization decision exact proposal subject mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.institution_id<>tenant_id OR NEW.decided_by<>actor_id OR NOT foundry_product.cap07_actor_has_course(NEW.institution_id,NEW.course_id) THEN
    RAISE EXCEPTION 'Asset Optimization decision actor lacks current course authority' USING ERRCODE='42501';
  END IF;
  IF subject.active_component_version_id IS DISTINCT FROM subject.component_version_id
    OR subject.active_capability_version_id IS DISTINCT FROM subject.capability_version_id
    OR subject.component_version_status<>'PUBLISHED' OR subject.capability_version_status<>'ACTIVE' THEN
    RAISE EXCEPTION 'Asset Optimization source is no longer the active exact version; no current-version decision can be recorded from stale evidence' USING ERRCODE='23514';
  END IF;
  IF NEW.actor_provenance->>'userId' IS DISTINCT FROM actor_id::text OR NEW.actor_provenance->>'institutionId' IS DISTINCT FROM tenant_id::text
    OR COALESCE(NEW.actor_provenance->>'authMethod','')='' OR COALESCE(NEW.actor_provenance->>'sessionId','')<>current_setting('foundry.session_id',true) THEN
    RAISE EXCEPTION 'Asset Optimization decision actor provenance mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM foundry_product.idempotency_keys reservation
    WHERE reservation.institution_id=NEW.institution_id AND reservation.command_type='DECIDE_ASSET_OPTIMIZATION_PROPOSAL'
      AND reservation.key=NEW.idempotency_key AND reservation.result_id=NEW.id
      AND reservation.request_hash=NEW.request_hash AND reservation.actor_user_id=actor_id) THEN
    RAISE EXCEPTION 'Asset Optimization decision requires its exact actor-bound idempotency reservation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.assert_asset_optimization_decision() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT ON "foundry_product"."asset_optimization_decisions"
FOR EACH ROW EXECUTE FUNCTION foundry_private.assert_asset_optimization_decision();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.reject_asset_optimization_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Asset Optimization evidence and governance are append-only' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION foundry_private.reject_asset_optimization_mutation() FROM PUBLIC;
CREATE TRIGGER "asset_optimization_proposal_immutable" BEFORE UPDATE OR DELETE ON "foundry_product"."asset_optimization_proposals"
FOR EACH ROW EXECUTE FUNCTION foundry_private.reject_asset_optimization_mutation();
CREATE TRIGGER "asset_optimization_decision_immutable" BEFORE UPDATE OR DELETE ON "foundry_product"."asset_optimization_decisions"
FOR EACH ROW EXECUTE FUNCTION foundry_private.reject_asset_optimization_mutation();
