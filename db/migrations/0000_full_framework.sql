CREATE SCHEMA IF NOT EXISTS "foundry_operational";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "foundry_product";
--> statement-breakpoint
CREATE TABLE "foundry_product"."capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"reference_pack_key" text NOT NULL,
	"kind" text NOT NULL,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capabilities_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."capability_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability_id" uuid NOT NULL,
	"version" text NOT NULL,
	"contract" jsonb NOT NULL,
	"implementation_key" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."component_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"version" text NOT NULL,
	"contract" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"eval_result" jsonb,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "component_version_status_ck" CHECK ("foundry_product"."component_versions"."status" IN ('DRAFT','PUBLISHED','REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'CANDIDATE' NOT NULL,
	"source_signal" jsonb NOT NULL,
	"active_version_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."context_compilations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"compiler_version" text NOT NULL,
	"token_budget" integer NOT NULL,
	"modality_budget" jsonb NOT NULL,
	"tokenizer" text NOT NULL,
	"selected_token_count" integer NOT NULL,
	"modality_usage" jsonb NOT NULL,
	"selected_items" jsonb NOT NULL,
	"excluded_items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supersedes_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."course_enrollments" (
	"institution_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_enrollments_institution_id_course_id_user_id_role_pk" PRIMARY KEY("institution_id","course_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."diagnostic_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"capability_version_id" uuid,
	"observation_source" text DEFAULT 'CAPABILITY' NOT NULL,
	"status" text NOT NULL,
	"failure_code" text,
	"first_invalid_step" text,
	"summary" text NOT NULL,
	"structured_result" jsonb NOT NULL,
	"input_lineage" jsonb NOT NULL,
	"output_lineage" jsonb NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_operational"."eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid,
	"dataset" text NOT NULL,
	"dataset_version" text NOT NULL,
	"status" text NOT NULL,
	"passed" integer NOT NULL,
	"failed" integer NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."evidence_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"institution_id" uuid,
	"modality" text NOT NULL,
	"locator" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"structured_content" jsonb,
	"search_document" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" real[],
	"embedding_model" text,
	"embedding_dimensions" integer,
	"embedding_status" text DEFAULT 'NOT_REQUESTED' NOT NULL,
	"embedding_failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."file_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"task_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"source_id" uuid,
	"purpose" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"ingestion_status" text DEFAULT 'STORED' NOT NULL,
	"extraction_text" text,
	"extraction_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interpretation" text,
	"interpretation_status" text DEFAULT 'NOT_APPLICABLE' NOT NULL,
	"provider_model" text,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "file_asset_purpose_ck" CHECK ("foundry_product"."file_assets"."purpose" IN ('LEARNING_MATERIAL','LEARNER_ATTEMPT')),
	CONSTRAINT "file_asset_ingestion_status_ck" CHECK ("foundry_product"."file_assets"."ingestion_status" IN ('STORED','EXTRACTED','PROVIDER_UNAVAILABLE','FAILED')),
	CONSTRAINT "file_asset_interpretation_status_ck" CHECK ("foundry_product"."file_assets"."interpretation_status" IN ('NOT_APPLICABLE','AVAILABLE','PROVIDER_UNAVAILABLE','FAILED')),
	CONSTRAINT "file_asset_size_ck" CHECK ("foundry_product"."file_assets"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."governance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"previous_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."idempotency_keys" (
	"institution_id" uuid NOT NULL,
	"key" text NOT NULL,
	"command_type" text NOT NULL,
	"request_hash" text NOT NULL,
	"result_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_institution_id_command_type_key_pk" PRIMARY KEY("institution_id","command_type","key")
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."institution_memberships" (
	"user_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_memberships_user_id_institution_id_role_pk" PRIMARY KEY("user_id","institution_id","role")
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institutions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."learner_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"capability_id" uuid,
	"file_asset_id" uuid,
	"prompt" text NOT NULL,
	"response" text NOT NULL,
	"structured_input" jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."learning_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."learning_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"retry_id" uuid NOT NULL,
	"result_review_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"outcome_type" text NOT NULL,
	"status" text NOT NULL,
	"evidence_refs" jsonb NOT NULL,
	"narrative" text NOT NULL,
	"actor_provenance" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_outcomes_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "learning_outcome_type_ck" CHECK ("foundry_product"."learning_outcomes"."outcome_type" = 'RETRY')
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."learning_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"goal" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"evidence_unit_id" uuid NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_operational"."model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"task_id" uuid,
	"file_asset_id" uuid,
	"call_type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"latency_ms" real NOT NULL,
	"evidence_unit_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."publication_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_version_id" uuid NOT NULL,
	"expert_id" uuid NOT NULL,
	"action" text NOT NULL,
	"rationale" text NOT NULL,
	"actor_provenance" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_decisions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "publication_action_ck" CHECK ("foundry_product"."publication_decisions"."action" IN ('APPROVE','REJECT','ROLLBACK')),
	CONSTRAINT "publication_provenance_ck" CHECK (length("foundry_product"."publication_decisions"."actor_provenance"->>'userId') > 0 AND length("foundry_product"."publication_decisions"."actor_provenance"->>'institutionId') > 0 AND length("foundry_product"."publication_decisions"."actor_provenance"->>'authMethod') > 0 AND ("foundry_product"."publication_decisions"."actor_provenance"->>'authMethod') NOT LIKE 'migrated-%')
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."retention_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retry_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"evidence_unit_id" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_reviews_retry_id_unique" UNIQUE("retry_id")
);
--> statement-breakpoint
CREATE TABLE "foundry_operational"."retrieval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"query" text NOT NULL,
	"purpose" text NOT NULL,
	"selected_evidence_ids" jsonb NOT NULL,
	"ranking_evidence" jsonb NOT NULL,
	"retrieval_mode" text NOT NULL,
	"embedding_status" text NOT NULL,
	"embedding_model" text,
	"reranker_status" text NOT NULL,
	"reranker_model" text,
	"missing_signal" boolean DEFAULT false NOT NULL,
	"conflicting_signal" boolean DEFAULT false NOT NULL,
	"latency_ms" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."retry_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_attempt_id" uuid NOT NULL,
	"reviewed_observation_id" uuid NOT NULL,
	"teacher_review_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'ASSIGNED' NOT NULL,
	"result_attempt_id" uuid,
	"result_observation_id" uuid,
	"result_review_id" uuid,
	"scheduled_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retry_activity_ck" CHECK ("foundry_product"."retry_attempts"."activity_type" = 'RETRY'),
	CONSTRAINT "retry_status_ck" CHECK ("foundry_product"."retry_attempts"."status" IN ('ASSIGNED','REVIEWED','ESCALATED'))
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."schedule_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_activity_ck" CHECK ("foundry_product"."schedule_items"."activity_type" = 'STUDY_REVIEW')
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid,
	"course_id" uuid,
	"source_key" text NOT NULL,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"version" text NOT NULL,
	"authority" text NOT NULL,
	"rights" text NOT NULL,
	"rights_authorization_status" text NOT NULL,
	"distribution_scope" text NOT NULL,
	"allowed_purposes" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_rights_authorization_ck" CHECK ("foundry_product"."source_records"."rights_authorization_status" IN ('APPROVED','REVIEW_REQUIRED','DENIED'))
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"reference_pack_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."teacher_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"correction" text,
	"supplement" text,
	"teaching_support" text NOT NULL,
	"actor_provenance" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_reviews_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "teacher_review_decision_ck" CHECK ("foundry_product"."teacher_reviews"."decision" IN ('ACCEPT','CORRECT','SUPPLEMENT','ESCALATE')),
	CONSTRAINT "teacher_review_payload_ck" CHECK (("foundry_product"."teacher_reviews"."decision" <> 'CORRECT' OR length(btrim("foundry_product"."teacher_reviews"."correction")) > 0) AND ("foundry_product"."teacher_reviews"."decision" <> 'SUPPLEMENT' OR length(btrim("foundry_product"."teacher_reviews"."supplement")) > 0)),
	CONSTRAINT "teacher_review_provenance_ck" CHECK (length("foundry_product"."teacher_reviews"."actor_provenance"->>'userId') > 0 AND length("foundry_product"."teacher_reviews"."actor_provenance"->>'institutionId') > 0 AND length("foundry_product"."teacher_reviews"."actor_provenance"->>'authMethod') > 0 AND length("foundry_product"."teacher_reviews"."actor_provenance"->>'sessionId') > 0 AND ("foundry_product"."teacher_reviews"."actor_provenance"->>'authMethod') NOT LIKE 'migrated-%')
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."transfer_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retry_id" uuid NOT NULL,
	"target_concept" text NOT NULL,
	"evidence_unit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_activities_retry_id_unique" UNIQUE("retry_id")
);
--> statement-breakpoint
CREATE TABLE "foundry_product"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "foundry_operational"."workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" text NOT NULL,
	"workflow_kind" text NOT NULL,
	"institution_id" uuid NOT NULL,
	"task_id" uuid,
	"episode_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"interrupt_type" text,
	"interrupt_version" integer DEFAULT 0 NOT NULL,
	"resume_claimed_at" timestamp with time zone,
	"product_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workflow_runs_thread_id_unique" UNIQUE("thread_id")
);
--> statement-breakpoint
ALTER TABLE "foundry_product"."capability_versions" ADD CONSTRAINT "capability_versions_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "foundry_product"."capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_versions" ADD CONSTRAINT "component_versions_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "foundry_product"."components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."component_versions" ADD CONSTRAINT "component_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD CONSTRAINT "components_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."components" ADD CONSTRAINT "components_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."context_compilations" ADD CONSTRAINT "context_compilations_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."context_compilations" ADD CONSTRAINT "context_compilations_episode_id_learning_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."conversation_events" ADD CONSTRAINT "conversation_events_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."conversation_events" ADD CONSTRAINT "conversation_events_episode_id_learning_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."conversation_events" ADD CONSTRAINT "conversation_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."course_enrollments" ADD CONSTRAINT "course_enrollments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."course_enrollments" ADD CONSTRAINT "course_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "foundry_product"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."courses" ADD CONSTRAINT "courses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."courses" ADD CONSTRAINT "courses_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "foundry_product"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."diagnostic_observations" ADD CONSTRAINT "diagnostic_observations_attempt_id_learner_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "foundry_product"."learner_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."diagnostic_observations" ADD CONSTRAINT "diagnostic_observations_capability_version_id_capability_versions_id_fk" FOREIGN KEY ("capability_version_id") REFERENCES "foundry_product"."capability_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."eval_runs" ADD CONSTRAINT "eval_runs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."evidence_units" ADD CONSTRAINT "evidence_units_source_id_source_records_id_fk" FOREIGN KEY ("source_id") REFERENCES "foundry_product"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."evidence_units" ADD CONSTRAINT "evidence_units_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."file_assets" ADD CONSTRAINT "file_assets_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."file_assets" ADD CONSTRAINT "file_assets_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."file_assets" ADD CONSTRAINT "file_assets_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."file_assets" ADD CONSTRAINT "file_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."file_assets" ADD CONSTRAINT "file_assets_source_id_source_records_id_fk" FOREIGN KEY ("source_id") REFERENCES "foundry_product"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."governance_events" ADD CONSTRAINT "governance_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."governance_events" ADD CONSTRAINT "governance_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."institution_memberships" ADD CONSTRAINT "institution_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "foundry_product"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."institution_memberships" ADD CONSTRAINT "institution_memberships_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learner_attempts" ADD CONSTRAINT "learner_attempts_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learner_attempts" ADD CONSTRAINT "learner_attempts_episode_id_learning_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learner_attempts" ADD CONSTRAINT "learner_attempts_learner_id_users_id_fk" FOREIGN KEY ("learner_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learner_attempts" ADD CONSTRAINT "learner_attempts_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "foundry_product"."capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learner_attempts" ADD CONSTRAINT "learner_attempts_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "foundry_product"."file_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learning_episodes" ADD CONSTRAINT "learning_episodes_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learning_outcomes" ADD CONSTRAINT "learning_outcomes_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learning_outcomes" ADD CONSTRAINT "learning_outcomes_retry_id_retry_attempts_id_fk" FOREIGN KEY ("retry_id") REFERENCES "foundry_product"."retry_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learning_outcomes" ADD CONSTRAINT "learning_outcomes_result_review_id_teacher_reviews_id_fk" FOREIGN KEY ("result_review_id") REFERENCES "foundry_product"."teacher_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learning_outcomes" ADD CONSTRAINT "learning_outcomes_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learning_tasks" ADD CONSTRAINT "learning_tasks_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learning_tasks" ADD CONSTRAINT "learning_tasks_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."learning_tasks" ADD CONSTRAINT "learning_tasks_learner_id_users_id_fk" FOREIGN KEY ("learner_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."library_items" ADD CONSTRAINT "library_items_learner_id_users_id_fk" FOREIGN KEY ("learner_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."library_items" ADD CONSTRAINT "library_items_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."library_items" ADD CONSTRAINT "library_items_evidence_unit_id_evidence_units_id_fk" FOREIGN KEY ("evidence_unit_id") REFERENCES "foundry_product"."evidence_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."model_runs" ADD CONSTRAINT "model_runs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."model_runs" ADD CONSTRAINT "model_runs_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."model_runs" ADD CONSTRAINT "model_runs_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "foundry_product"."file_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."publication_decisions" ADD CONSTRAINT "publication_decisions_component_version_id_component_versions_id_fk" FOREIGN KEY ("component_version_id") REFERENCES "foundry_product"."component_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."publication_decisions" ADD CONSTRAINT "publication_decisions_expert_id_users_id_fk" FOREIGN KEY ("expert_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."retention_reviews" ADD CONSTRAINT "retention_reviews_retry_id_retry_attempts_id_fk" FOREIGN KEY ("retry_id") REFERENCES "foundry_product"."retry_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."retention_reviews" ADD CONSTRAINT "retention_reviews_evidence_unit_id_evidence_units_id_fk" FOREIGN KEY ("evidence_unit_id") REFERENCES "foundry_product"."evidence_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."retry_attempts" ADD CONSTRAINT "retry_attempts_original_attempt_id_learner_attempts_id_fk" FOREIGN KEY ("original_attempt_id") REFERENCES "foundry_product"."learner_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."retry_attempts" ADD CONSTRAINT "retry_attempts_reviewed_observation_id_diagnostic_observations_id_fk" FOREIGN KEY ("reviewed_observation_id") REFERENCES "foundry_product"."diagnostic_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."retry_attempts" ADD CONSTRAINT "retry_attempts_teacher_review_id_teacher_reviews_id_fk" FOREIGN KEY ("teacher_review_id") REFERENCES "foundry_product"."teacher_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."retry_attempts" ADD CONSTRAINT "retry_attempts_result_attempt_id_learner_attempts_id_fk" FOREIGN KEY ("result_attempt_id") REFERENCES "foundry_product"."learner_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."retry_attempts" ADD CONSTRAINT "retry_attempts_result_observation_id_diagnostic_observations_id_fk" FOREIGN KEY ("result_observation_id") REFERENCES "foundry_product"."diagnostic_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."retry_attempts" ADD CONSTRAINT "retry_attempts_result_review_id_teacher_reviews_id_fk" FOREIGN KEY ("result_review_id") REFERENCES "foundry_product"."teacher_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."schedule_items" ADD CONSTRAINT "schedule_items_learner_id_users_id_fk" FOREIGN KEY ("learner_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."schedule_items" ADD CONSTRAINT "schedule_items_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."source_records" ADD CONSTRAINT "source_records_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."source_records" ADD CONSTRAINT "source_records_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."subjects" ADD CONSTRAINT "subjects_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_observation_id_diagnostic_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "foundry_product"."diagnostic_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."teacher_reviews" ADD CONSTRAINT "teacher_reviews_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."transfer_activities" ADD CONSTRAINT "transfer_activities_retry_id_retry_attempts_id_fk" FOREIGN KEY ("retry_id") REFERENCES "foundry_product"."retry_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_product"."transfer_activities" ADD CONSTRAINT "transfer_activities_evidence_unit_id_evidence_units_id_fk" FOREIGN KEY ("evidence_unit_id") REFERENCES "foundry_product"."evidence_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."workflow_runs" ADD CONSTRAINT "workflow_runs_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."workflow_runs" ADD CONSTRAINT "workflow_runs_task_id_learning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."workflow_runs" ADD CONSTRAINT "workflow_runs_episode_id_learning_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry_operational"."workflow_runs" ADD CONSTRAINT "workflow_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "foundry_product"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_versions_uq" ON "foundry_product"."capability_versions" USING btree ("capability_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "component_versions_uq" ON "foundry_product"."component_versions" USING btree ("component_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "components_institution_key_uq" ON "foundry_product"."components" USING btree ("institution_id","key");--> statement-breakpoint
CREATE INDEX "conversation_events_episode_idx" ON "foundry_product"."conversation_events" USING btree ("episode_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_institution_code_uq" ON "foundry_product"."courses" USING btree ("institution_id","code");--> statement-breakpoint
CREATE INDEX "observations_attempt_idx" ON "foundry_product"."diagnostic_observations" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_source_locator_hash_uq" ON "foundry_product"."evidence_units" USING btree ("source_id","locator","content_hash");--> statement-breakpoint
CREATE INDEX "evidence_source_idx" ON "foundry_product"."evidence_units" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "file_assets_scope_idx" ON "foundry_product"."file_assets" USING btree ("institution_id","course_id","created_at");--> statement-breakpoint
CREATE INDEX "file_assets_scope_hash_idx" ON "foundry_product"."file_assets" USING btree ("institution_id","owner_user_id","purpose","content_hash");--> statement-breakpoint
CREATE INDEX "governance_entity_idx" ON "foundry_product"."governance_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "attempts_task_idx" ON "foundry_product"."learner_attempts" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_task_sequence_uq" ON "foundry_product"."learning_episodes" USING btree ("task_id","sequence");--> statement-breakpoint
CREATE INDEX "learning_tasks_learner_idx" ON "foundry_product"."learning_tasks" USING btree ("learner_id","status");--> statement-breakpoint
CREATE INDEX "model_runs_scope_idx" ON "foundry_operational"."model_runs" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_key_version_uq" ON "foundry_product"."source_records" USING btree ("source_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_institution_key_uq" ON "foundry_product"."subjects" USING btree ("institution_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_observation_uq" ON "foundry_product"."teacher_reviews" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_institution_idx" ON "foundry_operational"."workflow_runs" USING btree ("institution_id","created_at");
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."assert_course_enrollment_institution"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "foundry_product"."courses" c WHERE c."id" = NEW."course_id" AND c."institution_id" = NEW."institution_id") THEN
    RAISE EXCEPTION 'course enrollment institution mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "course_enrollment_institution_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."course_enrollments" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_course_enrollment_institution"();
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."assert_learning_task_institution"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "foundry_product"."courses" c WHERE c."id" = NEW."course_id" AND c."institution_id" = NEW."institution_id") THEN
    RAISE EXCEPTION 'learning task institution mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "learning_task_institution_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learning_tasks" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_learning_task_institution"();
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."assert_source_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."course_id" IS NOT NULL AND (
    NEW."institution_id" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "foundry_product"."courses" course
      WHERE course."id" = NEW."course_id" AND course."institution_id" = NEW."institution_id"
    )
  ) THEN RAISE EXCEPTION 'source course and institution mismatch'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "source_scope_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."source_records" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_source_scope"();
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."assert_file_asset_lineage"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "foundry_product"."courses" course
    WHERE course."id" = NEW."course_id" AND course."institution_id" = NEW."institution_id"
  ) THEN RAISE EXCEPTION 'file asset course and institution mismatch'; END IF;
  IF NEW."task_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "foundry_product"."learning_tasks" task
    WHERE task."id" = NEW."task_id" AND task."course_id" = NEW."course_id" AND task."institution_id" = NEW."institution_id"
      AND (NEW."purpose" <> 'LEARNER_ATTEMPT' OR task."learner_id" = NEW."owner_user_id")
  ) THEN RAISE EXCEPTION 'file asset task, course, institution or learner mismatch'; END IF;
  IF NEW."source_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "foundry_product"."source_records" source
    WHERE source."id" = NEW."source_id" AND source."institution_id" = NEW."institution_id" AND source."course_id" = NEW."course_id"
  ) THEN RAISE EXCEPTION 'file asset source scope mismatch'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "file_asset_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."file_assets" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_file_asset_lineage"();
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."assert_attempt_lineage"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "foundry_product"."learning_tasks" task
    JOIN "foundry_product"."learning_episodes" episode ON episode."task_id" = task."id"
    WHERE task."id" = NEW."task_id" AND episode."id" = NEW."episode_id" AND task."learner_id" = NEW."learner_id"
  ) THEN RAISE EXCEPTION 'attempt task, episode or learner lineage mismatch'; END IF;
  IF NEW."file_asset_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "foundry_product"."file_assets" asset
    WHERE asset."id" = NEW."file_asset_id" AND asset."task_id" = NEW."task_id" AND asset."owner_user_id" = NEW."learner_id" AND asset."purpose" = 'LEARNER_ATTEMPT'
  ) THEN RAISE EXCEPTION 'attempt file lineage mismatch'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "attempt_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learner_attempts" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_attempt_lineage"();
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."assert_review_authority"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_institution text;
BEGIN
  SELECT task."institution_id"::text INTO task_institution
  FROM "foundry_product"."diagnostic_observations" observation
  JOIN "foundry_product"."learner_attempts" attempt ON attempt."id" = observation."attempt_id"
  JOIN "foundry_product"."learning_tasks" task ON task."id" = attempt."task_id"
  WHERE observation."id" = NEW."observation_id";
  IF task_institution IS NULL OR task_institution <> NEW."actor_provenance"->>'institutionId' OR NEW."teacher_id"::text <> NEW."actor_provenance"->>'userId' THEN
    RAISE EXCEPTION 'review actor or institution mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "review_authority_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."teacher_reviews" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_review_authority"();
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."assert_retry_lineage"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_task uuid; original_episode uuid; original_learner uuid; assignment_decision text; result_decision text; current_review uuid;
BEGIN
  SELECT attempt."task_id", attempt."episode_id", attempt."learner_id" INTO original_task, original_episode, original_learner
  FROM "foundry_product"."learner_attempts" attempt WHERE attempt."id" = NEW."original_attempt_id";
  SELECT review."decision" INTO assignment_decision
  FROM "foundry_product"."diagnostic_observations" observation
  JOIN "foundry_product"."teacher_reviews" review ON review."observation_id" = observation."id"
  WHERE observation."id" = NEW."reviewed_observation_id" AND observation."attempt_id" = NEW."original_attempt_id" AND review."id" = NEW."teacher_review_id";
  SELECT review."id" INTO current_review FROM "foundry_product"."teacher_reviews" review
  WHERE review."observation_id" = NEW."reviewed_observation_id" ORDER BY review."created_at" DESC, review."id" DESC LIMIT 1;
  IF assignment_decision IS NULL OR assignment_decision = 'ESCALATE' OR current_review <> NEW."teacher_review_id" THEN
    RAISE EXCEPTION 'retry assignment requires an eligible current Review';
  END IF;
  IF (NEW."result_attempt_id" IS NULL) <> (NEW."result_observation_id" IS NULL) OR (NEW."result_attempt_id" IS NULL) <> (NEW."result_review_id" IS NULL) THEN
    RAISE EXCEPTION 'retry result lineage must be linked atomically';
  END IF;
  IF NEW."result_attempt_id" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "foundry_product"."learner_attempts" result WHERE result."id" = NEW."result_attempt_id" AND result."task_id" = original_task AND result."episode_id" = original_episode AND result."learner_id" = original_learner) THEN
      RAISE EXCEPTION 'retry result task, episode or learner mismatch';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "foundry_product"."diagnostic_observations" observation WHERE observation."id" = NEW."result_observation_id" AND observation."attempt_id" = NEW."result_attempt_id") THEN
      RAISE EXCEPTION 'retry result observation mismatch';
    END IF;
    SELECT review."decision" INTO result_decision FROM "foundry_product"."teacher_reviews" review WHERE review."id" = NEW."result_review_id" AND review."observation_id" = NEW."result_observation_id";
    SELECT review."id" INTO current_review FROM "foundry_product"."teacher_reviews" review WHERE review."observation_id" = NEW."result_observation_id" ORDER BY review."created_at" DESC, review."id" DESC LIMIT 1;
    IF result_decision IS NULL OR current_review <> NEW."result_review_id" THEN RAISE EXCEPTION 'retry result requires its current Review'; END IF;
    IF (result_decision = 'ESCALATE' AND NEW."status" <> 'ESCALATED') OR (result_decision <> 'ESCALATE' AND NEW."status" <> 'REVIEWED') THEN RAISE EXCEPTION 'retry status does not match Review decision'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "retry_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."retry_attempts" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_retry_lineage"();
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."assert_outcome_lineage"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_institution text; current_review uuid; result_decision text;
BEGIN
  SELECT task."institution_id"::text INTO task_institution FROM "foundry_product"."learning_tasks" task WHERE task."id" = NEW."task_id";
  IF task_institution IS NULL OR task_institution <> NEW."actor_provenance"->>'institutionId' OR NEW."teacher_id"::text <> NEW."actor_provenance"->>'userId' THEN
    RAISE EXCEPTION 'outcome actor or institution mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "foundry_product"."retry_attempts" retry
    JOIN "foundry_product"."learner_attempts" attempt ON attempt."id" = retry."original_attempt_id"
    WHERE retry."id" = NEW."retry_id" AND attempt."task_id" = NEW."task_id" AND retry."result_review_id" = NEW."result_review_id" AND retry."status" = 'REVIEWED'
  ) THEN RAISE EXCEPTION 'outcome retry lineage mismatch'; END IF;
  SELECT review."decision", review."id" INTO result_decision, current_review
  FROM "foundry_product"."teacher_reviews" review
  JOIN "foundry_product"."retry_attempts" retry ON retry."result_observation_id" = review."observation_id"
  WHERE retry."id" = NEW."retry_id" ORDER BY review."created_at" DESC, review."id" DESC LIMIT 1;
  IF current_review <> NEW."result_review_id" OR result_decision = 'ESCALATE' THEN RAISE EXCEPTION 'outcome requires an eligible current result Review'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "outcome_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learning_outcomes" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."assert_outcome_lineage"();
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."reject_component_publication"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'component publication unavailable: real evaluator required';
END $$;
--> statement-breakpoint
CREATE TRIGGER "publication_fail_closed_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."publication_decisions" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."reject_component_publication"();
--> statement-breakpoint
CREATE FUNCTION "foundry_product"."protect_published_component_version"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'published Component versions are immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "published_component_version_immutable_guard" BEFORE UPDATE ON "foundry_product"."component_versions" FOR EACH ROW EXECUTE FUNCTION "foundry_product"."protect_published_component_version"();
