CREATE TABLE "foundry_product"."auth_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "issuer" text NOT NULL,
  "subject" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id") ON DELETE CASCADE,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_issuer_subject_uq" ON "foundry_product"."auth_identities" ("issuer", "subject");
--> statement-breakpoint
CREATE TABLE "foundry_product"."auth_sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "identity_id" uuid NOT NULL REFERENCES "foundry_product"."auth_identities"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id") ON DELETE CASCADE,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "version" integer DEFAULT 1 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_session_version_ck" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "foundry_product"."auth_sessions" ("user_id", "expires_at");
--> statement-breakpoint
CREATE TABLE "foundry_operational"."security_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid REFERENCES "foundry_product"."institutions"("id"),
  "actor_user_id" uuid REFERENCES "foundry_product"."users"("id"),
  "session_id" uuid REFERENCES "foundry_product"."auth_sessions"("id"),
  "event_class" text NOT NULL,
  "event_code" text NOT NULL,
  "principal" text,
  "purpose" text,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "security_event_class_ck" CHECK ("event_class" IN ('AUTHENTICATION','AUTHORIZATION','SERVICE'))
);
--> statement-breakpoint
CREATE INDEX "security_events_scope_idx" ON "foundry_operational"."security_events" ("institution_id", "created_at");
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foundry_migrator') THEN CREATE ROLE foundry_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foundry_product_runtime') THEN CREATE ROLE foundry_product_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foundry_auth_bootstrap') THEN CREATE ROLE foundry_auth_bootstrap NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foundry_checkpoint_runtime') THEN CREATE ROLE foundry_checkpoint_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foundry_worker') THEN CREATE ROLE foundry_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
END $$;
--> statement-breakpoint

REVOKE ALL ON SCHEMA "foundry_product", "foundry_operational" FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA "foundry_product", "foundry_operational" FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "foundry_product", "foundry_operational" FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "foundry_product", "foundry_operational" REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "foundry_product", "foundry_operational" REVOKE ALL ON SEQUENCES FROM PUBLIC;

GRANT USAGE ON SCHEMA "foundry_product", "foundry_operational" TO foundry_product_runtime, foundry_auth_bootstrap, foundry_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA "foundry_product", "foundry_operational" TO foundry_product_runtime;
REVOKE ALL ON "foundry_product"."auth_identities", "foundry_product"."auth_sessions" FROM foundry_product_runtime;
REVOKE SELECT ON "foundry_product"."users" FROM foundry_product_runtime;
GRANT SELECT ("id", "email", "name", "active", "created_at") ON "foundry_product"."users" TO foundry_product_runtime;

-- Worker reads are explicit and limited to the current workflow, Retrieval and
-- model-run contracts plus the tenant references their RLS policies consume.
GRANT SELECT ON
  "foundry_product"."institutions", "foundry_product"."institution_memberships", "foundry_product"."courses",
  "foundry_product"."learning_tasks", "foundry_product"."learning_episodes", "foundry_product"."source_records",
  "foundry_product"."file_assets", "foundry_product"."evidence_units",
  "foundry_operational"."workflow_runs", "foundry_operational"."retrieval_runs",
  "foundry_operational"."model_runs", "foundry_operational"."security_events"
TO foundry_worker;

GRANT INSERT, UPDATE ON
  "foundry_product"."learning_tasks", "foundry_product"."learning_episodes", "foundry_product"."conversation_events",
  "foundry_product"."source_records", "foundry_product"."file_assets", "foundry_product"."evidence_units",
  "foundry_product"."context_compilations", "foundry_product"."learner_attempts", "foundry_product"."diagnostic_observations",
  "foundry_product"."teacher_reviews", "foundry_product"."retry_attempts", "foundry_product"."transfer_activities",
  "foundry_product"."retention_reviews", "foundry_product"."learning_outcomes", "foundry_product"."components",
  "foundry_product"."component_versions", "foundry_product"."component_evaluations", "foundry_product"."publication_decisions",
  "foundry_product"."component_deliveries", "foundry_product"."library_items", "foundry_product"."schedule_items",
  "foundry_product"."governance_events", "foundry_product"."idempotency_keys",
  "foundry_operational"."workflow_runs", "foundry_operational"."retrieval_runs", "foundry_operational"."model_runs", "foundry_operational"."eval_runs"
TO foundry_product_runtime;
GRANT DELETE ON "foundry_product"."idempotency_keys" TO foundry_product_runtime;

GRANT SELECT ON "foundry_product"."users", "foundry_product"."institutions", "foundry_product"."institution_memberships", "foundry_product"."course_enrollments", "foundry_product"."courses", "foundry_product"."auth_identities", "foundry_product"."auth_sessions" TO foundry_auth_bootstrap;
GRANT INSERT ON "foundry_product"."auth_sessions", "foundry_operational"."security_events" TO foundry_auth_bootstrap;
GRANT UPDATE ("version", "last_verified_at", "revoked_at") ON "foundry_product"."auth_sessions" TO foundry_auth_bootstrap;

GRANT INSERT, UPDATE ON "foundry_operational"."workflow_runs", "foundry_operational"."retrieval_runs", "foundry_operational"."model_runs" TO foundry_worker;
GRANT INSERT ON "foundry_operational"."security_events" TO foundry_worker;

CREATE SCHEMA IF NOT EXISTS "foundry_private";
REVOKE ALL ON SCHEMA "foundry_private" FROM PUBLIC;
GRANT USAGE ON SCHEMA "foundry_private" TO foundry_product_runtime, foundry_worker;

CREATE OR REPLACE FUNCTION "foundry_private"."current_institution_id"() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('foundry.institution_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION "foundry_private"."current_user_id"() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('foundry.user_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION "foundry_private"."current_institution_id"(), "foundry_private"."current_user_id"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "foundry_private"."current_institution_id"(), "foundry_private"."current_user_id"() TO foundry_product_runtime, foundry_worker;

CREATE TABLE "foundry_private"."table_authority_catalog" (
  "schema_name" text NOT NULL,
  "table_name" text NOT NULL,
  "classification" text NOT NULL,
  "policy_required" boolean NOT NULL,
  PRIMARY KEY ("schema_name", "table_name")
);
REVOKE ALL ON "foundry_private"."table_authority_catalog" FROM PUBLIC;
GRANT SELECT ON "foundry_private"."table_authority_catalog" TO foundry_product_runtime, foundry_worker, foundry_auth_bootstrap;
INSERT INTO "foundry_private"."table_authority_catalog" ("schema_name", "table_name", "classification", "policy_required") VALUES
('foundry_product','__drizzle_migrations','GLOBAL_MIGRATION_METADATA',false),
('foundry_product','capabilities','GLOBAL_REFERENCE_READ_ONLY',true),
('foundry_product','capability_versions','GLOBAL_REFERENCE_READ_ONLY',true),
('foundry_product','component_versions','TENANT_INDIRECT',true),
('foundry_product','components','TENANT_DIRECT',true),
('foundry_product','context_compilations','TENANT_INDIRECT',true),
('foundry_product','conversation_events','TENANT_INDIRECT',true),
('foundry_product','course_enrollments','TENANT_DIRECT',true),
('foundry_product','courses','TENANT_DIRECT',true),
('foundry_product','diagnostic_observations','TENANT_INDIRECT',true),
('foundry_operational','eval_runs','TENANT_OR_GLOBAL_OPERATIONAL',true),
('foundry_product','evidence_units','TENANT_OR_GLOBAL_REFERENCE',true),
('foundry_product','file_assets','TENANT_DIRECT',true),
('foundry_product','governance_events','TENANT_DIRECT',true),
('foundry_product','idempotency_keys','TENANT_DIRECT',true),
('foundry_product','institution_memberships','TENANT_DIRECT',true),
('foundry_product','institutions','TENANT_DIRECT',true),
('foundry_product','learner_attempts','TENANT_INDIRECT',true),
('foundry_product','learning_episodes','TENANT_INDIRECT',true),
('foundry_product','learning_outcomes','TENANT_INDIRECT',true),
('foundry_product','learning_tasks','TENANT_DIRECT',true),
('foundry_product','library_items','TENANT_INDIRECT',true),
('foundry_operational','model_runs','TENANT_DIRECT',true),
('foundry_product','publication_decisions','TENANT_INDIRECT',true),
('foundry_product','retention_reviews','TENANT_INDIRECT',true),
('foundry_operational','retrieval_runs','TENANT_DIRECT',true),
('foundry_product','retry_attempts','TENANT_INDIRECT',true),
('foundry_product','schedule_items','TENANT_INDIRECT',true),
('foundry_product','source_records','TENANT_OR_GLOBAL_REFERENCE',true),
('foundry_product','subjects','TENANT_DIRECT',true),
('foundry_product','teacher_reviews','TENANT_INDIRECT',true),
('foundry_product','transfer_activities','TENANT_INDIRECT',true),
('foundry_product','users','TENANT_INDIRECT',true),
('foundry_operational','workflow_runs','TENANT_DIRECT',true),
('foundry_product','component_deliveries','TENANT_DIRECT',true),
('foundry_product','component_evaluations','TENANT_DIRECT',true),
('foundry_product','auth_identities','AUTH_BOOTSTRAP_ONLY',true),
('foundry_product','auth_sessions','TENANT_AUTH_SESSION',true),
('foundry_operational','security_events','TENANT_OR_PRETENANT_AUDIT',true);

ALTER TABLE "foundry_product"."capabilities" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."capabilities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "global_reference_read" ON "foundry_product"."capabilities" FOR SELECT TO foundry_product_runtime, foundry_worker USING (true);
ALTER TABLE "foundry_product"."capability_versions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."capability_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "global_reference_read" ON "foundry_product"."capability_versions" FOR SELECT TO foundry_product_runtime, foundry_worker USING (true);

ALTER TABLE "foundry_product"."institutions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."institutions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."institutions" FOR SELECT TO foundry_product_runtime, foundry_worker USING ("id" = "foundry_private"."current_institution_id"());
CREATE POLICY "auth_read" ON "foundry_product"."institutions" FOR SELECT TO foundry_auth_bootstrap USING (true);

ALTER TABLE "foundry_product"."institution_memberships" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."institution_memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."institution_memberships" TO foundry_product_runtime, foundry_worker USING ("institution_id" = "foundry_private"."current_institution_id"()) WITH CHECK ("institution_id" = "foundry_private"."current_institution_id"());
CREATE POLICY "auth_read" ON "foundry_product"."institution_memberships" FOR SELECT TO foundry_auth_bootstrap USING (true);

ALTER TABLE "foundry_product"."users" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."users" FOR SELECT TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."institution_memberships" m WHERE m."user_id" = "users"."id" AND m."institution_id" = "foundry_private"."current_institution_id"()));
CREATE POLICY "auth_read" ON "foundry_product"."users" FOR SELECT TO foundry_auth_bootstrap USING (true);

ALTER TABLE "foundry_product"."subjects" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."subjects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."subjects" TO foundry_product_runtime, foundry_worker USING ("institution_id" = "foundry_private"."current_institution_id"()) WITH CHECK ("institution_id" = "foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."courses" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."courses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."courses" TO foundry_product_runtime, foundry_worker USING ("institution_id" = "foundry_private"."current_institution_id"()) WITH CHECK ("institution_id" = "foundry_private"."current_institution_id"());
CREATE POLICY "auth_read" ON "foundry_product"."courses" FOR SELECT TO foundry_auth_bootstrap USING (true);
ALTER TABLE "foundry_product"."course_enrollments" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."course_enrollments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."course_enrollments" TO foundry_product_runtime, foundry_worker USING ("institution_id" = "foundry_private"."current_institution_id"()) WITH CHECK ("institution_id" = "foundry_private"."current_institution_id"());
CREATE POLICY "auth_read" ON "foundry_product"."course_enrollments" FOR SELECT TO foundry_auth_bootstrap USING (true);

ALTER TABLE "foundry_product"."learning_tasks" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."learning_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."learning_tasks" TO foundry_product_runtime, foundry_worker
  USING (
    "institution_id" = "foundry_private"."current_institution_id"()
    AND EXISTS (SELECT 1 FROM "foundry_product"."courses" c WHERE c."id"="learning_tasks"."course_id" AND c."institution_id"="foundry_private"."current_institution_id"())
    AND EXISTS (SELECT 1 FROM "foundry_product"."institution_memberships" m WHERE m."user_id"="learning_tasks"."learner_id" AND m."institution_id"="foundry_private"."current_institution_id"())
  )
  WITH CHECK (
    "institution_id" = "foundry_private"."current_institution_id"()
    AND EXISTS (SELECT 1 FROM "foundry_product"."courses" c WHERE c."id"="learning_tasks"."course_id" AND c."institution_id"="foundry_private"."current_institution_id"())
    AND EXISTS (SELECT 1 FROM "foundry_product"."institution_memberships" m WHERE m."user_id"="learning_tasks"."learner_id" AND m."institution_id"="foundry_private"."current_institution_id"())
  );
ALTER TABLE "foundry_product"."learning_episodes" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."learning_episodes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."learning_episodes" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id" = "learning_episodes"."task_id" AND t."institution_id" = "foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id" = "learning_episodes"."task_id" AND t."institution_id" = "foundry_private"."current_institution_id"()));
ALTER TABLE "foundry_product"."conversation_events" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."conversation_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."conversation_events" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id" = "conversation_events"."task_id" AND t."institution_id" = "foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id" = "conversation_events"."task_id" AND t."institution_id" = "foundry_private"."current_institution_id"()));

ALTER TABLE "foundry_product"."source_records" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."source_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_or_global_read" ON "foundry_product"."source_records" FOR SELECT TO foundry_product_runtime, foundry_worker USING ("institution_id" IS NULL OR "institution_id" = "foundry_private"."current_institution_id"());
CREATE POLICY "tenant_write" ON "foundry_product"."source_records" FOR ALL TO foundry_product_runtime, foundry_worker USING ("institution_id" = "foundry_private"."current_institution_id"()) WITH CHECK ("institution_id" = "foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."file_assets" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."file_assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."file_assets" TO foundry_product_runtime, foundry_worker USING ("institution_id" = "foundry_private"."current_institution_id"()) WITH CHECK ("institution_id" = "foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."evidence_units" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."evidence_units" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_or_global_read" ON "foundry_product"."evidence_units" FOR SELECT TO foundry_product_runtime, foundry_worker USING ("institution_id" = "foundry_private"."current_institution_id"() OR ("institution_id" IS NULL AND EXISTS (SELECT 1 FROM "foundry_product"."source_records" s WHERE s."id" = "evidence_units"."source_id" AND s."institution_id" IS NULL)));
CREATE POLICY "tenant_write" ON "foundry_product"."evidence_units" FOR ALL TO foundry_product_runtime, foundry_worker USING ("institution_id" = "foundry_private"."current_institution_id"()) WITH CHECK ("institution_id" = "foundry_private"."current_institution_id"());

ALTER TABLE "foundry_product"."context_compilations" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."context_compilations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."context_compilations" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id" = "context_compilations"."task_id" AND t."institution_id" = "foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id" = "context_compilations"."task_id" AND t."institution_id" = "foundry_private"."current_institution_id"()));
ALTER TABLE "foundry_product"."learner_attempts" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."learner_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."learner_attempts" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id" = "learner_attempts"."task_id" AND t."institution_id" = "foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id" = "learner_attempts"."task_id" AND t."institution_id" = "foundry_private"."current_institution_id"()));
ALTER TABLE "foundry_product"."diagnostic_observations" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."diagnostic_observations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."diagnostic_observations" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."learner_attempts" a JOIN "foundry_product"."learning_tasks" t ON t."id" = a."task_id" WHERE a."id" = "diagnostic_observations"."attempt_id" AND t."institution_id" = "foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."learner_attempts" a JOIN "foundry_product"."learning_tasks" t ON t."id" = a."task_id" WHERE a."id" = "diagnostic_observations"."attempt_id" AND t."institution_id" = "foundry_private"."current_institution_id"()));
ALTER TABLE "foundry_product"."teacher_reviews" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."teacher_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."teacher_reviews" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."diagnostic_observations" o JOIN "foundry_product"."learner_attempts" a ON a."id"=o."attempt_id" JOIN "foundry_product"."learning_tasks" t ON t."id"=a."task_id" WHERE o."id"="teacher_reviews"."observation_id" AND t."institution_id"="foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."diagnostic_observations" o JOIN "foundry_product"."learner_attempts" a ON a."id"=o."attempt_id" JOIN "foundry_product"."learning_tasks" t ON t."id"=a."task_id" WHERE o."id"="teacher_reviews"."observation_id" AND t."institution_id"="foundry_private"."current_institution_id"()));

ALTER TABLE "foundry_product"."retry_attempts" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."retry_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."retry_attempts" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."learner_attempts" a JOIN "foundry_product"."learning_tasks" t ON t."id"=a."task_id" WHERE a."id"="retry_attempts"."original_attempt_id" AND t."institution_id"="foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."learner_attempts" a JOIN "foundry_product"."learning_tasks" t ON t."id"=a."task_id" WHERE a."id"="retry_attempts"."original_attempt_id" AND t."institution_id"="foundry_private"."current_institution_id"()));
ALTER TABLE "foundry_product"."transfer_activities" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."transfer_activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."transfer_activities" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."retry_attempts" r WHERE r."id"="transfer_activities"."retry_id")) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."retry_attempts" r WHERE r."id"="transfer_activities"."retry_id"));
ALTER TABLE "foundry_product"."retention_reviews" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."retention_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."retention_reviews" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."retry_attempts" r WHERE r."id"="retention_reviews"."retry_id")) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."retry_attempts" r WHERE r."id"="retention_reviews"."retry_id"));
ALTER TABLE "foundry_product"."learning_outcomes" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."learning_outcomes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."learning_outcomes" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="learning_outcomes"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="learning_outcomes"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"()));

ALTER TABLE "foundry_product"."components" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."components" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."components" TO foundry_product_runtime, foundry_worker USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."component_versions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."component_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."component_versions" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."components" c WHERE c."id"="component_versions"."component_id" AND c."institution_id"="foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."components" c WHERE c."id"="component_versions"."component_id" AND c."institution_id"="foundry_private"."current_institution_id"()));
ALTER TABLE "foundry_product"."component_evaluations" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."component_evaluations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."component_evaluations" TO foundry_product_runtime, foundry_worker USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."publication_decisions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."publication_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."publication_decisions" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."component_versions" v JOIN "foundry_product"."components" c ON c."id"=v."component_id" WHERE v."id"="publication_decisions"."component_version_id" AND c."institution_id"="foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."component_versions" v JOIN "foundry_product"."components" c ON c."id"=v."component_id" WHERE v."id"="publication_decisions"."component_version_id" AND c."institution_id"="foundry_private"."current_institution_id"()));
ALTER TABLE "foundry_product"."component_deliveries" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."component_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."component_deliveries" TO foundry_product_runtime, foundry_worker USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());

ALTER TABLE "foundry_product"."library_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."library_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."library_items" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."courses" c WHERE c."id"="library_items"."course_id" AND c."institution_id"="foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."courses" c WHERE c."id"="library_items"."course_id" AND c."institution_id"="foundry_private"."current_institution_id"()));
ALTER TABLE "foundry_product"."schedule_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."schedule_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."schedule_items" TO foundry_product_runtime, foundry_worker USING (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="schedule_items"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"())) WITH CHECK (EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="schedule_items"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"()));

ALTER TABLE "foundry_operational"."workflow_runs" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_operational"."workflow_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_operational"."workflow_runs" TO foundry_product_runtime, foundry_worker
  USING (
    "institution_id"="foundry_private"."current_institution_id"()
    AND "thread_id" LIKE "foundry_private"."current_institution_id"()::text || ':%'
    AND ("task_id" IS NULL OR EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="workflow_runs"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"()))
    AND ("episode_id" IS NULL OR EXISTS (SELECT 1 FROM "foundry_product"."learning_episodes" e JOIN "foundry_product"."learning_tasks" t ON t."id"=e."task_id" WHERE e."id"="workflow_runs"."episode_id" AND t."institution_id"="foundry_private"."current_institution_id"()))
    AND EXISTS (SELECT 1 FROM "foundry_product"."institution_memberships" m WHERE m."user_id"="workflow_runs"."actor_user_id" AND m."institution_id"="foundry_private"."current_institution_id"())
  )
  WITH CHECK (
    "institution_id"="foundry_private"."current_institution_id"()
    AND "thread_id" LIKE "foundry_private"."current_institution_id"()::text || ':%'
    AND ("task_id" IS NULL OR EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="workflow_runs"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"()))
    AND ("episode_id" IS NULL OR EXISTS (SELECT 1 FROM "foundry_product"."learning_episodes" e JOIN "foundry_product"."learning_tasks" t ON t."id"=e."task_id" WHERE e."id"="workflow_runs"."episode_id" AND t."institution_id"="foundry_private"."current_institution_id"()))
    AND EXISTS (SELECT 1 FROM "foundry_product"."institution_memberships" m WHERE m."user_id"="workflow_runs"."actor_user_id" AND m."institution_id"="foundry_private"."current_institution_id"())
  );
ALTER TABLE "foundry_operational"."retrieval_runs" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_operational"."retrieval_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_operational"."retrieval_runs" TO foundry_product_runtime, foundry_worker
  USING ("institution_id"="foundry_private"."current_institution_id"() AND EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="retrieval_runs"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"()))
  WITH CHECK ("institution_id"="foundry_private"."current_institution_id"() AND EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="retrieval_runs"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"()));
ALTER TABLE "foundry_operational"."model_runs" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_operational"."model_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_operational"."model_runs" TO foundry_product_runtime, foundry_worker
  USING (
    "institution_id"="foundry_private"."current_institution_id"()
    AND ("task_id" IS NULL OR EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="model_runs"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"()))
    AND ("file_asset_id" IS NULL OR EXISTS (SELECT 1 FROM "foundry_product"."file_assets" f WHERE f."id"="model_runs"."file_asset_id" AND f."institution_id"="foundry_private"."current_institution_id"()))
  )
  WITH CHECK (
    "institution_id"="foundry_private"."current_institution_id"()
    AND ("task_id" IS NULL OR EXISTS (SELECT 1 FROM "foundry_product"."learning_tasks" t WHERE t."id"="model_runs"."task_id" AND t."institution_id"="foundry_private"."current_institution_id"()))
    AND ("file_asset_id" IS NULL OR EXISTS (SELECT 1 FROM "foundry_product"."file_assets" f WHERE f."id"="model_runs"."file_asset_id" AND f."institution_id"="foundry_private"."current_institution_id"()))
  );
ALTER TABLE "foundry_operational"."eval_runs" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_operational"."eval_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_or_global_read" ON "foundry_operational"."eval_runs" FOR SELECT TO foundry_product_runtime, foundry_worker USING ("institution_id" IS NULL OR "institution_id"="foundry_private"."current_institution_id"());
CREATE POLICY "tenant_write" ON "foundry_operational"."eval_runs" FOR ALL TO foundry_product_runtime, foundry_worker USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());

ALTER TABLE "foundry_product"."governance_events" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."governance_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."governance_events" TO foundry_product_runtime, foundry_worker USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."idempotency_keys" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."idempotency_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."idempotency_keys" TO foundry_product_runtime, foundry_worker USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());

ALTER TABLE "foundry_product"."auth_identities" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."auth_identities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "auth_boundary_read" ON "foundry_product"."auth_identities" FOR SELECT TO foundry_auth_bootstrap USING (true);
ALTER TABLE "foundry_product"."auth_sessions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."auth_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "auth_boundary" ON "foundry_product"."auth_sessions" TO foundry_auth_bootstrap USING (true) WITH CHECK (true);
ALTER TABLE "foundry_operational"."security_events" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_operational"."security_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_read" ON "foundry_operational"."security_events" FOR SELECT TO foundry_product_runtime, foundry_worker USING ("institution_id"="foundry_private"."current_institution_id"());
CREATE POLICY "worker_tenant_write" ON "foundry_operational"."security_events" FOR INSERT TO foundry_worker WITH CHECK ("institution_id"="foundry_private"."current_institution_id"() AND "event_class"='SERVICE');
CREATE POLICY "auth_audit_write" ON "foundry_operational"."security_events" FOR INSERT TO foundry_auth_bootstrap
  WITH CHECK ("event_class" IN ('AUTHENTICATION', 'AUTHORIZATION'));

-- Executable inventory and secondary-lineage enforcement for every table that
-- a product or worker runtime role can mutate. Existing domain/governance
-- triggers remain authoritative and execute in addition to this tenant guard.
CREATE TABLE "foundry_private"."writable_lineage_catalog" (
  "schema_name" text NOT NULL,
  "table_name" text NOT NULL,
  "writable_roles" text[] NOT NULL,
  "tenant_references" text NOT NULL,
  "enforcement" text NOT NULL DEFAULT 'FORCED_RLS + _authority_tenant_lineage_guard',
  PRIMARY KEY ("schema_name", "table_name")
);
REVOKE ALL ON "foundry_private"."writable_lineage_catalog" FROM PUBLIC;

INSERT INTO "foundry_private"."writable_lineage_catalog" ("schema_name", "table_name", "writable_roles", "tenant_references") VALUES
('foundry_product','learning_tasks',ARRAY['foundry_product_runtime'],'institution; course; learner membership'),
('foundry_product','learning_episodes',ARRAY['foundry_product_runtime'],'task'),
('foundry_product','conversation_events',ARRAY['foundry_product_runtime'],'task; episode/task; actor membership; superseded Event; sourceRefs; evidenceRefs'),
('foundry_product','source_records',ARRAY['foundry_product_runtime'],'institution; optional course; global sources remain read-only'),
('foundry_product','file_assets',ARRAY['foundry_product_runtime'],'institution; course; optional task/course; owner membership; optional source scope'),
('foundry_product','evidence_units',ARRAY['foundry_product_runtime'],'institution; source tenant-or-global; global Evidence remains read-only'),
('foundry_product','context_compilations',ARRAY['foundry_product_runtime'],'task; episode/task; selected/excluded Event or Attempt items'),
('foundry_product','learner_attempts',ARRAY['foundry_product_runtime'],'task; episode/task; learner/task; optional file; sourceRefs; global Capability'),
('foundry_product','diagnostic_observations',ARRAY['foundry_product_runtime'],'Attempt; optional superseding Observation; global CapabilityVersion'),
('foundry_product','teacher_reviews',ARRAY['foundry_product_runtime'],'Observation; teacher membership; actor provenance'),
('foundry_product','retry_attempts',ARRAY['foundry_product_runtime'],'original Attempt; reviewed Observation; assignment Review; optional result Attempt/Observation/Review'),
('foundry_product','transfer_activities',ARRAY['foundry_product_runtime'],'Retry; tenant-or-global Evidence'),
('foundry_product','retention_reviews',ARRAY['foundry_product_runtime'],'Retry; optional tenant-or-global Evidence'),
('foundry_product','learning_outcomes',ARRAY['foundry_product_runtime'],'Task; Retry; result Review; teacher membership; actor provenance; evidenceRefs'),
('foundry_product','components',ARRAY['foundry_product_runtime'],'institution; course; creator membership; global Capability; source signal; active Version'),
('foundry_product','component_versions',ARRAY['foundry_product_runtime'],'Component; creator membership; optional predecessor Version; source Observation/Review arrays'),
('foundry_product','component_evaluations',ARRAY['foundry_product_runtime'],'institution; course; ComponentVersion; creator membership; source Observation/Review/Attempt arrays'),
('foundry_product','publication_decisions',ARRAY['foundry_product_runtime'],'ComponentVersion; Evaluation; Expert membership/provenance; previous Version; Workflow thread'),
('foundry_product','component_deliveries',ARRAY['foundry_product_runtime'],'institution; course; Task; Episode; Component; Version; Observation; Review; deliverer membership'),
('foundry_product','library_items',ARRAY['foundry_product_runtime'],'learner membership; course; tenant-or-global Evidence'),
('foundry_product','schedule_items',ARRAY['foundry_product_runtime'],'learner membership/Task learner; Task'),
('foundry_product','governance_events',ARRAY['foundry_product_runtime'],'institution; actor membership; typed governed entity; optional previous Event'),
('foundry_product','idempotency_keys',ARRAY['foundry_product_runtime'],'institution; command-typed result authority'),
('foundry_product','auth_sessions',ARRAY['foundry_auth_bootstrap'],'active Identity/User; active institution membership'),
('foundry_operational','workflow_runs',ARRAY['foundry_product_runtime','foundry_worker'],'institution; thread prefix; Task; Episode/Task; actor membership; productLinks'),
('foundry_operational','retrieval_runs',ARRAY['foundry_product_runtime','foundry_worker'],'institution; Task; selected/ranked Evidence'),
('foundry_operational','model_runs',ARRAY['foundry_product_runtime','foundry_worker'],'institution; optional Task; optional File/Task; Evidence IDs'),
('foundry_operational','eval_runs',ARRAY['foundry_product_runtime'],'institution; global Eval remains read-only'),
('foundry_operational','security_events',ARRAY['foundry_auth_bootstrap','foundry_worker'],'auth tenant/actor/Session consistency or configured service principal/purpose');

CREATE OR REPLACE FUNCTION "foundry_private"."entity_in_tenant"("entity_kind" text, "entity_id" uuid, "tenant_id" uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF entity_id IS NULL THEN RETURN false; END IF;
  CASE entity_kind
    WHEN 'USER' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.institution_memberships m WHERE m.user_id=entity_id AND m.institution_id=tenant_id);
    WHEN 'COURSE' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.courses c WHERE c.id=entity_id AND c.institution_id=tenant_id);
    WHEN 'TASK' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.learning_tasks t WHERE t.id=entity_id AND t.institution_id=tenant_id);
    WHEN 'EPISODE' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.learning_episodes e JOIN foundry_product.learning_tasks t ON t.id=e.task_id WHERE e.id=entity_id AND t.institution_id=tenant_id);
    WHEN 'EVENT' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.conversation_events e JOIN foundry_product.learning_tasks t ON t.id=e.task_id WHERE e.id=entity_id AND t.institution_id=tenant_id);
    WHEN 'SOURCE' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.source_records s WHERE s.id=entity_id AND (s.institution_id IS NULL OR s.institution_id=tenant_id));
    WHEN 'FILE' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.file_assets f WHERE f.id=entity_id AND f.institution_id=tenant_id);
    WHEN 'EVIDENCE' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.evidence_units e JOIN foundry_product.source_records s ON s.id=e.source_id WHERE e.id=entity_id AND ((e.institution_id=tenant_id) OR (e.institution_id IS NULL AND s.institution_id IS NULL)));
    WHEN 'ATTEMPT' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.learner_attempts a JOIN foundry_product.learning_tasks t ON t.id=a.task_id WHERE a.id=entity_id AND t.institution_id=tenant_id);
    WHEN 'OBSERVATION' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.diagnostic_observations o JOIN foundry_product.learner_attempts a ON a.id=o.attempt_id JOIN foundry_product.learning_tasks t ON t.id=a.task_id WHERE o.id=entity_id AND t.institution_id=tenant_id);
    WHEN 'REVIEW' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.teacher_reviews r JOIN foundry_product.diagnostic_observations o ON o.id=r.observation_id JOIN foundry_product.learner_attempts a ON a.id=o.attempt_id JOIN foundry_product.learning_tasks t ON t.id=a.task_id WHERE r.id=entity_id AND t.institution_id=tenant_id);
    WHEN 'RETRY' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.retry_attempts r JOIN foundry_product.learner_attempts a ON a.id=r.original_attempt_id JOIN foundry_product.learning_tasks t ON t.id=a.task_id WHERE r.id=entity_id AND t.institution_id=tenant_id);
    WHEN 'OUTCOME' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.learning_outcomes o JOIN foundry_product.learning_tasks t ON t.id=o.task_id WHERE o.id=entity_id AND t.institution_id=tenant_id);
    WHEN 'COMPONENT' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.components c WHERE c.id=entity_id AND c.institution_id=tenant_id);
    WHEN 'VERSION' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.component_versions v JOIN foundry_product.components c ON c.id=v.component_id WHERE v.id=entity_id AND c.institution_id=tenant_id);
    WHEN 'EVALUATION' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.component_evaluations e WHERE e.id=entity_id AND e.institution_id=tenant_id);
    WHEN 'DECISION' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.publication_decisions d JOIN foundry_product.component_versions v ON v.id=d.component_version_id JOIN foundry_product.components c ON c.id=v.component_id WHERE d.id=entity_id AND c.institution_id=tenant_id);
    WHEN 'DELIVERY' THEN RETURN EXISTS (SELECT 1 FROM foundry_product.component_deliveries d WHERE d.id=entity_id AND d.institution_id=tenant_id);
    WHEN 'WORKFLOW' THEN RETURN EXISTS (SELECT 1 FROM foundry_operational.workflow_runs w WHERE w.id=entity_id AND w.institution_id=tenant_id);
    ELSE RETURN false;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION "foundry_private"."references_in_tenant"("references_json" jsonb, "tenant_id" uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE reference_item jsonb;
BEGIN
  IF references_json IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(references_json) <> 'array' THEN RETURN false; END IF;
  FOR reference_item IN SELECT value FROM jsonb_array_elements(references_json) LOOP
    IF (reference_item ? 'sourceId') AND NOT foundry_private.entity_in_tenant('SOURCE', NULLIF(reference_item->>'sourceId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'evidenceUnitId') AND NOT foundry_private.entity_in_tenant('EVIDENCE', NULLIF(reference_item->>'evidenceUnitId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'taskId') AND NOT foundry_private.entity_in_tenant('TASK', NULLIF(reference_item->>'taskId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'episodeId') AND NOT foundry_private.entity_in_tenant('EPISODE', NULLIF(reference_item->>'episodeId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'fileAssetId') AND NOT foundry_private.entity_in_tenant('FILE', NULLIF(reference_item->>'fileAssetId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'learnerAttemptId') AND NOT foundry_private.entity_in_tenant('ATTEMPT', NULLIF(reference_item->>'learnerAttemptId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'attemptId') AND NOT foundry_private.entity_in_tenant('ATTEMPT', NULLIF(reference_item->>'attemptId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'diagnosticObservationId') AND NOT foundry_private.entity_in_tenant('OBSERVATION', NULLIF(reference_item->>'diagnosticObservationId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'observationId') AND NOT foundry_private.entity_in_tenant('OBSERVATION', NULLIF(reference_item->>'observationId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'teacherReviewId') AND NOT foundry_private.entity_in_tenant('REVIEW', NULLIF(reference_item->>'teacherReviewId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'reviewId') AND NOT foundry_private.entity_in_tenant('REVIEW', NULLIF(reference_item->>'reviewId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'retryId') AND NOT foundry_private.entity_in_tenant('RETRY', NULLIF(reference_item->>'retryId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'outcomeId') AND NOT foundry_private.entity_in_tenant('OUTCOME', NULLIF(reference_item->>'outcomeId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'componentId') AND NOT foundry_private.entity_in_tenant('COMPONENT', NULLIF(reference_item->>'componentId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'componentVersionId') AND NOT foundry_private.entity_in_tenant('VERSION', NULLIF(reference_item->>'componentVersionId','')::uuid, tenant_id) THEN RETURN false; END IF;
    IF (reference_item ? 'evaluationId') AND NOT foundry_private.entity_in_tenant('EVALUATION', NULLIF(reference_item->>'evaluationId','')::uuid, tenant_id) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION "foundry_private"."uuid_array_in_tenant"("references_json" jsonb, "entity_kind" text, "tenant_id" uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE reference_id text;
BEGIN
  IF references_json IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(references_json) <> 'array' THEN RETURN false; END IF;
  FOR reference_id IN SELECT value #>> '{}' FROM jsonb_array_elements(references_json) LOOP
    IF NOT foundry_private.entity_in_tenant(entity_kind, NULLIF(reference_id,'')::uuid, tenant_id) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION "foundry_private"."context_items_in_tenant"("items" jsonb, "tenant_id" uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE item jsonb; item_task uuid; item_episode uuid; item_id uuid;
BEGIN
  IF items IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(items) <> 'array' THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    item_task := NULLIF(item->>'taskId','')::uuid;
    item_episode := NULLIF(item->>'episodeId','')::uuid;
    item_id := NULLIF(item->>'id','')::uuid;
    IF NOT foundry_private.entity_in_tenant('TASK', item_task, tenant_id)
       OR NOT EXISTS (SELECT 1 FROM foundry_product.learning_episodes e WHERE e.id=item_episode AND e.task_id=item_task) THEN RETURN false; END IF;
    IF item->>'kind' = 'EVENT' AND NOT EXISTS (SELECT 1 FROM foundry_product.conversation_events e WHERE e.id=item_id AND e.task_id=item_task AND e.episode_id=item_episode) THEN RETURN false; END IF;
    IF item->>'kind' = 'ATTEMPT' AND NOT EXISTS (SELECT 1 FROM foundry_product.learner_attempts a WHERE a.id=item_id AND a.task_id=item_task AND a.episode_id=item_episode) THEN RETURN false; END IF;
    IF item->>'kind' NOT IN ('EVENT','ATTEMPT') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION "foundry_private"."idempotency_result_in_tenant"("command_name" text, "result_id" uuid, "tenant_id" uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF result_id IS NULL THEN RETURN true; END IF;
  CASE command_name
    WHEN 'CREATE_TASK' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learning_tasks WHERE id=result_id) OR foundry_private.entity_in_tenant('TASK', result_id, tenant_id);
    WHEN 'APPEND_CONVERSATION_EVENT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.conversation_events WHERE id=result_id) OR foundry_private.entity_in_tenant('EVENT', result_id, tenant_id);
    WHEN 'CAPTURE_ATTEMPT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learner_attempts WHERE id=result_id) OR foundry_private.entity_in_tenant('ATTEMPT', result_id, tenant_id);
    WHEN 'UPLOAD_IMAGE_ATTEMPT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.file_assets WHERE id=result_id) OR foundry_private.entity_in_tenant('FILE', result_id, tenant_id);
    WHEN 'UPLOAD_LEARNING_MATERIAL' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.file_assets WHERE id=result_id) OR foundry_private.entity_in_tenant('FILE', result_id, tenant_id);
    WHEN 'REVIEW_SOURCE_RIGHTS' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.source_records WHERE id=result_id) OR foundry_private.entity_in_tenant('SOURCE', result_id, tenant_id);
    WHEN 'TEACHER_REVIEW' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.teacher_reviews WHERE id=result_id) OR foundry_private.entity_in_tenant('REVIEW', result_id, tenant_id);
    WHEN 'RETRY_RESULT_REVIEW' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.teacher_reviews WHERE id=result_id) OR foundry_private.entity_in_tenant('REVIEW', result_id, tenant_id);
    WHEN 'CREATE_RETRY' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.retry_attempts WHERE id=result_id) OR foundry_private.entity_in_tenant('RETRY', result_id, tenant_id);
    WHEN 'LEARNING_OUTCOME' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.learning_outcomes WHERE id=result_id) OR foundry_private.entity_in_tenant('OUTCOME', result_id, tenant_id);
    WHEN 'COMPONENT_CANDIDATE' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.components WHERE id=result_id) OR foundry_private.entity_in_tenant('COMPONENT', result_id, tenant_id);
    WHEN 'UPDATE_COMPONENT_VERSION' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_versions WHERE id=result_id) OR foundry_private.entity_in_tenant('VERSION', result_id, tenant_id);
    WHEN 'COMPONENT_PUBLICATION_DECISION' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.publication_decisions WHERE id=result_id) OR foundry_private.entity_in_tenant('DECISION', result_id, tenant_id);
    WHEN 'COMPONENT_ROLLBACK' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.publication_decisions WHERE id=result_id) OR foundry_private.entity_in_tenant('DECISION', result_id, tenant_id);
    WHEN 'DELIVER_COMPONENT_SUPPORT' THEN RETURN NOT EXISTS (SELECT 1 FROM foundry_product.component_deliveries WHERE id=result_id) OR foundry_private.entity_in_tenant('DELIVERY', result_id, tenant_id);
    ELSE RETURN false;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION
  "foundry_private"."entity_in_tenant"(text,uuid,uuid),
  "foundry_private"."references_in_tenant"(jsonb,uuid),
  "foundry_private"."uuid_array_in_tenant"(jsonb,text,uuid),
  "foundry_private"."context_items_in_tenant"(jsonb,uuid),
  "foundry_private"."idempotency_result_in_tenant"(text,uuid,uuid)
FROM PUBLIC;

CREATE OR REPLACE FUNCTION "foundry_private"."assert_rw02_tenant_lineage"()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  row_data jsonb := to_jsonb(NEW);
  tenant_id uuid;
  configured_role text := NULLIF(NULLIF(current_setting('role', true), ''), 'none');
  invoker_role text := session_user;
  runtime_role text;
  runtime_memberships text[];
  principal_is_superuser boolean := false;
  principal_owns_table boolean := false;
  table_key text := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
  guarded_task_id uuid;
  guarded_episode_id uuid;
  guarded_component_id uuid;
BEGIN
  -- SECURITY DEFINER changes current_user, so it is not a safe signal for the
  -- mutation caller. Prefer an exact SET ROLE. When role=none, resolve the
  -- authenticated/session principal from PostgreSQL's own role catalogs. A
  -- non-owner login must resolve to exactly one runtime group; ambiguity and
  -- missing authority fail closed. Owners and superusers remain the explicit
  -- migration boundary and are never inferred from a custom GUC.
  IF configured_role IS NOT NULL THEN
    IF configured_role IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap') THEN
      SELECT array_agg(r.rolname ORDER BY r.rolname)
      INTO runtime_memberships
      FROM pg_catalog.pg_roles r
      WHERE r.rolname IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap')
        AND pg_catalog.pg_has_role(configured_role, r.rolname, 'MEMBER');

      IF COALESCE(cardinality(runtime_memberships), 0) <> 1 THEN
        RAISE EXCEPTION 'Configured PostgreSQL role has ambiguous RW-02 runtime authority: %', configured_role USING ERRCODE='42501';
      END IF;
      runtime_role := configured_role;
    ELSE
      SELECT r.rolsuper,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=TG_TABLE_SCHEMA AND c.relname=TG_TABLE_NAME AND c.relowner=r.oid
        )
      INTO principal_is_superuser, principal_owns_table
      FROM pg_catalog.pg_roles r
      WHERE r.rolname=configured_role;

      IF COALESCE(principal_is_superuser, false) OR COALESCE(principal_owns_table, false) THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'Configured PostgreSQL role is not an RW-02 runtime authority: %', configured_role USING ERRCODE='42501';
    END IF;
  ELSE
    SELECT r.rolsuper,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=TG_TABLE_SCHEMA AND c.relname=TG_TABLE_NAME AND c.relowner=r.oid
      )
    INTO principal_is_superuser, principal_owns_table
    FROM pg_catalog.pg_roles r
    WHERE r.rolname=invoker_role;

    IF COALESCE(principal_is_superuser, false) OR COALESCE(principal_owns_table, false) THEN RETURN NEW; END IF;

    SELECT array_agg(r.rolname ORDER BY r.rolname)
    INTO runtime_memberships
    FROM pg_catalog.pg_roles r
    WHERE r.rolname IN ('foundry_product_runtime','foundry_worker','foundry_auth_bootstrap')
      AND pg_catalog.pg_has_role(invoker_role, r.rolname, 'MEMBER');

    CASE COALESCE(cardinality(runtime_memberships), 0)
      WHEN 1 THEN runtime_role := runtime_memberships[1];
      WHEN 0 THEN RAISE EXCEPTION 'PostgreSQL session principal has no RW-02 runtime authority: %', invoker_role USING ERRCODE='42501';
      ELSE RAISE EXCEPTION 'PostgreSQL session principal has multiple RW-02 runtime roles: %', invoker_role USING ERRCODE='42501';
    END CASE;
  END IF;

  IF runtime_role = 'foundry_auth_bootstrap' THEN
    CASE table_key
      WHEN 'foundry_product.auth_sessions' THEN
        IF NOT EXISTS (
          SELECT 1
          FROM foundry_product.auth_identities i
          JOIN foundry_product.users u ON u.id=i.user_id AND u.active
          JOIN foundry_product.institution_memberships m ON m.user_id=u.id
          WHERE i.id=(row_data->>'identity_id')::uuid
            AND i.user_id=(row_data->>'user_id')::uuid
            AND i.active
            AND m.institution_id=(row_data->>'institution_id')::uuid
        ) THEN RAISE EXCEPTION 'AuthSession tenant lineage mismatch' USING ERRCODE='23514'; END IF;
      WHEN 'foundry_operational.security_events' THEN
        tenant_id := NULLIF(row_data->>'institution_id','')::uuid;
        IF row_data->>'event_class' NOT IN ('AUTHENTICATION','AUTHORIZATION')
          OR (NULLIF(row_data->>'actor_user_id','') IS NOT NULL AND tenant_id IS NULL)
          OR (NULLIF(row_data->>'session_id','') IS NOT NULL AND tenant_id IS NULL)
          OR (NULLIF(row_data->>'actor_user_id','') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM foundry_product.users u
            JOIN foundry_product.institution_memberships m ON m.user_id=u.id
            WHERE u.id=(row_data->>'actor_user_id')::uuid AND u.active AND m.institution_id=tenant_id
          ))
          OR (NULLIF(row_data->>'session_id','') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM foundry_product.auth_sessions s
            WHERE s.id=(row_data->>'session_id')::uuid AND s.institution_id=tenant_id
              AND (NULLIF(row_data->>'actor_user_id','') IS NULL OR s.user_id=(row_data->>'actor_user_id')::uuid)
          )) THEN RAISE EXCEPTION 'Auth audit tenant lineage mismatch' USING ERRCODE='23514'; END IF;
      ELSE RAISE EXCEPTION 'Auth runtime mutation is missing RW-02 lineage enforcement: %', table_key USING ERRCODE='23514';
    END CASE;
    RETURN NEW;
  END IF;

  tenant_id := NULLIF(current_setting('foundry.institution_id', true), '')::uuid;
  IF tenant_id IS NULL THEN RAISE EXCEPTION 'RW-02 tenant context is required' USING ERRCODE='42501'; END IF;

  CASE table_key
    WHEN 'foundry_product.learning_tasks' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR NOT foundry_private.entity_in_tenant('COURSE',(row_data->>'course_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'learner_id')::uuid,tenant_id) THEN RAISE EXCEPTION 'learning Task tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.learning_episodes' THEN
      IF NOT foundry_private.entity_in_tenant('TASK',(row_data->>'task_id')::uuid,tenant_id) THEN RAISE EXCEPTION 'Episode Task tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.conversation_events' THEN
      guarded_task_id := (row_data->>'task_id')::uuid; guarded_episode_id := (row_data->>'episode_id')::uuid;
      IF NOT foundry_private.entity_in_tenant('TASK',guarded_task_id,tenant_id)
        OR NOT EXISTS (SELECT 1 FROM foundry_product.learning_episodes e WHERE e.id=guarded_episode_id AND e.task_id=guarded_task_id)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'actor_user_id')::uuid,tenant_id)
        OR (NULLIF(row_data->>'supersedes_event_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.conversation_events e WHERE e.id=(row_data->>'supersedes_event_id')::uuid AND e.task_id=guarded_task_id))
        OR NOT foundry_private.references_in_tenant(row_data->'source_refs',tenant_id)
        OR NOT foundry_private.references_in_tenant(row_data->'evidence_refs',tenant_id) THEN RAISE EXCEPTION 'ConversationEvent tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.source_records' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR (NULLIF(row_data->>'course_id','') IS NOT NULL AND NOT foundry_private.entity_in_tenant('COURSE',(row_data->>'course_id')::uuid,tenant_id)) THEN RAISE EXCEPTION 'Source scope tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.file_assets' THEN
      guarded_task_id := NULLIF(row_data->>'task_id','')::uuid;
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR NOT foundry_private.entity_in_tenant('COURSE',(row_data->>'course_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'owner_user_id')::uuid,tenant_id)
        OR (guarded_task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.learning_tasks t WHERE t.id=guarded_task_id AND t.institution_id=tenant_id AND t.course_id=(row_data->>'course_id')::uuid))
        OR (NULLIF(row_data->>'source_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.source_records s WHERE s.id=(row_data->>'source_id')::uuid AND s.institution_id=tenant_id AND s.course_id=(row_data->>'course_id')::uuid)) THEN RAISE EXCEPTION 'FileAsset tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.evidence_units' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR NOT foundry_private.entity_in_tenant('SOURCE',(row_data->>'source_id')::uuid,tenant_id) THEN RAISE EXCEPTION 'EvidenceUnit tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.context_compilations' THEN
      guarded_task_id := (row_data->>'task_id')::uuid; guarded_episode_id := (row_data->>'episode_id')::uuid;
      IF NOT foundry_private.entity_in_tenant('TASK',guarded_task_id,tenant_id)
        OR NOT EXISTS (SELECT 1 FROM foundry_product.learning_episodes e WHERE e.id=guarded_episode_id AND e.task_id=guarded_task_id)
        OR NOT foundry_private.context_items_in_tenant(row_data->'selected_items',tenant_id)
        OR NOT foundry_private.context_items_in_tenant(row_data->'excluded_items',tenant_id) THEN RAISE EXCEPTION 'ContextCompilation tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.learner_attempts' THEN
      guarded_task_id := (row_data->>'task_id')::uuid; guarded_episode_id := (row_data->>'episode_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM foundry_product.learning_tasks t JOIN foundry_product.learning_episodes e ON e.task_id=t.id WHERE t.id=guarded_task_id AND e.id=guarded_episode_id AND t.institution_id=tenant_id AND t.learner_id=(row_data->>'learner_id')::uuid)
        OR (NULLIF(row_data->>'file_asset_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.file_assets f WHERE f.id=(row_data->>'file_asset_id')::uuid AND f.institution_id=tenant_id AND f.task_id=guarded_task_id AND f.owner_user_id=(row_data->>'learner_id')::uuid))
        OR NOT foundry_private.references_in_tenant(row_data->'source_refs',tenant_id) THEN RAISE EXCEPTION 'LearnerAttempt tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.diagnostic_observations' THEN
      IF NOT foundry_private.entity_in_tenant('ATTEMPT',(row_data->>'attempt_id')::uuid,tenant_id)
        OR (NULLIF(row_data->>'superseded_by_id','') IS NOT NULL AND NOT foundry_private.entity_in_tenant('OBSERVATION',(row_data->>'superseded_by_id')::uuid,tenant_id)) THEN RAISE EXCEPTION 'DiagnosticObservation tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.teacher_reviews' THEN
      IF NOT foundry_private.entity_in_tenant('OBSERVATION',(row_data->>'observation_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'teacher_id')::uuid,tenant_id)
        OR row_data->'actor_provenance'->>'institutionId' <> tenant_id::text
        OR row_data->'actor_provenance'->>'userId' <> row_data->>'teacher_id' THEN RAISE EXCEPTION 'TeacherReview tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.retry_attempts' THEN
      IF NOT foundry_private.entity_in_tenant('ATTEMPT',(row_data->>'original_attempt_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('OBSERVATION',(row_data->>'reviewed_observation_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('REVIEW',(row_data->>'teacher_review_id')::uuid,tenant_id)
        OR (NULLIF(row_data->>'result_attempt_id','') IS NOT NULL AND NOT foundry_private.entity_in_tenant('ATTEMPT',(row_data->>'result_attempt_id')::uuid,tenant_id))
        OR (NULLIF(row_data->>'result_observation_id','') IS NOT NULL AND NOT foundry_private.entity_in_tenant('OBSERVATION',(row_data->>'result_observation_id')::uuid,tenant_id))
        OR (NULLIF(row_data->>'result_review_id','') IS NOT NULL AND NOT foundry_private.entity_in_tenant('REVIEW',(row_data->>'result_review_id')::uuid,tenant_id)) THEN RAISE EXCEPTION 'Retry tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.transfer_activities' THEN
      IF NOT foundry_private.entity_in_tenant('RETRY',(row_data->>'retry_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('EVIDENCE',(row_data->>'evidence_unit_id')::uuid,tenant_id) THEN RAISE EXCEPTION 'Transfer tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.retention_reviews' THEN
      IF NOT foundry_private.entity_in_tenant('RETRY',(row_data->>'retry_id')::uuid,tenant_id)
        OR (NULLIF(row_data->>'evidence_unit_id','') IS NOT NULL AND NOT foundry_private.entity_in_tenant('EVIDENCE',(row_data->>'evidence_unit_id')::uuid,tenant_id)) THEN RAISE EXCEPTION 'Retention tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.learning_outcomes' THEN
      IF NOT foundry_private.entity_in_tenant('TASK',(row_data->>'task_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('RETRY',(row_data->>'retry_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('REVIEW',(row_data->>'result_review_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'teacher_id')::uuid,tenant_id)
        OR row_data->'actor_provenance'->>'institutionId' <> tenant_id::text
        OR row_data->'actor_provenance'->>'userId' <> row_data->>'teacher_id'
        OR NOT foundry_private.references_in_tenant(row_data->'evidence_refs',tenant_id) THEN RAISE EXCEPTION 'LearningOutcome tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.components' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR NOT foundry_private.entity_in_tenant('COURSE',(row_data->>'course_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'created_by')::uuid,tenant_id)
        OR (NULLIF(row_data->>'active_version_id','') IS NOT NULL AND NOT foundry_private.entity_in_tenant('VERSION',(row_data->>'active_version_id')::uuid,tenant_id)) THEN RAISE EXCEPTION 'Component tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.component_versions' THEN
      guarded_component_id := (row_data->>'component_id')::uuid;
      IF NOT foundry_private.entity_in_tenant('COMPONENT',guarded_component_id,tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'created_by')::uuid,tenant_id)
        OR (NULLIF(row_data->>'successor_of_version_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.component_versions v WHERE v.id=(row_data->>'successor_of_version_id')::uuid AND v.component_id=guarded_component_id))
        OR NOT foundry_private.uuid_array_in_tenant(row_data->'source_observation_ids','OBSERVATION',tenant_id)
        OR NOT foundry_private.uuid_array_in_tenant(row_data->'source_review_ids','REVIEW',tenant_id) THEN RAISE EXCEPTION 'ComponentVersion tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.component_evaluations' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR NOT foundry_private.entity_in_tenant('COURSE',(row_data->>'course_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('VERSION',(row_data->>'component_version_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'created_by')::uuid,tenant_id)
        OR NOT foundry_private.uuid_array_in_tenant(row_data->'source_observation_ids','OBSERVATION',tenant_id)
        OR NOT foundry_private.uuid_array_in_tenant(row_data->'source_review_ids','REVIEW',tenant_id)
        OR NOT foundry_private.uuid_array_in_tenant(row_data->'source_attempt_ids','ATTEMPT',tenant_id) THEN RAISE EXCEPTION 'ComponentEvaluation tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.publication_decisions' THEN
      IF NOT foundry_private.entity_in_tenant('VERSION',(row_data->>'component_version_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'expert_id')::uuid,tenant_id)
        OR row_data->'actor_provenance'->>'institutionId' <> tenant_id::text
        OR row_data->'actor_provenance'->>'userId' <> row_data->>'expert_id'
        OR (NULLIF(row_data->>'evaluation_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.component_evaluations e WHERE e.id=(row_data->>'evaluation_id')::uuid AND e.component_version_id=(row_data->>'component_version_id')::uuid AND e.institution_id=tenant_id))
        OR (NULLIF(row_data->>'previous_active_version_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.component_versions p JOIN foundry_product.component_versions v ON v.component_id=p.component_id WHERE p.id=(row_data->>'previous_active_version_id')::uuid AND v.id=(row_data->>'component_version_id')::uuid))
        OR (NULLIF(row_data->>'workflow_thread_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_operational.workflow_runs w WHERE w.thread_id=row_data->>'workflow_thread_id' AND w.institution_id=tenant_id)) THEN RAISE EXCEPTION 'PublicationDecision tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.component_deliveries' THEN
      guarded_task_id := (row_data->>'task_id')::uuid; guarded_episode_id := (row_data->>'episode_id')::uuid; guarded_component_id := (row_data->>'component_id')::uuid;
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR NOT EXISTS (SELECT 1 FROM foundry_product.learning_tasks t WHERE t.id=guarded_task_id AND t.institution_id=tenant_id AND t.course_id=(row_data->>'course_id')::uuid)
        OR NOT EXISTS (SELECT 1 FROM foundry_product.learning_episodes e WHERE e.id=guarded_episode_id AND e.task_id=guarded_task_id)
        OR NOT EXISTS (SELECT 1 FROM foundry_product.components c WHERE c.id=guarded_component_id AND c.institution_id=tenant_id AND c.course_id=(row_data->>'course_id')::uuid)
        OR NOT EXISTS (SELECT 1 FROM foundry_product.component_versions v WHERE v.id=(row_data->>'component_version_id')::uuid AND v.component_id=guarded_component_id)
        OR NOT EXISTS (SELECT 1 FROM foundry_product.diagnostic_observations o JOIN foundry_product.learner_attempts a ON a.id=o.attempt_id WHERE o.id=(row_data->>'observation_id')::uuid AND a.task_id=guarded_task_id AND a.episode_id=guarded_episode_id)
        OR NOT EXISTS (SELECT 1 FROM foundry_product.teacher_reviews r WHERE r.id=(row_data->>'review_id')::uuid AND r.observation_id=(row_data->>'observation_id')::uuid)
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'delivered_by')::uuid,tenant_id) THEN RAISE EXCEPTION 'ComponentDelivery tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.library_items' THEN
      IF NOT foundry_private.entity_in_tenant('USER',(row_data->>'learner_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('COURSE',(row_data->>'course_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant('EVIDENCE',(row_data->>'evidence_unit_id')::uuid,tenant_id) THEN RAISE EXCEPTION 'LibraryItem tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.schedule_items' THEN
      IF NOT EXISTS (SELECT 1 FROM foundry_product.learning_tasks t WHERE t.id=(row_data->>'task_id')::uuid AND t.institution_id=tenant_id AND t.learner_id=(row_data->>'learner_id')::uuid) THEN RAISE EXCEPTION 'ScheduleItem tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.governance_events' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'actor_user_id')::uuid,tenant_id)
        OR NOT foundry_private.entity_in_tenant(CASE row_data->>'entity_type' WHEN 'LEARNING_TASK' THEN 'TASK' WHEN 'SOURCE_RECORD' THEN 'SOURCE' WHEN 'TEACHER_REVIEW' THEN 'REVIEW' WHEN 'LEARNING_OUTCOME' THEN 'OUTCOME' WHEN 'COMPONENT' THEN 'COMPONENT' WHEN 'COMPONENT_VERSION' THEN 'VERSION' WHEN 'COMPONENT_EVALUATION' THEN 'EVALUATION' WHEN 'PUBLICATION_DECISION' THEN 'DECISION' WHEN 'COMPONENT_DELIVERY' THEN 'DELIVERY' ELSE 'UNKNOWN' END,(row_data->>'entity_id')::uuid,tenant_id)
        OR (NULLIF(row_data->>'previous_event_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.governance_events g WHERE g.id=(row_data->>'previous_event_id')::uuid AND g.institution_id=tenant_id)) THEN RAISE EXCEPTION 'GovernanceEvent tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_product.idempotency_keys' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR NOT foundry_private.idempotency_result_in_tenant(row_data->>'command_type',NULLIF(row_data->>'result_id','')::uuid,tenant_id) THEN RAISE EXCEPTION 'Idempotency result tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_operational.workflow_runs' THEN
      guarded_task_id := NULLIF(row_data->>'task_id','')::uuid; guarded_episode_id := NULLIF(row_data->>'episode_id','')::uuid;
      IF (row_data->>'institution_id')::uuid <> tenant_id OR row_data->>'thread_id' NOT LIKE tenant_id::text || ':%'
        OR (guarded_task_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('TASK',guarded_task_id,tenant_id))
        OR (guarded_episode_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.learning_episodes e WHERE e.id=guarded_episode_id AND (guarded_task_id IS NULL OR e.task_id=guarded_task_id)))
        OR NOT foundry_private.entity_in_tenant('USER',(row_data->>'actor_user_id')::uuid,tenant_id)
        OR NOT foundry_private.references_in_tenant(jsonb_build_array(COALESCE(row_data->'product_links','{}'::jsonb)),tenant_id) THEN RAISE EXCEPTION 'WorkflowRun tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_operational.retrieval_runs' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR NOT foundry_private.entity_in_tenant('TASK',(row_data->>'task_id')::uuid,tenant_id)
        OR NOT foundry_private.uuid_array_in_tenant(row_data->'selected_evidence_ids','EVIDENCE',tenant_id)
        OR NOT foundry_private.references_in_tenant(row_data->'ranking_evidence',tenant_id) THEN RAISE EXCEPTION 'RetrievalRun tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_operational.model_runs' THEN
      guarded_task_id := NULLIF(row_data->>'task_id','')::uuid;
      IF (row_data->>'institution_id')::uuid <> tenant_id
        OR (guarded_task_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('TASK',guarded_task_id,tenant_id))
        OR (NULLIF(row_data->>'file_asset_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.file_assets f WHERE f.id=(row_data->>'file_asset_id')::uuid AND f.institution_id=tenant_id AND (guarded_task_id IS NULL OR f.task_id=guarded_task_id)))
        OR NOT foundry_private.uuid_array_in_tenant(row_data->'evidence_unit_ids','EVIDENCE',tenant_id) THEN RAISE EXCEPTION 'ModelRun tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_operational.eval_runs' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id THEN RAISE EXCEPTION 'EvalRun tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'foundry_operational.security_events' THEN
      IF (row_data->>'institution_id')::uuid <> tenant_id OR row_data->>'event_class' <> 'SERVICE' OR row_data->>'event_code' <> 'SERVICE_INVOCATION'
        OR row_data->>'principal' <> current_setting('foundry.service_principal',true)
        OR row_data->>'purpose' <> current_setting('foundry.service_purpose',true)
        OR (NULLIF(row_data->>'actor_user_id','') IS NOT NULL AND NOT foundry_private.entity_in_tenant('USER',(row_data->>'actor_user_id')::uuid,tenant_id))
        OR (NULLIF(row_data->>'session_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.auth_sessions s WHERE s.id=(row_data->>'session_id')::uuid AND s.institution_id=tenant_id AND (NULLIF(row_data->>'actor_user_id','') IS NULL OR s.user_id=(row_data->>'actor_user_id')::uuid))) THEN RAISE EXCEPTION 'Service audit tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    ELSE RAISE EXCEPTION 'Writable table is missing RW-02 lineage enforcement: %', table_key USING ERRCODE='23514';
  END CASE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."assert_rw02_tenant_lineage"() FROM PUBLIC;

DO $$
DECLARE protected_table record;
BEGIN
  FOR protected_table IN SELECT schema_name, table_name FROM foundry_private.writable_lineage_catalog LOOP
    -- PostgreSQL orders same-event triggers by name. Run the authority guard before
    -- domain governance triggers so cross-tenant input is rejected at the boundary first.
    EXECUTE format('CREATE TRIGGER _authority_tenant_lineage_guard BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION foundry_private.assert_rw02_tenant_lineage()', protected_table.schema_name, protected_table.table_name);
  END LOOP;
END $$;
