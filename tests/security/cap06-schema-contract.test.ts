import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("CAP-06 governed follow-up security and honesty boundary", () => {
  it("preserves legacy tenant checks and applies stricter CAP-06 guards", async () => {
    const migration = await readFile(new URL("../../db/migrations/0010_governed_followup.sql", import.meta.url), "utf8");
    expect(migration).toContain("Retry tenant lineage mismatch");
    expect(migration).toContain("Transfer tenant lineage mismatch");
    expect(migration).toContain("Retention tenant lineage mismatch");
    expect(migration).toContain("Governed follow-up tenant mismatch");
    expect(migration).toContain("GovernanceEvents are append-only");
    expect(migration).toContain("GovernanceEvents cannot be deleted");
    expect(migration).toContain("activity.institution_id=foundry_private.current_institution_id()");
    expect(migration).not.toContain("review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT','ESCALATE')");
    expect(migration.match(/review\.decision IN \('ACCEPT','CORRECT','SUPPLEMENT'\)/g)).toHaveLength(3);
    expect(migration).toContain("cap06_attempt_episode_writable");
    expect(migration).toContain('CREATE TRIGGER "cap06_episode_identity_guard" BEFORE INSERT OR UPDATE ON "foundry_product"."learning_episodes"');
    expect(migration).toContain("Governed Episode predecessor must belong to the same Task");
    expect(migration).toContain("Episode Task, sequence, purpose and predecessor are immutable");
    expect(migration).toContain('CREATE TRIGGER "cap06_task_close_guard" BEFORE UPDATE ON "foundry_product"."learning_tasks"');
    expect(migration).toContain("Learning Task cannot close while a governed follow-up is active");
    expect(migration).toContain("A terminal Learning Task cannot be reopened");
    expect(migration).toContain("A GENERAL Episode cannot be added while a governed follow-up is active");
    expect(migration).toContain("A completed GENERAL Episode cannot be reopened");
    expect(migration).toContain("Governed Episode must be atomically aligned with its exact follow-up activity");
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW');
    expect(migration).toContain("cap06_transition_actor_authorized");
    expect(migration).toContain("Legacy retry rows cannot acquire CAP-06 authority columns");
    expect(migration).toContain("activity.idempotency_key IS NOT NULL AND activity.activity_type=episode.purpose AND activity.status='IN_PROGRESS'");
    expect(migration).toContain("plan.id=p_activity_plan_id AND plan.id=delivery.activity_plan_id");
    expect(migration).toContain("activity.activity_plan_proposal_id=plan.activity_plan_proposal_id");
    expect(migration).toContain("activity.learner_id=NULLIF(current_setting('foundry.user_id',true),'')::uuid");
    expect(migration).toContain("position('LEARNER' in COALESCE(current_setting('foundry.roles',true),''))>0");
    expect(migration).toContain("delivery.learner_id=activity.learner_id");
    expect(migration).toContain("plan.task_id=task.id AND plan.episode_id=episode.id");
    expect(migration).toContain("Generic ConversationEvent requires an ACTIVE GENERAL Episode");
    expect(migration).toContain("ConversationEvents are append-only; corrections require supersedes_event_id");
    expect(migration).toContain("LearnerAttempt is outside the writable Episode/runtime scope");
    expect(migration).toContain("LearnerAttempt evidence is immutable");
    expect(migration).toContain("Learner write Task and Episode scope are immutable");
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "foundry_product"."conversation_events"');
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "foundry_product"."learner_attempts"');
    expect(migration).toContain("Task-bound FileAsset requires the current writable GENERAL Episode");
    expect(migration).toContain("FileAsset identity and Task scope are immutable");
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "foundry_product"."file_assets"');
    expect(migration).toContain("Governed follow-up GovernanceEvent must be consumed by exact Product State in the same transaction");
    expect(migration).toContain("Execution lineage may change only with its governed status transition");
    expect(migration).toContain("Only the current course teacher may bind the exact proposal while ASSIGNED");
  });

  it("binds Transfer and Retention facts beneath the application boundary", async () => {
    const migration = await readFile(new URL("../../db/migrations/0010_governed_followup.sql", import.meta.url), "utf8");
    expect(migration).toContain("NEW.declaration->'source'=activity.source_lineage->'canonicalTransferSourceSignature'");
    expect(migration).toContain("NEW.source_lineage->'canonicalTransferSourceSignature'=jsonb_build_object(");
    expect(migration).toContain("normalize(NEW.declaration->'source'->>dimension,NFKC)");
    expect(migration).toContain("normalize(NEW.declaration->'target'->>dimension,NFKC)");
    expect(migration).toContain("NEW.changed_dimensions<>expected_dimensions");
    expect(migration).toContain("activity.scheduled_for=NEW.due_at");
    expect(migration).toContain("NEW.due_at>=activity.assigned_at+(NEW.declared_delay_seconds * interval '1 second')");
    expect(migration).toContain("NEW.created_at=activity.assigned_at");
    expect(migration).toContain('ADD COLUMN "completed_intervening_exposure" jsonb');
    expect(migration).toContain('ADD COLUMN "exposure_confirmed_at" timestamp with time zone');
    expect(migration).toContain('ADD COLUMN "exposure_confirmed_by" uuid');
    expect(migration).toContain("NEW.exposure_confirmed_at=NEW.completed_at AND NEW.exposure_confirmed_by=actor_id");
    expect(migration).toContain("NEW.completed_intervening_exposure->>'kind' IN ('NONE_DECLARED','SAME_CONTENT','RELATED_CONTENT','UNKNOWN')");
    expect(migration).toContain("Retention declaration is immutable and actual exposure confirmation is set-once");
    expect(migration).toContain("Legacy Transfer rows cannot acquire CAP-06 declaration authority");
    expect(migration).toContain("Legacy Retention rows cannot acquire CAP-06 declaration authority");
    expect(migration).toContain("Retention cannot begin before its persisted dueAt");
    expect(migration).toContain("delivery.started_at>=activity.scheduled_for");
    expect(migration).toContain("CAP-06 Transfer requires exactly its CAP06_V1 declaration and no Retention declaration");
    expect(migration).toContain("CAP-06 Retention requires exactly its CAP06_V1 declaration and no Transfer declaration");
    expect(migration).toContain("CAP-06 Retry cannot carry Transfer or Retention declaration authority");
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "cap06_followup_commit_guard" AFTER INSERT OR UPDATE OR DELETE ON "foundry_product"."transfer_activities"');
  });

  it("commit-binds review authority, Context lifecycle and idempotency identity", async () => {
    const migration = await readFile(new URL("../../db/migrations/0010_governed_followup.sql", import.meta.url), "utf8");
    expect(migration).toContain('ADD COLUMN "assignment_request_hash" text');
    expect(migration).toContain('ADD COLUMN "actor_user_id" uuid REFERENCES "foundry_product"."users"("id")');
    expect(migration).toContain("Governed follow-up idempotency reservation does not match actor/tenant/request/result identity");
    expect(migration).toContain("Governed follow-up idempotency reservation is immutable");
    expect(migration).toContain("Governed follow-up reservation must resolve to its exact governed activity at commit");
    expect(migration).toContain("Terminal governed follow-up requires exact ContextItem invalidation provenance/reason/time");
    expect(migration).toContain("Live governed follow-up requires its exact ACTIVE ContextItem");
    expect(migration).toContain("Governed result TeacherReview author/provenance/transition/current course authority mismatch");
    expect(migration).toContain("review.teacher_id=transition.actor_user_id");
    expect(migration).toContain("activity.status='REVIEWED' AND review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')");
    expect(migration).toContain("activity.status='ESCALATED' AND review.decision='ESCALATE'");
    expect(migration).toContain("enrollment.course_id=activity.course_id AND enrollment.role='TEACHER'");
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "cap06_followup_commit_guard" AFTER INSERT OR UPDATE ON "foundry_product"."teacher_reviews"');
  });

  it("has no runtime-reachable RETRY_OUTCOME graph or CAP-06 Outcome write", async () => {
    const [service, catalog, model, followup, graph] = await Promise.all([
      readFile(new URL("../../application/workflow-service.ts", import.meta.url), "utf8"),
      readFile(new URL("../../workflows/catalog.ts", import.meta.url), "utf8"),
      readFile(new URL("../../domain/model.ts", import.meta.url), "utf8"),
      readFile(new URL("../../application/governed-followup.ts", import.meta.url), "utf8"),
      readFile(new URL("../../workflows/governed-followup.ts", import.meta.url), "utf8"),
    ]);
    expect(`${service}\n${catalog}\n${model}`).not.toContain("RETRY_OUTCOME");
    await expect(access(new URL("../../workflows/retry-outcome.ts", import.meta.url))).rejects.toBeTruthy();
    expect(followup).not.toMatch(/insert\(learningOutcomes\)|createLearningOutcome/);
    expect(graph).toContain("learningOutcomeCreated: false");
    expect(graph).toContain("masteryClaim: false");
    const migration = await readFile(new URL("../../db/migrations/0010_governed_followup.sql", import.meta.url), "utf8");
    expect(migration).toContain("CAP-06 governed follow-ups cannot create LearningOutcome");
    expect(migration).toContain('CREATE TRIGGER "cap06_learning_outcome_guard" BEFORE INSERT OR UPDATE');
  });

  it("retires active legacy retry workflows without pretending they resumed", async () => {
    const migration = await readFile(new URL("../../db/migrations/0010_governed_followup.sql", import.meta.url), "utf8");
    expect(migration).toContain("workflow_kind\"='RETRY_OUTCOME'");
    expect(migration).toContain("interrupt_type\"='LEARNER_RETRY_REQUIRED'");
    expect(migration).toContain("'failureCode','LEGACY_RETRY_OUTCOME_RETIRED'");
    expect(migration).toContain("'recoveryAction','RESTART_AS_GOVERNED_FOLLOWUP'");
    expect(migration).toContain('SET "status"=\'FAILED\'');
  });

  it("renders only the ActivityPlan-selected learner capability", async () => {
    const [queries, page] = await Promise.all([
      readFile(new URL("../../application/queries.ts", import.meta.url), "utf8"),
      readFile(new URL("../../app/learner/page.tsx", import.meta.url), "utf8"),
    ]);
    expect(queries).toContain("capabilityKey: capabilities.key");
    expect(queries).toContain("activityPlanProposals.selectedCapabilityId");
    expect(page).toContain("planned?.capabilityKey");
    expect(page).toContain("capability.publicKey === planned?.capabilityKey");
  });
});
