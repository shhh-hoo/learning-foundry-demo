DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='foundry_component_executor') THEN
    CREATE ROLE foundry_component_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA foundry_product TO foundry_component_executor;
--> statement-breakpoint
ALTER TABLE "foundry_product"."capabilities" ADD COLUMN "institution_id" uuid REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "foundry_product"."capabilities" ADD COLUMN "course_id" uuid REFERENCES "foundry_product"."courses"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "foundry_product"."capability_versions" ADD COLUMN "institution_id" uuid REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "foundry_product"."capability_versions" ADD COLUMN "course_id" uuid REFERENCES "foundry_product"."courses"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "foundry_product"."capability_versions" ADD COLUMN "component_asset_version_id" uuid REFERENCES "foundry_product"."component_versions"("id");
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ALTER COLUMN "capability_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "asset_type" text NOT NULL DEFAULT 'TEACHING_SUPPORT';
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "source_capability_resolution_id" uuid REFERENCES "foundry_product"."capability_resolutions"("id");
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "source_activity_plan_proposal_id" uuid REFERENCES "foundry_product"."activity_plan_proposals"("id");
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "supply_strategy" text;
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "adapted_from_capability_id" uuid REFERENCES "foundry_product"."capabilities"("id");
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "adapted_from_capability_version_id" uuid REFERENCES "foundry_product"."capability_versions"("id");
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "adapted_from_content_hash" text;
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "adapted_from_component_version_id" uuid REFERENCES "foundry_product"."component_versions"("id");
ALTER TABLE "foundry_product"."components" ADD COLUMN "adapted_from_component_content_hash" text;
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "registered_capability_id" uuid REFERENCES "foundry_product"."capabilities"("id");
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD COLUMN "registered_capability_version_id" uuid REFERENCES "foundry_product"."capability_versions"("id");
--> statement-breakpoint
ALTER TABLE "foundry_product"."runtime_deliveries" ADD COLUMN "retry_of_delivery_id" uuid REFERENCES "foundry_product"."runtime_deliveries"("id");
ALTER TABLE "foundry_product"."runtime_deliveries" ADD COLUMN "attempt_number" integer DEFAULT 1 NOT NULL;
DROP INDEX "foundry_product"."runtime_delivery_activity_plan_uq";
CREATE UNIQUE INDEX "runtime_delivery_plan_attempt_uq" ON "foundry_product"."runtime_deliveries" ("activity_plan_id","attempt_number");
CREATE UNIQUE INDEX "runtime_delivery_retry_of_uq" ON "foundry_product"."runtime_deliveries" ("retry_of_delivery_id") WHERE "retry_of_delivery_id" IS NOT NULL;
ALTER TABLE "foundry_product"."runtime_deliveries" ADD CONSTRAINT "runtime_delivery_retry_ck" CHECK (("attempt_number"=1 AND "retry_of_delivery_id" IS NULL) OR ("attempt_number"=2 AND "retry_of_delivery_id" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "foundry_product"."capabilities" ADD CONSTRAINT "capabilities_scope_ck" CHECK (("institution_id" IS NULL AND "course_id" IS NULL) OR ("institution_id" IS NOT NULL AND "course_id" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "foundry_product"."capability_versions" ADD CONSTRAINT "capability_versions_scope_ck" CHECK (("institution_id" IS NULL AND "course_id" IS NULL AND "component_asset_version_id" IS NULL) OR ("institution_id" IS NOT NULL AND "course_id" IS NOT NULL AND "component_asset_version_id" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD CONSTRAINT "component_asset_type_ck" CHECK (
  ("asset_type"='TEACHING_SUPPORT' AND "capability_id" IS NOT NULL AND "source_capability_resolution_id" IS NULL AND "source_activity_plan_proposal_id" IS NULL AND "supply_strategy" IS NULL AND "adapted_from_capability_id" IS NULL AND "adapted_from_capability_version_id" IS NULL AND "adapted_from_content_hash" IS NULL AND "adapted_from_component_version_id" IS NULL AND "adapted_from_component_content_hash" IS NULL)
  OR ("asset_type"='WEB_COMPONENT_ASSET' AND "source_capability_resolution_id" IS NOT NULL AND "source_activity_plan_proposal_id" IS NOT NULL AND "supply_strategy"='ADAPT' AND "adapted_from_capability_id" IS NOT NULL AND "adapted_from_capability_version_id" IS NOT NULL AND length("adapted_from_content_hash")>7 AND "adapted_from_component_version_id" IS NOT NULL AND length("adapted_from_component_content_hash")>7)
  OR ("asset_type"='WEB_COMPONENT_ASSET' AND "capability_id" IS NOT NULL AND "source_capability_resolution_id" IS NULL AND "source_activity_plan_proposal_id" IS NULL AND "supply_strategy" IS NULL AND "adapted_from_capability_id" IS NULL AND "adapted_from_capability_version_id" IS NULL AND "adapted_from_content_hash" IS NULL AND "adapted_from_component_version_id" IS NULL AND "adapted_from_component_content_hash" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "components_source_resolution_uq" ON "foundry_product"."components" ("source_capability_resolution_id") WHERE "source_capability_resolution_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "foundry_product"."component_asset_previews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id") ON DELETE cascade,
  "component_version_id" uuid NOT NULL REFERENCES "foundry_product"."component_versions"("id"),
  "component_evaluation_id" uuid NOT NULL REFERENCES "foundry_product"."component_evaluations"("id"),
  "source_capability_resolution_id" uuid NOT NULL REFERENCES "foundry_product"."capability_resolutions"("id"),
  "content_hash" text NOT NULL,
  "request_hash" text NOT NULL,
  "learner_input" jsonb NOT NULL,
  "runtime_output" jsonb NOT NULL,
  "event_trace" jsonb NOT NULL,
  "executor_version" text NOT NULL,
  "executor_receipt_hash" text NOT NULL,
  "status" text NOT NULL,
  "previewed_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "actor_provenance" jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "component_asset_preview_status_ck" CHECK ("status" IN ('SUCCEEDED','FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_asset_preview_actor_key_uq" ON "foundry_product"."component_asset_previews" ("institution_id","previewed_by","idempotency_key");
--> statement-breakpoint
CREATE INDEX "component_asset_preview_version_idx" ON "foundry_product"."component_asset_previews" ("component_version_id","created_at");
--> statement-breakpoint
CREATE TABLE "foundry_product"."capability_availability_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id") ON DELETE cascade,
  "capability_id" uuid NOT NULL REFERENCES "foundry_product"."capabilities"("id"),
  "capability_version_id" uuid NOT NULL REFERENCES "foundry_product"."capability_versions"("id"),
  "component_version_id" uuid NOT NULL REFERENCES "foundry_product"."component_versions"("id"),
  "confirmation_decision_id" uuid NOT NULL REFERENCES "foundry_product"."publication_decisions"("id"),
  "availability_status" text NOT NULL,
  "availability_scope" jsonb NOT NULL,
  "confirmed_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "actor_provenance" jsonb NOT NULL,
  "rationale" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "capability_availability_status_ck" CHECK ("availability_status" IN ('AVAILABLE','DISABLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "capability_availability_confirmation_uq" ON "foundry_product"."capability_availability_decisions" ("confirmation_decision_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "capability_availability_exact_version_uq" ON "foundry_product"."capability_availability_decisions" ("capability_version_id");
--> statement-breakpoint
CREATE TABLE "foundry_product"."capability_supply_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id") ON DELETE cascade,
  "source_capability_resolution_id" uuid NOT NULL REFERENCES "foundry_product"."capability_resolutions"("id"),
  "source_activity_plan_proposal_id" uuid NOT NULL REFERENCES "foundry_product"."activity_plan_proposals"("id"),
  "source_diagnostic_observation_id" uuid NOT NULL REFERENCES "foundry_product"."diagnostic_observations"("id"),
  "source_attempt_id" uuid NOT NULL REFERENCES "foundry_product"."learner_attempts"("id"),
  "component_id" uuid NOT NULL REFERENCES "foundry_product"."components"("id"),
  "component_version_id" uuid NOT NULL REFERENCES "foundry_product"."component_versions"("id"),
  "registered_capability_id" uuid NOT NULL REFERENCES "foundry_product"."capabilities"("id"),
  "registered_capability_version_id" uuid NOT NULL REFERENCES "foundry_product"."capability_versions"("id"),
  "confirmation_decision_id" uuid NOT NULL REFERENCES "foundry_product"."publication_decisions"("id"),
  "created_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "capability_supply_relation_source_uq" ON "foundry_product"."capability_supply_relations" ("source_capability_resolution_id");
CREATE UNIQUE INDEX "capability_supply_relation_version_uq" ON "foundry_product"."capability_supply_relations" ("registered_capability_version_id");
CREATE UNIQUE INDEX "capability_supply_relation_confirmation_uq" ON "foundry_product"."capability_supply_relations" ("confirmation_decision_id");
CREATE INDEX "capability_supply_relation_course_idx" ON "foundry_product"."capability_supply_relations" ("institution_id","course_id","created_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_product.cap07_actor_has_course(target_institution_id uuid,target_course_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT target_institution_id IS NOT NULL AND target_course_id IS NOT NULL
    AND target_institution_id=NULLIF(current_setting('foundry.institution_id',true),'')::uuid
    AND NULLIF(current_setting('foundry.user_id',true),'')::uuid IS NOT NULL
    AND length(COALESCE(current_setting('foundry.session_id',true),''))>0
    AND EXISTS (
      SELECT 1 FROM foundry_product.institution_memberships m
      JOIN foundry_product.course_enrollments ce ON ce.institution_id=m.institution_id AND ce.user_id=m.user_id AND ce.course_id=target_course_id
      WHERE m.institution_id=target_institution_id AND m.user_id=NULLIF(current_setting('foundry.user_id',true),'')::uuid
    )
$$;
REVOKE ALL ON FUNCTION foundry_product.cap07_actor_has_course(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundry_product.cap07_actor_has_course(uuid,uuid) TO foundry_product_runtime;
--> statement-breakpoint
DROP POLICY IF EXISTS "global_reference_read" ON "foundry_product"."capabilities";
DROP POLICY IF EXISTS "registry_reference_read" ON "foundry_product"."capabilities";
CREATE POLICY "registry_global_read" ON "foundry_product"."capabilities" FOR SELECT TO foundry_product_runtime, foundry_worker USING ("institution_id" IS NULL AND "course_id" IS NULL);
CREATE POLICY "registry_course_read" ON "foundry_product"."capabilities" FOR SELECT TO foundry_product_runtime USING (foundry_product.cap07_actor_has_course("institution_id","course_id"));
CREATE POLICY "tenant_registry_insert" ON "foundry_product"."capabilities" FOR INSERT TO foundry_product_runtime WITH CHECK (foundry_product.cap07_actor_has_course("institution_id","course_id"));
CREATE POLICY "tenant_registry_update" ON "foundry_product"."capabilities" FOR UPDATE TO foundry_product_runtime USING (foundry_product.cap07_actor_has_course("institution_id","course_id")) WITH CHECK (foundry_product.cap07_actor_has_course("institution_id","course_id"));
--> statement-breakpoint
DROP POLICY IF EXISTS "global_reference_read" ON "foundry_product"."capability_versions";
DROP POLICY IF EXISTS "registry_version_reference_read" ON "foundry_product"."capability_versions";
CREATE POLICY "registry_version_global_read" ON "foundry_product"."capability_versions" FOR SELECT TO foundry_product_runtime, foundry_worker USING ("institution_id" IS NULL AND "course_id" IS NULL);
CREATE POLICY "registry_version_course_read" ON "foundry_product"."capability_versions" FOR SELECT TO foundry_product_runtime USING (foundry_product.cap07_actor_has_course("capability_versions"."institution_id","capability_versions"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.capabilities c WHERE c.id="capability_versions"."capability_id" AND c.institution_id="capability_versions"."institution_id" AND c.course_id="capability_versions"."course_id"));
CREATE POLICY "tenant_registry_version_insert" ON "foundry_product"."capability_versions" FOR INSERT TO foundry_product_runtime WITH CHECK (foundry_product.cap07_actor_has_course("capability_versions"."institution_id","capability_versions"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.capabilities c WHERE c.id="capability_versions"."capability_id" AND c.institution_id="capability_versions"."institution_id" AND c.course_id="capability_versions"."course_id"));
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_scope" ON "foundry_product"."components";
CREATE POLICY "component_course_read" ON "foundry_product"."components" FOR SELECT TO foundry_product_runtime USING (foundry_product.cap07_actor_has_course("institution_id","course_id"));
CREATE POLICY "component_course_insert" ON "foundry_product"."components" FOR INSERT TO foundry_product_runtime WITH CHECK (foundry_product.cap07_actor_has_course("institution_id","course_id"));
CREATE POLICY "component_course_update" ON "foundry_product"."components" FOR UPDATE TO foundry_product_runtime USING (foundry_product.cap07_actor_has_course("institution_id","course_id")) WITH CHECK (foundry_product.cap07_actor_has_course("institution_id","course_id"));
DROP POLICY IF EXISTS "tenant_scope" ON "foundry_product"."component_versions";
CREATE POLICY "component_version_course_read" ON "foundry_product"."component_versions" FOR SELECT TO foundry_product_runtime USING (EXISTS (SELECT 1 FROM foundry_product.components c WHERE c.id="component_versions"."component_id" AND foundry_product.cap07_actor_has_course(c.institution_id,c.course_id)));
CREATE POLICY "component_version_course_insert" ON "foundry_product"."component_versions" FOR INSERT TO foundry_product_runtime WITH CHECK (EXISTS (SELECT 1 FROM foundry_product.components c WHERE c.id="component_versions"."component_id" AND foundry_product.cap07_actor_has_course(c.institution_id,c.course_id)));
CREATE POLICY "component_version_course_update" ON "foundry_product"."component_versions" FOR UPDATE TO foundry_product_runtime USING (EXISTS (SELECT 1 FROM foundry_product.components c WHERE c.id="component_versions"."component_id" AND foundry_product.cap07_actor_has_course(c.institution_id,c.course_id))) WITH CHECK (EXISTS (SELECT 1 FROM foundry_product.components c WHERE c.id="component_versions"."component_id" AND foundry_product.cap07_actor_has_course(c.institution_id,c.course_id)));
DROP POLICY IF EXISTS "tenant_scope" ON "foundry_product"."component_evaluations";
CREATE POLICY "component_evaluation_course_read" ON "foundry_product"."component_evaluations" FOR SELECT TO foundry_product_runtime USING (foundry_product.cap07_actor_has_course("component_evaluations"."institution_id","component_evaluations"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id WHERE v.id="component_evaluations"."component_version_id" AND c.institution_id="component_evaluations"."institution_id" AND c.course_id="component_evaluations"."course_id"));
CREATE POLICY "component_evaluation_course_insert" ON "foundry_product"."component_evaluations" FOR INSERT TO foundry_product_runtime WITH CHECK (foundry_product.cap07_actor_has_course("component_evaluations"."institution_id","component_evaluations"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id WHERE v.id="component_evaluations"."component_version_id" AND c.institution_id="component_evaluations"."institution_id" AND c.course_id="component_evaluations"."course_id"));
DROP POLICY IF EXISTS "tenant_scope" ON "foundry_product"."publication_decisions";
CREATE POLICY "publication_course_scope" ON "foundry_product"."publication_decisions" TO foundry_product_runtime USING (EXISTS (SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id WHERE v.id="publication_decisions"."component_version_id" AND foundry_product.cap07_actor_has_course(c.institution_id,c.course_id))) WITH CHECK (EXISTS (SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id WHERE v.id="publication_decisions"."component_version_id" AND foundry_product.cap07_actor_has_course(c.institution_id,c.course_id)));
ALTER TABLE "foundry_product"."component_asset_previews" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."component_asset_previews" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."component_asset_previews" TO foundry_product_runtime USING (foundry_product.cap07_actor_has_course("component_asset_previews"."institution_id","component_asset_previews"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id WHERE v.id="component_asset_previews"."component_version_id" AND c.institution_id="component_asset_previews"."institution_id" AND c.course_id="component_asset_previews"."course_id")) WITH CHECK (foundry_product.cap07_actor_has_course("component_asset_previews"."institution_id","component_asset_previews"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id WHERE v.id="component_asset_previews"."component_version_id" AND c.institution_id="component_asset_previews"."institution_id" AND c.course_id="component_asset_previews"."course_id"));
ALTER TABLE "foundry_product"."capability_availability_decisions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."capability_availability_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."capability_availability_decisions" TO foundry_product_runtime USING (foundry_product.cap07_actor_has_course("capability_availability_decisions"."institution_id","capability_availability_decisions"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.capability_versions v JOIN foundry_product.capabilities c ON c.id=v.capability_id JOIN foundry_product.component_versions cv ON cv.id="capability_availability_decisions"."component_version_id" JOIN foundry_product.components component ON component.id=cv.component_id WHERE v.id="capability_availability_decisions"."capability_version_id" AND c.id="capability_availability_decisions"."capability_id" AND v.component_asset_version_id=cv.id AND v.institution_id="capability_availability_decisions"."institution_id" AND v.course_id="capability_availability_decisions"."course_id" AND c.institution_id=v.institution_id AND c.course_id=v.course_id AND component.institution_id=v.institution_id AND component.course_id=v.course_id)) WITH CHECK (foundry_product.cap07_actor_has_course("capability_availability_decisions"."institution_id","capability_availability_decisions"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.capability_versions v JOIN foundry_product.capabilities c ON c.id=v.capability_id JOIN foundry_product.component_versions cv ON cv.id="capability_availability_decisions"."component_version_id" JOIN foundry_product.components component ON component.id=cv.component_id WHERE v.id="capability_availability_decisions"."capability_version_id" AND c.id="capability_availability_decisions"."capability_id" AND v.component_asset_version_id=cv.id AND v.institution_id="capability_availability_decisions"."institution_id" AND v.course_id="capability_availability_decisions"."course_id" AND c.institution_id=v.institution_id AND c.course_id=v.course_id AND component.institution_id=v.institution_id AND component.course_id=v.course_id));
ALTER TABLE "foundry_product"."capability_supply_relations" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."capability_supply_relations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."capability_supply_relations" TO foundry_product_runtime USING (foundry_product.cap07_actor_has_course("capability_supply_relations"."institution_id","capability_supply_relations"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.components c JOIN foundry_product.component_versions cv ON cv.id="capability_supply_relations"."component_version_id" AND cv.component_id=c.id JOIN foundry_product.capability_versions v ON v.id="capability_supply_relations"."registered_capability_version_id" AND v.component_asset_version_id=cv.id JOIN foundry_product.capabilities capability ON capability.id="capability_supply_relations"."registered_capability_id" AND capability.id=v.capability_id WHERE c.id="capability_supply_relations"."component_id" AND c.institution_id="capability_supply_relations"."institution_id" AND c.course_id="capability_supply_relations"."course_id" AND v.institution_id=c.institution_id AND v.course_id=c.course_id AND capability.institution_id=c.institution_id AND capability.course_id=c.course_id)) WITH CHECK (foundry_product.cap07_actor_has_course("capability_supply_relations"."institution_id","capability_supply_relations"."course_id") AND EXISTS (SELECT 1 FROM foundry_product.components c JOIN foundry_product.component_versions cv ON cv.id="capability_supply_relations"."component_version_id" AND cv.component_id=c.id JOIN foundry_product.capability_versions v ON v.id="capability_supply_relations"."registered_capability_version_id" AND v.component_asset_version_id=cv.id JOIN foundry_product.capabilities capability ON capability.id="capability_supply_relations"."registered_capability_id" AND capability.id=v.capability_id WHERE c.id="capability_supply_relations"."component_id" AND c.institution_id="capability_supply_relations"."institution_id" AND c.course_id="capability_supply_relations"."course_id" AND v.institution_id=c.institution_id AND v.course_id=c.course_id AND capability.institution_id=c.institution_id AND capability.course_id=c.course_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "foundry_product"."capabilities" TO foundry_product_runtime;
GRANT SELECT, INSERT ON "foundry_product"."capability_versions" TO foundry_product_runtime;
GRANT SELECT ON "foundry_product"."component_asset_previews" TO foundry_product_runtime;
GRANT SELECT, INSERT ON "foundry_product"."capability_availability_decisions" TO foundry_product_runtime;
GRANT SELECT, INSERT ON "foundry_product"."capability_supply_relations" TO foundry_product_runtime;
--> statement-breakpoint
UPDATE foundry_private.table_authority_catalog SET classification='TENANT_OR_GLOBAL_REFERENCE' WHERE schema_name='foundry_product' AND table_name IN ('capabilities','capability_versions');
INSERT INTO foundry_private.table_authority_catalog(schema_name,table_name,classification,policy_required) VALUES
  ('foundry_product','component_asset_previews','TENANT_DIRECT',true),
  ('foundry_product','capability_availability_decisions','TENANT_DIRECT',true)
  ,('foundry_product','capability_supply_relations','TENANT_DIRECT',true)
ON CONFLICT (schema_name,table_name) DO UPDATE SET classification=EXCLUDED.classification,policy_required=EXCLUDED.policy_required;
INSERT INTO foundry_private.writable_lineage_catalog(schema_name,table_name,writable_roles,tenant_references) VALUES
  ('foundry_product','capabilities',ARRAY['foundry_product_runtime'],'tenant-private Registry identity; course; active exact version'),
  ('foundry_product','capability_versions',ARRAY['foundry_product_runtime'],'tenant-private Registry identity; course; exact ComponentAssetVersion'),
  ('foundry_product','capability_availability_decisions',ARRAY['foundry_product_runtime'],'institution; course; exact CapabilityVersion and ComponentAssetVersion; human confirmation decision/provenance')
  ,('foundry_product','capability_supply_relations',ARRAY['foundry_product_runtime'],'protected institution/course gap lineage; exact registered CapabilityVersion and confirmation')
ON CONFLICT (schema_name,table_name) DO UPDATE SET writable_roles=EXCLUDED.writable_roles,tenant_references=EXCLUDED.tenant_references;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_product.cap07_actor_can_confirm(target_course_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT foundry_product.cap07_actor_has_course(NULLIF(current_setting('foundry.institution_id',true),'')::uuid,target_course_id)
    AND NULLIF(current_setting('foundry.user_id',true),'')::uuid IS NOT NULL
    AND length(COALESCE(current_setting('foundry.session_id',true),''))>0
    AND string_to_array(COALESCE(current_setting('foundry.roles',true),''),',') && ARRAY['EXPERT','ADMIN']
    AND EXISTS (
      SELECT 1 FROM foundry_product.courses c
      JOIN foundry_product.institution_memberships m ON m.institution_id=c.institution_id AND m.user_id=NULLIF(current_setting('foundry.user_id',true),'')::uuid AND m.role IN ('EXPERT','ADMIN')
      JOIN foundry_product.course_enrollments ce ON ce.institution_id=c.institution_id AND ce.course_id=c.id AND ce.user_id=m.user_id AND ce.role IN ('EXPERT','ADMIN')
      WHERE c.id=target_course_id AND c.institution_id=NULLIF(current_setting('foundry.institution_id',true),'')::uuid
    )
$$;
REVOKE ALL ON FUNCTION foundry_product.cap07_actor_can_confirm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundry_product.cap07_actor_can_confirm(uuid) TO foundry_product_runtime;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_private.cap07_lock_task_before_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
BEGIN
  IF tenant_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM foundry_product.learning_tasks task
    WHERE task.id=NEW.task_id AND task.institution_id=NEW.institution_id AND NEW.institution_id=tenant_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAP-07 freshness lock requires the active Task tenant' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.cap07_lock_task_before_append() FROM PUBLIC;
CREATE TRIGGER "0_cap07_source_freshness_lock" BEFORE INSERT ON foundry_product.capability_resolutions FOR EACH ROW EXECUTE FUNCTION foundry_private.cap07_lock_task_before_append();
CREATE TRIGGER "0_cap07_source_freshness_lock" BEFORE INSERT ON foundry_product.activity_plan_proposals FOR EACH ROW EXECUTE FUNCTION foundry_private.cap07_lock_task_before_append();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_product.lock_cap07_publication_source(target_component_id uuid,target_component_version_id uuid,target_evaluation_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid; target_task_id uuid; target_source_capability_id uuid; target_course_id uuid;
BEGIN
  SELECT resolution.task_id,component.adapted_from_capability_id,component.course_id
    INTO target_task_id,target_source_capability_id,target_course_id
    FROM foundry_product.components component
    JOIN foundry_product.component_versions version ON version.id=target_component_version_id AND version.component_id=component.id
    JOIN foundry_product.component_evaluations evaluation ON evaluation.id=target_evaluation_id AND evaluation.component_version_id=version.id AND evaluation.content_hash=version.content_hash
    JOIN foundry_product.capability_resolutions resolution ON resolution.id=component.source_capability_resolution_id
    JOIN foundry_product.activity_plan_proposals plan ON plan.id=component.source_activity_plan_proposal_id AND plan.capability_resolution_id=resolution.id
    JOIN foundry_product.capability_versions source_version ON source_version.id=component.adapted_from_capability_version_id AND source_version.capability_id=component.adapted_from_capability_id
    JOIN foundry_product.component_versions source_component_version ON source_component_version.id=component.adapted_from_component_version_id AND source_component_version.id=source_version.component_asset_version_id AND source_component_version.content_hash=component.adapted_from_component_content_hash AND source_component_version.status='PUBLISHED'
    WHERE component.id=target_component_id AND component.institution_id=tenant_id AND component.asset_type='WEB_COMPONENT_ASSET' AND component.supply_strategy='ADAPT';
  IF target_task_id IS NULL OR target_source_capability_id IS NULL OR target_course_id IS NULL OR NOT foundry_product.cap07_actor_can_confirm(target_course_id) THEN
    RAISE EXCEPTION 'CAP-07 publication freshness lock requires exact course-authorized ComponentAsset lineage' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM foundry_product.learning_tasks task WHERE task.id=target_task_id AND task.institution_id=tenant_id AND task.course_id=target_course_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAP-07 publication freshness lock lost its exact Task' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM foundry_product.capabilities capability WHERE capability.id=target_source_capability_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAP-07 publication freshness lock lost its source Capability' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION foundry_product.lock_cap07_publication_source(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundry_product.lock_cap07_publication_source(uuid,uuid,uuid) TO foundry_product_runtime;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION foundry_product.assert_scoped_capability_registry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid; governance_command text:=current_setting('foundry.governance_command',true);
BEGIN
  IF tenant_id IS NULL OR NEW.institution_id<>tenant_id OR NOT EXISTS (SELECT 1 FROM foundry_product.courses c WHERE c.id=NEW.course_id AND c.institution_id=tenant_id) THEN
    RAISE EXCEPTION 'Tenant-private Capability Registry scope mismatch' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.institution_id<>OLD.institution_id OR NEW.course_id<>OLD.course_id OR NEW.key<>OLD.key OR NEW.name<>OLD.name OR NEW.reference_pack_key<>OLD.reference_pack_key OR NEW.kind<>OLD.kind) THEN
    RAISE EXCEPTION 'Registered Capability identity is immutable; only exact active version may change' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.active_version_id IS NOT NULL THEN RAISE EXCEPTION 'Tenant-private Capability begins unavailable until exact confirmation and READY replanning' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND NEW.active_version_id IS DISTINCT FROM OLD.active_version_id AND (governance_command<>'component_publication' OR NOT foundry_product.cap07_actor_can_confirm(NEW.course_id)
    OR NOT EXISTS (
      SELECT 1 FROM foundry_product.capability_versions v
      JOIN foundry_product.component_versions component_version ON component_version.id=v.component_asset_version_id AND component_version.status='PUBLISHED'
      JOIN foundry_product.components component ON component.id=component_version.component_id AND component.institution_id=tenant_id AND component.course_id=NEW.course_id AND component.asset_type='WEB_COMPONENT_ASSET'
      JOIN foundry_product.publication_decisions decision ON decision.component_version_id=component_version.id AND decision.action='APPROVE' AND decision.expert_id=NULLIF(current_setting('foundry.user_id',true),'')::uuid
      WHERE v.id=NEW.active_version_id AND v.capability_id=NEW.id AND v.institution_id=tenant_id AND v.course_id=NEW.course_id AND v.status='ACTIVE'
    )) THEN
    RAISE EXCEPTION 'Capability activation requires the authenticated confirmation command and exact published ComponentAssetVersion' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON foundry_product.capabilities FOR EACH ROW WHEN (NEW.institution_id IS NOT NULL) EXECUTE FUNCTION foundry_product.assert_scoped_capability_registry();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_product.assert_scoped_capability_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid; actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Registered CapabilityVersion is immutable' USING ERRCODE='23514'; END IF;
  IF tenant_id IS NULL OR NEW.institution_id<>tenant_id OR NEW.status<>'ACTIVE' OR current_setting('foundry.governance_command',true)<>'component_publication' OR NOT foundry_product.cap07_actor_can_confirm(NEW.course_id)
    OR NOT EXISTS (SELECT 1 FROM foundry_product.capabilities c WHERE c.id=NEW.capability_id AND c.institution_id=tenant_id AND c.course_id=NEW.course_id)
    OR NOT EXISTS (SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id JOIN foundry_product.publication_decisions d ON d.component_version_id=v.id AND d.action='APPROVE' AND d.expert_id=actor_id WHERE v.id=NEW.component_asset_version_id AND v.status='PUBLISHED' AND c.institution_id=tenant_id AND c.course_id=NEW.course_id AND c.asset_type='WEB_COMPONENT_ASSET') THEN
    RAISE EXCEPTION 'Tenant-private CapabilityVersion exact ComponentAsset lineage mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON foundry_product.capability_versions FOR EACH ROW WHEN (NEW.institution_id IS NOT NULL) EXECUTE FUNCTION foundry_product.assert_scoped_capability_version();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_product.assert_cap07_registration_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target_capability_id uuid; tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid; actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid; target_course_id uuid;
BEGIN
  IF TG_TABLE_NAME='capabilities' THEN
    IF NEW.institution_id IS NULL OR NEW.active_version_id IS NULL THEN RETURN NULL; END IF;
    target_capability_id:=NEW.id;
  ELSIF TG_TABLE_NAME='capability_versions' THEN
    IF NEW.institution_id IS NULL THEN RETURN NULL; END IF;
    target_capability_id:=NEW.capability_id;
  ELSIF TG_TABLE_NAME='components' THEN
    IF NEW.asset_type<>'WEB_COMPONENT_ASSET' OR NEW.registered_capability_id IS NULL THEN RETURN NULL; END IF;
    target_capability_id:=NEW.registered_capability_id;
  ELSIF TG_TABLE_NAME='publication_decisions' THEN
    IF NEW.action<>'APPROVE' THEN RETURN NULL; END IF;
    SELECT component.registered_capability_id INTO target_capability_id
      FROM foundry_product.component_versions version JOIN foundry_product.components component ON component.id=version.component_id
      WHERE version.id=NEW.component_version_id AND component.asset_type='WEB_COMPONENT_ASSET';
    IF target_capability_id IS NULL AND EXISTS (SELECT 1 FROM foundry_product.component_versions version JOIN foundry_product.components component ON component.id=version.component_id WHERE version.id=NEW.component_version_id AND component.asset_type='WEB_COMPONENT_ASSET') THEN
      RAISE EXCEPTION 'Web ComponentAsset APPROVE cannot commit without complete Registry availability and READY planning' USING ERRCODE='23514';
    END IF;
    IF target_capability_id IS NULL THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME='component_versions' THEN
    IF NEW.status<>'PUBLISHED' THEN RETURN NULL; END IF;
    SELECT component.registered_capability_id INTO target_capability_id FROM foundry_product.components component WHERE component.id=NEW.component_id AND component.asset_type='WEB_COMPONENT_ASSET';
    IF target_capability_id IS NULL AND EXISTS (SELECT 1 FROM foundry_product.components component WHERE component.id=NEW.component_id AND component.asset_type='WEB_COMPONENT_ASSET') THEN
      RAISE EXCEPTION 'Published Web ComponentAssetVersion cannot commit without complete Registry availability and READY planning' USING ERRCODE='23514';
    END IF;
    IF target_capability_id IS NULL THEN RETURN NULL; END IF;
  ELSE
    target_capability_id:=NEW.capability_id;
  END IF;
  SELECT c.course_id INTO target_course_id FROM foundry_product.capabilities c WHERE c.id=target_capability_id;
  IF tenant_id IS NULL OR actor_id IS NULL OR target_course_id IS NULL OR NOT foundry_product.cap07_actor_can_confirm(target_course_id) OR current_setting('foundry.governance_command',true)<>'component_publication'
    OR NOT EXISTS (
      SELECT 1
      FROM foundry_product.capabilities capability
      JOIN foundry_product.capability_versions version ON version.id=capability.active_version_id AND version.capability_id=capability.id AND version.status='ACTIVE' AND version.institution_id=capability.institution_id AND version.course_id=capability.course_id
      JOIN foundry_product.components component ON component.registered_capability_id=capability.id AND component.registered_capability_version_id=version.id AND component.capability_id=capability.id AND component.active_version_id=version.component_asset_version_id AND component.status='PUBLISHED' AND component.asset_type='WEB_COMPONENT_ASSET'
      JOIN foundry_product.publication_decisions decision ON decision.component_version_id=version.component_asset_version_id AND decision.action='APPROVE' AND decision.expert_id=actor_id
      JOIN foundry_product.capability_availability_decisions availability ON availability.capability_id=capability.id AND availability.capability_version_id=version.id AND availability.component_version_id=version.component_asset_version_id AND availability.confirmation_decision_id=decision.id AND availability.availability_status='AVAILABLE' AND availability.confirmed_by=actor_id
      JOIN foundry_product.capability_supply_relations supply ON supply.source_capability_resolution_id=component.source_capability_resolution_id AND supply.source_activity_plan_proposal_id=component.source_activity_plan_proposal_id AND supply.component_id=component.id AND supply.component_version_id=version.component_asset_version_id AND supply.registered_capability_id=capability.id AND supply.registered_capability_version_id=version.id AND supply.confirmation_decision_id=decision.id
      JOIN foundry_product.capability_resolutions source_resolution ON source_resolution.id=supply.source_capability_resolution_id AND source_resolution.diagnostic_observation_id=supply.source_diagnostic_observation_id
      JOIN foundry_product.capability_resolutions selected_resolution ON selected_resolution.task_id=source_resolution.task_id AND selected_resolution.episode_id=source_resolution.episode_id AND selected_resolution.diagnostic_observation_id=supply.source_diagnostic_observation_id AND selected_resolution.selected_capability_id=capability.id AND selected_resolution.selected_capability_version_id=version.id AND selected_resolution.decision='EXISTING' AND selected_resolution.no_match=false
      JOIN foundry_product.activity_plan_proposals ready_plan ON ready_plan.capability_resolution_id=selected_resolution.id AND ready_plan.selected_capability_id=capability.id AND ready_plan.selected_capability_version_id=version.id AND ready_plan.state='READY'
      WHERE capability.id=target_capability_id AND capability.institution_id=tenant_id AND capability.course_id=target_course_id
        AND NOT EXISTS (SELECT 1 FROM foundry_product.capability_resolutions newer WHERE newer.task_id=source_resolution.task_id AND newer.episode_id=source_resolution.episode_id AND (newer.created_at,newer.id)>(selected_resolution.created_at,selected_resolution.id))
        AND NOT EXISTS (SELECT 1 FROM foundry_product.activity_plan_proposals newer WHERE newer.task_id=ready_plan.task_id AND newer.episode_id=ready_plan.episode_id AND (newer.created_at,newer.id)>(ready_plan.created_at,ready_plan.id))
    ) THEN
    RAISE EXCEPTION 'Capability availability requires exact APPROVE confirmation, availability decision, Component registration and durable latest READY replanning' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "cap07_registration_complete_guard" AFTER INSERT OR UPDATE ON foundry_product.capabilities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION foundry_product.assert_cap07_registration_complete();
CREATE CONSTRAINT TRIGGER "cap07_registration_version_complete_guard" AFTER INSERT OR UPDATE ON foundry_product.capability_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION foundry_product.assert_cap07_registration_complete();
CREATE CONSTRAINT TRIGGER "cap07_registration_component_complete_guard" AFTER UPDATE ON foundry_product.components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION foundry_product.assert_cap07_registration_complete();
CREATE CONSTRAINT TRIGGER "cap07_registration_availability_complete_guard" AFTER INSERT ON foundry_product.capability_availability_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION foundry_product.assert_cap07_registration_complete();
CREATE CONSTRAINT TRIGGER "cap07_registration_decision_complete_guard" AFTER INSERT ON foundry_product.publication_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION foundry_product.assert_cap07_registration_complete();
CREATE CONSTRAINT TRIGGER "cap07_registration_published_version_complete_guard" AFTER UPDATE OF status ON foundry_product.component_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION foundry_product.assert_cap07_registration_complete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_product.assert_component_asset_preview() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid; actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid; session_id text:=current_setting('foundry.session_id',true); auth_method text:=current_setting('foundry.auth_method',true); exact_lineage boolean:=false;
BEGIN
  SELECT EXISTS (SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id JOIN foundry_product.component_evaluations e ON e.id=NEW.component_evaluation_id AND e.component_version_id=v.id AND e.content_hash=v.content_hash AND e.system_status='PASSED' WHERE v.id=NEW.component_version_id AND v.status='DRAFT' AND v.content_hash=NEW.content_hash AND c.asset_type='WEB_COMPONENT_ASSET' AND c.institution_id=NEW.institution_id AND c.course_id=NEW.course_id AND c.source_capability_resolution_id=NEW.source_capability_resolution_id) INTO exact_lineage;
  IF tenant_id IS NULL OR actor_id IS NULL OR length(COALESCE(session_id,''))=0 OR length(COALESCE(auth_method,''))=0 OR NOT exact_lineage
    OR NEW.institution_id<>tenant_id OR NEW.previewed_by<>actor_id OR NEW.status<>'SUCCEEDED'
    OR NEW.request_hash !~ '^sha256:[0-9a-f]{64}$' OR NEW.executor_version<>'cap-07.shared-web-executor.v1' OR NEW.executor_receipt_hash !~ '^sha256:[0-9a-f]{64}$'
    OR NEW.actor_provenance->>'institutionId'<>tenant_id::text OR NEW.actor_provenance->>'userId'<>actor_id::text OR NEW.actor_provenance->>'sessionId'<>session_id OR NEW.actor_provenance->>'authMethod'<>auth_method
    OR jsonb_typeof(NEW.learner_input)<>'object' OR jsonb_typeof(NEW.runtime_output)<>'object' OR jsonb_typeof(NEW.event_trace)<>'array'
    OR NOT foundry_product.cap07_actor_has_course(NEW.institution_id,NEW.course_id) THEN
    RAISE EXCEPTION 'Exact learner preview command, result or actor authority mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON foundry_product.component_asset_previews FOR EACH ROW EXECUTE FUNCTION foundry_product.assert_component_asset_preview();
CREATE TRIGGER "component_asset_preview_immutable_guard" BEFORE UPDATE OR DELETE ON foundry_product.component_asset_previews FOR EACH ROW EXECUTE FUNCTION foundry_product.protect_publication_decision();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_product.record_component_asset_preview(requested_preview_id uuid,requested_component_id uuid,requested_component_version_id uuid,requested_evaluation_id uuid,requested_hash text,requested_input jsonb,requested_output jsonb,requested_trace jsonb,requested_executor_version text,requested_executor_receipt_hash text,command_key text) RETURNS TABLE(preview_id uuid,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid; actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid; session_id text:=current_setting('foundry.session_id',true); auth_method text:=current_setting('foundry.auth_method',true); roles text:=current_setting('foundry.roles',true); row_scope record; inserted_id uuid; existing_row foundry_product.component_asset_previews%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('role',true),'')<>'foundry_component_executor' OR COALESCE(current_setting('foundry.executor_purpose',true),'')<>'WEB_COMPONENT_PREVIEW' THEN
    RAISE EXCEPTION 'Web ComponentAsset preview requires the dedicated trusted executor identity' USING ERRCODE='42501';
  END IF;
  IF tenant_id IS NULL OR actor_id IS NULL OR length(COALESCE(session_id,''))=0 OR length(COALESCE(auth_method,''))=0 OR length(COALESCE(command_key,''))<8 THEN RAISE EXCEPTION 'Preview requires an authenticated scoped command' USING ERRCODE='23514'; END IF;
  SELECT c.course_id,c.source_capability_resolution_id,v.content_hash INTO row_scope FROM foundry_product.components c JOIN foundry_product.component_versions v ON v.component_id=c.id JOIN foundry_product.component_evaluations e ON e.id=requested_evaluation_id AND e.component_version_id=v.id AND e.content_hash=v.content_hash AND e.system_status='PASSED' WHERE c.id=requested_component_id AND c.institution_id=tenant_id AND c.asset_type='WEB_COMPONENT_ASSET' AND v.id=requested_component_version_id AND v.status='DRAFT';
  IF row_scope IS NULL OR NOT foundry_product.cap07_actor_has_course(tenant_id,row_scope.course_id) THEN RAISE EXCEPTION 'Preview course authority or exact checks are unavailable' USING ERRCODE='23514'; END IF;
  INSERT INTO foundry_product.component_asset_previews(id,institution_id,course_id,component_version_id,component_evaluation_id,source_capability_resolution_id,content_hash,request_hash,learner_input,runtime_output,event_trace,executor_version,executor_receipt_hash,status,previewed_by,actor_provenance,idempotency_key) VALUES (requested_preview_id,tenant_id,row_scope.course_id,requested_component_version_id,requested_evaluation_id,row_scope.source_capability_resolution_id,row_scope.content_hash,requested_hash,requested_input,requested_output,requested_trace,requested_executor_version,requested_executor_receipt_hash,'SUCCEEDED',actor_id,jsonb_build_object('userId',actor_id::text,'institutionId',tenant_id::text,'roles',to_jsonb(string_to_array(COALESCE(roles,''),',')),'authMethod',auth_method,'sessionId',session_id,'authenticatedAt',now()::text),command_key) ON CONFLICT (institution_id,previewed_by,idempotency_key) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN preview_id:=inserted_id; replayed:=false; RETURN NEXT; RETURN; END IF;
  SELECT * INTO existing_row FROM foundry_product.component_asset_previews p WHERE p.institution_id=tenant_id AND p.previewed_by=actor_id AND p.idempotency_key=command_key;
  IF existing_row.id IS NULL OR existing_row.component_version_id<>requested_component_version_id OR existing_row.component_evaluation_id<>requested_evaluation_id OR existing_row.request_hash<>requested_hash OR existing_row.learner_input<>requested_input OR existing_row.runtime_output<>requested_output OR existing_row.event_trace<>requested_trace OR existing_row.executor_version<>requested_executor_version OR existing_row.executor_receipt_hash<>requested_executor_receipt_hash THEN RAISE EXCEPTION 'Preview idempotency key was reused with different input' USING ERRCODE='23505'; END IF;
  preview_id:=existing_row.id; replayed:=true; RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION foundry_product.record_component_asset_preview(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text) FROM PUBLIC, foundry_product_runtime, foundry_worker, foundry_auth_bootstrap;
GRANT EXECUTE ON FUNCTION foundry_product.record_component_asset_preview(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,text,text) TO foundry_component_executor;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_product.reject_direct_web_component_evaluation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF current_user='foundry_product_runtime' AND EXISTS (
    SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id
    WHERE v.id=NEW.component_version_id AND c.asset_type='WEB_COMPONENT_ASSET'
  ) THEN RAISE EXCEPTION 'Web ComponentAsset evaluations require the canonical evaluation service' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "0_web_component_evaluation_service_guard" BEFORE INSERT ON foundry_product.component_evaluations FOR EACH ROW EXECUTE FUNCTION foundry_product.reject_direct_web_component_evaluation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_private.assert_component_evaluation_tenant_lineage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  row_data jsonb:=to_jsonb(NEW);
  tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
  configured_role text:=NULLIF(NULLIF(current_setting('role',true),''),'none');
  invoker_role text:=session_user;
  runtime_role text;
  runtime_memberships text[];
  principal_is_superuser boolean:=false;
  principal_owns_table boolean:=false;
  executor_command boolean:=false;
BEGIN
  IF configured_role='foundry_component_executor' THEN
    executor_command:=TG_OP='INSERT' AND COALESCE(current_setting('foundry.executor_purpose',true),'')='WEB_COMPONENT_EVALUATION';
    IF NOT executor_command THEN
      RAISE EXCEPTION 'Component evaluation executor purpose mismatch' USING ERRCODE='42501';
    END IF;
    runtime_role:=configured_role;
  ELSIF configured_role IS NOT NULL THEN
    IF configured_role IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap') THEN
      SELECT array_agg(r.rolname ORDER BY r.rolname) INTO runtime_memberships
      FROM pg_catalog.pg_roles r
      WHERE r.rolname IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap')
        AND pg_catalog.pg_has_role(configured_role,r.rolname,'MEMBER');
      IF COALESCE(cardinality(runtime_memberships),0)<>1 THEN
        RAISE EXCEPTION 'Configured PostgreSQL role has ambiguous component evaluation authority: %',configured_role USING ERRCODE='42501';
      END IF;
      runtime_role:=configured_role;
    ELSE
      SELECT r.rolsuper,EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=TG_TABLE_SCHEMA AND c.relname=TG_TABLE_NAME AND c.relowner=r.oid
      ) INTO principal_is_superuser,principal_owns_table FROM pg_catalog.pg_roles r WHERE r.rolname=configured_role;
      IF COALESCE(principal_is_superuser,false) OR COALESCE(principal_owns_table,false) THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'Configured PostgreSQL role is not a component evaluation authority: %',configured_role USING ERRCODE='42501';
    END IF;
  ELSE
    SELECT r.rolsuper,EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=TG_TABLE_SCHEMA AND c.relname=TG_TABLE_NAME AND c.relowner=r.oid
    ) INTO principal_is_superuser,principal_owns_table FROM pg_catalog.pg_roles r WHERE r.rolname=invoker_role;
    IF COALESCE(principal_is_superuser,false) OR COALESCE(principal_owns_table,false) THEN RETURN NEW; END IF;
    SELECT array_agg(r.rolname ORDER BY r.rolname) INTO runtime_memberships
    FROM pg_catalog.pg_roles r
    WHERE r.rolname IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap')
      AND pg_catalog.pg_has_role(invoker_role,r.rolname,'MEMBER');
    CASE COALESCE(cardinality(runtime_memberships),0)
      WHEN 1 THEN runtime_role:=runtime_memberships[1];
      WHEN 0 THEN RAISE EXCEPTION 'PostgreSQL session principal has no component evaluation authority: %',invoker_role USING ERRCODE='42501';
      ELSE RAISE EXCEPTION 'PostgreSQL session principal has multiple component evaluation roles: %',invoker_role USING ERRCODE='42501';
    END CASE;
  END IF;
  IF runtime_role NOT IN ('foundry_product_runtime','foundry_worker','foundry_component_executor') THEN
    RAISE EXCEPTION 'PostgreSQL role cannot mutate component evaluations: %',runtime_role USING ERRCODE='42501';
  END IF;
  IF tenant_id IS NULL THEN RAISE EXCEPTION 'Component evaluation tenant context is required' USING ERRCODE='42501'; END IF;
  IF (row_data->>'institution_id')::uuid<>tenant_id
    OR NOT foundry_private.entity_in_tenant('COURSE',(row_data->>'course_id')::uuid,tenant_id)
    OR NOT foundry_private.entity_in_tenant('VERSION',(row_data->>'component_version_id')::uuid,tenant_id)
    OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'created_by')::uuid,tenant_id)
    OR NOT foundry_private.uuid_array_in_tenant(row_data->'source_observation_ids','OBSERVATION',tenant_id)
    OR NOT foundry_private.uuid_array_in_tenant(row_data->'source_review_ids','REVIEW',tenant_id)
    OR NOT foundry_private.uuid_array_in_tenant(row_data->'source_attempt_ids','ATTEMPT',tenant_id) THEN
    RAISE EXCEPTION 'ComponentEvaluation tenant lineage mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundry_private.assert_component_evaluation_tenant_lineage() FROM PUBLIC;
DROP TRIGGER IF EXISTS "_authority_tenant_lineage_guard" ON foundry_product.component_evaluations;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON foundry_product.component_evaluations FOR EACH ROW EXECUTE FUNCTION foundry_private.assert_component_evaluation_tenant_lineage();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_product.record_web_component_evaluation(
  requested_id uuid,requested_component_version_id uuid,requested_input_hash text,requested_system_status text,
  requested_system_checks jsonb,requested_fixture_execution jsonb,requested_evidence_checks jsonb,requested_provider_checks jsonb
) RETURNS TABLE(evaluation_id uuid,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid; actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid; roles text:=COALESCE(current_setting('foundry.roles',true),''); row_scope record; hash_pass boolean:=false; checks_pass boolean:=false; fixture_pass boolean:=false; evidence_pass boolean:=false; package_pass boolean:=false; source_pass boolean:=false; privacy_pass boolean:=false; canonical_pass boolean:=false; inserted_id uuid; existing_row foundry_product.component_evaluations%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('role',true),'')<>'foundry_component_executor' OR COALESCE(current_setting('foundry.executor_purpose',true),'')<>'WEB_COMPONENT_EVALUATION' THEN
    RAISE EXCEPTION 'Web ComponentAsset evaluation requires the dedicated trusted executor identity' USING ERRCODE='42501';
  END IF;
  SELECT c.id AS component_id,c.course_id,c.source_capability_resolution_id,c.source_activity_plan_proposal_id,c.adapted_from_capability_id,c.adapted_from_capability_version_id,c.adapted_from_content_hash,c.adapted_from_component_version_id,c.adapted_from_component_content_hash,v.content_hash,v.contract,v.content,r.diagnostic_observation_id,o.attempt_id
    INTO row_scope
    FROM foundry_product.component_versions v
    JOIN foundry_product.components c ON c.id=v.component_id
    JOIN foundry_product.capability_resolutions r ON r.id=c.source_capability_resolution_id
    JOIN foundry_product.diagnostic_observations o ON o.id=r.diagnostic_observation_id
    WHERE v.id=requested_component_version_id AND v.status='DRAFT' AND c.asset_type='WEB_COMPONENT_ASSET' AND c.institution_id=tenant_id AND c.supply_strategy='ADAPT';
  IF row_scope IS NULL OR actor_id IS NULL OR NOT (string_to_array(roles,',') && ARRAY['EXPERT','ADMIN']) OR NOT foundry_product.cap07_actor_has_course(tenant_id,row_scope.course_id) THEN
    RAISE EXCEPTION 'Web ComponentAsset evaluation requires an authenticated course-authorized expert service command' USING ERRCODE='23514';
  END IF;
  SELECT requested_input_hash ~ '^[0-9a-f]{64}$' INTO hash_pass;
  SELECT requested_system_status IN ('PASSED','BLOCKED')
    AND jsonb_typeof(requested_system_checks)='array' AND jsonb_array_length(requested_system_checks)>=10
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(requested_system_checks) item WHERE item->>'status'='BLOCKED') INTO checks_pass;
  SELECT requested_fixture_execution->>'status'='EXECUTED_PASSED'
    AND requested_fixture_execution->>'executorVersion'='cap-07.shared-web-executor.v1'
    AND requested_fixture_execution->>'executorReceiptHash' ~ '^sha256:[0-9a-f]{64}$' INTO fixture_pass;
  evidence_pass:=COALESCE(hash_pass,false) AND COALESCE(checks_pass,false) AND COALESCE(fixture_pass,false);
  SELECT
    row_scope.contract->>'supplyStrategy'='ADAPT' AND row_scope.contract->>'dataClassification'='DEIDENTIFIED_INSTRUCTIONAL'
    AND row_scope.contract->'adaptationSource'->>'capabilityVersionId'=row_scope.adapted_from_capability_version_id::text
    AND row_scope.contract->'adaptationSource'->>'capabilityVersionContentHash'=row_scope.adapted_from_content_hash
    AND row_scope.contract->'adaptationSource'->>'componentAssetVersionId'=row_scope.adapted_from_component_version_id::text
    AND row_scope.contract->'adaptationSource'->>'componentAssetVersionContentHash'=row_scope.adapted_from_component_content_hash
    AND row_scope.content->>'packageRole'='ADAPTED' AND row_scope.content->'adaptation'->>'kind'='SOURCE_BEHAVIOR_WITH_DIAGNOSTIC_SCAFFOLD'
    AND row_scope.content->'adaptation'->'source'->>'componentVersionId'=row_scope.adapted_from_component_version_id::text
    AND row_scope.content->'adaptation'->'source'->>'contentHash'=row_scope.adapted_from_component_content_hash
    INTO package_pass;
  SELECT EXISTS (
      SELECT 1 FROM foundry_product.capability_versions source_capability_version
      JOIN foundry_product.capabilities source_capability ON source_capability.id=source_capability_version.capability_id
      JOIN foundry_product.component_versions source_component_version ON source_component_version.id=source_capability_version.component_asset_version_id
      JOIN foundry_product.components source_component ON source_component.id=source_component_version.component_id
      WHERE source_capability_version.id=row_scope.adapted_from_capability_version_id AND source_capability.id=row_scope.adapted_from_capability_id
        AND source_capability.active_version_id=source_capability_version.id AND source_capability_version.status='ACTIVE' AND source_capability_version.content_hash=row_scope.adapted_from_content_hash
        AND source_component_version.id=row_scope.adapted_from_component_version_id AND source_component.active_version_id=source_component_version.id AND source_component_version.status='PUBLISHED' AND source_component_version.content_hash=row_scope.adapted_from_component_content_hash
        AND row_scope.content->'adaptation'->'source'->'contract'=source_component_version.contract AND row_scope.content->'adaptation'->'source'->'package'=source_component_version.content
    ) INTO source_pass;
  SELECT position(lower(row_scope.diagnostic_observation_id::text) in lower(row_scope.contract::text||row_scope.content::text))=0
    AND position(lower(row_scope.source_capability_resolution_id::text) in lower(row_scope.contract::text||row_scope.content::text))=0
    AND position(lower(row_scope.source_activity_plan_proposal_id::text) in lower(row_scope.contract::text||row_scope.content::text))=0
    INTO privacy_pass;
  canonical_pass:=COALESCE(evidence_pass,false) AND COALESCE(package_pass,false) AND COALESCE(source_pass,false) AND COALESCE(privacy_pass,false);
  IF requested_system_status='PASSED' AND NOT COALESCE(canonical_pass,false) THEN
    RAISE EXCEPTION 'Web ComponentAsset PASSED evaluation does not match canonical exact-source, hash and privacy checks' USING ERRCODE='23514';
  END IF;
  INSERT INTO foundry_product.component_evaluations(id,component_version_id,institution_id,course_id,evaluator_key,evaluator_version,content_hash,input_hash,system_status,system_checks,source_observation_ids,source_review_ids,source_attempt_ids,fixture_execution,evidence_checks,provider_checks,created_by)
  VALUES(requested_id,requested_component_version_id,tenant_id,row_scope.course_id,'foundry-web-component-asset-gates','cap-07.1',row_scope.content_hash,requested_input_hash,requested_system_status,requested_system_checks,ARRAY[row_scope.diagnostic_observation_id],ARRAY[]::uuid[],ARRAY[row_scope.attempt_id],requested_fixture_execution,requested_evidence_checks,requested_provider_checks,actor_id)
  ON CONFLICT (component_version_id,input_hash) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN evaluation_id:=inserted_id; replayed:=false; RETURN NEXT; RETURN; END IF;
  SELECT * INTO existing_row FROM foundry_product.component_evaluations e WHERE e.component_version_id=requested_component_version_id AND e.input_hash=requested_input_hash;
  IF existing_row.id IS NULL OR existing_row.system_status<>requested_system_status OR existing_row.system_checks<>requested_system_checks OR existing_row.fixture_execution<>requested_fixture_execution THEN RAISE EXCEPTION 'Web ComponentAsset evaluation replay mismatch' USING ERRCODE='23505'; END IF;
  evaluation_id:=existing_row.id; replayed:=true; RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION foundry_product.record_web_component_evaluation(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, foundry_product_runtime, foundry_worker, foundry_auth_bootstrap;
GRANT EXECUTE ON FUNCTION foundry_product.record_web_component_evaluation(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb) TO foundry_component_executor;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_product.assert_capability_availability_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid; actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid; session_id text:=current_setting('foundry.session_id',true); auth_method text:=current_setting('foundry.auth_method',true);
BEGIN
  IF current_setting('foundry.governance_command',true)<>'component_publication' OR tenant_id IS NULL OR actor_id IS NULL OR NEW.institution_id<>tenant_id OR NEW.confirmed_by<>actor_id OR NOT foundry_product.cap07_actor_can_confirm(NEW.course_id)
    OR length(COALESCE(session_id,''))=0 OR length(COALESCE(auth_method,''))=0
    OR NEW.actor_provenance->>'institutionId'<>tenant_id::text OR NEW.actor_provenance->>'userId'<>actor_id::text OR NEW.actor_provenance->>'sessionId'<>session_id OR NEW.actor_provenance->>'authMethod'<>auth_method OR length(btrim(NEW.rationale))<5
    OR NEW.availability_scope->>'kind'<>'INSTITUTION_COURSE_PRIVATE' OR (NEW.availability_scope->>'crossTenantReuse')::boolean<>false
    OR NEW.availability_scope->>'institutionId'<>tenant_id::text OR NEW.availability_scope->>'courseId'<>NEW.course_id::text
    OR NOT EXISTS (SELECT 1 FROM foundry_product.publication_decisions d WHERE d.id=NEW.confirmation_decision_id AND d.action='APPROVE' AND d.expert_id=actor_id AND d.component_version_id=NEW.component_version_id AND d.actor_provenance->>'sessionId'=session_id AND d.actor_provenance->>'authMethod'=auth_method)
    OR NOT EXISTS (SELECT 1 FROM foundry_product.capability_versions v JOIN foundry_product.capabilities c ON c.id=v.capability_id JOIN foundry_product.components component ON component.id=(SELECT cv.component_id FROM foundry_product.component_versions cv WHERE cv.id=NEW.component_version_id) WHERE v.id=NEW.capability_version_id AND v.capability_id=NEW.capability_id AND v.component_asset_version_id=NEW.component_version_id AND v.institution_id=tenant_id AND v.course_id=NEW.course_id AND c.institution_id=tenant_id AND c.course_id=NEW.course_id AND component.course_id=NEW.course_id AND component.institution_id=tenant_id) THEN
    RAISE EXCEPTION 'Capability availability confirmation exact-version lineage mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON foundry_product.capability_availability_decisions FOR EACH ROW EXECUTE FUNCTION foundry_product.assert_capability_availability_decision();
CREATE TRIGGER "capability_availability_immutable_guard" BEFORE UPDATE OR DELETE ON foundry_product.capability_availability_decisions FOR EACH ROW EXECUTE FUNCTION foundry_product.protect_publication_decision();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_product.assert_capability_supply_relation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid; actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Capability supply relation is immutable' USING ERRCODE='23514'; END IF;
  IF current_setting('foundry.governance_command',true)<>'component_publication' OR NEW.institution_id<>tenant_id OR NEW.created_by<>actor_id OR NOT foundry_product.cap07_actor_can_confirm(NEW.course_id)
    OR NOT EXISTS (
      SELECT 1 FROM foundry_product.components c
      JOIN foundry_product.component_versions cv ON cv.id=NEW.component_version_id AND cv.component_id=c.id AND cv.status='PUBLISHED'
      JOIN foundry_product.capability_resolutions r ON r.id=NEW.source_capability_resolution_id AND r.id=c.source_capability_resolution_id AND r.diagnostic_observation_id=NEW.source_diagnostic_observation_id
      JOIN foundry_product.activity_plan_proposals p ON p.id=NEW.source_activity_plan_proposal_id AND p.id=c.source_activity_plan_proposal_id AND p.capability_resolution_id=r.id
      JOIN foundry_product.diagnostic_observations o ON o.id=NEW.source_diagnostic_observation_id
      JOIN foundry_product.learner_attempts a ON a.id=NEW.source_attempt_id AND a.id=o.attempt_id
      JOIN foundry_product.capability_versions registered_version ON registered_version.id=NEW.registered_capability_version_id AND registered_version.capability_id=NEW.registered_capability_id AND registered_version.component_asset_version_id=cv.id
      JOIN foundry_product.publication_decisions decision ON decision.id=NEW.confirmation_decision_id AND decision.component_version_id=cv.id AND decision.action='APPROVE' AND decision.expert_id=actor_id
      WHERE c.id=NEW.component_id AND c.institution_id=tenant_id AND c.course_id=NEW.course_id AND c.registered_capability_id=NEW.registered_capability_id AND c.registered_capability_version_id=NEW.registered_capability_version_id
    ) THEN RAISE EXCEPTION 'Protected capability supply relation exact lineage mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON foundry_product.capability_supply_relations FOR EACH ROW EXECUTE FUNCTION foundry_product.assert_capability_supply_relation();
CREATE TRIGGER "capability_supply_relation_immutable_guard" BEFORE DELETE ON foundry_product.capability_supply_relations FOR EACH ROW EXECUTE FUNCTION foundry_product.protect_publication_decision();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_product"."assert_component_evaluation_lineage"() RETURNS trigger AS $$
DECLARE component_institution uuid; component_course uuid; component_type text; source_resolution uuid;
BEGIN
  SELECT c.institution_id,c.course_id,c.asset_type,c.source_capability_resolution_id INTO component_institution,component_course,component_type,source_resolution
  FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id WHERE v.id=NEW.component_version_id;
  IF component_institution IS NULL OR component_institution<>NEW.institution_id OR component_course<>NEW.course_id THEN RAISE EXCEPTION 'Component evaluation scope does not match its version' USING ERRCODE='23514'; END IF;
  IF component_type='WEB_COMPONENT_ASSET' THEN
    IF cardinality(NEW.source_observation_ids)<>1 OR cardinality(NEW.source_review_ids)<>0 OR cardinality(NEW.source_attempt_ids)<>1
      OR NOT EXISTS (SELECT 1 FROM foundry_product.capability_resolutions r JOIN foundry_product.diagnostic_observations o ON o.id=r.diagnostic_observation_id JOIN foundry_product.learner_attempts a ON a.id=o.attempt_id WHERE r.id=source_resolution AND o.id=NEW.source_observation_ids[1] AND a.id=NEW.source_attempt_ids[1] AND o.superseded_by_id IS NULL) THEN RAISE EXCEPTION 'Web ComponentAsset evaluation must preserve exact CAP-02 gap lineage' USING ERRCODE='23514'; END IF;
  ELSIF cardinality(NEW.source_observation_ids)<1 OR cardinality(NEW.source_review_ids)<1 OR cardinality(NEW.source_attempt_ids)<1 THEN RAISE EXCEPTION 'Component evaluation must preserve source lineage' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION foundry_private.cap04_runtime_delivery_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid:=NULLIF(current_setting('foundry.institution_id',true),'')::uuid; actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid; actor_roles text:=COALESCE(current_setting('foundry.roles',true),''); prior foundry_product.runtime_deliveries%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RuntimeDelivery cannot be deleted' USING ERRCODE='23514'; END IF;
  IF tenant_id IS NOT NULL AND NEW.institution_id<>tenant_id THEN RAISE EXCEPTION 'RuntimeDelivery tenant mismatch' USING ERRCODE='23514'; END IF;
  IF actor_id IS NOT NULL AND actor_id<>NEW.learner_id AND position('ADMIN' in actor_roles)=0 THEN RAISE EXCEPTION 'RuntimeDelivery actor is not the Task learner' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' THEN RAISE EXCEPTION 'RuntimeDelivery must start PENDING' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS (SELECT 1 FROM foundry_product.activity_plans plan JOIN foundry_product.learning_tasks task ON task.id=plan.task_id JOIN foundry_product.learning_episodes episode ON episode.id=plan.episode_id AND episode.task_id=task.id WHERE plan.id=NEW.activity_plan_id AND plan.institution_id=NEW.institution_id AND plan.course_id=NEW.course_id AND plan.task_id=NEW.task_id AND plan.episode_id=NEW.episode_id AND task.learner_id=NEW.learner_id AND plan.capability_id=NEW.capability_id AND plan.capability_version_id=NEW.capability_version_id AND plan.capability_version_content_hash=NEW.capability_version_content_hash AND plan.runtime_contract_hash=NEW.runtime_contract_hash AND plan.implementation_key=NEW.implementation_key AND plan.runtime_kind=NEW.runtime_kind) THEN RAISE EXCEPTION 'RuntimeDelivery ActivityPlan/exact-version lineage mismatch' USING ERRCODE='23514'; END IF;
    IF NEW.retry_of_delivery_id IS NULL THEN
      IF NEW.attempt_number<>1 THEN RAISE EXCEPTION 'Initial RuntimeDelivery must be attempt one' USING ERRCODE='23514'; END IF;
    ELSE
      SELECT * INTO prior FROM foundry_product.runtime_deliveries delivery WHERE delivery.id=NEW.retry_of_delivery_id FOR SHARE;
      IF prior.id IS NULL OR prior.institution_id<>NEW.institution_id OR prior.course_id<>NEW.course_id OR prior.task_id<>NEW.task_id OR prior.episode_id<>NEW.episode_id OR prior.learner_id<>NEW.learner_id OR prior.activity_plan_id<>NEW.activity_plan_id OR prior.capability_id<>NEW.capability_id OR prior.capability_version_id<>NEW.capability_version_id OR prior.capability_version_content_hash<>NEW.capability_version_content_hash OR prior.runtime_contract_hash<>NEW.runtime_contract_hash OR prior.implementation_key<>NEW.implementation_key OR prior.runtime_kind<>NEW.runtime_kind
        OR prior.status NOT IN ('FAILED','TIMED_OUT','CANCELLED') OR COALESCE((prior.normalized_error->>'retryable')::boolean,false)<>true OR NEW.attempt_number<>prior.attempt_number+1 OR NEW.attempt_number>2
        OR EXISTS (SELECT 1 FROM foundry_product.runtime_deliveries newer WHERE newer.activity_plan_id=prior.activity_plan_id AND newer.attempt_number>prior.attempt_number) THEN RAISE EXCEPTION 'RuntimeDelivery retry requires the latest exact retryable terminal predecessor and bounded attempt number' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED') THEN RAISE EXCEPTION 'RuntimeDelivery terminal state is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='PENDING' AND NEW.status='RUNNING') OR (OLD.status='RUNNING' AND NEW.status IN ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED'))) THEN RAISE EXCEPTION 'RuntimeDelivery transition is invalid' USING ERRCODE='23514'; END IF;
  IF (OLD.id,OLD.institution_id,OLD.course_id,OLD.task_id,OLD.episode_id,OLD.learner_id,OLD.activity_plan_id,OLD.retry_of_delivery_id,OLD.attempt_number,OLD.capability_id,OLD.capability_version_id,OLD.capability_version_content_hash,OLD.runtime_contract_hash,OLD.implementation_key,OLD.runtime_kind,OLD.request_hash,OLD.idempotency_key,OLD.deadline_ms,OLD.started_at)
    IS DISTINCT FROM (NEW.id,NEW.institution_id,NEW.course_id,NEW.task_id,NEW.episode_id,NEW.learner_id,NEW.activity_plan_id,NEW.retry_of_delivery_id,NEW.attempt_number,NEW.capability_id,NEW.capability_version_id,NEW.capability_version_content_hash,NEW.runtime_contract_hash,NEW.implementation_key,NEW.runtime_kind,NEW.request_hash,NEW.idempotency_key,NEW.deadline_ms,NEW.started_at) THEN RAISE EXCEPTION 'RuntimeDelivery exact lineage is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "foundry_product"."assert_component_active_version"() RETURNS trigger AS $$
DECLARE governance_command text:=current_setting('foundry.governance_command',true); target_component uuid; target_status text; candidate_lineage_valid boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    IF governance_command<>'component_candidate' OR NEW.status<>'CANDIDATE' OR NEW.active_version_id IS NOT NULL THEN RAISE EXCEPTION 'Components must begin as governed Candidates without an active version' USING ERRCODE='23514'; END IF;
    IF NEW.asset_type='WEB_COMPONENT_ASSET' THEN
      SELECT EXISTS (
        SELECT 1 FROM foundry_product.capability_resolutions r
        JOIN foundry_product.activity_plan_proposals p ON p.id=NEW.source_activity_plan_proposal_id AND p.capability_resolution_id=r.id
        JOIN foundry_product.learning_tasks t ON t.id=r.task_id
        JOIN foundry_product.courses c ON c.id=t.course_id
        JOIN foundry_product.subjects s ON s.id=c.subject_id
        JOIN foundry_product.capability_versions source_version ON source_version.id=NEW.adapted_from_capability_version_id AND source_version.capability_id=NEW.adapted_from_capability_id AND source_version.status='ACTIVE' AND source_version.content_hash=NEW.adapted_from_content_hash
        JOIN foundry_product.capabilities source_capability ON source_capability.id=source_version.capability_id AND source_capability.active_version_id=source_version.id AND source_capability.reference_pack_key=s.reference_pack_key
        JOIN foundry_product.component_versions source_component_version ON source_component_version.id=NEW.adapted_from_component_version_id AND source_component_version.id=source_version.component_asset_version_id AND source_component_version.status='PUBLISHED' AND source_component_version.content_hash=NEW.adapted_from_component_content_hash
        JOIN foundry_product.components source_component ON source_component.id=source_component_version.component_id AND source_component.asset_type='WEB_COMPONENT_ASSET' AND source_component.active_version_id=source_component_version.id AND source_component.institution_id=NEW.institution_id AND source_component.course_id=NEW.course_id
        WHERE r.id=NEW.source_capability_resolution_id AND r.institution_id=NEW.institution_id AND r.course_id=NEW.course_id AND r.decision='ADAPT' AND NEW.supply_strategy='ADAPT'
          AND r.no_match AND r.teacher_escalation AND r.gap_signal->>'kind'='ADAPTATION_REQUIRED' AND r.gap_signal->>'relatedCapabilityVersionId'=source_version.id::text
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.candidate_set) candidate WHERE candidate->>'capabilityId'=source_capability.id::text AND candidate->>'versionId'=source_version.id::text AND candidate->>'contentHash'=source_version.content_hash AND candidate->>'matchMode'='ADAPT' AND candidate->>'eligibility'='ELIGIBLE' AND jsonb_array_length(COALESCE(candidate->'exclusionReasons','[]'::jsonb))=0)
          AND p.state='BLOCKED' AND p.selected_capability_version_id IS NULL AND s.reference_pack_key=NEW.reference_pack_key AND NEW.capability_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM foundry_product.capability_resolutions newer WHERE newer.task_id=r.task_id AND newer.episode_id=r.episode_id AND (newer.created_at,newer.id)>(r.created_at,r.id))
          AND NOT EXISTS (SELECT 1 FROM foundry_product.activity_plan_proposals newer WHERE newer.task_id=p.task_id AND newer.episode_id=p.episode_id AND (newer.created_at,newer.id)>(p.created_at,p.id))
      ) INTO candidate_lineage_valid;
    ELSE
      SELECT EXISTS (SELECT 1 FROM foundry_product.diagnostic_observations o JOIN foundry_product.learner_attempts a ON a.id=o.attempt_id JOIN foundry_product.learning_tasks t ON t.id=a.task_id JOIN foundry_product.courses c ON c.id=t.course_id JOIN foundry_product.subjects s ON s.id=c.subject_id JOIN foundry_product.capabilities cap ON cap.id=a.capability_id JOIN foundry_product.teacher_reviews r ON r.observation_id=o.id WHERE o.id=NULLIF(NEW.source_signal->>'observationId','')::uuid AND r.id=NULLIF(NEW.source_signal->>'reviewId','')::uuid AND t.institution_id=NEW.institution_id AND t.course_id=NEW.course_id AND cap.id=NEW.capability_id AND cap.active_version_id=o.capability_version_id AND s.reference_pack_key=NEW.reference_pack_key AND cap.reference_pack_key=NEW.reference_pack_key AND o.observation_source='CAPABILITY' AND o.failure_code=NEW.failure_code AND o.superseded_by_id IS NULL AND r.decision IN ('ACCEPT','CORRECT','SUPPLEMENT') AND r.actor_provenance->>'userId'=r.teacher_id::text AND r.actor_provenance->>'institutionId'=NEW.institution_id::text AND length(COALESCE(r.actor_provenance->>'sessionId',''))>0 AND COALESCE(r.actor_provenance->>'authMethod','') NOT LIKE 'migrated-%') INTO candidate_lineage_valid;
    END IF;
    IF NOT candidate_lineage_valid THEN RAISE EXCEPTION 'Component Candidate requires current governed source lineage' USING ERRCODE='23514'; END IF; RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND governance_command NOT IN ('component_publication','component_rollback') THEN RAISE EXCEPTION 'Component lifecycle status requires a governed publication or rollback command' USING ERRCODE='23514'; END IF;
  IF NEW.active_version_id IS DISTINCT FROM OLD.active_version_id THEN
    IF governance_command NOT IN ('component_publication','component_rollback') THEN RAISE EXCEPTION 'Component active version requires a governed publication or rollback command' USING ERRCODE='23514'; END IF;
    SELECT v.component_id,v.status INTO target_component,target_status FROM foundry_product.component_versions v WHERE v.id=NEW.active_version_id;
    IF target_component IS NULL OR target_component<>NEW.id OR target_status<>'PUBLISHED' THEN RAISE EXCEPTION 'Component active version must be a published version from the same Component' USING ERRCODE='23514'; END IF;
  END IF;
  IF OLD.asset_type IS DISTINCT FROM NEW.asset_type OR OLD.source_capability_resolution_id IS DISTINCT FROM NEW.source_capability_resolution_id OR OLD.source_activity_plan_proposal_id IS DISTINCT FROM NEW.source_activity_plan_proposal_id OR OLD.supply_strategy IS DISTINCT FROM NEW.supply_strategy OR OLD.adapted_from_capability_id IS DISTINCT FROM NEW.adapted_from_capability_id OR OLD.adapted_from_capability_version_id IS DISTINCT FROM NEW.adapted_from_capability_version_id OR OLD.adapted_from_content_hash IS DISTINCT FROM NEW.adapted_from_content_hash OR OLD.adapted_from_component_version_id IS DISTINCT FROM NEW.adapted_from_component_version_id OR OLD.adapted_from_component_content_hash IS DISTINCT FROM NEW.adapted_from_component_content_hash THEN RAISE EXCEPTION 'ComponentAsset proposal strategy and source lineage are immutable' USING ERRCODE='23514'; END IF;
  IF OLD.asset_type='WEB_COMPONENT_ASSET' AND (NEW.capability_id IS DISTINCT FROM OLD.capability_id OR NEW.registered_capability_id IS DISTINCT FROM OLD.registered_capability_id OR NEW.registered_capability_version_id IS DISTINCT FROM OLD.registered_capability_version_id) AND (governance_command<>'component_publication' OR NOT foundry_product.cap07_actor_can_confirm(NEW.course_id)
    OR NEW.capability_id IS NULL OR NEW.registered_capability_id<>NEW.capability_id
    OR NOT EXISTS (SELECT 1 FROM foundry_product.capability_versions capability_version JOIN foundry_product.publication_decisions decision ON decision.component_version_id=NEW.active_version_id AND decision.action='APPROVE' AND decision.expert_id=NULLIF(current_setting('foundry.user_id',true),'')::uuid WHERE capability_version.id=NEW.registered_capability_version_id AND capability_version.capability_id=NEW.registered_capability_id AND capability_version.component_asset_version_id=NEW.active_version_id AND capability_version.institution_id=NEW.institution_id AND capability_version.course_id=NEW.course_id)) THEN RAISE EXCEPTION 'Web ComponentAsset Registry binding requires exact governed confirmation' USING ERRCODE='23514'; END IF;
  IF OLD.active_version_id IS NOT NULL AND NEW.title IS DISTINCT FROM OLD.title AND governance_command NOT IN ('component_publication','component_rollback') THEN RAISE EXCEPTION 'Active Component presentation changes only with publication or rollback' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "foundry_product"."assert_publication_decision"() RETURNS trigger AS $$
DECLARE governance_command text:=current_setting('foundry.governance_command',true); actor_id uuid:=NULLIF(current_setting('foundry.user_id',true),'')::uuid; session_id text:=current_setting('foundry.session_id',true); auth_method text:=current_setting('foundry.auth_method',true); version_component uuid; version_status text; version_hash text; component_institution uuid; component_course uuid; component_active uuid; component_type text; evaluation_status text; evaluation_hash text; workflow_matches boolean:=false; evaluation_lineage_current boolean:=false;
BEGIN
  IF length(btrim(NEW.rationale))<5 THEN RAISE EXCEPTION 'Publication rationale is required' USING ERRCODE='23514'; END IF;
  SELECT v.component_id,v.status,v.content_hash,c.institution_id,c.course_id,c.active_version_id,c.asset_type INTO version_component,version_status,version_hash,component_institution,component_course,component_active,component_type FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id WHERE v.id=NEW.component_version_id;
  IF NEW.action IN ('APPROVE','REJECT') THEN
    IF governance_command<>'component_publication' OR version_status<>'DRAFT' OR NEW.evaluation_id IS NULL OR NEW.workflow_thread_id IS NULL OR NEW.human_rubric IS NULL
      OR actor_id IS NULL OR NEW.expert_id<>actor_id OR NOT foundry_product.cap07_actor_can_confirm(component_course)
      OR NEW.actor_provenance->>'userId'<>actor_id::text OR NEW.actor_provenance->>'institutionId'<>component_institution::text OR NEW.actor_provenance->>'sessionId'<>session_id OR NEW.actor_provenance->>'authMethod'<>auth_method THEN RAISE EXCEPTION 'Publication decision requires a current evaluated Draft and authenticated course-authorized expert workflow' USING ERRCODE='23514'; END IF;
    SELECT e.system_status,e.content_hash INTO evaluation_status,evaluation_hash FROM foundry_product.component_evaluations e WHERE e.id=NEW.evaluation_id AND e.component_version_id=NEW.component_version_id;
    IF component_type='WEB_COMPONENT_ASSET' THEN
      SELECT cardinality(e.source_observation_ids)=1 AND cardinality(e.source_review_ids)=0 AND cardinality(e.source_attempt_ids)=1 AND EXISTS (
        SELECT 1 FROM foundry_product.components c
        JOIN foundry_product.capability_resolutions r ON r.id=c.source_capability_resolution_id
        JOIN foundry_product.activity_plan_proposals plan ON plan.id=c.source_activity_plan_proposal_id AND plan.capability_resolution_id=r.id
        JOIN foundry_product.diagnostic_observations o ON o.id=r.diagnostic_observation_id
        JOIN foundry_product.learner_attempts a ON a.id=o.attempt_id
        JOIN foundry_product.capability_versions source_version ON source_version.id=c.adapted_from_capability_version_id AND source_version.capability_id=c.adapted_from_capability_id AND source_version.content_hash=c.adapted_from_content_hash AND source_version.status='ACTIVE'
        JOIN foundry_product.capabilities source_capability ON source_capability.id=source_version.capability_id AND source_capability.active_version_id=source_version.id
        JOIN foundry_product.component_versions source_component_version ON source_component_version.id=c.adapted_from_component_version_id AND source_component_version.id=source_version.component_asset_version_id AND source_component_version.status='PUBLISHED' AND source_component_version.content_hash=c.adapted_from_component_content_hash
        JOIN foundry_product.components source_component ON source_component.id=source_component_version.component_id AND source_component.asset_type='WEB_COMPONENT_ASSET' AND source_component.active_version_id=source_component_version.id AND source_component.institution_id=c.institution_id AND source_component.course_id=c.course_id
        WHERE c.id=version_component AND c.supply_strategy='ADAPT' AND r.decision='ADAPT' AND r.no_match AND r.teacher_escalation AND r.gap_signal->>'kind'='ADAPTATION_REQUIRED' AND r.gap_signal->>'relatedCapabilityVersionId'=source_version.id::text
          AND plan.state='BLOCKED' AND plan.selected_capability_version_id IS NULL AND o.id=e.source_observation_ids[1] AND a.id=e.source_attempt_ids[1] AND o.superseded_by_id IS NULL
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.candidate_set) candidate WHERE candidate->>'capabilityId'=source_capability.id::text AND candidate->>'versionId'=source_version.id::text AND candidate->>'contentHash'=source_version.content_hash AND candidate->>'matchMode'='ADAPT' AND candidate->>'eligibility'='ELIGIBLE' AND jsonb_array_length(COALESCE(candidate->'exclusionReasons','[]'::jsonb))=0)
          AND NOT EXISTS (SELECT 1 FROM foundry_product.capability_resolutions newer WHERE newer.task_id=r.task_id AND newer.episode_id=r.episode_id AND (newer.created_at,newer.id)>(r.created_at,r.id))
          AND NOT EXISTS (SELECT 1 FROM foundry_product.activity_plan_proposals newer WHERE newer.task_id=plan.task_id AND newer.episode_id=plan.episode_id AND (newer.created_at,newer.id)>(plan.created_at,plan.id))
      ) INTO evaluation_lineage_current FROM foundry_product.component_evaluations e WHERE e.id=NEW.evaluation_id;
      IF NEW.action='APPROVE' AND NOT EXISTS (SELECT 1 FROM foundry_product.component_asset_previews p WHERE p.component_version_id=NEW.component_version_id AND p.component_evaluation_id=NEW.evaluation_id AND p.content_hash=version_hash AND p.status='SUCCEEDED' AND p.actor_provenance->>'institutionId'=component_institution::text AND length(COALESCE(p.actor_provenance->>'sessionId',''))>0 AND COALESCE(p.actor_provenance->>'authMethod','') NOT LIKE 'migrated-%') THEN RAISE EXCEPTION 'Web ComponentAsset confirmation requires exact authenticated checks-bound learner preview' USING ERRCODE='23514'; END IF;
    ELSE
      SELECT count(DISTINCT o.id)=cardinality(e.source_observation_ids) AND count(DISTINCT r.id)=cardinality(e.source_review_ids) AND count(DISTINCT a.id)=cardinality(e.source_attempt_ids) INTO evaluation_lineage_current FROM foundry_product.component_evaluations e JOIN foundry_product.diagnostic_observations o ON o.id=ANY(e.source_observation_ids) AND o.superseded_by_id IS NULL JOIN foundry_product.learner_attempts a ON a.id=o.attempt_id AND a.id=ANY(e.source_attempt_ids) JOIN foundry_product.teacher_reviews r ON r.observation_id=o.id AND r.id=ANY(e.source_review_ids) WHERE e.id=NEW.evaluation_id AND r.decision IN ('ACCEPT','CORRECT','SUPPLEMENT') AND r.actor_provenance->>'userId'=r.teacher_id::text AND r.actor_provenance->>'institutionId'=component_institution::text AND length(COALESCE(r.actor_provenance->>'sessionId',''))>0 AND COALESCE(r.actor_provenance->>'authMethod','') NOT LIKE 'migrated-%' GROUP BY e.source_observation_ids,e.source_review_ids,e.source_attempt_ids;
    END IF;
    SELECT EXISTS (SELECT 1 FROM foundry_operational.workflow_runs w WHERE w.thread_id=NEW.workflow_thread_id AND w.institution_id=component_institution AND w.workflow_kind='COMPONENT_LIFECYCLE' AND w.status='RESUMING' AND w.interrupt_type='EXPERT_PUBLICATION_REVIEW_REQUIRED' AND w.interrupt_version>=1 AND w.product_links->>'componentId'=version_component::text AND w.product_links->>'componentVersionId'=NEW.component_version_id::text AND w.product_links->>'evaluationId'=NEW.evaluation_id::text) INTO workflow_matches;
    IF evaluation_status IS NULL OR evaluation_hash<>version_hash OR NOT COALESCE(evaluation_lineage_current,false) OR NOT workflow_matches THEN RAISE EXCEPTION 'Publication decision evaluation or workflow lineage is stale' USING ERRCODE='23514'; END IF;
    IF NEW.human_rubric->>'domainCorrectness' NOT IN ('PASS','FAIL') OR NEW.human_rubric->>'pedagogy' NOT IN ('PASS','FAIL') OR NEW.human_rubric->>'safety' NOT IN ('PASS','FAIL') OR NEW.human_rubric->>'reuseReadiness' NOT IN ('PASS','FAIL') OR length(btrim(COALESCE(NEW.human_rubric->>'notes','')))<5 THEN RAISE EXCEPTION 'Publication decision requires a complete expert rubric' USING ERRCODE='23514'; END IF;
    IF NEW.action='APPROVE' AND (evaluation_status<>'PASSED' OR NEW.human_rubric->>'domainCorrectness'<>'PASS' OR NEW.human_rubric->>'pedagogy'<>'PASS' OR NEW.human_rubric->>'safety'<>'PASS' OR NEW.human_rubric->>'reuseReadiness'<>'PASS') THEN RAISE EXCEPTION 'Approval requires passed system gates and expert rubric' USING ERRCODE='23514'; END IF;
  ELSIF NEW.action='ROLLBACK' THEN
    IF governance_command<>'component_rollback' OR version_status<>'PUBLISHED' OR NEW.previous_active_version_id IS NULL OR component_active<>NEW.previous_active_version_id OR NEW.evaluation_id IS NOT NULL OR NEW.workflow_thread_id IS NOT NULL THEN RAISE EXCEPTION 'Rollback requires the current active version and an already-published target' USING ERRCODE='23514'; END IF;
  END IF; RETURN NEW;
END $$ LANGUAGE plpgsql;
