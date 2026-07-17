import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runProductStateMigrations } from "../scripts/lib/product-state-migrations";
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
        evidence: { legacyImportReceiptId: imported.receipt.id },
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
  });
});
