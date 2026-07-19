-- RW-03 package A: additive canonical identity, Context and Evidence foundation.
-- Existing Task/Episode/Attempt/Outcome semantics and legacy query shapes remain intact.

CREATE OR REPLACE FUNCTION "foundry_private"."deterministic_uuid"("seed" text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT (
    substr(value,1,8) || '-' || substr(value,9,4) || '-4' || substr(value,14,3) ||
    '-a' || substr(value,18,3) || '-' || substr(value,21,12)
  )::uuid
  FROM (SELECT md5(seed) AS value) digest
$$;
REVOKE ALL ON FUNCTION "foundry_private"."deterministic_uuid"(text) FROM PUBLIC;
--> statement-breakpoint

-- Fail closed before canonizing inconsistent legacy scope. The migration does
-- not choose a convenient tenant/course/type when historical rows disagree.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM foundry_product.learning_tasks task
    LEFT JOIN foundry_product.courses course ON course.id=task.course_id AND course.institution_id=task.institution_id
    LEFT JOIN foundry_product.institution_memberships membership ON membership.user_id=task.learner_id AND membership.institution_id=task.institution_id
    WHERE course.id IS NULL OR membership.user_id IS NULL
  ) THEN RAISE EXCEPTION 'RW-03 preflight: LearningTask course or learner membership scope is inconsistent' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT source.institution_id,source.source_key FROM foundry_product.source_records source
    GROUP BY source.institution_id,source.source_key
    HAVING cardinality(array_agg(DISTINCT coalesce(source.course_id::text,'NULL')))<>1
       OR cardinality(array_agg(DISTINCT source.source_type))<>1
  ) THEN RAISE EXCEPTION 'RW-03 preflight: SourceRecord stable identity has conflicting course or source type' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM foundry_product.file_assets file JOIN foundry_product.source_records source ON source.id=file.source_id
    WHERE source.institution_id IS DISTINCT FROM file.institution_id
       OR source.course_id IS DISTINCT FROM file.course_id
       OR source.content_hash<>file.content_hash
  ) THEN RAISE EXCEPTION 'RW-03 preflight: FileAsset and SourceRecord scope/hash disagree' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT file.source_id FROM foundry_product.file_assets file WHERE file.source_id IS NOT NULL
    GROUP BY file.source_id HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'RW-03 preflight: multiple FileAssets for one SourceRecord are ambiguous' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM foundry_product.evidence_units evidence JOIN foundry_product.source_records source ON source.id=evidence.source_id
    WHERE NOT ((evidence.institution_id IS NULL AND source.institution_id IS NULL) OR evidence.institution_id=source.institution_id)
  ) THEN RAISE EXCEPTION 'RW-03 preflight: EvidenceUnit and SourceRecord scope disagree' USING ERRCODE='23514'; END IF;
END $$;
--> statement-breakpoint

CREATE TABLE "foundry_product"."learner_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "learner_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id") ON DELETE CASCADE,
  "created_by" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "learner_profiles_institution_learner_uq" ON "foundry_product"."learner_profiles" ("institution_id","learner_id");
--> statement-breakpoint

INSERT INTO "foundry_product"."learner_profiles" ("id","institution_id","learner_id","created_by","created_at")
SELECT "foundry_private"."deterministic_uuid"('learner-profile|' || membership."institution_id"::text || '|' || membership."user_id"::text),
       membership."institution_id", membership."user_id", membership."user_id", min(membership."created_at")
FROM "foundry_product"."institution_memberships" membership
WHERE membership."role" = 'LEARNER'
GROUP BY membership."institution_id", membership."user_id"
ON CONFLICT ("institution_id","learner_id") DO NOTHING;

INSERT INTO "foundry_product"."learner_profiles" ("id","institution_id","learner_id","created_by","created_at")
SELECT "foundry_private"."deterministic_uuid"('learner-profile|' || task."institution_id"::text || '|' || task."learner_id"::text),
       task."institution_id", task."learner_id", task."learner_id", min(task."created_at")
FROM "foundry_product"."learning_tasks" task
GROUP BY task."institution_id", task."learner_id"
ON CONFLICT ("institution_id","learner_id") DO NOTHING;

ALTER TABLE "foundry_product"."learning_tasks" ADD COLUMN "learner_profile_id" uuid;
UPDATE "foundry_product"."learning_tasks" task SET "learner_profile_id" = profile."id"
FROM "foundry_product"."learner_profiles" profile
WHERE profile."institution_id"=task."institution_id" AND profile."learner_id"=task."learner_id";
ALTER TABLE "foundry_product"."learning_tasks" ALTER COLUMN "learner_profile_id" SET NOT NULL;
ALTER TABLE "foundry_product"."learning_tasks" ALTER COLUMN "learner_profile_id" SET DEFAULT NULL;
ALTER TABLE "foundry_product"."learning_tasks" ADD CONSTRAINT "learning_tasks_learner_profile_id_fkey"
  FOREIGN KEY ("learner_profile_id") REFERENCES "foundry_product"."learner_profiles"("id");
--> statement-breakpoint

CREATE TABLE "foundry_product"."learner_strategy_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "learner_profile_id" uuid NOT NULL REFERENCES "foundry_product"."learner_profiles"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "strategy" jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "rule_version" text NOT NULL,
  "confidence" real,
  "review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
  "source_record_id" uuid REFERENCES "foundry_product"."source_records"("id"),
  "actor_user_id" uuid NOT NULL REFERENCES "foundry_product"."users"("id"),
  "effective_from" timestamp with time zone NOT NULL,
  "effective_until" timestamp with time zone,
  "invalidated_at" timestamp with time zone,
  "invalidation_reason" text,
  "supersedes_version_id" uuid REFERENCES "foundry_product"."learner_strategy_versions"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "learner_strategy_status_ck" CHECK ("status" IN ('ACTIVE','STALE','SUPERSEDED','INVALIDATED')),
  CONSTRAINT "learner_strategy_confidence_ck" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "learner_strategy_interval_ck" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
  CONSTRAINT "learner_strategy_provenance_ck" CHECK (jsonb_typeof("provenance")='object' AND "provenance"<>'{}'::jsonb),
  CONSTRAINT "learner_strategy_predecessor_ck" CHECK ("supersedes_version_id" IS NULL OR "supersedes_version_id"<>"id")
);
CREATE INDEX "learner_strategy_profile_kind_idx" ON "foundry_product"."learner_strategy_versions" ("learner_profile_id","kind","effective_from");
--> statement-breakpoint

CREATE TABLE "foundry_product"."source_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "course_id" uuid REFERENCES "foundry_product"."courses"("id"),
  "stable_key" text NOT NULL,
  "source_type" text NOT NULL,
  "original_language" text,
  "owner_user_id" uuid REFERENCES "foundry_product"."users"("id"),
  "created_by" uuid REFERENCES "foundry_product"."users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "foundry_product"."source_assets" ADD CONSTRAINT "source_assets_scope_key_uq" UNIQUE NULLS NOT DISTINCT ("institution_id","stable_key");
--> statement-breakpoint

CREATE TABLE "foundry_product"."source_asset_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_asset_id" uuid NOT NULL REFERENCES "foundry_product"."source_assets"("id") ON DELETE CASCADE,
  "institution_id" uuid REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "version_key" text NOT NULL,
  "content_hash" text NOT NULL,
  "storage_key" text,
  "stable_locator" text,
  "media_type" text,
  "byte_size" integer,
  "provenance" jsonb NOT NULL,
  "rights_basis" text NOT NULL,
  "rights_status" text NOT NULL,
  "access_scope" text NOT NULL,
  "effective_from" timestamp with time zone,
  "effective_until" timestamp with time zone,
  "supersedes_version_id" uuid REFERENCES "foundry_product"."source_asset_versions"("id"),
  "created_by" uuid REFERENCES "foundry_product"."users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "source_asset_version_locator_ck" CHECK ("storage_key" IS NOT NULL OR "stable_locator" IS NOT NULL),
  CONSTRAINT "source_asset_version_size_ck" CHECK ("byte_size" IS NULL OR "byte_size" > 0),
  CONSTRAINT "source_asset_version_interval_ck" CHECK ("effective_until" IS NULL OR "effective_from" IS NULL OR "effective_until" > "effective_from"),
  CONSTRAINT "source_asset_version_provenance_ck" CHECK (jsonb_typeof("provenance")='object' AND "provenance"<>'{}'::jsonb),
  CONSTRAINT "source_asset_version_predecessor_ck" CHECK ("supersedes_version_id" IS NULL OR "supersedes_version_id"<>"id")
);
CREATE UNIQUE INDEX "source_asset_versions_asset_version_uq" ON "foundry_product"."source_asset_versions" ("source_asset_id","version_key");
--> statement-breakpoint

INSERT INTO "foundry_product"."source_assets" ("id","institution_id","course_id","stable_key","source_type","created_at")
SELECT "foundry_private"."deterministic_uuid"('source-asset|' || coalesce(source."institution_id"::text,'GLOBAL') || '|' || source."source_key"),
       source."institution_id", (array_agg(source."course_id" ORDER BY source."course_id"))[1], source."source_key", min(source."source_type"), min(source."created_at")
FROM "foundry_product"."source_records" source
GROUP BY source."institution_id", source."source_key"
ON CONFLICT ("institution_id","stable_key") DO NOTHING;

INSERT INTO "foundry_product"."source_asset_versions"
  ("id","source_asset_id","institution_id","version_key","content_hash","storage_key","stable_locator","media_type","byte_size","provenance","rights_basis","rights_status","access_scope","created_at")
SELECT source."id", asset."id", source."institution_id", source."version", source."content_hash",
       file."storage_key", 'source-record:' || source."id"::text, file."media_type", file."byte_size",
       jsonb_build_object('compatibilitySource','source_records','sourceRecordId',source."id"::text,'authority',source."authority"),
       source."rights", source."rights_authorization_status", source."distribution_scope", source."created_at"
FROM "foundry_product"."source_records" source
JOIN "foundry_product"."source_assets" asset
  ON asset."institution_id" IS NOT DISTINCT FROM source."institution_id" AND asset."stable_key"=source."source_key"
LEFT JOIN "foundry_product"."file_assets" file ON file."source_id"=source."id"
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "foundry_product"."source_records" ADD COLUMN "source_asset_id" uuid;
ALTER TABLE "foundry_product"."source_records" ADD COLUMN "source_asset_version_id" uuid;
UPDATE "foundry_product"."source_records" source
SET "source_asset_id"=version."source_asset_id", "source_asset_version_id"=version."id"
FROM "foundry_product"."source_asset_versions" version WHERE version."id"=source."id";
ALTER TABLE "foundry_product"."source_records" ALTER COLUMN "source_asset_id" SET NOT NULL;
ALTER TABLE "foundry_product"."source_records" ALTER COLUMN "source_asset_version_id" SET NOT NULL;
ALTER TABLE "foundry_product"."source_records" ALTER COLUMN "source_asset_id" SET DEFAULT NULL;
ALTER TABLE "foundry_product"."source_records" ALTER COLUMN "source_asset_version_id" SET DEFAULT NULL;
ALTER TABLE "foundry_product"."source_records" ADD CONSTRAINT "source_records_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "foundry_product"."source_assets"("id");
ALTER TABLE "foundry_product"."source_records" ADD CONSTRAINT "source_records_source_asset_version_id_fkey" FOREIGN KEY ("source_asset_version_id") REFERENCES "foundry_product"."source_asset_versions"("id");
CREATE UNIQUE INDEX "source_records_asset_version_uq" ON "foundry_product"."source_records" ("source_asset_version_id");
--> statement-breakpoint

-- Files without a legacy SourceRecord (learner-attempt uploads) still receive a stable
-- canonical source and immutable version; their existing FileAsset identity is preserved.
INSERT INTO "foundry_product"."source_assets"
  ("id","institution_id","course_id","stable_key","source_type","owner_user_id","created_by","created_at")
SELECT "foundry_private"."deterministic_uuid"('file-source-asset|' || file."id"::text),
       file."institution_id", file."course_id", 'file:' || file."id"::text,
       CASE WHEN file."purpose"='LEARNER_ATTEMPT' THEN 'LEARNER_SUBMISSION' ELSE 'UPLOADED_FILE' END,
       file."owner_user_id", file."owner_user_id", file."created_at"
FROM "foundry_product"."file_assets" file WHERE file."source_id" IS NULL
ON CONFLICT ("institution_id","stable_key") DO NOTHING;

INSERT INTO "foundry_product"."source_asset_versions"
  ("id","source_asset_id","institution_id","version_key","content_hash","storage_key","media_type","byte_size","provenance","rights_basis","rights_status","access_scope","created_by","created_at")
SELECT "foundry_private"."deterministic_uuid"('file-source-version|' || file."id"::text), asset."id", file."institution_id",
       file."content_hash", file."content_hash", file."storage_key", file."media_type", file."byte_size",
       jsonb_build_object('compatibilitySource','file_assets','fileAssetId',file."id"::text),
       CASE WHEN file."purpose"='LEARNER_ATTEMPT' THEN 'LEARNER_SUBMISSION' ELSE 'LEGACY_UPLOAD' END,
       CASE WHEN file."purpose"='LEARNER_ATTEMPT' THEN 'RESTRICTED' ELSE 'REVIEW_REQUIRED' END,
       'INSTITUTION', file."owner_user_id", file."created_at"
FROM "foundry_product"."file_assets" file
JOIN "foundry_product"."source_assets" asset ON asset."stable_key"='file:' || file."id"::text AND asset."institution_id"=file."institution_id"
WHERE file."source_id" IS NULL
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "foundry_product"."file_assets" ADD COLUMN "source_asset_id" uuid;
ALTER TABLE "foundry_product"."file_assets" ADD COLUMN "source_asset_version_id" uuid;
UPDATE "foundry_product"."file_assets" file SET
  "source_asset_id"=source."source_asset_id", "source_asset_version_id"=source."source_asset_version_id"
FROM "foundry_product"."source_records" source WHERE source."id"=file."source_id";
UPDATE "foundry_product"."file_assets" file SET
  "source_asset_id"=version."source_asset_id", "source_asset_version_id"=version."id"
FROM "foundry_product"."source_asset_versions" version
WHERE file."source_id" IS NULL AND version."id"="foundry_private"."deterministic_uuid"('file-source-version|' || file."id"::text);
ALTER TABLE "foundry_product"."file_assets" ALTER COLUMN "source_asset_id" SET NOT NULL;
ALTER TABLE "foundry_product"."file_assets" ALTER COLUMN "source_asset_version_id" SET NOT NULL;
ALTER TABLE "foundry_product"."file_assets" ALTER COLUMN "source_asset_id" SET DEFAULT NULL;
ALTER TABLE "foundry_product"."file_assets" ALTER COLUMN "source_asset_version_id" SET DEFAULT NULL;
ALTER TABLE "foundry_product"."file_assets" ADD CONSTRAINT "file_assets_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "foundry_product"."source_assets"("id");
ALTER TABLE "foundry_product"."file_assets" ADD CONSTRAINT "file_assets_source_asset_version_id_fkey" FOREIGN KEY ("source_asset_version_id") REFERENCES "foundry_product"."source_asset_versions"("id");
--> statement-breakpoint

ALTER TABLE "foundry_product"."evidence_units" ADD COLUMN "source_asset_version_id" uuid;
UPDATE "foundry_product"."evidence_units" evidence
SET "source_asset_version_id"=source."source_asset_version_id"
FROM "foundry_product"."source_records" source WHERE source."id"=evidence."source_id";
ALTER TABLE "foundry_product"."evidence_units" ALTER COLUMN "source_asset_version_id" SET NOT NULL;
ALTER TABLE "foundry_product"."evidence_units" ALTER COLUMN "source_asset_version_id" SET DEFAULT NULL;
ALTER TABLE "foundry_product"."evidence_units" ADD CONSTRAINT "evidence_units_source_asset_version_id_fkey" FOREIGN KEY ("source_asset_version_id") REFERENCES "foundry_product"."source_asset_versions"("id");
--> statement-breakpoint

CREATE TABLE "foundry_product"."source_processing_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "source_asset_version_id" uuid NOT NULL REFERENCES "foundry_product"."source_asset_versions"("id") ON DELETE CASCADE,
  "file_asset_id" uuid REFERENCES "foundry_product"."file_assets"("id"),
  "operation" text NOT NULL,
  "processor" text NOT NULL,
  "processor_version" text NOT NULL,
  "status" text NOT NULL,
  "failure_code" text,
  "failure_message" text,
  "retry_of_attempt_id" uuid REFERENCES "foundry_product"."source_processing_attempts"("id"),
  "actor_user_id" uuid REFERENCES "foundry_product"."users"("id"),
  "idempotency_key" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  CONSTRAINT "source_processing_attempt_status_ck" CHECK ("status" IN ('STARTED','SUCCEEDED','FAILED','CANCELLED')),
  CONSTRAINT "source_processing_attempt_terminal_ck" CHECK (("status"='STARTED' AND "finished_at" IS NULL) OR ("status"<>'STARTED' AND "finished_at" IS NOT NULL)),
  CONSTRAINT "source_processing_attempt_failure_ck" CHECK ("status"<>'SUCCEEDED' OR ("failure_code" IS NULL AND "failure_message" IS NULL)),
  CONSTRAINT "source_processing_attempt_retry_ck" CHECK ("retry_of_attempt_id" IS NULL OR "retry_of_attempt_id"<>"id")
);
ALTER TABLE "foundry_product"."source_processing_attempts" ADD CONSTRAINT "source_processing_attempt_idempotency_uq" UNIQUE NULLS NOT DISTINCT ("institution_id","operation","idempotency_key");
CREATE UNIQUE INDEX "source_processing_attempt_active_file_uq" ON "foundry_product"."source_processing_attempts" ("file_asset_id","operation") WHERE "status"='STARTED' AND "file_asset_id" IS NOT NULL;
CREATE INDEX "source_processing_attempt_version_idx" ON "foundry_product"."source_processing_attempts" ("source_asset_version_id","started_at");

INSERT INTO "foundry_product"."source_processing_attempts"
  ("id","institution_id","source_asset_version_id","file_asset_id","operation","processor","processor_version","status","failure_code","failure_message","actor_user_id","idempotency_key","started_at","finished_at")
SELECT "foundry_private"."deterministic_uuid"('legacy-processing-attempt|' || file."id"::text), file."institution_id",
       file."source_asset_version_id", file."id", 'LEGACY_INTAKE', 'LEGACY_FILE_ASSET', 'rw02',
       CASE WHEN file."ingestion_status" IN ('FAILED','PROVIDER_UNAVAILABLE') OR file."failure_code" IS NOT NULL THEN 'FAILED' ELSE 'SUCCEEDED' END,
       file."failure_code", file."failure_message", file."owner_user_id", 'legacy:' || file."id"::text, file."created_at", file."updated_at"
FROM "foundry_product"."file_assets" file
ON CONFLICT ("institution_id","operation","idempotency_key") DO NOTHING;
--> statement-breakpoint

CREATE TABLE "foundry_product"."evidence_derivatives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "source_asset_version_id" uuid NOT NULL REFERENCES "foundry_product"."source_asset_versions"("id") ON DELETE CASCADE,
  "evidence_unit_id" uuid REFERENCES "foundry_product"."evidence_units"("id"),
  "derivative_type" text NOT NULL,
  "locator" text NOT NULL,
  "content_hash" text NOT NULL,
  "processor" text NOT NULL,
  "processor_version" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
  "state" text DEFAULT 'ACTIVE' NOT NULL,
  "invalidated_at" timestamp with time zone,
  "invalidation_reason" text,
  "successor_id" uuid REFERENCES "foundry_product"."evidence_derivatives"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "evidence_derivative_state_ck" CHECK ("state" IN ('ACTIVE','STALE','SUPERSEDED','INVALIDATED')),
  CONSTRAINT "evidence_derivative_provenance_ck" CHECK (jsonb_typeof("provenance")='object' AND "provenance"<>'{}'::jsonb),
  CONSTRAINT "evidence_derivative_successor_ck" CHECK ("successor_id" IS NULL OR "successor_id"<>"id")
);
CREATE UNIQUE INDEX "evidence_derivative_lineage_uq" ON "foundry_product"."evidence_derivatives" ("source_asset_version_id","derivative_type","locator","content_hash");
CREATE UNIQUE INDEX "evidence_derivative_unit_uq" ON "foundry_product"."evidence_derivatives" ("evidence_unit_id");

INSERT INTO "foundry_product"."evidence_derivatives"
  ("id","institution_id","source_asset_version_id","evidence_unit_id","derivative_type","locator","content_hash","processor","processor_version","provenance","review_status","created_at")
SELECT "foundry_private"."deterministic_uuid"('evidence-derivative|' || evidence."id"::text), evidence."institution_id",
       evidence."source_asset_version_id", evidence."id", evidence."modality", evidence."locator", evidence."content_hash",
       'LEGACY_EVIDENCE_UNIT', 'rw02', jsonb_build_object('compatibilitySource','evidence_units','evidenceUnitId',evidence."id"::text),
       'LEGACY_UNREVIEWED', evidence."created_at"
FROM "foundry_product"."evidence_units" evidence
ON CONFLICT ("evidence_unit_id") DO NOTHING;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM foundry_product.learning_tasks task LEFT JOIN foundry_product.learner_profiles profile ON profile.id=task.learner_profile_id AND profile.institution_id=task.institution_id AND profile.learner_id=task.learner_id WHERE profile.id IS NULL)
    THEN RAISE EXCEPTION 'RW-03 backfill: LearningTask canonical profile link is incomplete' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM foundry_product.source_records source
    LEFT JOIN foundry_product.source_assets asset ON asset.id=source.source_asset_id
    LEFT JOIN foundry_product.source_asset_versions version ON version.id=source.source_asset_version_id AND version.source_asset_id=asset.id
    WHERE asset.id IS NULL OR version.id IS NULL OR asset.institution_id IS DISTINCT FROM source.institution_id
      OR asset.course_id IS DISTINCT FROM source.course_id OR asset.stable_key<>source.source_key OR asset.source_type<>source.source_type
      OR version.institution_id IS DISTINCT FROM source.institution_id OR version.content_hash<>source.content_hash
      OR version.rights_basis<>source.rights OR version.rights_status<>source.rights_authorization_status OR version.access_scope<>source.distribution_scope
  ) THEN RAISE EXCEPTION 'RW-03 backfill: SourceRecord canonical asset/version link is incomplete' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM foundry_product.file_assets file
    LEFT JOIN foundry_product.source_assets asset ON asset.id=file.source_asset_id
    LEFT JOIN foundry_product.source_asset_versions version ON version.id=file.source_asset_version_id AND version.source_asset_id=asset.id
    LEFT JOIN foundry_product.source_records source ON source.id=file.source_id
    WHERE asset.id IS NULL OR version.id IS NULL OR asset.institution_id<>file.institution_id OR asset.course_id IS DISTINCT FROM file.course_id
      OR version.institution_id<>file.institution_id OR version.content_hash<>file.content_hash
      OR version.storage_key IS DISTINCT FROM file.storage_key OR version.media_type IS DISTINCT FROM file.media_type OR version.byte_size IS DISTINCT FROM file.byte_size
      OR (source.id IS NOT NULL AND (source.source_asset_id<>file.source_asset_id OR source.source_asset_version_id<>file.source_asset_version_id))
  ) THEN RAISE EXCEPTION 'RW-03 backfill: FileAsset canonical source/version link is incomplete' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM foundry_product.evidence_units evidence
    LEFT JOIN foundry_product.source_records source ON source.id=evidence.source_id
    LEFT JOIN foundry_product.source_asset_versions version ON version.id=evidence.source_asset_version_id
    LEFT JOIN foundry_product.evidence_derivatives derivative ON derivative.evidence_unit_id=evidence.id
    WHERE source.id IS NULL OR version.id IS NULL OR source.source_asset_version_id<>evidence.source_asset_version_id
      OR derivative.id IS NULL OR derivative.source_asset_version_id<>evidence.source_asset_version_id OR derivative.locator<>evidence.locator
  ) THEN RAISE EXCEPTION 'RW-03 backfill: EvidenceUnit canonical version/derivative link is incomplete' USING ERRCODE='23514'; END IF;
END $$;
--> statement-breakpoint

CREATE TABLE "foundry_product"."context_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "learner_profile_id" uuid NOT NULL REFERENCES "foundry_product"."learner_profiles"("id") ON DELETE CASCADE,
  "course_id" uuid NOT NULL REFERENCES "foundry_product"."courses"("id"),
  "task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE CASCADE,
  "episode_id" uuid REFERENCES "foundry_product"."learning_episodes"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "scope" text NOT NULL,
  "state" text DEFAULT 'ACTIVE' NOT NULL,
  "payload" jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "rule_version" text NOT NULL,
  "confidence" real,
  "review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
  "source_record_id" uuid REFERENCES "foundry_product"."source_records"("id"),
  "source_asset_version_id" uuid REFERENCES "foundry_product"."source_asset_versions"("id"),
  "evidence_unit_id" uuid REFERENCES "foundry_product"."evidence_units"("id"),
  "evidence_derivative_id" uuid REFERENCES "foundry_product"."evidence_derivatives"("id"),
  "actor_user_id" uuid REFERENCES "foundry_product"."users"("id"),
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_until" timestamp with time zone,
  "invalidated_at" timestamp with time zone,
  "invalidation_reason" text,
  "successor_id" uuid REFERENCES "foundry_product"."context_items"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "context_item_scope_ck" CHECK ("scope" IN ('PROFILE','WORKSPACE','TASK','EPISODE')),
  CONSTRAINT "context_item_state_ck" CHECK ("state" IN ('ACTIVE','STALE','SUPERSEDED','PROMOTED','INVALIDATED')),
  CONSTRAINT "context_item_interval_ck" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  CONSTRAINT "context_item_confidence_ck" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "context_item_episode_scope_ck" CHECK ("scope"<>'EPISODE' OR "episode_id" IS NOT NULL),
  CONSTRAINT "context_item_provenance_ck" CHECK (jsonb_typeof("provenance")='object' AND "provenance"<>'{}'::jsonb),
  CONSTRAINT "context_item_successor_ck" CHECK ("successor_id" IS NULL OR "successor_id"<>"id")
);
CREATE INDEX "context_items_task_episode_idx" ON "foundry_product"."context_items" ("task_id","episode_id","state");
--> statement-breakpoint

CREATE TABLE "foundry_product"."context_carryover_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "foundry_product"."institutions"("id") ON DELETE CASCADE,
  "source_task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE CASCADE,
  "source_context_item_id" uuid NOT NULL REFERENCES "foundry_product"."context_items"("id") ON DELETE CASCADE,
  "target_task_id" uuid NOT NULL REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE CASCADE,
  "relation_type" text NOT NULL,
  "actor_user_id" uuid REFERENCES "foundry_product"."users"("id"),
  "policy_key" text,
  "policy_version" text,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "context_carryover_type_ck" CHECK ("relation_type" IN ('EXPLICIT_REFERENCE','LINKED_RETRY','LINKED_TRANSFER','LINKED_RETENTION','PROMOTED_ARTIFACT','TEACHER_ASSIGNMENT','CURRICULUM_CONTINUITY')),
  CONSTRAINT "context_carryover_cross_task_ck" CHECK ("source_task_id"<>"target_task_id"),
  CONSTRAINT "context_carryover_authority_ck" CHECK ("actor_user_id" IS NOT NULL OR ("policy_key" IS NOT NULL AND "policy_version" IS NOT NULL))
);
CREATE UNIQUE INDEX "context_carryover_exact_uq" ON "foundry_product"."context_carryover_relations" ("source_context_item_id","target_task_id","relation_type");
--> statement-breakpoint

-- Small compatibility adapter: existing Task/source/upload/Evidence insert shapes
-- receive canonical links before the new NOT NULL constraints are evaluated.
CREATE OR REPLACE FUNCTION "foundry_private"."rw03_compatibility_adapter"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE canonical_asset_id uuid; canonical_version_id uuid; profile_id uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'learning_tasks' THEN
      SELECT p.id INTO profile_id FROM foundry_product.learner_profiles p
      WHERE p.institution_id=NEW.institution_id AND p.learner_id=NEW.learner_id;
      IF profile_id IS NULL THEN
        profile_id := foundry_private.deterministic_uuid('learner-profile|' || NEW.institution_id::text || '|' || NEW.learner_id::text);
        INSERT INTO foundry_product.learner_profiles (id,institution_id,learner_id,created_by)
        VALUES (profile_id,NEW.institution_id,NEW.learner_id,NEW.learner_id)
        ON CONFLICT (institution_id,learner_id) DO UPDATE SET learner_id=EXCLUDED.learner_id RETURNING id INTO profile_id;
      END IF;
      NEW.learner_profile_id := COALESCE(NEW.learner_profile_id,profile_id);
    WHEN 'source_records' THEN
      canonical_asset_id := COALESCE(NEW.source_asset_id, foundry_private.deterministic_uuid('source-asset|' || coalesce(NEW.institution_id::text,'GLOBAL') || '|' || NEW.source_key));
      canonical_version_id := COALESCE(NEW.source_asset_version_id, NEW.id);
      INSERT INTO foundry_product.source_assets (id,institution_id,course_id,stable_key,source_type,created_at)
      VALUES (canonical_asset_id,NEW.institution_id,NEW.course_id,NEW.source_key,NEW.source_type,NEW.created_at)
      ON CONFLICT (institution_id,stable_key) DO NOTHING;
      SELECT asset.id INTO canonical_asset_id FROM foundry_product.source_assets asset
      WHERE asset.institution_id IS NOT DISTINCT FROM NEW.institution_id AND asset.stable_key=NEW.source_key;
      INSERT INTO foundry_product.source_asset_versions
        (id,source_asset_id,institution_id,version_key,content_hash,stable_locator,provenance,rights_basis,rights_status,access_scope,created_at)
      VALUES (canonical_version_id,canonical_asset_id,NEW.institution_id,NEW.version,NEW.content_hash,'source-record:'||NEW.id::text,
        jsonb_build_object('compatibilitySource','source_records','sourceRecordId',NEW.id::text,'authority',NEW.authority),
        NEW.rights,NEW.rights_authorization_status,NEW.distribution_scope,NEW.created_at)
      ON CONFLICT (source_asset_id,version_key) DO NOTHING;
      SELECT version.id INTO canonical_version_id FROM foundry_product.source_asset_versions version
      WHERE version.source_asset_id=canonical_asset_id AND version.version_key=NEW.version;
      NEW.source_asset_id := canonical_asset_id; NEW.source_asset_version_id := canonical_version_id;
    WHEN 'file_assets' THEN
      IF NEW.source_id IS NOT NULL THEN
        SELECT s.source_asset_id,s.source_asset_version_id INTO canonical_asset_id,canonical_version_id
        FROM foundry_product.source_records s WHERE s.id=NEW.source_id;
        UPDATE foundry_product.source_asset_versions version SET
          storage_key=COALESCE(version.storage_key,NEW.storage_key),
          media_type=COALESCE(version.media_type,NEW.media_type),
          byte_size=COALESCE(version.byte_size,NEW.byte_size)
        WHERE version.id=canonical_version_id AND version.content_hash=NEW.content_hash
          AND (version.storage_key IS NULL OR version.storage_key=NEW.storage_key)
          AND (version.media_type IS NULL OR version.media_type=NEW.media_type)
          AND (version.byte_size IS NULL OR version.byte_size=NEW.byte_size);
        IF NOT FOUND THEN RAISE EXCEPTION 'FileAsset cannot initialize an inconsistent SourceAssetVersion' USING ERRCODE='23514'; END IF;
      ELSE
        canonical_asset_id := COALESCE(NEW.source_asset_id, foundry_private.deterministic_uuid('file-source-asset|' || NEW.id::text));
        canonical_version_id := COALESCE(NEW.source_asset_version_id, foundry_private.deterministic_uuid('file-source-version|' || NEW.id::text));
        INSERT INTO foundry_product.source_assets (id,institution_id,course_id,stable_key,source_type,owner_user_id,created_by,created_at)
        VALUES (canonical_asset_id,NEW.institution_id,NEW.course_id,'file:'||NEW.id::text,
          CASE WHEN NEW.purpose='LEARNER_ATTEMPT' THEN 'LEARNER_SUBMISSION' ELSE 'UPLOADED_FILE' END,
          NEW.owner_user_id,NEW.owner_user_id,NEW.created_at)
        ON CONFLICT (institution_id,stable_key) DO NOTHING;
        SELECT asset.id INTO canonical_asset_id FROM foundry_product.source_assets asset
        WHERE asset.institution_id=NEW.institution_id AND asset.stable_key='file:'||NEW.id::text;
        INSERT INTO foundry_product.source_asset_versions
          (id,source_asset_id,institution_id,version_key,content_hash,storage_key,media_type,byte_size,provenance,rights_basis,rights_status,access_scope,created_by,created_at)
        VALUES (canonical_version_id,canonical_asset_id,NEW.institution_id,NEW.content_hash,NEW.content_hash,NEW.storage_key,NEW.media_type,NEW.byte_size,
          jsonb_build_object('compatibilitySource','file_assets','fileAssetId',NEW.id::text),
          CASE WHEN NEW.purpose='LEARNER_ATTEMPT' THEN 'LEARNER_SUBMISSION' ELSE 'LEGACY_UPLOAD' END,
          CASE WHEN NEW.purpose='LEARNER_ATTEMPT' THEN 'RESTRICTED' ELSE 'REVIEW_REQUIRED' END,
          'INSTITUTION',NEW.owner_user_id,NEW.created_at)
        ON CONFLICT (source_asset_id,version_key) DO NOTHING;
        SELECT version.id INTO canonical_version_id FROM foundry_product.source_asset_versions version
        WHERE version.source_asset_id=canonical_asset_id AND version.version_key=NEW.content_hash;
      END IF;
      NEW.source_asset_id := COALESCE(NEW.source_asset_id,canonical_asset_id);
      NEW.source_asset_version_id := COALESCE(NEW.source_asset_version_id,canonical_version_id);
    WHEN 'evidence_units' THEN
      SELECT s.source_asset_version_id INTO canonical_version_id FROM foundry_product.source_records s WHERE s.id=NEW.source_id;
      NEW.source_asset_version_id := COALESCE(NEW.source_asset_version_id,canonical_version_id);
  END CASE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."rw03_compatibility_adapter"() FROM PUBLIC;

CREATE TRIGGER "_rw03_canonical_compatibility" BEFORE INSERT OR UPDATE OF "institution_id","learner_id","learner_profile_id"
  ON "foundry_product"."learning_tasks" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_compatibility_adapter"();
CREATE TRIGGER "_rw03_canonical_compatibility" BEFORE INSERT
  ON "foundry_product"."source_records" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_compatibility_adapter"();
CREATE TRIGGER "_rw03_canonical_compatibility" BEFORE INSERT
  ON "foundry_product"."file_assets" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_compatibility_adapter"();
CREATE TRIGGER "_rw03_canonical_compatibility" BEFORE INSERT
  ON "foundry_product"."evidence_units" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_compatibility_adapter"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."rw03_evidence_derivative_adapter"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO foundry_product.evidence_derivatives
    (id,institution_id,source_asset_version_id,evidence_unit_id,derivative_type,locator,content_hash,processor,processor_version,provenance,review_status,created_at)
  VALUES (foundry_private.deterministic_uuid('evidence-derivative|'||NEW.id::text),NEW.institution_id,NEW.source_asset_version_id,
    NEW.id,NEW.modality,NEW.locator,NEW.content_hash,'EVIDENCE_COMPATIBILITY_ADAPTER','rw03',
    jsonb_build_object('compatibilitySource','evidence_units','evidenceUnitId',NEW.id::text),'UNREVIEWED',NEW.created_at)
  ON CONFLICT (evidence_unit_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."rw03_evidence_derivative_adapter"() FROM PUBLIC;
CREATE TRIGGER "_rw03_evidence_derivative_compatibility" AFTER INSERT ON "foundry_product"."evidence_units"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_evidence_derivative_adapter"();
--> statement-breakpoint

-- RW-02 authority catalogs remain executable and are extended additively.
INSERT INTO "foundry_private"."table_authority_catalog" ("schema_name","table_name","classification","policy_required") VALUES
('foundry_product','learner_profiles','TENANT_DIRECT_CLASS_A',true),
('foundry_product','learner_strategy_versions','TENANT_DIRECT_CLASS_B',true),
('foundry_product','context_items','TENANT_DIRECT_CLASS_B',true),
('foundry_product','context_carryover_relations','TENANT_DIRECT_CLASS_A',true),
('foundry_product','source_assets','TENANT_OR_GLOBAL_CLASS_A',true),
('foundry_product','source_asset_versions','TENANT_OR_GLOBAL_CLASS_A',true),
('foundry_product','source_processing_attempts','TENANT_OR_GLOBAL_CLASS_C',true),
('foundry_product','evidence_derivatives','TENANT_OR_GLOBAL_CLASS_B',true);

INSERT INTO "foundry_private"."writable_lineage_catalog" ("schema_name","table_name","writable_roles","tenant_references","enforcement") VALUES
('foundry_product','learner_profiles',ARRAY['foundry_product_runtime'],'institution; learner membership; creator membership','FORCED_RLS + _authority_tenant_lineage_guard'),
('foundry_product','learner_strategy_versions',ARRAY['foundry_product_runtime'],'institution; LearnerProfile; actor; optional SourceRecord; predecessor','FORCED_RLS + _authority_tenant_lineage_guard'),
('foundry_product','context_items',ARRAY['foundry_product_runtime'],'institution; profile; course; Task; Episode; exact source/version/Evidence/derivative; actor; successor','FORCED_RLS + _authority_tenant_lineage_guard'),
('foundry_product','context_carryover_relations',ARRAY['foundry_product_runtime'],'institution; source Task/item; target Task/profile; actor or policy','FORCED_RLS + _authority_tenant_lineage_guard'),
('foundry_product','source_assets',ARRAY['foundry_product_runtime'],'institution; optional course/owner/creator; global is read-only','FORCED_RLS + _authority_tenant_lineage_guard'),
('foundry_product','source_asset_versions',ARRAY['foundry_product_runtime'],'SourceAsset; institution; creator; immutable version','FORCED_RLS + _authority_tenant_lineage_guard'),
('foundry_product','source_processing_attempts',ARRAY['foundry_product_runtime'],'SourceAssetVersion; optional FileAsset; retry; actor','FORCED_RLS + _authority_tenant_lineage_guard'),
('foundry_product','evidence_derivatives',ARRAY['foundry_product_runtime'],'SourceAssetVersion; optional EvidenceUnit exact version; successor','FORCED_RLS + _authority_tenant_lineage_guard');
--> statement-breakpoint

REVOKE ALL ON "foundry_product"."learner_profiles", "foundry_product"."learner_strategy_versions",
  "foundry_product"."context_items", "foundry_product"."context_carryover_relations",
  "foundry_product"."source_assets", "foundry_product"."source_asset_versions",
  "foundry_product"."source_processing_attempts", "foundry_product"."evidence_derivatives" FROM PUBLIC;

GRANT SELECT ON "foundry_product"."learner_profiles", "foundry_product"."learner_strategy_versions",
  "foundry_product"."context_items", "foundry_product"."context_carryover_relations",
  "foundry_product"."source_assets", "foundry_product"."source_asset_versions",
  "foundry_product"."source_processing_attempts", "foundry_product"."evidence_derivatives" TO foundry_product_runtime;
GRANT INSERT ON "foundry_product"."learner_profiles", "foundry_product"."learner_strategy_versions",
  "foundry_product"."context_items", "foundry_product"."context_carryover_relations",
  "foundry_product"."source_assets", "foundry_product"."source_asset_versions",
  "foundry_product"."source_processing_attempts", "foundry_product"."evidence_derivatives" TO foundry_product_runtime;
GRANT UPDATE ON "foundry_product"."learner_strategy_versions", "foundry_product"."context_items",
  "foundry_product"."source_processing_attempts", "foundry_product"."evidence_derivatives" TO foundry_product_runtime;

ALTER TABLE "foundry_product"."learner_profiles" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."learner_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."learner_profiles" TO foundry_product_runtime USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."learner_strategy_versions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."learner_strategy_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."learner_strategy_versions" TO foundry_product_runtime USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."context_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."context_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."context_items" TO foundry_product_runtime USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."context_carryover_relations" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."context_carryover_relations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."context_carryover_relations" TO foundry_product_runtime USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."source_assets" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."source_assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_or_global_read" ON "foundry_product"."source_assets" FOR SELECT TO foundry_product_runtime USING ("institution_id" IS NULL OR "institution_id"="foundry_private"."current_institution_id"());
CREATE POLICY "tenant_write" ON "foundry_product"."source_assets" FOR INSERT TO foundry_product_runtime WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."source_asset_versions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."source_asset_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_or_global_read" ON "foundry_product"."source_asset_versions" FOR SELECT TO foundry_product_runtime USING ("institution_id" IS NULL OR "institution_id"="foundry_private"."current_institution_id"());
CREATE POLICY "tenant_write" ON "foundry_product"."source_asset_versions" FOR INSERT TO foundry_product_runtime WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."source_processing_attempts" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."source_processing_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_scope" ON "foundry_product"."source_processing_attempts" TO foundry_product_runtime USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
ALTER TABLE "foundry_product"."evidence_derivatives" ENABLE ROW LEVEL SECURITY; ALTER TABLE "foundry_product"."evidence_derivatives" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_or_global_read" ON "foundry_product"."evidence_derivatives" FOR SELECT TO foundry_product_runtime USING ("institution_id" IS NULL OR "institution_id"="foundry_private"."current_institution_id"());
CREATE POLICY "tenant_write" ON "foundry_product"."evidence_derivatives" TO foundry_product_runtime USING ("institution_id"="foundry_private"."current_institution_id"()) WITH CHECK ("institution_id"="foundry_private"."current_institution_id"());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE row_data jsonb := to_jsonb(NEW); tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
BEGIN
  IF tenant_id IS NULL THEN
    -- Existing owner/migrator behavior remains the explicit RW-02 migration boundary.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_roles r ON r.oid=c.relowner WHERE n.nspname=TG_TABLE_SCHEMA AND c.relname=TG_TABLE_NAME AND r.rolname=session_user)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolsuper) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'RW-03 tenant context is required' USING ERRCODE='42501';
  END IF;
  CASE TG_TABLE_NAME
    WHEN 'learner_profiles' THEN
      IF NEW.institution_id<>tenant_id OR NOT foundry_private.entity_in_tenant('USER',NEW.learner_id,tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',NEW.created_by,tenant_id) THEN RAISE EXCEPTION 'LearnerProfile tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'learner_strategy_versions' THEN
      IF NEW.institution_id<>tenant_id OR NOT EXISTS (SELECT 1 FROM foundry_product.learner_profiles p WHERE p.id=NEW.learner_profile_id AND p.institution_id=tenant_id)
        OR NOT foundry_private.entity_in_tenant('USER',NEW.actor_user_id,tenant_id)
        OR (NEW.source_record_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('SOURCE',NEW.source_record_id,tenant_id))
        OR (NEW.supersedes_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.learner_strategy_versions v WHERE v.id=NEW.supersedes_version_id AND v.learner_profile_id=NEW.learner_profile_id AND v.kind=NEW.kind))
        THEN RAISE EXCEPTION 'LearnerStrategyVersion tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'source_assets' THEN
      IF NEW.institution_id<>tenant_id OR (NEW.course_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('COURSE',NEW.course_id,tenant_id))
        OR (NEW.owner_user_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('USER',NEW.owner_user_id,tenant_id))
        OR (NEW.created_by IS NOT NULL AND NOT foundry_private.entity_in_tenant('USER',NEW.created_by,tenant_id))
        THEN RAISE EXCEPTION 'SourceAsset tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'source_asset_versions' THEN
      IF NEW.institution_id<>tenant_id OR NOT EXISTS (SELECT 1 FROM foundry_product.source_assets a WHERE a.id=NEW.source_asset_id AND a.institution_id=tenant_id)
        OR (NEW.created_by IS NOT NULL AND NOT foundry_private.entity_in_tenant('USER',NEW.created_by,tenant_id))
        OR (NEW.supersedes_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.source_asset_versions prior WHERE prior.id=NEW.supersedes_version_id AND prior.source_asset_id=NEW.source_asset_id))
        THEN RAISE EXCEPTION 'SourceAssetVersion tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'source_processing_attempts' THEN
      IF NEW.institution_id<>tenant_id OR NOT EXISTS (SELECT 1 FROM foundry_product.source_asset_versions v WHERE v.id=NEW.source_asset_version_id AND v.institution_id=tenant_id)
        OR (NEW.file_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.file_assets f WHERE f.id=NEW.file_asset_id AND f.institution_id=tenant_id AND f.source_asset_version_id=NEW.source_asset_version_id))
        OR (NEW.retry_of_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.source_processing_attempts p WHERE p.id=NEW.retry_of_attempt_id AND p.source_asset_version_id=NEW.source_asset_version_id))
        OR (NEW.actor_user_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('USER',NEW.actor_user_id,tenant_id))
        THEN RAISE EXCEPTION 'SourceProcessingAttempt tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'evidence_derivatives' THEN
      IF NEW.institution_id IS DISTINCT FROM tenant_id OR NOT EXISTS (SELECT 1 FROM foundry_product.source_asset_versions v WHERE v.id=NEW.source_asset_version_id AND v.institution_id IS NOT DISTINCT FROM NEW.institution_id)
        OR (NEW.evidence_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.evidence_units e WHERE e.id=NEW.evidence_unit_id AND e.source_asset_version_id=NEW.source_asset_version_id AND e.institution_id IS NOT DISTINCT FROM NEW.institution_id))
        OR (NEW.successor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.evidence_derivatives d WHERE d.id=NEW.successor_id AND d.source_asset_version_id=NEW.source_asset_version_id))
        THEN RAISE EXCEPTION 'EvidenceDerivative tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'context_items' THEN
      IF NEW.institution_id<>tenant_id
        OR NOT EXISTS (SELECT 1 FROM foundry_product.learning_tasks t WHERE t.id=NEW.task_id AND t.institution_id=tenant_id AND t.course_id=NEW.course_id AND t.learner_profile_id=NEW.learner_profile_id)
        OR (NEW.episode_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.learning_episodes e WHERE e.id=NEW.episode_id AND e.task_id=NEW.task_id))
        OR (NEW.source_asset_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.source_asset_versions v WHERE v.id=NEW.source_asset_version_id AND v.institution_id=tenant_id))
        OR (NEW.source_record_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.source_records s WHERE s.id=NEW.source_record_id AND s.source_asset_version_id=NEW.source_asset_version_id))
        OR (NEW.evidence_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.evidence_units e WHERE e.id=NEW.evidence_unit_id AND e.source_asset_version_id=NEW.source_asset_version_id))
        OR (NEW.evidence_derivative_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.evidence_derivatives d WHERE d.id=NEW.evidence_derivative_id AND d.source_asset_version_id=NEW.source_asset_version_id AND (NEW.evidence_unit_id IS NULL OR d.evidence_unit_id=NEW.evidence_unit_id)))
        OR (NEW.actor_user_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('USER',NEW.actor_user_id,tenant_id))
        OR (NEW.successor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.context_items c WHERE c.id=NEW.successor_id AND c.task_id=NEW.task_id))
        THEN RAISE EXCEPTION 'ContextItem tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'context_carryover_relations' THEN
      IF NEW.institution_id<>tenant_id
        OR NOT EXISTS (SELECT 1 FROM foundry_product.context_items c WHERE c.id=NEW.source_context_item_id AND c.task_id=NEW.source_task_id AND c.institution_id=tenant_id)
        OR NOT EXISTS (SELECT 1 FROM foundry_product.context_items c JOIN foundry_product.learning_tasks t ON t.id=NEW.target_task_id WHERE c.id=NEW.source_context_item_id AND t.institution_id=tenant_id AND t.learner_profile_id=c.learner_profile_id)
        OR (NEW.actor_user_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('USER',NEW.actor_user_id,tenant_id))
        THEN RAISE EXCEPTION 'ContextCarryover tenant lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'learning_tasks' THEN
      IF NOT EXISTS (SELECT 1 FROM foundry_product.learner_profiles p WHERE p.id=NEW.learner_profile_id AND p.institution_id=NEW.institution_id AND p.learner_id=NEW.learner_id) THEN RAISE EXCEPTION 'LearningTask LearnerProfile lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'source_records' THEN
      IF NOT EXISTS (
        SELECT 1 FROM foundry_product.source_asset_versions v JOIN foundry_product.source_assets a ON a.id=v.source_asset_id
        WHERE v.id=NEW.source_asset_version_id AND a.id=NEW.source_asset_id
          AND a.institution_id IS NOT DISTINCT FROM NEW.institution_id AND a.course_id IS NOT DISTINCT FROM NEW.course_id
          AND a.stable_key=NEW.source_key AND a.source_type=NEW.source_type
          AND v.institution_id IS NOT DISTINCT FROM NEW.institution_id AND v.content_hash=NEW.content_hash
          AND v.rights_basis=NEW.rights AND v.rights_status=NEW.rights_authorization_status AND v.access_scope=NEW.distribution_scope
      ) THEN RAISE EXCEPTION 'SourceRecord canonical lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'file_assets' THEN
      IF NOT EXISTS (SELECT 1 FROM foundry_product.source_asset_versions v JOIN foundry_product.source_assets a ON a.id=v.source_asset_id WHERE v.id=NEW.source_asset_version_id AND a.id=NEW.source_asset_id AND a.institution_id=NEW.institution_id AND a.course_id IS NOT DISTINCT FROM NEW.course_id AND v.institution_id=NEW.institution_id AND v.content_hash=NEW.content_hash)
        OR (NEW.source_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM foundry_product.source_records s WHERE s.id=NEW.source_id AND s.source_asset_id=NEW.source_asset_id AND s.source_asset_version_id=NEW.source_asset_version_id))
        OR NOT EXISTS (SELECT 1 FROM foundry_product.source_asset_versions v WHERE v.id=NEW.source_asset_version_id AND v.storage_key=NEW.storage_key AND v.content_hash=NEW.content_hash AND v.media_type IS NOT DISTINCT FROM NEW.media_type AND v.byte_size IS NOT DISTINCT FROM NEW.byte_size)
        THEN RAISE EXCEPTION 'FileAsset canonical lineage mismatch' USING ERRCODE='23514'; END IF;
    WHEN 'evidence_units' THEN
      IF NOT EXISTS (SELECT 1 FROM foundry_product.source_records s WHERE s.id=NEW.source_id AND s.source_asset_version_id=NEW.source_asset_version_id) THEN RAISE EXCEPTION 'EvidenceUnit canonical version lineage mismatch' USING ERRCODE='23514'; END IF;
  END CASE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."assert_rw03_canonical_lineage"() FROM PUBLIC;

CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learner_profiles" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learner_strategy_versions" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."context_items" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."context_carryover_relations" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."source_assets" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."source_asset_versions" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."source_processing_attempts" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."evidence_derivatives" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();

CREATE TRIGGER "_rw03_canonical_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learning_tasks" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_rw03_canonical_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."source_records" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_rw03_canonical_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."file_assets" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
CREATE TRIGGER "_rw03_canonical_lineage_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."evidence_units" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."assert_rw03_canonical_lineage"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."rw03_lifecycle_update_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE old_rank integer; new_rank integer;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'learner_strategy_versions' THEN
      IF (to_jsonb(OLD)-'status'-'effective_until'-'invalidated_at'-'invalidation_reason')
        IS DISTINCT FROM (to_jsonb(NEW)-'status'-'effective_until'-'invalidated_at'-'invalidation_reason')
        OR (OLD.status<>'ACTIVE' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW))
        OR NEW.status NOT IN ('ACTIVE','STALE','SUPERSEDED','INVALIDATED')
        OR (OLD.effective_until IS NOT NULL AND NEW.effective_until IS DISTINCT FROM OLD.effective_until)
        OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
        THEN RAISE EXCEPTION 'LearnerStrategyVersion identity/provenance is immutable' USING ERRCODE='23514'; END IF;
    WHEN 'context_items' THEN
      IF (to_jsonb(OLD)-'state'-'valid_until'-'invalidated_at'-'invalidation_reason'-'successor_id')
        IS DISTINCT FROM (to_jsonb(NEW)-'state'-'valid_until'-'invalidated_at'-'invalidation_reason'-'successor_id')
        OR (OLD.valid_until IS NOT NULL AND NEW.valid_until IS DISTINCT FROM OLD.valid_until)
        OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
        THEN RAISE EXCEPTION 'ContextItem identity/provenance/payload is immutable' USING ERRCODE='23514'; END IF;
      old_rank := CASE OLD.state WHEN 'ACTIVE' THEN 0 WHEN 'PROMOTED' THEN 1 WHEN 'STALE' THEN 1 WHEN 'SUPERSEDED' THEN 2 WHEN 'INVALIDATED' THEN 3 END;
      new_rank := CASE NEW.state WHEN 'ACTIVE' THEN 0 WHEN 'PROMOTED' THEN 1 WHEN 'STALE' THEN 1 WHEN 'SUPERSEDED' THEN 2 WHEN 'INVALIDATED' THEN 3 END;
      IF new_rank IS NULL OR new_rank<old_rank THEN RAISE EXCEPTION 'ContextItem lifecycle cannot move backward' USING ERRCODE='23514'; END IF;
    WHEN 'evidence_derivatives' THEN
      IF (to_jsonb(OLD)-'state'-'invalidated_at'-'invalidation_reason'-'successor_id')
        IS DISTINCT FROM (to_jsonb(NEW)-'state'-'invalidated_at'-'invalidation_reason'-'successor_id')
        OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
        THEN RAISE EXCEPTION 'EvidenceDerivative identity/provenance is immutable' USING ERRCODE='23514'; END IF;
      old_rank := CASE OLD.state WHEN 'ACTIVE' THEN 0 WHEN 'STALE' THEN 1 WHEN 'SUPERSEDED' THEN 2 WHEN 'INVALIDATED' THEN 3 END;
      new_rank := CASE NEW.state WHEN 'ACTIVE' THEN 0 WHEN 'STALE' THEN 1 WHEN 'SUPERSEDED' THEN 2 WHEN 'INVALIDATED' THEN 3 END;
      IF new_rank IS NULL OR new_rank<old_rank THEN RAISE EXCEPTION 'EvidenceDerivative lifecycle cannot move backward' USING ERRCODE='23514'; END IF;
    WHEN 'source_processing_attempts' THEN
      IF (to_jsonb(OLD)-'status'-'failure_code'-'failure_message'-'finished_at')
        IS DISTINCT FROM (to_jsonb(NEW)-'status'-'failure_code'-'failure_message'-'finished_at')
        OR (OLD.status<>'STARTED' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW))
        OR NEW.status NOT IN ('STARTED','SUCCEEDED','FAILED','CANCELLED')
        THEN RAISE EXCEPTION 'SourceProcessingAttempt identity/processor lineage is immutable' USING ERRCODE='23514'; END IF;
  END CASE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."rw03_lifecycle_update_guard"() FROM PUBLIC;
CREATE TRIGGER "rw03_lifecycle_update_guard" BEFORE UPDATE ON "foundry_product"."learner_strategy_versions" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_lifecycle_update_guard"();
CREATE TRIGGER "rw03_lifecycle_update_guard" BEFORE UPDATE ON "foundry_product"."context_items" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_lifecycle_update_guard"();
CREATE TRIGGER "rw03_lifecycle_update_guard" BEFORE UPDATE ON "foundry_product"."evidence_derivatives" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_lifecycle_update_guard"();
CREATE TRIGGER "rw03_lifecycle_update_guard" BEFORE UPDATE ON "foundry_product"."source_processing_attempts" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_lifecycle_update_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."rw03_immutable_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  -- Compatibility may attach exact storage metadata once while storage_key is
  -- still NULL. It does not prove transaction co-location; every canonical
  -- identity, hash, rights and already-populated storage field remains fixed.
  IF TG_TABLE_NAME='source_asset_versions' AND TG_OP='UPDATE'
    AND OLD.storage_key IS NULL AND NEW.storage_key IS NOT NULL
    AND (OLD.media_type IS NULL OR OLD.media_type=NEW.media_type)
    AND (OLD.byte_size IS NULL OR OLD.byte_size=NEW.byte_size)
    AND (to_jsonb(OLD)-'storage_key'-'media_type'-'byte_size')=(to_jsonb(NEW)-'storage_key'-'media_type'-'byte_size')
    THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is immutable; append a successor record', TG_TABLE_NAME USING ERRCODE='23514';
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."rw03_immutable_guard"() FROM PUBLIC;
CREATE TRIGGER "source_asset_version_immutable_guard" BEFORE UPDATE ON "foundry_product"."source_asset_versions" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_immutable_guard"();
CREATE TRIGGER "context_carryover_immutable_guard" BEFORE UPDATE ON "foundry_product"."context_carryover_relations" FOR EACH ROW EXECUTE FUNCTION "foundry_private"."rw03_immutable_guard"();
--> statement-breakpoint

-- Rollback boundary: revert application/schema use first, then drop the four compatibility
-- triggers/columns and eight additive tables in reverse dependency order. Original rows are
-- not rewritten or deleted; new canonical-only rows require export before destructive rollback.
