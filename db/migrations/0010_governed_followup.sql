-- CAP-06: governed Retry / Transfer / Retention over the existing Task,
-- Episode, Context, Diagnosis, Resolution, ActivityPlan, RuntimeDelivery,
-- LearnerAttempt and TeacherReview authorities. The historical physical
-- retry_attempts table remains the shared execution envelope; typed extension
-- rows preserve Transfer and Retention semantics. No LearningOutcome is made.

ALTER TABLE "foundry_product"."learning_episodes"
  ADD COLUMN "purpose" text DEFAULT 'GENERAL' NOT NULL,
  ADD COLUMN "predecessor_episode_id" uuid,
  ADD COLUMN "waiting_reason" text,
  ADD COLUMN "recovery_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD CONSTRAINT "learning_episodes_predecessor_fk" FOREIGN KEY ("predecessor_episode_id") REFERENCES "foundry_product"."learning_episodes"("id"),
  ADD CONSTRAINT "episode_purpose_ck" CHECK ("purpose" IN ('GENERAL','RETRY','TRANSFER','RETENTION')),
  ADD CONSTRAINT "episode_predecessor_ck" CHECK ("predecessor_episode_id" IS NULL OR "predecessor_episode_id"<>"id"),
  ADD CONSTRAINT "episode_recovery_json_ck" CHECK (jsonb_typeof("recovery_state")='object');
CREATE UNIQUE INDEX "episodes_predecessor_uq" ON "foundry_product"."learning_episodes" ("predecessor_episode_id") WHERE "predecessor_episode_id" IS NOT NULL;
CREATE OR REPLACE FUNCTION "foundry_private"."cap06_episode_identity_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE predecessor_task_id uuid;
BEGIN
  IF TG_OP='INSERT' AND NOT EXISTS (
    SELECT 1 FROM foundry_product.learning_tasks task
    WHERE task.id=NEW.task_id AND task.status='OPEN'
  ) THEN
    RAISE EXCEPTION 'A new Episode requires an OPEN Learning Task' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.purpose='GENERAL' AND EXISTS (
    SELECT 1 FROM foundry_product.retry_attempts activity
    WHERE activity.task_id=NEW.task_id AND activity.idempotency_key IS NOT NULL
      AND activity.status NOT IN ('REVIEWED','ESCALATED','CANCELLED','FAILED_FINAL')
  ) THEN
    RAISE EXCEPTION 'A GENERAL Episode cannot be added while a governed follow-up is active' USING ERRCODE='23514';
  END IF;
  IF NEW.predecessor_episode_id IS NOT NULL THEN
    SELECT episode.task_id INTO predecessor_task_id
    FROM foundry_product.learning_episodes episode WHERE episode.id=NEW.predecessor_episode_id;
    IF predecessor_task_id IS NULL OR predecessor_task_id<>NEW.task_id THEN
      RAISE EXCEPTION 'Governed Episode predecessor must belong to the same Task' USING ERRCODE='23514';
    END IF;
    IF NEW.purpose='GENERAL' THEN
      RAISE EXCEPTION 'A successor Episode requires a governed purpose' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.purpose<>'GENERAL' THEN
    RAISE EXCEPTION 'A governed Episode requires its exact predecessor' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (OLD.task_id,OLD.sequence,OLD.purpose,OLD.predecessor_episode_id)
      IS DISTINCT FROM (NEW.task_id,NEW.sequence,NEW.purpose,NEW.predecessor_episode_id) THEN
      RAISE EXCEPTION 'Episode Task, sequence, purpose and predecessor are immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.purpose='GENERAL' AND OLD.status<>'ACTIVE' AND NEW.status='ACTIVE' THEN
      RAISE EXCEPTION 'A completed GENERAL Episode cannot be reopened' USING ERRCODE='23514';
    END IF;
    IF NEW.purpose='GENERAL' AND NEW.status='ACTIVE' AND EXISTS (
      SELECT 1 FROM foundry_product.retry_attempts activity
      WHERE activity.task_id=NEW.task_id AND activity.idempotency_key IS NOT NULL
        AND activity.status NOT IN ('REVIEWED','ESCALATED','CANCELLED','FAILED_FINAL')
    ) THEN
      RAISE EXCEPTION 'A GENERAL Episode cannot be active while a governed follow-up is active' USING ERRCODE='23514';
    END IF;
    IF OLD.predecessor_episode_id IS NOT NULL AND OLD.status<>NEW.status AND NOT (
      (OLD.status='ACTIVE' AND NEW.status IN ('WAITING_FOR_REVIEW','FAILED','CANCELLED'))
      OR (OLD.status='WAITING_FOR_REVIEW' AND NEW.status IN ('COMPLETED','ESCALATED','FAILED','CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'Governed Episode status transition is not forward-authorized' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_episode_identity_guard"() FROM PUBLIC;
CREATE TRIGGER "cap06_episode_identity_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learning_episodes"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_episode_identity_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_task_close_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.status<>'OPEN' AND NEW.status='OPEN' THEN
    RAISE EXCEPTION 'A terminal Learning Task cannot be reopened' USING ERRCODE='23514';
  END IF;
  IF OLD.status='OPEN' AND NEW.status<>'OPEN' AND EXISTS (
    SELECT 1 FROM foundry_product.retry_attempts activity
    WHERE activity.task_id=OLD.id AND activity.idempotency_key IS NOT NULL
      AND activity.status NOT IN ('REVIEWED','ESCALATED','CANCELLED','FAILED_FINAL')
  ) THEN
    RAISE EXCEPTION 'Learning Task cannot close while a governed follow-up is active' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_task_close_guard"() FROM PUBLIC;
CREATE TRIGGER "cap06_task_close_guard" BEFORE UPDATE ON "foundry_product"."learning_tasks"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_task_close_guard"();

-- Historical RETRY_OUTCOME checkpoints have no safe graph-compatible resume
-- path under CAP-06. Preserve their checkpoint/product evidence, but fail every
-- still-active run closed and require a new governed follow-up assignment.
UPDATE "foundry_operational"."workflow_runs"
SET "status"='FAILED',
    "interrupt_type"=NULL,
    "resume_claimed_at"=NULL,
    "resume_claim_token"=NULL,
    "resume_lease_expires_at"=NULL,
    "failure"='Legacy RETRY_OUTCOME workflow retired; restart under a governed follow-up',
    "completed_at"=COALESCE("completed_at",CURRENT_TIMESTAMP),
    "product_links"="product_links" || jsonb_build_object(
      'failureCode','LEGACY_RETRY_OUTCOME_RETIRED',
      'recoveryAction','RESTART_AS_GOVERNED_FOLLOWUP'
    )
WHERE ("workflow_kind"='RETRY_OUTCOME' OR "interrupt_type"='LEARNER_RETRY_REQUIRED')
  AND "status" NOT IN ('COMPLETED','FAILED','CANCELLED');
--> statement-breakpoint

ALTER TABLE "foundry_product"."retry_attempts"
  DROP CONSTRAINT "retry_activity_ck",
  DROP CONSTRAINT "retry_status_ck",
  ADD COLUMN "institution_id" uuid,
  ADD COLUMN "course_id" uuid,
  ADD COLUMN "task_id" uuid,
  ADD COLUMN "source_episode_id" uuid,
  ADD COLUMN "target_episode_id" uuid,
  ADD COLUMN "learner_id" uuid,
  ADD COLUMN "context_item_id" uuid,
  ADD COLUMN "activity_plan_proposal_id" uuid,
  ADD COLUMN "activity_plan_id" uuid,
  ADD COLUMN "runtime_delivery_id" uuid,
  ADD COLUMN "assigned_at" timestamp with time zone,
  ADD COLUMN "source_lineage" jsonb,
  ADD COLUMN "actor_user_id" uuid,
  ADD COLUMN "actor_provenance" jsonb,
  ADD COLUMN "idempotency_key" text,
  ADD COLUMN "assignment_request_hash" text,
  ADD COLUMN "latest_transition_event_id" uuid,
  ADD COLUMN "cancellation_state" jsonb,
  ADD COLUMN "failure_state" jsonb,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
UPDATE "foundry_product"."retry_attempts" SET "assigned_at"="created_at" WHERE "assigned_at" IS NULL;
ALTER TABLE "foundry_product"."retry_attempts"
  ALTER COLUMN "assigned_at" SET DEFAULT now(),
  ALTER COLUMN "assigned_at" SET NOT NULL,
  ADD CONSTRAINT "retry_attempts_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "foundry_product"."institutions"("id") ON DELETE cascade,
  ADD CONSTRAINT "retry_attempts_course_fk" FOREIGN KEY ("course_id") REFERENCES "foundry_product"."courses"("id"),
  ADD CONSTRAINT "retry_attempts_task_fk" FOREIGN KEY ("task_id") REFERENCES "foundry_product"."learning_tasks"("id") ON DELETE cascade,
  ADD CONSTRAINT "retry_attempts_source_episode_fk" FOREIGN KEY ("source_episode_id") REFERENCES "foundry_product"."learning_episodes"("id"),
  ADD CONSTRAINT "retry_attempts_target_episode_fk" FOREIGN KEY ("target_episode_id") REFERENCES "foundry_product"."learning_episodes"("id"),
  ADD CONSTRAINT "retry_attempts_learner_fk" FOREIGN KEY ("learner_id") REFERENCES "foundry_product"."users"("id"),
  ADD CONSTRAINT "retry_attempts_context_item_fk" FOREIGN KEY ("context_item_id") REFERENCES "foundry_product"."context_items"("id"),
  ADD CONSTRAINT "retry_attempts_plan_proposal_fk" FOREIGN KEY ("activity_plan_proposal_id") REFERENCES "foundry_product"."activity_plan_proposals"("id"),
  ADD CONSTRAINT "retry_attempts_plan_fk" FOREIGN KEY ("activity_plan_id") REFERENCES "foundry_product"."activity_plans"("id"),
  ADD CONSTRAINT "retry_attempts_runtime_delivery_fk" FOREIGN KEY ("runtime_delivery_id") REFERENCES "foundry_product"."runtime_deliveries"("id"),
  ADD CONSTRAINT "retry_attempts_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "foundry_product"."users"("id"),
  ADD CONSTRAINT "retry_attempts_transition_event_fk" FOREIGN KEY ("latest_transition_event_id") REFERENCES "foundry_product"."governance_events"("id"),
  ADD CONSTRAINT "retry_activity_ck" CHECK ("activity_type" IN ('RETRY','TRANSFER','RETENTION')),
  ADD CONSTRAINT "retry_status_ck" CHECK ("status" IN ('ASSIGNED','IN_PROGRESS','WAITING_FOR_REVIEW','REVIEWED','ESCALATED','CANCELLED','FAILED_RECOVERABLE','FAILED_FINAL')),
  ADD CONSTRAINT "governed_followup_json_ck" CHECK (
    ("idempotency_key" IS NULL AND "institution_id" IS NULL AND "course_id" IS NULL AND "task_id" IS NULL
      AND "source_episode_id" IS NULL AND "target_episode_id" IS NULL AND "learner_id" IS NULL
      AND "context_item_id" IS NULL AND "activity_plan_proposal_id" IS NULL AND "activity_plan_id" IS NULL
      AND "runtime_delivery_id" IS NULL AND "source_lineage" IS NULL AND "actor_user_id" IS NULL
      AND "actor_provenance" IS NULL AND "assignment_request_hash" IS NULL AND "latest_transition_event_id" IS NULL
      AND "cancellation_state" IS NULL AND "failure_state" IS NULL)
    OR ("idempotency_key" IS NOT NULL AND "institution_id" IS NOT NULL AND "course_id" IS NOT NULL
      AND "task_id" IS NOT NULL AND "source_episode_id" IS NOT NULL AND "target_episode_id" IS NOT NULL
      AND "learner_id" IS NOT NULL AND "context_item_id" IS NOT NULL AND "actor_user_id" IS NOT NULL
      AND "source_lineage" IS NOT NULL AND jsonb_typeof("source_lineage")='object' AND "source_lineage"<>'{}'::jsonb
      AND "actor_provenance" IS NOT NULL AND jsonb_typeof("actor_provenance")='object'
      AND "assignment_request_hash" IS NOT NULL AND length(btrim("assignment_request_hash"))>7)
  ),
  ADD CONSTRAINT "governed_followup_terminal_fact_ck" CHECK (
    ("status"<>'CANCELLED' OR ("cancellation_state" IS NOT NULL AND jsonb_typeof("cancellation_state")='object'
      AND length(btrim("cancellation_state"->>'actorUserId'))>0 AND length(btrim("cancellation_state"->>'recordedAt'))>0
      AND length(btrim("cancellation_state"->>'reason'))>0 AND jsonb_typeof("cancellation_state"->'externalWorkMayStillFinish')='boolean'))
    AND ("status" NOT IN ('FAILED_RECOVERABLE','FAILED_FINAL') OR ("failure_state" IS NOT NULL AND jsonb_typeof("failure_state")='object'
      AND length(btrim("failure_state"->>'actorUserId'))>0 AND length(btrim("failure_state"->>'recordedAt'))>0
      AND length(btrim("failure_state"->>'reason'))>0 AND jsonb_typeof("failure_state"->'externalWorkMayStillFinish')='boolean'))
  ),
  ADD CONSTRAINT "governed_followup_result_ck" CHECK (
    ("status" IN ('ASSIGNED','IN_PROGRESS','FAILED_RECOVERABLE','FAILED_FINAL','CANCELLED') AND "result_review_id" IS NULL)
    OR ("status"='WAITING_FOR_REVIEW' AND "activity_plan_id" IS NOT NULL AND "runtime_delivery_id" IS NOT NULL
      AND "result_attempt_id" IS NOT NULL AND "result_observation_id" IS NOT NULL AND "result_review_id" IS NULL)
    OR ("status" IN ('REVIEWED','ESCALATED') AND "activity_plan_id" IS NOT NULL AND "runtime_delivery_id" IS NOT NULL
      AND "result_attempt_id" IS NOT NULL AND "result_observation_id" IS NOT NULL AND "result_review_id" IS NOT NULL)
    OR ("idempotency_key" IS NULL AND "status" IN ('ASSIGNED','REVIEWED','ESCALATED'))
  );
CREATE UNIQUE INDEX "governed_followup_target_episode_uq" ON "foundry_product"."retry_attempts" ("target_episode_id") WHERE "target_episode_id" IS NOT NULL;
CREATE UNIQUE INDEX "governed_followup_plan_proposal_uq" ON "foundry_product"."retry_attempts" ("activity_plan_proposal_id") WHERE "activity_plan_proposal_id" IS NOT NULL;
CREATE UNIQUE INDEX "governed_followup_plan_uq" ON "foundry_product"."retry_attempts" ("activity_plan_id") WHERE "activity_plan_id" IS NOT NULL;
CREATE UNIQUE INDEX "governed_followup_delivery_uq" ON "foundry_product"."retry_attempts" ("runtime_delivery_id") WHERE "runtime_delivery_id" IS NOT NULL;
CREATE UNIQUE INDEX "governed_followup_actor_key_uq" ON "foundry_product"."retry_attempts" ("institution_id","actor_user_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;

ALTER TABLE "foundry_product"."idempotency_keys"
  ADD COLUMN "actor_user_id" uuid REFERENCES "foundry_product"."users"("id");

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_learning_outcome_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM foundry_product.retry_attempts activity
    WHERE activity.id=NEW.retry_id AND activity.idempotency_key IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'CAP-06 governed follow-ups cannot create LearningOutcome' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_learning_outcome_guard"() FROM PUBLIC;
CREATE TRIGGER "cap06_learning_outcome_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learning_outcomes"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_learning_outcome_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_episode_activity_aligned"(p_episode_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
    FROM foundry_product.learning_episodes episode
    JOIN foundry_product.retry_attempts activity ON activity.target_episode_id=episode.id
    WHERE episode.id=p_episode_id AND episode.purpose IN ('RETRY','TRANSFER','RETENTION')
      AND activity.idempotency_key IS NOT NULL AND activity.task_id=episode.task_id
      AND activity.source_episode_id=episode.predecessor_episode_id AND activity.activity_type=episode.purpose
      AND (
        (episode.status='ACTIVE' AND episode.ended_at IS NULL AND activity.status IN ('ASSIGNED','IN_PROGRESS','FAILED_RECOVERABLE'))
        OR (episode.status='WAITING_FOR_REVIEW' AND episode.ended_at IS NULL
          AND episode.waiting_reason='WAITING_FOR_TEACHER_REVIEW' AND activity.status='WAITING_FOR_REVIEW')
        OR (episode.status='COMPLETED' AND episode.ended_at IS NOT NULL AND episode.waiting_reason IS NULL AND activity.status='REVIEWED')
        OR (episode.status='ESCALATED' AND episode.ended_at IS NOT NULL AND episode.waiting_reason IS NULL AND activity.status='ESCALATED')
        OR (episode.status='FAILED' AND episode.ended_at IS NOT NULL AND episode.waiting_reason IS NULL AND activity.status='FAILED_FINAL')
        OR (episode.status='CANCELLED' AND episode.ended_at IS NOT NULL AND episode.waiting_reason IS NULL AND activity.status='CANCELLED')
      )
      AND jsonb_typeof(episode.recovery_state)='object' AND episode.recovery_state<>'{}'::jsonb
  )
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_episode_activity_aligned"(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_episode_activity_alignment_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.purpose<>'GENERAL' AND NOT foundry_private.cap06_episode_activity_aligned(NEW.id) THEN
    RAISE EXCEPTION 'Governed Episode must be atomically aligned with its exact follow-up activity' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_episode_activity_alignment_guard"() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "cap06_episode_activity_alignment_guard"
  AFTER INSERT OR UPDATE ON "foundry_product"."learning_episodes"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION "foundry_private"."cap06_episode_activity_alignment_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_followup_episode_alignment_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.idempotency_key IS NOT NULL AND NOT foundry_private.cap06_episode_activity_aligned(NEW.target_episode_id) THEN
    RAISE EXCEPTION 'Governed follow-up must be atomically aligned with its exact target Episode' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_followup_episode_alignment_guard"() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "cap06_followup_episode_alignment_guard"
  AFTER INSERT OR UPDATE ON "foundry_product"."retry_attempts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION "foundry_private"."cap06_followup_episode_alignment_guard"();
--> statement-breakpoint

-- Preserve the original legacy Retry result rule while allowing CAP-06 to
-- append its target-Episode Attempt and Diagnosis before the later human
-- Review. The existing retry_lineage_guard continues to call this function.
CREATE OR REPLACE FUNCTION "foundry_product"."assert_retry_lineage"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_task uuid; original_episode uuid; original_learner uuid;
        assignment_decision text; result_decision text; current_review uuid;
BEGIN
  SELECT attempt.task_id,attempt.episode_id,attempt.learner_id INTO original_task,original_episode,original_learner
  FROM foundry_product.learner_attempts attempt WHERE attempt.id=NEW.original_attempt_id;
  SELECT review.decision INTO assignment_decision
  FROM foundry_product.diagnostic_observations observation
  JOIN foundry_product.teacher_reviews review ON review.observation_id=observation.id
  WHERE observation.id=NEW.reviewed_observation_id AND observation.attempt_id=NEW.original_attempt_id AND review.id=NEW.teacher_review_id;
  SELECT review.id INTO current_review FROM foundry_product.teacher_reviews review
  WHERE review.observation_id=NEW.reviewed_observation_id ORDER BY review.created_at DESC,review.id DESC LIMIT 1;
  IF assignment_decision IS NULL OR assignment_decision='ESCALATE' OR current_review<>NEW.teacher_review_id THEN
    RAISE EXCEPTION 'retry assignment requires an eligible current Review';
  END IF;

  IF NEW.idempotency_key IS NULL THEN
    IF (NEW.result_attempt_id IS NULL)<>(NEW.result_observation_id IS NULL)
      OR (NEW.result_attempt_id IS NULL)<>(NEW.result_review_id IS NULL) THEN
      RAISE EXCEPTION 'retry result lineage must be linked atomically';
    END IF;
    IF NEW.result_attempt_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM foundry_product.learner_attempts result
        WHERE result.id=NEW.result_attempt_id AND result.task_id=original_task AND result.episode_id=original_episode AND result.learner_id=original_learner) THEN
        RAISE EXCEPTION 'retry result task, episode or learner mismatch';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM foundry_product.diagnostic_observations observation
        WHERE observation.id=NEW.result_observation_id AND observation.attempt_id=NEW.result_attempt_id) THEN
        RAISE EXCEPTION 'retry result observation mismatch';
      END IF;
      SELECT review.decision INTO result_decision FROM foundry_product.teacher_reviews review
        WHERE review.id=NEW.result_review_id AND review.observation_id=NEW.result_observation_id;
      SELECT review.id INTO current_review FROM foundry_product.teacher_reviews review
        WHERE review.observation_id=NEW.result_observation_id ORDER BY review.created_at DESC,review.id DESC LIMIT 1;
      IF result_decision IS NULL OR current_review<>NEW.result_review_id THEN RAISE EXCEPTION 'retry result requires its current Review'; END IF;
      IF (result_decision='ESCALATE' AND NEW.status<>'ESCALATED') OR (result_decision<>'ESCALATE' AND NEW.status<>'REVIEWED') THEN
        RAISE EXCEPTION 'retry status does not match Review decision';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.result_attempt_id IS NULL)<>(NEW.result_observation_id IS NULL) OR (NEW.result_attempt_id IS NULL AND NEW.result_review_id IS NOT NULL) THEN
    RAISE EXCEPTION 'governed follow-up result Attempt and Diagnosis must be linked together before Review';
  END IF;
  IF NEW.result_attempt_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM foundry_product.learner_attempts result
      JOIN foundry_product.runtime_deliveries delivery ON delivery.id=result.runtime_delivery_id
      WHERE result.id=NEW.result_attempt_id AND result.task_id=NEW.task_id AND result.episode_id=NEW.target_episode_id
        AND result.learner_id=NEW.learner_id AND result.activity_plan_id=NEW.activity_plan_id
        AND delivery.id=NEW.runtime_delivery_id AND delivery.activity_plan_id=NEW.activity_plan_id
        AND delivery.task_id=NEW.task_id AND delivery.episode_id=NEW.target_episode_id AND delivery.learner_id=NEW.learner_id
        AND (NEW.activity_type<>'RETENTION' OR (NEW.scheduled_for IS NOT NULL
          AND delivery.started_at>=NEW.scheduled_for AND result.created_at>=NEW.scheduled_for))
    ) THEN RAISE EXCEPTION 'governed follow-up result Plan, RuntimeDelivery, Attempt, Task, Episode or learner mismatch'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM foundry_product.diagnostic_observations observation
      JOIN foundry_product.runtime_deliveries delivery ON delivery.id=NEW.runtime_delivery_id
      WHERE observation.id=NEW.result_observation_id AND observation.attempt_id=NEW.result_attempt_id
        AND observation.capability_version_id=delivery.capability_version_id AND observation.superseded_by_id IS NULL
    ) THEN RAISE EXCEPTION 'governed follow-up result Diagnosis lineage mismatch'; END IF;
  END IF;
  IF NEW.result_review_id IS NOT NULL THEN
    SELECT review.decision INTO result_decision FROM foundry_product.teacher_reviews review
      WHERE review.id=NEW.result_review_id AND review.observation_id=NEW.result_observation_id;
    SELECT review.id INTO current_review FROM foundry_product.teacher_reviews review
      WHERE review.observation_id=NEW.result_observation_id ORDER BY review.created_at DESC,review.id DESC LIMIT 1;
    IF result_decision IS NULL OR current_review<>NEW.result_review_id THEN
      RAISE EXCEPTION 'governed follow-up result requires its current TeacherReview';
    END IF;
    IF (result_decision='ESCALATE' AND NEW.status<>'ESCALATED') OR (result_decision<>'ESCALATE' AND NEW.status<>'REVIEWED') THEN
      RAISE EXCEPTION 'governed follow-up status does not match its result TeacherReview';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

ALTER TABLE "foundry_product"."transfer_activities"
  ALTER COLUMN "evidence_unit_id" DROP NOT NULL,
  ADD COLUMN "contract_version" text DEFAULT 'LEGACY_UNVERIFIED' NOT NULL,
  ADD COLUMN "declaration" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN "changed_dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD CONSTRAINT "transfer_material_difference_ck" CHECK (
    "contract_version"='LEGACY_UNVERIFIED' OR ("contract_version"='CAP06_V1'
      AND jsonb_typeof("declaration")='object'
      AND "declaration"->>'evidenceLimit'='TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN'
      AND jsonb_typeof("declaration"->'source')='object' AND jsonb_typeof("declaration"->'target')='object'
      AND jsonb_typeof("changed_dimensions")='array' AND jsonb_array_length("changed_dimensions")>0
      AND "changed_dimensions"<@'["context","representation","itemFamily","problemStructure"]'::jsonb)
  );
ALTER TABLE "foundry_product"."retention_reviews"
  ALTER COLUMN "evidence_unit_id" DROP NOT NULL,
  ADD COLUMN "contract_version" text DEFAULT 'LEGACY_UNVERIFIED' NOT NULL,
  ADD COLUMN "declared_delay_seconds" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "intervening_exposure" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN "content_equivalence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN "assistance_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN "completed_intervening_exposure" jsonb,
  ADD COLUMN "exposure_confirmed_at" timestamp with time zone,
  ADD COLUMN "exposure_confirmed_by" uuid REFERENCES "foundry_product"."users"("id"),
  ADD CONSTRAINT "retention_contract_ck" CHECK (
    "contract_version"='LEGACY_UNVERIFIED' OR ("contract_version"='CAP06_V1' AND "declared_delay_seconds">0
      AND jsonb_typeof("intervening_exposure")='object' AND jsonb_typeof("content_equivalence")='object'
      AND jsonb_typeof("assistance_policy")='object'
      AND (("completed_at" IS NULL AND "completed_intervening_exposure" IS NULL
          AND "exposure_confirmed_at" IS NULL AND "exposure_confirmed_by" IS NULL)
        OR ("completed_at" IS NOT NULL AND jsonb_typeof("completed_intervening_exposure")='object'
          AND "exposure_confirmed_at" IS NOT NULL AND "exposure_confirmed_by" IS NOT NULL)))
  );
--> statement-breakpoint

-- Replace only the generic guards whose pre-CAP-06 shape cannot see the new
-- direct lineage. All other RW-02 guards remain unchanged.
DROP TRIGGER IF EXISTS "_authority_tenant_lineage_guard" ON "foundry_product"."retry_attempts";
DROP TRIGGER IF EXISTS "_authority_tenant_lineage_guard" ON "foundry_product"."transfer_activities";
DROP TRIGGER IF EXISTS "_authority_tenant_lineage_guard" ON "foundry_product"."retention_reviews";
DROP TRIGGER IF EXISTS "_authority_tenant_lineage_guard" ON "foundry_product"."governance_events";

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_transition_actor_authorized"(
  p_activity_id uuid,p_actor_id uuid,p_from_status text,p_to_status text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE learner_authorized boolean := false; teacher_authorized boolean := false;
BEGIN
  SELECT
    activity.learner_id=p_actor_id AND EXISTS (
      SELECT 1 FROM foundry_product.institution_memberships membership
      JOIN foundry_product.course_enrollments enrollment
        ON enrollment.user_id=membership.user_id AND enrollment.institution_id=membership.institution_id
      WHERE membership.user_id=p_actor_id AND membership.institution_id=activity.institution_id AND membership.role='LEARNER'
        AND enrollment.course_id=activity.course_id AND enrollment.role='LEARNER'
    ),
    EXISTS (
      SELECT 1 FROM foundry_product.institution_memberships membership
      JOIN foundry_product.course_enrollments enrollment
        ON enrollment.user_id=membership.user_id AND enrollment.institution_id=membership.institution_id
      WHERE membership.user_id=p_actor_id AND membership.institution_id=activity.institution_id AND membership.role='TEACHER'
        AND enrollment.course_id=activity.course_id AND enrollment.role='TEACHER'
    )
  INTO learner_authorized,teacher_authorized
  FROM foundry_product.retry_attempts activity
  WHERE activity.id=p_activity_id AND activity.idempotency_key IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_to_status='ASSIGNED' AND p_from_status IS NULL THEN RETURN teacher_authorized; END IF;
  IF p_to_status IN ('IN_PROGRESS','WAITING_FOR_REVIEW')
    OR (p_to_status='ASSIGNED' AND p_from_status='FAILED_RECOVERABLE')
    OR (p_to_status IN ('FAILED_RECOVERABLE','FAILED_FINAL') AND p_from_status<>'ASSIGNED') THEN
    RETURN learner_authorized;
  END IF;
  IF p_to_status IN ('REVIEWED','ESCALATED')
    OR (p_to_status IN ('FAILED_RECOVERABLE','FAILED_FINAL') AND p_from_status='ASSIGNED') THEN
    RETURN teacher_authorized;
  END IF;
  IF p_to_status='CANCELLED' THEN RETURN learner_authorized OR teacher_authorized; END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_transition_actor_authorized"(uuid,uuid,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_governance_event_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
        actor_id uuid := NULLIF(current_setting('foundry.user_id',true),'')::uuid;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'GovernanceEvents cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'GovernanceEvents are append-only' USING ERRCODE='23514'; END IF;
  IF tenant_id IS NOT NULL AND NEW.institution_id<>tenant_id THEN RAISE EXCEPTION 'GovernanceEvent tenant mismatch' USING ERRCODE='23514'; END IF;
  IF actor_id IS NOT NULL AND NEW.actor_user_id<>actor_id THEN RAISE EXCEPTION 'GovernanceEvent actor mismatch' USING ERRCODE='23514'; END IF;
  IF NOT foundry_private.entity_in_tenant('USER',NEW.actor_user_id,NEW.institution_id) THEN RAISE EXCEPTION 'GovernanceEvent actor membership missing' USING ERRCODE='23514'; END IF;
  IF NEW.entity_type='GOVERNED_FOLLOWUP' THEN
    IF NOT EXISTS (
      SELECT 1 FROM foundry_product.retry_attempts activity
      WHERE activity.id=NEW.entity_id AND activity.institution_id=NEW.institution_id AND activity.idempotency_key IS NOT NULL
        AND ((NEW.action='ASSIGNED' AND activity.latest_transition_event_id IS NULL AND NEW.previous_event_id IS NULL
              AND NEW.payload->>'fromStatus' IS NULL AND NEW.payload->>'toStatus'='ASSIGNED')
          OR (NEW.action='STATUS_TRANSITION' AND NEW.previous_event_id=activity.latest_transition_event_id
              AND NEW.payload->>'fromStatus'=activity.status AND length(btrim(NEW.payload->>'toStatus'))>0))
        AND NEW.payload->>'actorUserId'=NEW.actor_user_id::text
        AND foundry_private.cap06_transition_actor_authorized(
          NEW.entity_id,NEW.actor_user_id,NEW.payload->>'fromStatus',NEW.payload->>'toStatus')
        AND (activity.activity_type<>'RETENTION' OR NEW.payload->>'toStatus'<>'IN_PROGRESS'
          OR (activity.scheduled_for IS NOT NULL AND activity.scheduled_for<=CURRENT_TIMESTAMP))
        AND (activity.activity_type<>'TRANSFER' OR NEW.payload->>'toStatus' NOT IN ('REVIEWED','ESCALATED')
          OR NEW.payload->'transferContractConfirmed'='true'::jsonb)
        AND length(btrim(NEW.payload->>'recordedAt'))>0 AND length(btrim(NEW.payload->>'reason'))>0
        AND jsonb_typeof(NEW.payload->'externalWorkMayStillFinish')='boolean'
        AND NEW.payload->'educationalEffectivenessClaim'='false'::jsonb
        AND NEW.payload->'masteryClaim'='false'::jsonb
    ) THEN RAISE EXCEPTION 'Governed follow-up transition event is not bound to current Product State' USING ERRCODE='23514'; END IF;
  ELSE
    IF NOT foundry_private.entity_in_tenant(
      CASE NEW.entity_type
        WHEN 'LEARNING_TASK' THEN 'TASK' WHEN 'SOURCE_RECORD' THEN 'SOURCE' WHEN 'TEACHER_REVIEW' THEN 'REVIEW'
        WHEN 'LEARNING_OUTCOME' THEN 'OUTCOME' WHEN 'COMPONENT' THEN 'COMPONENT' WHEN 'COMPONENT_VERSION' THEN 'VERSION'
        WHEN 'COMPONENT_EVALUATION' THEN 'EVALUATION' WHEN 'PUBLICATION_DECISION' THEN 'DECISION'
        WHEN 'COMPONENT_DELIVERY' THEN 'DELIVERY' ELSE 'UNKNOWN' END,
      NEW.entity_id,NEW.institution_id
    ) THEN RAISE EXCEPTION 'GovernanceEvent entity lineage mismatch' USING ERRCODE='23514'; END IF;
    IF NEW.previous_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM foundry_product.governance_events prior WHERE prior.id=NEW.previous_event_id AND prior.institution_id=NEW.institution_id
    ) THEN RAISE EXCEPTION 'GovernanceEvent predecessor mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_governance_event_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "foundry_product"."governance_events"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_governance_event_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_governed_event_consumed_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.entity_type='GOVERNED_FOLLOWUP' AND NOT EXISTS (
    WITH RECURSIVE event_chain AS (
      SELECT event.id,event.previous_event_id
      FROM foundry_product.retry_attempts activity
      JOIN foundry_product.governance_events event ON event.id=activity.latest_transition_event_id
      WHERE activity.id=NEW.entity_id AND activity.idempotency_key IS NOT NULL
        AND event.entity_type='GOVERNED_FOLLOWUP' AND event.entity_id=activity.id
        AND event.payload->>'toStatus'=activity.status
      UNION ALL
      SELECT prior.id,prior.previous_event_id
      FROM foundry_product.governance_events prior
      JOIN event_chain later ON prior.id=later.previous_event_id
      WHERE prior.entity_type='GOVERNED_FOLLOWUP' AND prior.entity_id=NEW.entity_id
    )
    SELECT 1 FROM event_chain WHERE id=NEW.id
  ) THEN
    RAISE EXCEPTION 'Governed follow-up GovernanceEvent must be consumed by exact Product State in the same transaction' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_governed_event_consumed_guard"() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "cap06_governed_event_consumed_guard"
  AFTER INSERT ON "foundry_product"."governance_events"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION "foundry_private"."cap06_governed_event_consumed_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_followup_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
        actor_id uuid := NULLIF(current_setting('foundry.user_id',true),'')::uuid;
        transition foundry_product.governance_events%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.idempotency_key IS NOT NULL THEN RAISE EXCEPTION 'Governed follow-up Product State cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.idempotency_key IS NULL THEN
    IF NEW.institution_id IS NOT NULL OR NEW.course_id IS NOT NULL OR NEW.task_id IS NOT NULL
      OR NEW.source_episode_id IS NOT NULL OR NEW.target_episode_id IS NOT NULL OR NEW.learner_id IS NOT NULL
      OR NEW.context_item_id IS NOT NULL OR NEW.activity_plan_proposal_id IS NOT NULL OR NEW.activity_plan_id IS NOT NULL
      OR NEW.runtime_delivery_id IS NOT NULL OR NEW.source_lineage IS NOT NULL OR NEW.actor_user_id IS NOT NULL
      OR NEW.actor_provenance IS NOT NULL OR NEW.assignment_request_hash IS NOT NULL OR NEW.latest_transition_event_id IS NOT NULL
      OR NEW.cancellation_state IS NOT NULL OR NEW.failure_state IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy retry rows cannot acquire CAP-06 authority columns' USING ERRCODE='23514';
    END IF;
    IF tenant_id IS NOT NULL AND (NOT foundry_private.entity_in_tenant('ATTEMPT',NEW.original_attempt_id,tenant_id)
      OR NOT foundry_private.entity_in_tenant('OBSERVATION',NEW.reviewed_observation_id,tenant_id)
      OR NOT foundry_private.entity_in_tenant('REVIEW',NEW.teacher_review_id,tenant_id)
      OR (NEW.result_attempt_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('ATTEMPT',NEW.result_attempt_id,tenant_id))
      OR (NEW.result_observation_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('OBSERVATION',NEW.result_observation_id,tenant_id))
      OR (NEW.result_review_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('REVIEW',NEW.result_review_id,tenant_id))) THEN
      RAISE EXCEPTION 'Retry tenant lineage mismatch' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF tenant_id IS NOT NULL AND NEW.institution_id<>tenant_id THEN
    RAISE EXCEPTION 'Governed follow-up tenant mismatch' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.assignment_request_hash IS NULL THEN
      SELECT reservation.request_hash INTO NEW.assignment_request_hash
      FROM foundry_product.idempotency_keys reservation
      WHERE reservation.institution_id=NEW.institution_id
        AND reservation.command_type='CREATE_GOVERNED_FOLLOWUP'
        AND reservation.key=NEW.idempotency_key
        AND reservation.result_id=NEW.id
        AND reservation.actor_user_id=NEW.actor_user_id;
    END IF;
    IF NEW.status<>'ASSIGNED' OR NEW.latest_transition_event_id IS NOT NULL OR NEW.cancellation_state IS NOT NULL OR NEW.failure_state IS NOT NULL THEN
      RAISE EXCEPTION 'Governed follow-up must begin ASSIGNED with no terminal fact' USING ERRCODE='23514';
    END IF;
    IF actor_id IS NOT NULL AND NEW.actor_user_id<>actor_id THEN RAISE EXCEPTION 'Governed follow-up assigning actor mismatch' USING ERRCODE='23514'; END IF;
    IF NEW.assigned_at<>NEW.created_at OR NEW.updated_at<>NEW.assigned_at THEN RAISE EXCEPTION 'Governed follow-up assignment timestamps diverge' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM foundry_product.learner_attempts attempt
      JOIN foundry_product.diagnostic_observations observation ON observation.id=NEW.reviewed_observation_id AND observation.attempt_id=attempt.id AND observation.superseded_by_id IS NULL
      JOIN foundry_product.teacher_reviews review ON review.id=NEW.teacher_review_id AND review.observation_id=observation.id
      JOIN foundry_product.learning_tasks task ON task.id=attempt.task_id
      JOIN foundry_product.learning_episodes source_episode ON source_episode.id=attempt.episode_id AND source_episode.task_id=task.id
      JOIN foundry_product.learning_episodes target_episode ON target_episode.id=NEW.target_episode_id AND target_episode.task_id=task.id
      JOIN foundry_product.context_items context_item ON context_item.id=NEW.context_item_id
      JOIN foundry_product.capability_versions version ON version.id=observation.capability_version_id
      JOIN foundry_product.capabilities capability ON capability.id=version.capability_id
      WHERE attempt.id=NEW.original_attempt_id AND task.id=NEW.task_id AND task.institution_id=NEW.institution_id
        AND task.course_id=NEW.course_id AND task.learner_id=NEW.learner_id AND task.status='OPEN'
        AND source_episode.id=NEW.source_episode_id AND target_episode.predecessor_episode_id=source_episode.id
        AND target_episode.purpose=NEW.activity_type AND target_episode.status='ACTIVE'
        AND context_item.institution_id=NEW.institution_id AND context_item.course_id=NEW.course_id
        AND context_item.task_id=NEW.task_id AND context_item.episode_id=NEW.target_episode_id
        AND context_item.kind='GOVERNED_FOLLOWUP' AND context_item.state='ACTIVE'
        AND context_item.payload->>'followupId'=NEW.id::text AND context_item.payload->>'followupType'=NEW.activity_type
        AND context_item.payload->>'governingTeacherReviewId'=NEW.teacher_review_id::text
        AND context_item.payload->'effectivenessClaim'='false'::jsonb AND context_item.payload->'masteryClaim'='false'::jsonb
        AND NEW.source_lineage->>'learnerAttemptId'=attempt.id::text
        AND NEW.source_lineage->>'diagnosticObservationId'=observation.id::text
        AND NEW.source_lineage->>'teacherReviewId'=review.id::text
        AND NEW.source_lineage->>'sourceEpisodeId'=source_episode.id::text
        AND NEW.source_lineage->>'capabilityId'=capability.id::text
        AND NEW.source_lineage->>'capabilityVersionId'=version.id::text
        AND NEW.source_lineage->>'capabilityVersionContentHash'=version.content_hash
        AND NEW.source_lineage->'canonicalTransferSourceSignature'=jsonb_build_object(
          'context',left(btrim(task.title),120),
          'representation',COALESCE(attempt.modality,CASE WHEN attempt.file_asset_id IS NOT NULL THEN 'MULTIMODAL' ELSE 'TEXT' END),
          'itemFamily',capability.key,
          'problemStructure',version.implementation_key
        )
        AND review.actor_provenance->>'institutionId'=NEW.institution_id::text
        AND review.actor_provenance->>'userId'=review.teacher_id::text
        AND review.actor_provenance->>'authMethod' NOT LIKE 'migrated-%'
        AND review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')
    ) THEN RAISE EXCEPTION 'Governed follow-up exact source/target lineage mismatch' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM foundry_product.institution_memberships membership
      JOIN foundry_product.course_enrollments enrollment ON enrollment.user_id=membership.user_id AND enrollment.institution_id=membership.institution_id
      WHERE membership.user_id=NEW.actor_user_id AND membership.institution_id=NEW.institution_id AND membership.role='TEACHER'
        AND enrollment.course_id=NEW.course_id AND enrollment.role='TEACHER'
        AND NEW.actor_provenance->>'userId'=NEW.actor_user_id::text
        AND NEW.actor_provenance->>'institutionId'=NEW.institution_id::text
        AND NEW.actor_provenance->'roles' @> '["TEACHER"]'::jsonb
        AND NEW.actor_provenance->>'authMethod' NOT LIKE 'migrated-%'
    ) THEN RAISE EXCEPTION 'Governed follow-up requires authenticated current course teacher authority' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;

  IF OLD.idempotency_key IS NULL THEN RAISE EXCEPTION 'Legacy retry rows cannot be converted in place to CAP-06' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('REVIEWED','ESCALATED','CANCELLED','FAILED_FINAL') THEN RAISE EXCEPTION 'Governed follow-up terminal state is immutable' USING ERRCODE='23514'; END IF;
  IF (OLD.id,OLD.original_attempt_id,OLD.reviewed_observation_id,OLD.teacher_review_id,OLD.activity_type,OLD.prompt,
      OLD.institution_id,OLD.course_id,OLD.task_id,OLD.source_episode_id,OLD.target_episode_id,OLD.learner_id,OLD.context_item_id,
      OLD.assigned_at,OLD.scheduled_for,OLD.source_lineage,OLD.actor_user_id,OLD.actor_provenance,OLD.idempotency_key,
      OLD.assignment_request_hash,OLD.created_at)
     IS DISTINCT FROM
     (NEW.id,NEW.original_attempt_id,NEW.reviewed_observation_id,NEW.teacher_review_id,NEW.activity_type,NEW.prompt,
      NEW.institution_id,NEW.course_id,NEW.task_id,NEW.source_episode_id,NEW.target_episode_id,NEW.learner_id,NEW.context_item_id,
      NEW.assigned_at,NEW.scheduled_for,NEW.source_lineage,NEW.actor_user_id,NEW.actor_provenance,NEW.idempotency_key,
      NEW.assignment_request_hash,NEW.created_at)
  THEN RAISE EXCEPTION 'Governed follow-up assignment and source lineage are immutable' USING ERRCODE='23514'; END IF;
  IF (OLD.activity_plan_proposal_id IS NOT NULL AND NEW.activity_plan_proposal_id IS DISTINCT FROM OLD.activity_plan_proposal_id)
    OR (OLD.activity_plan_id IS NOT NULL AND NEW.activity_plan_id IS DISTINCT FROM OLD.activity_plan_id)
    OR (OLD.runtime_delivery_id IS NOT NULL AND NEW.runtime_delivery_id IS DISTINCT FROM OLD.runtime_delivery_id)
    OR (OLD.result_attempt_id IS NOT NULL AND NEW.result_attempt_id IS DISTINCT FROM OLD.result_attempt_id)
    OR (OLD.result_observation_id IS NOT NULL AND NEW.result_observation_id IS DISTINCT FROM OLD.result_observation_id)
    OR (OLD.result_review_id IS NOT NULL AND NEW.result_review_id IS DISTINCT FROM OLD.result_review_id)
  THEN RAISE EXCEPTION 'Governed follow-up execution lineage is set-once' USING ERRCODE='23514'; END IF;

  IF NEW.activity_plan_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM foundry_product.activity_plan_proposals proposal
    WHERE proposal.id=NEW.activity_plan_proposal_id AND proposal.institution_id=NEW.institution_id
      AND proposal.course_id=NEW.course_id AND proposal.task_id=NEW.task_id
      AND proposal.episode_id=NEW.target_episode_id
      AND proposal.diagnostic_observation_id=NEW.reviewed_observation_id
  ) THEN RAISE EXCEPTION 'Governed follow-up ActivityPlanProposal exact lineage mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.activity_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM foundry_product.activity_plans plan
    WHERE plan.id=NEW.activity_plan_id AND plan.activity_plan_proposal_id=NEW.activity_plan_proposal_id
      AND plan.institution_id=NEW.institution_id AND plan.course_id=NEW.course_id
      AND plan.task_id=NEW.task_id AND plan.episode_id=NEW.target_episode_id
      AND plan.diagnostic_observation_id=NEW.reviewed_observation_id
  ) THEN RAISE EXCEPTION 'Governed follow-up ActivityPlan exact lineage mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.runtime_delivery_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM foundry_product.runtime_deliveries delivery
    WHERE delivery.id=NEW.runtime_delivery_id AND delivery.activity_plan_id=NEW.activity_plan_id
      AND delivery.institution_id=NEW.institution_id AND delivery.course_id=NEW.course_id
      AND delivery.task_id=NEW.task_id AND delivery.episode_id=NEW.target_episode_id
      AND delivery.learner_id=NEW.learner_id
  ) THEN RAISE EXCEPTION 'Governed follow-up RuntimeDelivery exact lineage mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.result_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM foundry_product.learner_attempts attempt
    WHERE attempt.id=NEW.result_attempt_id AND attempt.task_id=NEW.task_id
      AND attempt.episode_id=NEW.target_episode_id AND attempt.learner_id=NEW.learner_id
      AND attempt.activity_plan_id=NEW.activity_plan_id AND attempt.runtime_delivery_id=NEW.runtime_delivery_id
  ) THEN RAISE EXCEPTION 'Governed follow-up result LearnerAttempt exact lineage mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.result_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM foundry_product.diagnostic_observations observation
    WHERE observation.id=NEW.result_observation_id AND observation.attempt_id=NEW.result_attempt_id
      AND observation.superseded_by_id IS NULL
  ) THEN RAISE EXCEPTION 'Governed follow-up result Diagnosis exact lineage mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.result_review_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM foundry_product.teacher_reviews review
    JOIN foundry_product.governance_events event ON event.id=NEW.latest_transition_event_id
    JOIN foundry_product.institution_memberships membership
      ON membership.user_id=review.teacher_id AND membership.institution_id=NEW.institution_id AND membership.role='TEACHER'
    JOIN foundry_product.course_enrollments enrollment
      ON enrollment.user_id=review.teacher_id AND enrollment.institution_id=NEW.institution_id
      AND enrollment.course_id=NEW.course_id AND enrollment.role='TEACHER'
    WHERE review.id=NEW.result_review_id AND review.observation_id=NEW.result_observation_id
      AND review.teacher_id=event.actor_user_id AND event.entity_type='GOVERNED_FOLLOWUP' AND event.entity_id=NEW.id
      AND event.payload->>'toStatus'=NEW.status AND event.payload->>'actorUserId'=review.teacher_id::text
      AND review.actor_provenance->>'userId'=review.teacher_id::text
      AND review.actor_provenance->>'institutionId'=NEW.institution_id::text
      AND review.actor_provenance->'roles' @> '["TEACHER"]'::jsonb
      AND review.actor_provenance->>'authMethod' NOT LIKE 'migrated-%'
  ) THEN RAISE EXCEPTION 'Governed follow-up result TeacherReview exact lineage mismatch' USING ERRCODE='23514'; END IF;
  IF OLD.cancellation_state IS NOT NULL AND NEW.cancellation_state IS DISTINCT FROM OLD.cancellation_state THEN RAISE EXCEPTION 'Cancellation fact is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.failure_state IS NOT NULL AND NEW.failure_state IS DISTINCT FROM OLD.failure_state
    AND NOT (OLD.status<>NEW.status AND NEW.status IN ('FAILED_RECOVERABLE','FAILED_FINAL')) THEN
    RAISE EXCEPTION 'Failure fact can be replaced only by a new governed failure transition' USING ERRCODE='23514';
  END IF;

  IF NEW.status=OLD.status THEN
    IF NEW.cancellation_state IS DISTINCT FROM OLD.cancellation_state OR NEW.failure_state IS DISTINCT FROM OLD.failure_state THEN
      RAISE EXCEPTION 'Terminal facts require a status transition' USING ERRCODE='23514';
    END IF;
    IF NEW.latest_transition_event_id IS DISTINCT FROM OLD.latest_transition_event_id THEN
      IF OLD.latest_transition_event_id IS NOT NULL OR NEW.status<>'ASSIGNED' OR NOT EXISTS (
        SELECT 1 FROM foundry_product.governance_events event WHERE event.id=NEW.latest_transition_event_id
          AND event.entity_type='GOVERNED_FOLLOWUP' AND event.entity_id=NEW.id AND event.action='ASSIGNED'
          AND event.previous_event_id IS NULL AND event.actor_user_id=NEW.actor_user_id
          AND event.payload->>'toStatus'='ASSIGNED' AND (event.payload->>'recordedAt')::timestamptz=NEW.assigned_at
      ) THEN RAISE EXCEPTION 'Initial assignment event binding is invalid' USING ERRCODE='23514'; END IF;
    END IF;
    IF (NEW.activity_plan_id,NEW.runtime_delivery_id,NEW.result_attempt_id,NEW.result_observation_id,NEW.result_review_id)
      IS DISTINCT FROM
      (OLD.activity_plan_id,OLD.runtime_delivery_id,OLD.result_attempt_id,OLD.result_observation_id,OLD.result_review_id) THEN
      RAISE EXCEPTION 'Execution lineage may change only with its governed status transition' USING ERRCODE='23514';
    END IF;
    IF NEW.activity_plan_proposal_id IS DISTINCT FROM OLD.activity_plan_proposal_id THEN
      IF OLD.activity_plan_proposal_id IS NOT NULL OR NEW.activity_plan_proposal_id IS NULL OR NEW.status<>'ASSIGNED'
        OR actor_id IS NULL OR NOT foundry_private.cap06_transition_actor_authorized(NEW.id,actor_id,NULL,'ASSIGNED') THEN
        RAISE EXCEPTION 'Only the current course teacher may bind the exact proposal while ASSIGNED' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT ((OLD.status='ASSIGNED' AND NEW.status IN ('IN_PROGRESS','FAILED_RECOVERABLE','FAILED_FINAL','CANCELLED'))
    OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('WAITING_FOR_REVIEW','FAILED_RECOVERABLE','FAILED_FINAL','CANCELLED'))
    OR (OLD.status='FAILED_RECOVERABLE' AND NEW.status IN ('ASSIGNED','IN_PROGRESS','FAILED_FINAL','CANCELLED'))
    OR (OLD.status='WAITING_FOR_REVIEW' AND NEW.status IN ('REVIEWED','ESCALATED'))) THEN
    RAISE EXCEPTION 'Governed follow-up status transition is not forward-authorized' USING ERRCODE='23514';
  END IF;
  IF NEW.activity_type='RETENTION' AND NEW.status='IN_PROGRESS'
    AND (NEW.scheduled_for IS NULL OR NEW.scheduled_for>CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'Retention cannot begin before its persisted dueAt' USING ERRCODE='23514';
  END IF;
  SELECT * INTO transition FROM foundry_product.governance_events event
    WHERE event.id=NEW.latest_transition_event_id AND event.entity_type='GOVERNED_FOLLOWUP' AND event.entity_id=NEW.id
      AND event.action='STATUS_TRANSITION' AND event.previous_event_id=OLD.latest_transition_event_id
      AND event.actor_user_id=actor_id AND event.payload->>'actorUserId'=actor_id::text
      AND event.payload->>'fromStatus'=OLD.status AND event.payload->>'toStatus'=NEW.status
      AND length(btrim(event.payload->>'reason'))>0 AND jsonb_typeof(event.payload->'externalWorkMayStillFinish')='boolean';
  IF NOT FOUND THEN RAISE EXCEPTION 'Governed follow-up transition lacks its append-only actor/reason event' USING ERRCODE='23514'; END IF;
  IF NOT foundry_private.cap06_transition_actor_authorized(NEW.id,transition.actor_user_id,OLD.status,NEW.status) THEN
    RAISE EXCEPTION 'Governed follow-up transition actor lacks learner or course-teacher authority' USING ERRCODE='23514';
  END IF;
  IF NEW.activity_type='TRANSFER' AND NEW.status IN ('REVIEWED','ESCALATED')
    AND transition.payload->'transferContractConfirmed'<>'true'::jsonb THEN
    RAISE EXCEPTION 'Transfer review requires explicit confirmation of the persisted delivery contract' USING ERRCODE='23514';
  END IF;
  IF NEW.status='CANCELLED' AND (NEW.cancellation_state IS NULL
      OR NEW.cancellation_state->>'actorUserId'<>transition.actor_user_id::text
      OR NEW.cancellation_state->>'reason'<>transition.payload->>'reason'
      OR (NEW.cancellation_state->>'recordedAt')::timestamptz<>(transition.payload->>'recordedAt')::timestamptz
      OR NEW.cancellation_state->'externalWorkMayStillFinish'<>transition.payload->'externalWorkMayStillFinish') THEN
    RAISE EXCEPTION 'Cancellation fact does not match its transition event' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('FAILED_RECOVERABLE','FAILED_FINAL') AND (NEW.failure_state IS NULL
      OR NEW.failure_state->>'actorUserId'<>transition.actor_user_id::text
      OR NEW.failure_state->>'reason'<>transition.payload->>'reason'
      OR (NEW.failure_state->>'recordedAt')::timestamptz<>(transition.payload->>'recordedAt')::timestamptz
      OR NEW.failure_state->'externalWorkMayStillFinish'<>transition.payload->'externalWorkMayStillFinish') THEN
    RAISE EXCEPTION 'Failure fact does not match its transition event' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_followup_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "foundry_product"."retry_attempts"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_followup_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_transfer_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected_dimensions jsonb;
        tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.contract_version='CAP06_V1' THEN RAISE EXCEPTION 'CAP-06 Transfer declaration is immutable' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.contract_version='CAP06_V1' THEN
      RAISE EXCEPTION 'CAP-06 Transfer declaration is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.contract_version='LEGACY_UNVERIFIED' AND (
      NEW.contract_version<>OLD.contract_version OR NEW.declaration IS DISTINCT FROM OLD.declaration
      OR NEW.changed_dimensions IS DISTINCT FROM OLD.changed_dimensions
    ) THEN
      RAISE EXCEPTION 'Legacy Transfer rows cannot acquire CAP-06 declaration authority' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.contract_version='LEGACY_UNVERIFIED' THEN
    IF NEW.declaration<>'{}'::jsonb OR NEW.changed_dimensions<>'[]'::jsonb THEN
      RAISE EXCEPTION 'Legacy Transfer rows cannot carry CAP-06 declaration authority' USING ERRCODE='23514';
    END IF;
    IF tenant_id IS NOT NULL AND (NOT foundry_private.entity_in_tenant('RETRY',NEW.retry_id,tenant_id)
      OR NEW.evidence_unit_id IS NULL OR NOT foundry_private.entity_in_tenant('EVIDENCE',NEW.evidence_unit_id,tenant_id)) THEN
      RAISE EXCEPTION 'Transfer tenant lineage mismatch' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT COALESCE(jsonb_agg(dimension ORDER BY ordinal),'[]'::jsonb) INTO expected_dimensions
  FROM (VALUES
    ('context',1),('representation',2),('itemFamily',3),('problemStructure',4)
  ) AS dimensions(dimension,ordinal)
  WHERE lower(regexp_replace(btrim(normalize(NEW.declaration->'source'->>dimension,NFKC)),'\s+',' ','g'))
    IS DISTINCT FROM lower(regexp_replace(btrim(normalize(NEW.declaration->'target'->>dimension,NFKC)),'\s+',' ','g'));
  IF expected_dimensions='[]'::jsonb OR NEW.changed_dimensions<>expected_dimensions THEN
    RAISE EXCEPTION 'Transfer changedDimensions must be the exact database-recomputed material difference' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.retry_attempts activity
    WHERE activity.id=NEW.retry_id AND activity.activity_type='TRANSFER' AND activity.idempotency_key IS NOT NULL
      AND activity.institution_id=foundry_private.current_institution_id()
      AND NEW.declaration->'source'=activity.source_lineage->'canonicalTransferSourceSignature'
      AND NEW.declaration->>'evidenceLimit'='TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN'
      AND NEW.target_concept=NEW.declaration->'target'->>'itemFamily'
      AND length(btrim(NEW.declaration->>'materialDifferenceRationale'))>=10
      AND length(btrim(NEW.declaration->'target'->>'context'))>0
      AND length(btrim(NEW.declaration->'target'->>'representation'))>0
      AND length(btrim(NEW.declaration->'target'->>'itemFamily'))>0
      AND length(btrim(NEW.declaration->'target'->>'problemStructure'))>0
      AND (NEW.evidence_unit_id IS NULL OR foundry_private.entity_in_tenant('EVIDENCE',NEW.evidence_unit_id,activity.institution_id))
  ) THEN RAISE EXCEPTION 'Transfer declaration is not bound to its governed source lineage' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_transfer_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "foundry_product"."transfer_activities"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_transfer_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_retention_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant_id uuid := NULLIF(current_setting('foundry.institution_id',true),'')::uuid;
        actor_id uuid := NULLIF(current_setting('foundry.user_id',true),'')::uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.contract_version='CAP06_V1' THEN RAISE EXCEPTION 'CAP-06 Retention declaration cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.contract_version='LEGACY_UNVERIFIED' AND (
      NEW.contract_version<>OLD.contract_version OR NEW.declared_delay_seconds IS DISTINCT FROM OLD.declared_delay_seconds
      OR NEW.intervening_exposure IS DISTINCT FROM OLD.intervening_exposure
      OR NEW.content_equivalence IS DISTINCT FROM OLD.content_equivalence
      OR NEW.assistance_policy IS DISTINCT FROM OLD.assistance_policy
      OR NEW.completed_intervening_exposure IS DISTINCT FROM OLD.completed_intervening_exposure
      OR NEW.exposure_confirmed_at IS DISTINCT FROM OLD.exposure_confirmed_at
      OR NEW.exposure_confirmed_by IS DISTINCT FROM OLD.exposure_confirmed_by
    ) THEN
      RAISE EXCEPTION 'Legacy Retention rows cannot acquire CAP-06 declaration authority' USING ERRCODE='23514';
    END IF;
    IF OLD.contract_version='CAP06_V1' AND (
      (to_jsonb(OLD)-'completed_at'-'completed_intervening_exposure'-'exposure_confirmed_at'-'exposure_confirmed_by')
        IS DISTINCT FROM
      (to_jsonb(NEW)-'completed_at'-'completed_intervening_exposure'-'exposure_confirmed_at'-'exposure_confirmed_by')
      OR OLD.completed_at IS NOT NULL OR OLD.completed_intervening_exposure IS NOT NULL
      OR OLD.exposure_confirmed_at IS NOT NULL OR OLD.exposure_confirmed_by IS NOT NULL
      OR NEW.completed_at IS NULL OR NEW.completed_intervening_exposure IS NULL
      OR NEW.exposure_confirmed_at IS NULL OR NEW.exposure_confirmed_by IS NULL) THEN
      RAISE EXCEPTION 'Retention declaration is immutable and actual exposure confirmation is set-once' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.contract_version='LEGACY_UNVERIFIED' THEN
    IF NEW.declared_delay_seconds<>0 OR NEW.intervening_exposure<>'{}'::jsonb
      OR NEW.content_equivalence<>'{}'::jsonb OR NEW.assistance_policy<>'{}'::jsonb
      OR NEW.completed_intervening_exposure IS NOT NULL OR NEW.exposure_confirmed_at IS NOT NULL
      OR NEW.exposure_confirmed_by IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy Retention rows cannot carry CAP-06 declaration authority' USING ERRCODE='23514';
    END IF;
    IF tenant_id IS NOT NULL AND (NOT foundry_private.entity_in_tenant('RETRY',NEW.retry_id,tenant_id)
      OR (NEW.evidence_unit_id IS NOT NULL AND NOT foundry_private.entity_in_tenant('EVIDENCE',NEW.evidence_unit_id,tenant_id))) THEN
      RAISE EXCEPTION 'Retention tenant lineage mismatch' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM foundry_product.retry_attempts activity
    WHERE activity.id=NEW.retry_id AND activity.activity_type='RETENTION' AND activity.idempotency_key IS NOT NULL
      AND activity.institution_id=foundry_private.current_institution_id()
      AND activity.scheduled_for=NEW.due_at
      AND NEW.due_at>=activity.assigned_at+(NEW.declared_delay_seconds * interval '1 second')
      AND NEW.created_at=activity.assigned_at
      AND NEW.declared_delay_seconds>0
      AND length(btrim(NEW.intervening_exposure->>'detail'))>0
      AND NEW.intervening_exposure->>'kind' IN ('NONE_DECLARED','SAME_CONTENT','RELATED_CONTENT','UNKNOWN')
      AND length(btrim(NEW.content_equivalence->>'rationale'))>=5
      AND NEW.content_equivalence->>'kind' IN ('EXACT','EQUIVALENT_FORM','SAME_CONCEPT_DIFFERENT_ITEM')
      AND length(btrim(NEW.assistance_policy->>'allowed'))>0
      AND NEW.assistance_policy->>'kind' IN ('INDEPENDENT','STANDARD_SUPPORT','DECLARED_ASSISTANCE')
      AND (NEW.evidence_unit_id IS NULL OR foundry_private.entity_in_tenant('EVIDENCE',NEW.evidence_unit_id,activity.institution_id))
      AND (NEW.completed_at IS NULL OR (
        activity.status IN ('REVIEWED','ESCALATED') AND NEW.completed_at>=NEW.due_at
        AND NEW.completed_at<=clock_timestamp()
        AND NEW.exposure_confirmed_at=NEW.completed_at AND NEW.exposure_confirmed_by=actor_id
        AND EXISTS (
          SELECT 1 FROM foundry_product.governance_events event
          WHERE event.id=activity.latest_transition_event_id AND event.entity_type='GOVERNED_FOLLOWUP'
            AND event.entity_id=activity.id AND event.actor_user_id=NEW.exposure_confirmed_by
            AND event.payload->>'toStatus'=activity.status
            AND (event.payload->>'recordedAt')::timestamptz<=NEW.completed_at
        )
        AND length(btrim(NEW.completed_intervening_exposure->>'detail'))>0
        AND NEW.completed_intervening_exposure->>'kind' IN ('NONE_DECLARED','SAME_CONTENT','RELATED_CONTENT','UNKNOWN')
        AND EXISTS (
          SELECT 1 FROM foundry_product.institution_memberships membership
          JOIN foundry_product.course_enrollments enrollment
            ON enrollment.user_id=membership.user_id AND enrollment.institution_id=membership.institution_id
          WHERE membership.user_id=NEW.exposure_confirmed_by AND membership.institution_id=activity.institution_id
            AND membership.role='TEACHER' AND enrollment.course_id=activity.course_id AND enrollment.role='TEACHER'
        )
      ))
  ) THEN RAISE EXCEPTION 'Retention delay/dueAt/declaration is not bound to the persisted assignment' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_retention_guard"() FROM PUBLIC;
CREATE TRIGGER "_authority_tenant_lineage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "foundry_product"."retention_reviews"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_retention_guard"();
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
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.command_type='CREATE_GOVERNED_FOLLOWUP' THEN
    RAISE EXCEPTION 'Governed follow-up idempotency reservation is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.command_type='CREATE_GOVERNED_FOLLOWUP' THEN
    IF actor_id IS NULL THEN
      RAISE EXCEPTION 'Governed follow-up reservation requires an authenticated actor' USING ERRCODE='23514';
    END IF;
    IF NEW.actor_user_id IS NULL THEN NEW.actor_user_id := actor_id; END IF;
    IF NEW.actor_user_id<>actor_id OR length(btrim(NEW.request_hash))<=7 THEN
      RAISE EXCEPTION 'Governed follow-up reservation actor/request identity mismatch' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.actor_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only governed follow-up reservations may carry CAP-06 actor identity' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_idempotency_reservation_guard"() FROM PUBLIC;
CREATE TRIGGER "cap06_idempotency_reservation_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "foundry_product"."idempotency_keys"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_idempotency_reservation_guard"();

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_assert_followup_complete"(p_activity_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE activity foundry_product.retry_attempts%ROWTYPE;
        episode foundry_product.learning_episodes%ROWTYPE;
        context_item foundry_product.context_items%ROWTYPE;
        transition foundry_product.governance_events%ROWTYPE;
        reservation foundry_product.idempotency_keys%ROWTYPE;
        expected_context_reason text;
BEGIN
  SELECT * INTO activity FROM foundry_product.retry_attempts WHERE id=p_activity_id;
  IF NOT FOUND OR activity.idempotency_key IS NULL THEN RETURN; END IF;

  IF activity.activity_type='RETRY' AND (
      EXISTS (SELECT 1 FROM foundry_product.transfer_activities extension WHERE extension.retry_id=activity.id)
      OR EXISTS (SELECT 1 FROM foundry_product.retention_reviews extension WHERE extension.retry_id=activity.id)
    ) THEN
    RAISE EXCEPTION 'CAP-06 Retry cannot carry Transfer or Retention declaration authority' USING ERRCODE='23514';
  ELSIF activity.activity_type='TRANSFER' AND (
      NOT EXISTS (SELECT 1 FROM foundry_product.transfer_activities extension
        WHERE extension.retry_id=activity.id AND extension.contract_version='CAP06_V1')
      OR EXISTS (SELECT 1 FROM foundry_product.retention_reviews extension WHERE extension.retry_id=activity.id)
    ) THEN
    RAISE EXCEPTION 'CAP-06 Transfer requires exactly its CAP06_V1 declaration and no Retention declaration' USING ERRCODE='23514';
  ELSIF activity.activity_type='RETENTION' AND (
      NOT EXISTS (SELECT 1 FROM foundry_product.retention_reviews extension
        WHERE extension.retry_id=activity.id AND extension.contract_version='CAP06_V1')
      OR EXISTS (SELECT 1 FROM foundry_product.transfer_activities extension WHERE extension.retry_id=activity.id)
    ) THEN
    RAISE EXCEPTION 'CAP-06 Retention requires exactly its CAP06_V1 declaration and no Transfer declaration' USING ERRCODE='23514';
  END IF;

  SELECT * INTO reservation FROM foundry_product.idempotency_keys candidate
  WHERE candidate.institution_id=activity.institution_id
    AND candidate.command_type='CREATE_GOVERNED_FOLLOWUP'
    AND candidate.key=activity.idempotency_key;
  IF NOT FOUND OR reservation.result_id<>activity.id OR reservation.actor_user_id<>activity.actor_user_id
    OR reservation.request_hash<>activity.assignment_request_hash THEN
    RAISE EXCEPTION 'Governed follow-up idempotency reservation does not match actor/tenant/request/result identity' USING ERRCODE='23514';
  END IF;

  SELECT * INTO episode FROM foundry_product.learning_episodes WHERE id=activity.target_episode_id;
  SELECT * INTO context_item FROM foundry_product.context_items WHERE id=activity.context_item_id;
  SELECT * INTO transition FROM foundry_product.governance_events WHERE id=activity.latest_transition_event_id;
  IF episode.id IS NULL OR context_item.id IS NULL OR transition.id IS NULL
    OR transition.entity_type<>'GOVERNED_FOLLOWUP' OR transition.entity_id<>activity.id
    OR transition.payload->>'toStatus'<>activity.status THEN
    RAISE EXCEPTION 'Governed follow-up commit lacks its exact Episode, ContextItem or latest transition' USING ERRCODE='23514';
  END IF;

  IF activity.status IN ('ASSIGNED','IN_PROGRESS','WAITING_FOR_REVIEW','FAILED_RECOVERABLE') THEN
    IF context_item.state<>'ACTIVE' OR context_item.invalidated_at IS NOT NULL
      OR context_item.invalidation_reason IS NOT NULL OR context_item.successor_id IS NOT NULL THEN
      RAISE EXCEPTION 'Live governed follow-up requires its exact ACTIVE ContextItem' USING ERRCODE='23514';
    END IF;
  ELSE
    expected_context_reason := CASE activity.status
      WHEN 'REVIEWED' THEN 'Governed follow-up ended with an authorized teacher review'
      WHEN 'ESCALATED' THEN 'Governed follow-up ended with an authorized teacher escalation'
      ELSE transition.payload->>'reason'
    END;
    IF context_item.state<>'INVALIDATED' OR context_item.invalidated_at IS NULL
      OR context_item.invalidation_reason IS DISTINCT FROM expected_context_reason
      OR context_item.invalidated_at IS DISTINCT FROM episode.ended_at
      OR context_item.invalidated_at<(transition.payload->>'recordedAt')::timestamptz
      OR context_item.successor_id IS NOT NULL THEN
      RAISE EXCEPTION 'Terminal governed follow-up requires exact ContextItem invalidation provenance/reason/time' USING ERRCODE='23514';
    END IF;
  END IF;

  IF activity.status IN ('REVIEWED','ESCALATED') AND NOT EXISTS (
    SELECT 1
    FROM foundry_product.teacher_reviews review
    JOIN foundry_product.institution_memberships membership
      ON membership.user_id=review.teacher_id AND membership.institution_id=activity.institution_id AND membership.role='TEACHER'
    JOIN foundry_product.course_enrollments enrollment
      ON enrollment.user_id=review.teacher_id AND enrollment.institution_id=activity.institution_id
      AND enrollment.course_id=activity.course_id AND enrollment.role='TEACHER'
    WHERE review.id=activity.result_review_id AND review.observation_id=activity.result_observation_id
      AND review.teacher_id=transition.actor_user_id
      AND ((activity.status='REVIEWED' AND review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT'))
        OR (activity.status='ESCALATED' AND review.decision='ESCALATE'))
      AND review.actor_provenance->>'userId'=review.teacher_id::text
      AND review.actor_provenance->>'institutionId'=activity.institution_id::text
      AND review.actor_provenance->'roles' @> '["TEACHER"]'::jsonb
      AND review.actor_provenance->>'authMethod' NOT LIKE 'migrated-%'
      AND transition.payload->>'actorUserId'=review.teacher_id::text
  ) THEN
    RAISE EXCEPTION 'Governed result TeacherReview author/provenance/transition/current course authority mismatch' USING ERRCODE='23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_assert_followup_complete"(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_followup_commit_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE activity_id uuid;
BEGIN
  IF TG_TABLE_NAME='retry_attempts' THEN
    activity_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME IN ('transfer_activities','retention_reviews') THEN
    activity_id := CASE WHEN TG_OP='DELETE' THEN OLD.retry_id ELSE NEW.retry_id END;
  ELSIF TG_TABLE_NAME='context_items' THEN
    IF NEW.kind<>'GOVERNED_FOLLOWUP' THEN RETURN NULL; END IF;
    activity_id := NULLIF(NEW.payload->>'followupId','')::uuid;
  ELSIF TG_TABLE_NAME='idempotency_keys' THEN
    IF (CASE WHEN TG_OP='DELETE' THEN OLD.command_type ELSE NEW.command_type END)<>'CREATE_GOVERNED_FOLLOWUP' THEN RETURN NULL; END IF;
    activity_id := CASE WHEN TG_OP='DELETE' THEN OLD.result_id ELSE NEW.result_id END;
    IF TG_OP<>'DELETE' AND NOT EXISTS (
      SELECT 1 FROM foundry_product.retry_attempts activity
      WHERE activity.id=NEW.result_id AND activity.idempotency_key IS NOT NULL
        AND activity.institution_id=NEW.institution_id AND activity.idempotency_key=NEW.key
        AND activity.actor_user_id=NEW.actor_user_id AND activity.assignment_request_hash=NEW.request_hash
    ) THEN
      RAISE EXCEPTION 'Governed follow-up reservation must resolve to its exact governed activity at commit' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='teacher_reviews' THEN
    FOR activity_id IN
      SELECT activity.id FROM foundry_product.retry_attempts activity
      WHERE activity.result_review_id=NEW.id AND activity.idempotency_key IS NOT NULL
    LOOP
      PERFORM foundry_private.cap06_assert_followup_complete(activity_id);
    END LOOP;
    RETURN NULL;
  END IF;
  PERFORM foundry_private.cap06_assert_followup_complete(activity_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_followup_commit_guard"() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "cap06_followup_commit_guard" AFTER INSERT OR UPDATE ON "foundry_product"."retry_attempts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_followup_commit_guard"();
CREATE CONSTRAINT TRIGGER "cap06_followup_commit_guard" AFTER INSERT OR UPDATE OR DELETE ON "foundry_product"."transfer_activities"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_followup_commit_guard"();
CREATE CONSTRAINT TRIGGER "cap06_followup_commit_guard" AFTER INSERT OR UPDATE OR DELETE ON "foundry_product"."retention_reviews"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_followup_commit_guard"();
CREATE CONSTRAINT TRIGGER "cap06_followup_commit_guard" AFTER INSERT OR UPDATE ON "foundry_product"."context_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_followup_commit_guard"();
CREATE CONSTRAINT TRIGGER "cap06_followup_commit_guard" AFTER INSERT OR UPDATE OR DELETE ON "foundry_product"."idempotency_keys"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_followup_commit_guard"();
CREATE CONSTRAINT TRIGGER "cap06_followup_commit_guard" AFTER INSERT OR UPDATE ON "foundry_product"."teacher_reviews"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_followup_commit_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_diagnosis_matches_episode"(
  p_observation_id uuid,p_attempt_id uuid,p_task_id uuid,p_target_episode_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM foundry_product.learner_attempts attempt
    WHERE attempt.id=p_attempt_id AND attempt.task_id=p_task_id AND attempt.episode_id=p_target_episode_id
  ) OR EXISTS (
    SELECT 1 FROM foundry_product.retry_attempts activity
    JOIN foundry_product.learner_attempts attempt ON attempt.id=activity.original_attempt_id
    JOIN foundry_product.diagnostic_observations observation ON observation.id=activity.reviewed_observation_id AND observation.attempt_id=attempt.id
    JOIN foundry_product.teacher_reviews review ON review.id=activity.teacher_review_id AND review.observation_id=observation.id
    JOIN foundry_product.learning_episodes source_episode ON source_episode.id=activity.source_episode_id AND source_episode.id=attempt.episode_id
    JOIN foundry_product.learning_episodes target_episode ON target_episode.id=activity.target_episode_id AND target_episode.predecessor_episode_id=source_episode.id
    JOIN foundry_product.context_items context_item ON context_item.id=activity.context_item_id
    WHERE activity.task_id=p_task_id AND activity.target_episode_id=p_target_episode_id
      AND activity.original_attempt_id=p_attempt_id AND activity.reviewed_observation_id=p_observation_id
      AND activity.idempotency_key IS NOT NULL AND activity.status NOT IN ('CANCELLED','FAILED_FINAL')
      AND source_episode.task_id=p_task_id AND target_episode.task_id=p_task_id AND target_episode.purpose=activity.activity_type
      AND context_item.task_id=p_task_id AND context_item.episode_id=p_target_episode_id
      AND context_item.kind='GOVERNED_FOLLOWUP' AND context_item.state='ACTIVE'
      AND context_item.payload->>'followupId'=activity.id::text
      AND activity.source_lineage->>'learnerAttemptId'=attempt.id::text
      AND activity.source_lineage->>'diagnosticObservationId'=observation.id::text
      AND activity.source_lineage->>'teacherReviewId'=review.id::text
      AND activity.source_lineage->>'sourceEpisodeId'=source_episode.id::text
      AND review.actor_provenance->>'institutionId'=activity.institution_id::text
      AND review.actor_provenance->>'userId'=review.teacher_id::text
      AND review.actor_provenance->>'authMethod' NOT LIKE 'migrated-%'
      AND review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')
  )
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_diagnosis_matches_episode"(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "foundry_private"."cap06_diagnosis_matches_episode"(uuid,uuid,uuid,uuid) TO foundry_product_runtime;

-- Preserve every CAP-02/03/04 guard clause and replace only their former
-- same-Episode Diagnosis predicate with the bounded CAP-06 relation above.
DO $$
DECLARE function_name text; definition text; strict_clause text := 'attempt.task_id=NEW.task_id AND attempt.episode_id=NEW.episode_id';
        governed_clause text := 'attempt.task_id=NEW.task_id AND foundry_private.cap06_diagnosis_matches_episode(observation.id,attempt.id,NEW.task_id,NEW.episode_id)';
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'foundry_private.cap02_capability_resolution_lineage_guard()',
    'foundry_private.cap03_activity_plan_lineage_guard()',
    'foundry_private.cap04_activity_plan_guard()'
  ] LOOP
    SELECT pg_get_functiondef(function_name::regprocedure) INTO definition;
    IF position(strict_clause IN definition)=0 THEN
      RAISE EXCEPTION 'CAP-06 expected guarded predicate is absent from %',function_name USING ERRCODE='23514';
    END IF;
    definition := replace(definition,strict_clause,governed_clause);
    IF position(strict_clause IN definition)>0 THEN
      RAISE EXCEPTION 'CAP-06 did not replace every guarded predicate in %',function_name USING ERRCODE='23514';
    END IF;
    EXECUTE definition;
  END LOOP;
END $$;
--> statement-breakpoint

-- Compatibility boundary: existing retry/transfer/retention rows retain their
-- pre-CAP-06 shape and are labelled LEGACY_UNVERIFIED. No historical row is
-- upgraded into governed authority and no Outcome/mastery row is touched.

--> statement-breakpoint
-- CAP-06 write boundary: ordinary learner writes remain confined to the open
-- ACTIVE GENERAL Episode. The only write path into a governed successor is the
-- exact RuntimeDelivery/ActivityPlan lineage while that activity is IN_PROGRESS.
CREATE OR REPLACE FUNCTION "foundry_private"."cap06_attempt_episode_writable"(
  p_task_id uuid,p_episode_id uuid,p_activity_plan_id uuid,p_runtime_delivery_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
    FROM foundry_product.learning_tasks task
    JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id
    WHERE task.id=p_task_id AND episode.id=p_episode_id AND task.status='OPEN' AND episode.status='ACTIVE'
      AND (
        (episode.purpose='GENERAL'
          AND (NULLIF(current_setting('foundry.user_id',true),'') IS NULL OR (
            task.learner_id=NULLIF(current_setting('foundry.user_id',true),'')::uuid
            AND position('LEARNER' in COALESCE(current_setting('foundry.roles',true),''))>0
          ))
          AND NOT EXISTS (
            SELECT 1 FROM foundry_product.retry_attempts active_followup
            WHERE active_followup.task_id=task.id AND active_followup.idempotency_key IS NOT NULL
              AND active_followup.status NOT IN ('REVIEWED','ESCALATED','CANCELLED','FAILED_FINAL')
          ))
        OR (episode.purpose IN ('RETRY','TRANSFER','RETENTION')
          AND p_activity_plan_id IS NOT NULL AND p_runtime_delivery_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM foundry_product.retry_attempts activity
          JOIN foundry_product.runtime_deliveries delivery ON delivery.id=p_runtime_delivery_id
          JOIN foundry_product.activity_plans plan ON plan.id=p_activity_plan_id AND plan.id=delivery.activity_plan_id
          WHERE activity.task_id=task.id AND activity.target_episode_id=episode.id
            AND activity.idempotency_key IS NOT NULL AND activity.activity_type=episode.purpose AND activity.status='IN_PROGRESS'
            AND activity.learner_id=NULLIF(current_setting('foundry.user_id',true),'')::uuid
            AND position('LEARNER' in COALESCE(current_setting('foundry.roles',true),''))>0
            AND activity.activity_plan_proposal_id=plan.activity_plan_proposal_id
            AND delivery.task_id=task.id AND delivery.episode_id=episode.id AND delivery.learner_id=activity.learner_id
            AND plan.task_id=task.id AND plan.episode_id=episode.id
            AND delivery.status IN ('PENDING','RUNNING','SUCCEEDED')
            AND (activity.activity_type<>'RETENTION' OR (activity.scheduled_for IS NOT NULL
              AND activity.scheduled_for<=CURRENT_TIMESTAMP AND delivery.started_at>=activity.scheduled_for))
        ))
      )
  )
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_attempt_episode_writable"(uuid,uuid,uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "foundry_private"."cap06_learner_write_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME IN ('conversation_events','learner_attempts') THEN
    IF TG_OP='UPDATE' AND (OLD.task_id,OLD.episode_id) IS DISTINCT FROM (NEW.task_id,NEW.episode_id) THEN
      RAISE EXCEPTION 'Learner write Task and Episode scope are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME='conversation_events' THEN
    IF TG_OP='UPDATE' THEN
      RAISE EXCEPTION 'ConversationEvents are append-only; corrections require supersedes_event_id' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM foundry_product.learning_tasks task
      JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id
      WHERE task.id=NEW.task_id AND episode.id=NEW.episode_id
        AND task.status='OPEN' AND episode.status='ACTIVE' AND episode.purpose='GENERAL'
        AND (NULLIF(current_setting('foundry.user_id',true),'') IS NULL OR (
          task.learner_id=NULLIF(current_setting('foundry.user_id',true),'')::uuid
          AND position('LEARNER' in COALESCE(current_setting('foundry.roles',true),''))>0
        ))
        AND NOT EXISTS (
          SELECT 1 FROM foundry_product.retry_attempts activity
          WHERE activity.task_id=task.id AND activity.idempotency_key IS NOT NULL
            AND activity.status NOT IN ('REVIEWED','ESCALATED','CANCELLED','FAILED_FINAL')
        )
    ) THEN RAISE EXCEPTION 'Generic ConversationEvent requires an ACTIVE GENERAL Episode' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='learner_attempts' THEN
    IF TG_OP='UPDATE' AND (OLD.learner_id,OLD.prompt,OLD.response,OLD.structured_input,OLD.file_asset_id,OLD.source_refs,OLD.capability_id,
        OLD.capability_version_id,OLD.activity_plan_id,OLD.runtime_delivery_id,OLD.modality,OLD.content_hash,
        OLD.assistance_provenance,OLD.created_at)
      IS DISTINCT FROM
      (NEW.learner_id,NEW.prompt,NEW.response,NEW.structured_input,NEW.file_asset_id,NEW.source_refs,NEW.capability_id,
        NEW.capability_version_id,NEW.activity_plan_id,NEW.runtime_delivery_id,NEW.modality,NEW.content_hash,
        NEW.assistance_provenance,NEW.created_at) THEN
      RAISE EXCEPTION 'LearnerAttempt evidence is immutable' USING ERRCODE='23514';
    END IF;
    IF NOT foundry_private.cap06_attempt_episode_writable(
      NEW.task_id,NEW.episode_id,NEW.activity_plan_id,NEW.runtime_delivery_id
    ) THEN
      RAISE EXCEPTION 'LearnerAttempt is outside the writable Episode/runtime scope' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='file_assets' THEN
    IF TG_OP='UPDATE' AND (OLD.id,OLD.institution_id,OLD.course_id,OLD.task_id,OLD.owner_user_id,OLD.source_id,
        OLD.source_asset_id,OLD.purpose,OLD.storage_key,OLD.original_name,OLD.media_type,OLD.byte_size,OLD.content_hash,OLD.created_at)
      IS DISTINCT FROM
      (NEW.id,NEW.institution_id,NEW.course_id,NEW.task_id,NEW.owner_user_id,NEW.source_id,
        NEW.source_asset_id,NEW.purpose,NEW.storage_key,NEW.original_name,NEW.media_type,NEW.byte_size,NEW.content_hash,NEW.created_at) THEN
      RAISE EXCEPTION 'FileAsset identity and Task scope are immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
    IF NEW.task_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM foundry_product.learning_tasks task
      JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id
      WHERE task.id=NEW.task_id AND task.status='OPEN' AND episode.status='ACTIVE' AND episode.purpose='GENERAL'
        AND task.learner_id=NEW.owner_user_id
        AND NOT EXISTS (
          SELECT 1 FROM foundry_product.retry_attempts activity
          WHERE activity.task_id=task.id AND activity.idempotency_key IS NOT NULL
            AND activity.status NOT IN ('REVIEWED','ESCALATED','CANCELLED','FAILED_FINAL')
        )
    ) THEN RAISE EXCEPTION 'Task-bound FileAsset requires the current writable GENERAL Episode' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "foundry_private"."cap06_learner_write_guard"() FROM PUBLIC;
CREATE TRIGGER "cap06_learner_write_scope_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."conversation_events"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_learner_write_guard"();
CREATE TRIGGER "cap06_learner_write_scope_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learner_attempts"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_learner_write_guard"();
CREATE TRIGGER "cap06_learner_write_scope_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."file_assets"
  FOR EACH ROW EXECUTE FUNCTION "foundry_private"."cap06_learner_write_guard"();
