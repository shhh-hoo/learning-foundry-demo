import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadProductStateMigrations, runProductStateMigrations } from "../scripts/lib/product-state-migrations";
import { PostgresProductStateRepository } from "../src/product-state/postgres-product-state-repository";
import { LegacyExperienceImporter } from "../src/product-state/legacy-experience-importer";
import { ProductStateCutoverService } from "../src/product-state/product-state-cutover";
import { ProductStateService } from "../src/product-state/product-state-service";

const connectionString = process.env.PRODUCT_STATE_TEST_DATABASE_URL;
const describeWithDatabase = connectionString ? describe : describe.skip;
const at = "2026-07-18T10:00:00.000Z";

describeWithDatabase("Postgres canonical Product State", () => {
  const pool = new Pool({ connectionString, max: 4 });
  const repository = new PostgresProductStateRepository(pool);
  const service = new ProductStateService(repository, { now: () => at });
  const learner = { actorId: "learner-integration", role: "LEARNER" } as const;
  const teacher = { actorId: "teacher-integration", role: "TEACHER" } as const;
  const foundry = { actorId: "foundry-integration", role: "FOUNDRY" } as const;

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS product_state CASCADE");
    await runProductStateMigrations(pool);
    await runProductStateMigrations(pool);
  });

  afterAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS product_state CASCADE");
    await pool.end();
  });

  it("commits the full learning loop with its decision and outbox records in the same database", async () => {
    await service.createTask(learner, { taskId: "task-pg", goal: "Complete a governed retry", materialRefs: [] });
    await service.startEpisode(learner, { episodeId: "episode-pg", taskId: "task-pg" });
    await service.appendConversationEvent(learner, {
      eventId: "event-pg",
      taskId: "task-pg",
      episodeId: "episode-pg",
      kind: "LEARNER_MESSAGE",
      payload: { content: "My first response" },
      artifactRefs: [],
      sourceRefs: [],
      evidenceRefs: [],
    });
    await service.submitAttempt(learner, {
      attemptId: "attempt-pg-1",
      taskId: "task-pg",
      episodeId: "episode-pg",
      artifactRefs: [],
      evidenceRefs: [],
    });
    await service.recordObservation(foundry, {
      observationId: "observation-pg-1",
      attemptId: "attempt-pg-1",
      sourceRefs: [],
      evidenceRefs: [],
      provenance: { executionId: "execution-pg-1", policyVersion: "1.0.0" },
      diagnosisPayload: {
        representationVersion: "1.0.0",
        derivedAt: at,
        derivation: {
          kind: "DETERMINISTIC",
          implementationId: "integration-capability",
          implementationVersion: "1.0.0",
          sourceRecordIds: ["attempt-pg-1"],
        },
        value: { finding: "retry required" },
      },
    });
    await service.reviewObservation(teacher, {
      reviewId: "review-pg",
      observationId: "observation-pg-1",
      decision: "ACCEPT",
      rationale: "The observation is supported by the attempt.",
      evidenceRefs: [],
    });
    await service.planRetry(teacher, {
      retryAttemptId: "retry-pg",
      taskId: "task-pg",
      episodeId: "episode-pg",
      originalAttemptId: "attempt-pg-1",
      reviewId: "review-pg",
    });
    await service.submitRetry(learner, {
      retryAttemptId: "retry-pg",
      attemptId: "attempt-pg-2",
      artifactRefs: [],
      evidenceRefs: [],
    });
    await service.recordRetryResult(foundry, {
      retryAttemptId: "retry-pg",
      observationId: "observation-pg-2",
      sourceRefs: [],
      evidenceRefs: [],
      provenance: { executionId: "execution-pg-2", policyVersion: "1.0.0" },
      diagnosisPayload: {
        representationVersion: "1.0.0",
        derivedAt: at,
        derivation: {
          kind: "DETERMINISTIC",
          implementationId: "integration-capability",
          implementationVersion: "1.0.0",
          sourceRecordIds: ["attempt-pg-2"],
        },
        value: { finding: "retry complete" },
      },
    });
    await service.recordOutcome(teacher, {
      outcomeId: "outcome-pg",
      retryAttemptId: "retry-pg",
      outcomeType: "RETRY",
      result: "IMPROVED",
      evidenceRefs: [],
    });

    const loop = await service.getLearningLoop(learner, "task-pg");
    expect(loop.task.status).toBe("COMPLETED");
    expect(loop.episodes[0]?.status).toBe("COMPLETED");
    expect(loop.attempts).toHaveLength(2);
    expect(loop.observations).toHaveLength(2);
    expect(loop.retries).toEqual([expect.objectContaining({ status: "COMPLETED", attemptId: "attempt-pg-2" })]);
    expect(loop.outcomes).toEqual([expect.objectContaining({ result: "IMPROVED" })]);
    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM product_state.product_state_decision) AS decisions,
        (SELECT count(*)::int FROM product_state.outbox_message) AS outbox`,
    );
    expect(counts.rows[0]).toEqual({ decisions: 10, outbox: 10 });
    await expect(pool.query(
      "UPDATE product_state.teacher_review SET rationale = 'rewritten' WHERE id = 'review-pg'",
    )).rejects.toMatchObject({ code: "55000" });
  });

  it("allocates concurrent ConversationEvent sequences inside the write transaction", async () => {
    await service.createTask(learner, { taskId: "task-event-sequence", goal: "Serialize events", materialRefs: [] });
    await service.startEpisode(learner, { episodeId: "episode-event-sequence", taskId: "task-event-sequence" });

    const events = await Promise.all(Array.from({ length: 8 }, (_, index) => service.appendConversationEvent(learner, {
      eventId: `event-concurrent-${index}`,
      taskId: "task-event-sequence",
      episodeId: "episode-event-sequence",
      kind: "LEARNER_MESSAGE",
      payload: { index },
      artifactRefs: [],
      sourceRefs: [],
      evidenceRefs: [],
    })));

    expect(events.map((event) => event.sequence).sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const persisted = await pool.query(
      "SELECT sequence FROM product_state.conversation_event WHERE episode_id = $1 ORDER BY sequence",
      ["episode-event-sequence"],
    );
    expect(persisted.rows.map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("enforces current Review, Retry and Attempt chains at both service and database boundaries", async () => {
    await service.createTask(learner, { taskId: "task-chain-pg", goal: "Govern chain integrity", materialRefs: [] });
    await service.startEpisode(learner, { episodeId: "episode-chain-pg", taskId: "task-chain-pg" });
    await service.submitAttempt(learner, {
      attemptId: "attempt-chain-pg-1", taskId: "task-chain-pg", episodeId: "episode-chain-pg", artifactRefs: [], evidenceRefs: [],
    });
    await service.recordObservation(foundry, {
      observationId: "observation-chain-pg",
      attemptId: "attempt-chain-pg-1",
      sourceRefs: [],
      evidenceRefs: [],
      provenance: { executionId: "execution-chain-pg", policyVersion: "1.0.0" },
      diagnosisPayload: {
        representationVersion: "1.0.0",
        derivedAt: at,
        derivation: { kind: "DETERMINISTIC", implementationId: "chain-test", implementationVersion: "1.0.0", sourceRecordIds: ["attempt-chain-pg-1"] },
        value: {},
      },
    });
    await service.reviewObservation(teacher, {
      reviewId: "review-chain-root-pg", observationId: "observation-chain-pg", decision: "ACCEPT", rationale: "Root review", evidenceRefs: [],
    });
    await service.reviewObservation(teacher, {
      reviewId: "review-chain-leaf-pg",
      observationId: "observation-chain-pg",
      decision: "ACCEPT",
      rationale: "Current review",
      evidenceRefs: [],
      supersedesReviewId: "review-chain-root-pg",
    });
    await expect(service.planRetry(teacher, {
      retryAttemptId: "retry-stale-review-pg",
      taskId: "task-chain-pg",
      episodeId: "episode-chain-pg",
      originalAttemptId: "attempt-chain-pg-1",
      reviewId: "review-chain-root-pg",
    })).rejects.toThrow("CURRENT_ACTIONABLE_TEACHER_REVIEW_REQUIRED");
    await service.planRetry(teacher, {
      retryAttemptId: "retry-chain-pg",
      taskId: "task-chain-pg",
      episodeId: "episode-chain-pg",
      originalAttemptId: "attempt-chain-pg-1",
      reviewId: "review-chain-leaf-pg",
    });

    await expect(pool.query(
      `INSERT INTO product_state.teacher_review
        (id, observation_id, reviewer_id, reviewed_at, decision, rationale, evidence_refs, supersedes_review_id)
       VALUES ('review-fork-pg', 'observation-chain-pg', 'teacher-integration', $1, 'ACCEPT', 'fork', '[]'::jsonb, 'review-chain-root-pg')`,
      [at],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(
      `INSERT INTO product_state.teacher_review
        (id, observation_id, reviewer_id, reviewed_at, decision, rationale, evidence_refs, supersedes_review_id)
       VALUES ('review-after-retry-pg', 'observation-chain-pg', 'teacher-integration', $1, 'ACCEPT', 'late', '[]'::jsonb, 'review-chain-leaf-pg')`,
      [at],
    )).rejects.toMatchObject({ code: "23514" });

    await service.createTask(learner, { taskId: "task-other-pg", goal: "Other scope", materialRefs: [] });
    await service.startEpisode(learner, { episodeId: "episode-other-pg", taskId: "task-other-pg" });
    await expect(pool.query(
      `INSERT INTO product_state.learner_attempt
        (id, task_id, episode_id, submitted_at, status, artifact_refs, evidence_refs, supersedes_attempt_id)
       VALUES ('attempt-cross-scope-pg', 'task-other-pg', 'episode-other-pg', $1, 'SUBMITTED', '[]'::jsonb, '[]'::jsonb, 'attempt-chain-pg-1')`,
      [at],
    )).rejects.toMatchObject({ code: "23514" });

    await service.submitRetry(learner, {
      retryAttemptId: "retry-chain-pg", attemptId: "attempt-chain-pg-2", artifactRefs: [], evidenceRefs: [],
    });
    await expect(repository.getAttempt("attempt-chain-pg-1")).resolves.toMatchObject({ status: "SUPERSEDED" });
  });

  it("imports Legacy state idempotently and records explicit cutover acceptance", async () => {
    const importer = new LegacyExperienceImporter(repository, { now: () => at });
    const imported = await importer.import({
      snapshot: {
        conversationId: "legacy-pg",
        messages: [{ id: "legacy-message-pg", role: "USER", content: "Imported raw message" }],
        agentTraces: [{ traceId: "derived-trace" }],
        diagnoses: [],
        eventLog: [],
        library: [],
        schedule: [],
        capabilityGaps: [],
      },
      goal: "Continue imported work",
      learnerId: "learner-imported",
      importedBy: "migration-operator",
    });
    const repeated = await importer.import({
      snapshot: {
        conversationId: "legacy-pg",
        messages: [{ id: "legacy-message-pg", role: "USER", content: "Imported raw message" }],
        agentTraces: [{ traceId: "derived-trace" }],
        diagnoses: [],
        eventLog: [],
        library: [],
        schedule: [],
        capabilityGaps: [],
      },
      goal: "Continue imported work",
      learnerId: "learner-imported",
      importedBy: "migration-operator",
    });
    expect(imported.status).toBe("IMPORTED");
    expect(repeated.status).toBe("ALREADY_IMPORTED");

    const cutover = new ProductStateCutoverService(repository, { now: () => at });
    const decision = await cutover.recordImportDecision(
      { actorId: "deployment-owner", role: "SYSTEM" },
      {
        decisionId: "import-decision-pg",
        environment: "canonical-integration",
        decision: "IMPORT_COMPLETED",
        evidence: {
          environment: "canonical-integration",
          scope: "canonical-integration",
          legacyImportReceiptId: imported.receipt.id,
        },
      },
    );
    const acceptance = await cutover.accept(
      { actorId: "deployment-owner", role: "SYSTEM" },
      {
        acceptanceId: "cutover-pg",
        environment: "canonical-integration",
        mode: "POSTGRES_CANONICAL",
        notes: "Isolated migration, health and importer verified.",
      },
    );
    expect(acceptance.importerDecisionId).toBe(decision.id);
    expect(await repository.getCutoverAcceptance("canonical-integration")).toEqual(acceptance);
    await expect(pool.query(
      "DELETE FROM product_state.legacy_import_receipt WHERE id = $1",
      [imported.receipt.id],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(pool.query(
      `INSERT INTO product_state.import_decision
        (id, schema_version, environment, scope, decision, legacy_import_receipt_id, decided_at, decided_by, evidence)
       VALUES ('invalid-import-decision-pg', '1.1.0', 'other-env', 'other-env', 'IMPORT_COMPLETED',
         'missing-receipt', $1, 'operator', '{"environment":"other-env","scope":"other-env"}'::jsonb)`,
      [at],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(
      `INSERT INTO product_state.import_decision
        (id, schema_version, environment, scope, decision, decided_at, decided_by, evidence)
       VALUES ('missing-scope-evidence-pg', '1.1.0', 'other-env', 'other-env', 'NO_IMPORT_REQUIRED',
         $1, 'operator', '{}'::jsonb)`,
      [at],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("upgrades schema 1.0 import decisions without rewriting append-only records", async () => {
    await pool.query("DROP SCHEMA IF EXISTS product_state CASCADE");
    const migrations = await loadProductStateMigrations();
    await pool.query(migrations[0]!.sql);
    await pool.query(migrations[1]!.sql);
    await pool.query(
      `INSERT INTO product_state.import_decision
        (id, schema_version, environment, decision, decided_at, decided_by, evidence)
       VALUES ('legacy-schema-decision', '1.0.0', 'legacy-environment', 'NO_IMPORT_REQUIRED', $1, 'legacy-operator', '{"reason":"pre-0003"}'::jsonb)`,
      [at],
    );

    await pool.query(migrations[2]!.sql);

    const preserved = await pool.query(
      "SELECT schema_version, scope, legacy_import_receipt_id, evidence FROM product_state.import_decision WHERE id = 'legacy-schema-decision'",
    );
    expect(preserved.rows[0]).toEqual({
      schema_version: "1.0.0",
      scope: null,
      legacy_import_receipt_id: null,
      evidence: { reason: "pre-0003" },
    });
    await expect(pool.query(
      `INSERT INTO product_state.import_decision
        (id, schema_version, environment, decision, decided_at, decided_by, evidence)
       VALUES ('new-legacy-schema-decision', '1.0.0', 'legacy-environment', 'NO_IMPORT_REQUIRED', $1, 'legacy-operator', '{}'::jsonb)`,
      [at],
    )).rejects.toMatchObject({ code: "23514" });
  });
});
