ALTER TABLE "foundry_operational"."workflow_runs" ADD COLUMN "resume_claim_token" text;
--> statement-breakpoint
ALTER TABLE "foundry_operational"."workflow_runs" ADD COLUMN "resume_claim_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "foundry_operational"."workflow_runs" ADD COLUMN "resume_lease_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "foundry_operational"."workflow_runs"
SET "resume_claim_token" = 'legacy:' || "id"::text,
    "resume_lease_expires_at" = COALESCE("resume_claimed_at", "created_at") + interval '5 minutes'
WHERE "status" = 'RESUMING';
--> statement-breakpoint
UPDATE "foundry_operational"."workflow_runs"
SET "resume_claimed_at" = NULL,
    "resume_claim_token" = NULL,
    "resume_lease_expires_at" = NULL
WHERE "status" <> 'RESUMING';
--> statement-breakpoint
ALTER TABLE "foundry_operational"."workflow_runs" ADD CONSTRAINT "workflow_resume_claim_version_ck" CHECK ("resume_claim_version" >= 0);
--> statement-breakpoint
ALTER TABLE "foundry_operational"."workflow_runs" ADD CONSTRAINT "workflow_resume_claim_integrity_ck" CHECK (("status" = 'RESUMING' AND "resume_claimed_at" IS NOT NULL AND "resume_claim_token" IS NOT NULL AND "resume_lease_expires_at" IS NOT NULL) OR ("status" <> 'RESUMING' AND "resume_claimed_at" IS NULL AND "resume_claim_token" IS NULL AND "resume_lease_expires_at" IS NULL));
--> statement-breakpoint
CREATE INDEX "workflow_runs_resume_lease_idx" ON "foundry_operational"."workflow_runs" USING btree ("status", "resume_lease_expires_at");
