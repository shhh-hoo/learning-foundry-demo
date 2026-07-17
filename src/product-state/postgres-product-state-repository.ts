import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  ConversationEvent,
  DiagnosticObservation,
  LearningEpisode,
  LearningOutcome,
  LearningTask,
  LearnerAttempt,
  ObservationCorrection,
  RetryAttempt,
  TeacherReview,
} from "../core/domain/learning";
import type {
  ConversationEventWrite,
  LearningLoopView,
  LegacyImportReceipt,
  LegacyProductStateBundle,
  ProductStateCutoverAcceptance,
  ProductStateHealth,
  ProductStateImportDecision,
  ProductStateRepository,
  ProductStateWrite,
} from "../core/ports/product-state-repository";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalJson<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function taskFrom(row: QueryResultRow): LearningTask {
  return {
    id: row.id as string,
    learnerId: row.learner_id as string,
    status: row.status as LearningTask["status"],
    goal: row.goal as string,
    createdAt: iso(row.created_at as string | Date),
    updatedAt: iso(row.updated_at as string | Date),
    materialRefs: row.material_refs as LearningTask["materialRefs"],
  };
}

function episodeFrom(row: QueryResultRow): LearningEpisode {
  const completedAt = row.completed_at as string | Date | null;
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    status: row.status as LearningEpisode["status"],
    startedAt: iso(row.started_at as string | Date),
    ...(completedAt ? { completedAt: iso(completedAt) } : {}),
  };
}

function eventFrom(row: QueryResultRow): ConversationEvent {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    episodeId: row.episode_id as string,
    sequence: row.sequence as number,
    occurredAt: iso(row.occurred_at as string | Date),
    actor: row.actor as ConversationEvent["actor"],
    kind: row.kind as string,
    payload: row.payload as ConversationEvent["payload"],
    artifactRefs: row.artifact_refs as ConversationEvent["artifactRefs"],
    sourceRefs: row.source_refs as ConversationEvent["sourceRefs"],
    evidenceRefs: row.evidence_refs as ConversationEvent["evidenceRefs"],
  };
}

function attemptFrom(row: QueryResultRow): LearnerAttempt {
  const capability = optionalJson(row.capability as LearnerAttempt["capability"] | null);
  const supersedesAttemptId = row.supersedes_attempt_id as string | null;
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    episodeId: row.episode_id as string,
    submittedAt: iso(row.submitted_at as string | Date),
    status: row.status as LearnerAttempt["status"],
    artifactRefs: row.artifact_refs as LearnerAttempt["artifactRefs"],
    evidenceRefs: row.evidence_refs as LearnerAttempt["evidenceRefs"],
    ...(capability ? { capability } : {}),
    ...(supersedesAttemptId ? { supersedesAttemptId } : {}),
  };
}

function correctionFrom(row: QueryResultRow): ObservationCorrection {
  const supersedesCorrectionId = row.supersedes_correction_id as string | null;
  return {
    id: row.id as string,
    observationId: row.observation_id as string,
    createdAt: iso(row.created_at as string | Date),
    actorId: row.actor_id as string,
    reason: row.reason as string,
    ...(supersedesCorrectionId ? { supersedesCorrectionId } : {}),
  };
}

function observationFrom(row: QueryResultRow, corrections: readonly ObservationCorrection[]): DiagnosticObservation {
  return {
    id: row.id as string,
    attemptId: row.attempt_id as string,
    status: row.status as DiagnosticObservation["status"],
    createdAt: iso(row.created_at as string | Date),
    sourceRefs: row.source_refs as DiagnosticObservation["sourceRefs"],
    evidenceRefs: row.evidence_refs as DiagnosticObservation["evidenceRefs"],
    provenance: row.provenance as DiagnosticObservation["provenance"],
    diagnosisPayload: row.diagnosis_payload as DiagnosticObservation["diagnosisPayload"],
    corrections,
  };
}

function reviewFrom(row: QueryResultRow): TeacherReview {
  const supersedesReviewId = row.supersedes_review_id as string | null;
  return {
    id: row.id as string,
    observationId: row.observation_id as string,
    reviewerId: row.reviewer_id as string,
    reviewedAt: iso(row.reviewed_at as string | Date),
    decision: row.decision as TeacherReview["decision"],
    rationale: row.rationale as string,
    evidenceRefs: row.evidence_refs as TeacherReview["evidenceRefs"],
    ...(supersedesReviewId ? { supersedesReviewId } : {}),
  };
}

function retryFrom(row: QueryResultRow): RetryAttempt {
  const attemptId = row.attempt_id as string | null;
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    episodeId: row.episode_id as string,
    originalAttemptId: row.original_attempt_id as string,
    reviewId: row.review_id as string,
    ...(attemptId ? { attemptId } : {}),
    status: row.status as RetryAttempt["status"],
    createdAt: iso(row.created_at as string | Date),
  };
}

function outcomeFrom(row: QueryResultRow): LearningOutcome {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    episodeId: row.episode_id as string,
    originalAttemptId: row.original_attempt_id as string,
    retryAttemptId: row.retry_attempt_id as string,
    recordedAt: iso(row.recorded_at as string | Date),
    outcomeType: row.outcome_type as LearningOutcome["outcomeType"],
    result: row.result as LearningOutcome["result"],
    evidenceRefs: row.evidence_refs as LearningOutcome["evidenceRefs"],
    recordedBy: row.recorded_by as string,
  };
}

function legacyImportReceiptFrom(row: QueryResultRow): LegacyImportReceipt {
  return {
    schemaVersion: row.schema_version,
    id: row.id,
    sourceSystem: row.source_system,
    sourceKey: row.source_key,
    sourceHash: row.source_hash,
    importedAt: iso(row.imported_at),
    importedBy: row.imported_by,
    taskId: row.task_id,
    details: row.details,
  } as LegacyImportReceipt;
}

async function insertAttempt(client: PoolClient, attempt: LearnerAttempt): Promise<void> {
  await client.query(
    `INSERT INTO product_state.learner_attempt
      (id, task_id, episode_id, submitted_at, status, artifact_refs, evidence_refs, capability, supersedes_attempt_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
    [
      attempt.id,
      attempt.taskId,
      attempt.episodeId,
      attempt.submittedAt,
      attempt.status,
      json(attempt.artifactRefs),
      json(attempt.evidenceRefs),
      attempt.capability ? json(attempt.capability) : null,
      attempt.supersedesAttemptId ?? null,
    ],
  );
}

async function insertObservation(client: PoolClient, observation: DiagnosticObservation): Promise<void> {
  await client.query(
    `INSERT INTO product_state.diagnostic_observation
      (id, attempt_id, status, created_at, source_refs, evidence_refs, provenance, diagnosis_payload)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)`,
    [
      observation.id,
      observation.attemptId,
      observation.status,
      observation.createdAt,
      json(observation.sourceRefs),
      json(observation.evidenceRefs),
      json(observation.provenance),
      json(observation.diagnosisPayload),
    ],
  );
}

function requireUpdated(rowCount: number | null, code: string): void {
  if (rowCount !== 1) throw new Error(code);
}

async function insertDecisionAndOutbox(
  client: PoolClient,
  decision: ProductStateWrite["decision"],
  outbox: ProductStateWrite["outbox"],
): Promise<void> {
  await client.query(
    `INSERT INTO product_state.product_state_decision
      (id, schema_version, event_type, actor_id, actor_role, aggregate_type, aggregate_id, occurred_at, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      decision.id,
      decision.schemaVersion,
      decision.eventType,
      decision.actor.actorId,
      decision.actor.role,
      decision.aggregateType,
      decision.aggregateId,
      decision.occurredAt,
      json(decision.details),
    ],
  );
  await client.query(
    `INSERT INTO product_state.outbox_message
      (id, schema_version, event_type, aggregate_type, aggregate_id, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      outbox.id,
      outbox.schemaVersion,
      outbox.eventType,
      outbox.aggregateType,
      outbox.aggregateId,
      outbox.occurredAt,
      json(outbox.payload),
    ],
  );
}

async function inRepeatableReadSnapshot<T>(pool: Pool, read: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await read(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresProductStateRepository implements ProductStateRepository {
  constructor(private readonly pool: Pool) {}

  async apply(write: ProductStateWrite): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.applyMutation(client, write);
      await insertDecisionAndOutbox(client, write.decision, write.outbox);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendConversationEvent(write: ConversationEventWrite): Promise<ConversationEvent> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      requireUpdated((await client.query(
        `SELECT id FROM product_state.learning_episode
         WHERE id = $1 AND task_id = $2 AND status = 'ACTIVE'
         FOR UPDATE`,
        [write.event.episodeId, write.event.taskId],
      )).rowCount, "ACTIVE_EPISODE_REQUIRED");
      const sequenceResult = await client.query(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM product_state.conversation_event WHERE episode_id = $1",
        [write.event.episodeId],
      );
      const event: ConversationEvent = {
        ...write.event,
        sequence: Number(sequenceResult.rows[0]?.next_sequence ?? 1),
      };
      await client.query(
        `INSERT INTO product_state.conversation_event
          (id, task_id, episode_id, sequence, occurred_at, actor, kind, payload, artifact_refs, source_refs, evidence_refs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)`,
        [
          event.id,
          event.taskId,
          event.episodeId,
          event.sequence,
          event.occurredAt,
          event.actor,
          event.kind,
          json(event.payload),
          json(event.artifactRefs),
          json(event.sourceRefs),
          json(event.evidenceRefs),
        ],
      );
      await insertDecisionAndOutbox(
        client,
        { ...write.decision, details: { ...write.decision.details, sequence: event.sequence } },
        { ...write.outbox, payload: { ...write.outbox.payload, sequence: event.sequence } },
      );
      await client.query("COMMIT");
      return event;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getTask(taskId: string): Promise<LearningTask | null> {
    const result = await this.pool.query("SELECT * FROM product_state.learning_task WHERE id = $1", [taskId]);
    return result.rows[0] ? taskFrom(result.rows[0]) : null;
  }

  async getEpisode(episodeId: string): Promise<LearningEpisode | null> {
    const result = await this.pool.query("SELECT * FROM product_state.learning_episode WHERE id = $1", [episodeId]);
    return result.rows[0] ? episodeFrom(result.rows[0]) : null;
  }

  async getAttempt(attemptId: string): Promise<LearnerAttempt | null> {
    const result = await this.pool.query("SELECT * FROM product_state.learner_attempt WHERE id = $1", [attemptId]);
    return result.rows[0] ? attemptFrom(result.rows[0]) : null;
  }

  async getObservation(observationId: string): Promise<DiagnosticObservation | null> {
    return inRepeatableReadSnapshot(this.pool, async (client) => {
      const observation = await client.query("SELECT * FROM product_state.diagnostic_observation WHERE id = $1", [observationId]);
      if (!observation.rows[0]) return null;
      const corrections = await client.query(
        "SELECT * FROM product_state.observation_correction WHERE observation_id = $1 ORDER BY created_at, id",
        [observationId],
      );
      return observationFrom(observation.rows[0], corrections.rows.map(correctionFrom));
    });
  }

  async getReview(reviewId: string): Promise<TeacherReview | null> {
    const result = await this.pool.query("SELECT * FROM product_state.teacher_review WHERE id = $1", [reviewId]);
    return result.rows[0] ? reviewFrom(result.rows[0]) : null;
  }

  async getCurrentReviewForObservation(observationId: string): Promise<TeacherReview | null> {
    const result = await this.pool.query(
      `SELECT review.*
       FROM product_state.teacher_review review
       WHERE review.observation_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM product_state.teacher_review child
           WHERE child.supersedes_review_id = review.id
         )
       LIMIT 1`,
      [observationId],
    );
    return result.rows[0] ? reviewFrom(result.rows[0]) : null;
  }

  async getRetry(retryAttemptId: string): Promise<RetryAttempt | null> {
    const result = await this.pool.query("SELECT * FROM product_state.retry_attempt WHERE id = $1", [retryAttemptId]);
    return result.rows[0] ? retryFrom(result.rows[0]) : null;
  }

  async getOutcomeForRetry(retryAttemptId: string): Promise<LearningOutcome | null> {
    const result = await this.pool.query("SELECT * FROM product_state.learning_outcome WHERE retry_attempt_id = $1", [retryAttemptId]);
    return result.rows[0] ? outcomeFrom(result.rows[0]) : null;
  }

  async getLearningLoop(taskId: string): Promise<LearningLoopView | null> {
    return inRepeatableReadSnapshot(this.pool, async (client) => {
      const task = await client.query("SELECT * FROM product_state.learning_task WHERE id = $1", [taskId]);
      if (!task.rows[0]) return null;
      const episodes = await client.query("SELECT * FROM product_state.learning_episode WHERE task_id = $1 ORDER BY started_at, id", [taskId]);
      const events = await client.query("SELECT * FROM product_state.conversation_event WHERE task_id = $1 ORDER BY occurred_at, sequence, id", [taskId]);
      const attempts = await client.query("SELECT * FROM product_state.learner_attempt WHERE task_id = $1 ORDER BY submitted_at, id", [taskId]);
      const observations = await client.query(
        `SELECT observation.* FROM product_state.diagnostic_observation observation
         JOIN product_state.learner_attempt attempt ON attempt.id = observation.attempt_id
         WHERE attempt.task_id = $1 ORDER BY observation.created_at, observation.id`,
        [taskId],
      );
      const corrections = await client.query(
        `SELECT correction.* FROM product_state.observation_correction correction
         JOIN product_state.diagnostic_observation observation ON observation.id = correction.observation_id
         JOIN product_state.learner_attempt attempt ON attempt.id = observation.attempt_id
         WHERE attempt.task_id = $1 ORDER BY correction.created_at, correction.id`,
        [taskId],
      );
      const reviews = await client.query(
        `SELECT review.* FROM product_state.teacher_review review
         JOIN product_state.diagnostic_observation observation ON observation.id = review.observation_id
         JOIN product_state.learner_attempt attempt ON attempt.id = observation.attempt_id
         WHERE attempt.task_id = $1 ORDER BY review.reviewed_at, review.id`,
        [taskId],
      );
      const retries = await client.query("SELECT * FROM product_state.retry_attempt WHERE task_id = $1 ORDER BY created_at, id", [taskId]);
      const outcomes = await client.query("SELECT * FROM product_state.learning_outcome WHERE task_id = $1 ORDER BY recorded_at, id", [taskId]);
      const correctionRecords = corrections.rows.map(correctionFrom);
      return {
        task: taskFrom(task.rows[0]),
        episodes: episodes.rows.map(episodeFrom),
        conversationEvents: events.rows.map(eventFrom),
        attempts: attempts.rows.map(attemptFrom),
        observations: observations.rows.map((row) => observationFrom(
          row,
          correctionRecords.filter((item) => item.observationId === row.id),
        )),
        reviews: reviews.rows.map(reviewFrom),
        retries: retries.rows.map(retryFrom),
        outcomes: outcomes.rows.map(outcomeFrom),
      };
    });
  }

  async health(): Promise<ProductStateHealth> {
    try {
      const [result, readOnlyResult] = await Promise.all([
        this.pool.query("SELECT version FROM product_state.schema_migration ORDER BY version DESC LIMIT 1"),
        this.pool.query("SHOW transaction_read_only"),
      ]);
      const readOnly = readOnlyResult.rows[0]?.transaction_read_only === "on";
      return {
        ready: result.rows[0]?.version === "0003" && !readOnly,
        schemaVersion: (result.rows[0]?.version as string | undefined) ?? null,
        readOnly,
      };
    } catch {
      return { ready: false, schemaVersion: null, readOnly: false };
    }
  }

  async getLegacyImportReceipt(sourceSystem: "LEGACY_SHOWCASE", sourceKey: string): Promise<LegacyImportReceipt | null> {
    const result = await this.pool.query(
      `SELECT * FROM product_state.legacy_import_receipt
       WHERE source_system = $1 AND source_key = $2`,
      [sourceSystem, sourceKey],
    );
    const row = result.rows[0];
    return row ? legacyImportReceiptFrom(row) : null;
  }

  async getLegacyImportReceiptById(receiptId: string): Promise<LegacyImportReceipt | null> {
    const result = await this.pool.query(
      "SELECT * FROM product_state.legacy_import_receipt WHERE id = $1",
      [receiptId],
    );
    return result.rows[0] ? legacyImportReceiptFrom(result.rows[0]) : null;
  }

  async importLegacyBundle(bundle: LegacyProductStateBundle): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO product_state.learning_task
          (id, learner_id, status, goal, material_refs, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [bundle.task.id, bundle.task.learnerId, bundle.task.status, bundle.task.goal, json(bundle.task.materialRefs), bundle.task.createdAt, bundle.task.updatedAt],
      );
      await client.query(
        `INSERT INTO product_state.learning_episode
          (id, task_id, status, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [bundle.episode.id, bundle.episode.taskId, bundle.episode.status, bundle.episode.startedAt, bundle.episode.completedAt ?? null],
      );
      for (const event of bundle.conversationEvents) {
        await client.query(
          `INSERT INTO product_state.conversation_event
            (id, task_id, episode_id, sequence, occurred_at, actor, kind, payload, artifact_refs, source_refs, evidence_refs)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)`,
          [
            event.id,
            event.taskId,
            event.episodeId,
            event.sequence,
            event.occurredAt,
            event.actor,
            event.kind,
            json(event.payload),
            json(event.artifactRefs),
            json(event.sourceRefs),
            json(event.evidenceRefs),
          ],
        );
      }
      await client.query(
        `INSERT INTO product_state.legacy_import_receipt
          (id, schema_version, source_system, source_key, source_hash, imported_at, imported_by, task_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          bundle.receipt.id,
          bundle.receipt.schemaVersion,
          bundle.receipt.sourceSystem,
          bundle.receipt.sourceKey,
          bundle.receipt.sourceHash,
          bundle.receipt.importedAt,
          bundle.receipt.importedBy,
          bundle.receipt.taskId,
          json(bundle.receipt.details),
        ],
      );
      await client.query(
        `INSERT INTO product_state.product_state_decision
          (id, schema_version, event_type, actor_id, actor_role, aggregate_type, aggregate_id, occurred_at, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          bundle.decision.id,
          bundle.decision.schemaVersion,
          bundle.decision.eventType,
          bundle.decision.actor.actorId,
          bundle.decision.actor.role,
          bundle.decision.aggregateType,
          bundle.decision.aggregateId,
          bundle.decision.occurredAt,
          json(bundle.decision.details),
        ],
      );
      await client.query(
        `INSERT INTO product_state.outbox_message
          (id, schema_version, event_type, aggregate_type, aggregate_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          bundle.outbox.id,
          bundle.outbox.schemaVersion,
          bundle.outbox.eventType,
          bundle.outbox.aggregateType,
          bundle.outbox.aggregateId,
          bundle.outbox.occurredAt,
          json(bundle.outbox.payload),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordImportDecision(decision: ProductStateImportDecision): Promise<void> {
    await this.pool.query(
      `INSERT INTO product_state.import_decision
        (id, schema_version, environment, scope, decision, legacy_import_receipt_id, decided_at, decided_by, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        decision.id,
        decision.schemaVersion,
        decision.environment,
        decision.scope,
        decision.decision,
        decision.legacyImportReceiptId ?? null,
        decision.decidedAt,
        decision.decidedBy,
        json(decision.evidence),
      ],
    );
  }

  async getImportDecision(environment: string): Promise<ProductStateImportDecision | null> {
    const result = await this.pool.query(
      `SELECT * FROM product_state.import_decision
       WHERE environment = $1 ORDER BY decided_at DESC, id DESC LIMIT 1`,
      [environment],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      schemaVersion: row.schema_version,
      id: row.id,
      environment: row.environment,
      scope: row.scope,
      decision: row.decision,
      ...(row.legacy_import_receipt_id ? { legacyImportReceiptId: row.legacy_import_receipt_id } : {}),
      decidedAt: iso(row.decided_at),
      decidedBy: row.decided_by,
      evidence: row.evidence,
    } as ProductStateImportDecision;
  }

  async recordCutoverAcceptance(acceptance: ProductStateCutoverAcceptance): Promise<void> {
    await this.pool.query(
      `INSERT INTO product_state.cutover_acceptance
        (id, schema_version, environment, mode, accepted_at, accepted_by, migration_version,
         database_ready, importer_decision_id, dual_write, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        acceptance.id,
        acceptance.schemaVersion,
        acceptance.environment,
        acceptance.mode,
        acceptance.acceptedAt,
        acceptance.acceptedBy,
        acceptance.migrationVersion,
        acceptance.databaseReady,
        acceptance.importerDecisionId,
        acceptance.dualWrite,
        acceptance.notes,
      ],
    );
  }

  async getCutoverAcceptance(environment: string): Promise<ProductStateCutoverAcceptance | null> {
    const result = await this.pool.query(
      "SELECT * FROM product_state.cutover_acceptance WHERE environment = $1 AND mode = 'POSTGRES_CANONICAL'",
      [environment],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      schemaVersion: row.schema_version,
      id: row.id,
      environment: row.environment,
      mode: row.mode,
      acceptedAt: iso(row.accepted_at),
      acceptedBy: row.accepted_by,
      migrationVersion: row.migration_version,
      databaseReady: row.database_ready,
      importerDecisionId: row.importer_decision_id,
      dualWrite: row.dual_write,
      notes: row.notes,
    } as ProductStateCutoverAcceptance;
  }

  private async applyMutation(client: PoolClient, write: ProductStateWrite): Promise<void> {
    const mutation = write.mutation;
    switch (mutation.kind) {
      case "CREATE_TASK":
        await client.query(
          `INSERT INTO product_state.learning_task
            (id, learner_id, status, goal, material_refs, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [mutation.task.id, mutation.task.learnerId, mutation.task.status, mutation.task.goal, json(mutation.task.materialRefs), mutation.task.createdAt, mutation.task.updatedAt],
        );
        return;
      case "START_EPISODE":
        await client.query(
          `INSERT INTO product_state.learning_episode
            (id, task_id, status, started_at, completed_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [mutation.episode.id, mutation.episode.taskId, mutation.episode.status, mutation.episode.startedAt, mutation.episode.completedAt ?? null],
        );
        return;
      case "SUBMIT_ATTEMPT":
        await insertAttempt(client, mutation.attempt);
        return;
      case "RECORD_OBSERVATION":
        await insertObservation(client, mutation.observation);
        return;
      case "RECORD_REVIEW":
        await client.query(
          `INSERT INTO product_state.teacher_review
            (id, observation_id, reviewer_id, reviewed_at, decision, rationale, evidence_refs, supersedes_review_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            mutation.review.id,
            mutation.review.observationId,
            mutation.review.reviewerId,
            mutation.review.reviewedAt,
            mutation.review.decision,
            mutation.review.rationale,
            json(mutation.review.evidenceRefs),
            mutation.review.supersedesReviewId ?? null,
          ],
        );
        if (mutation.correction) {
          await client.query(
            `INSERT INTO product_state.observation_correction
              (id, observation_id, created_at, actor_id, reason, supersedes_correction_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              mutation.correction.id,
              mutation.correction.observationId,
              mutation.correction.createdAt,
              mutation.correction.actorId,
              mutation.correction.reason,
              mutation.correction.supersedesCorrectionId ?? null,
            ],
          );
        }
        return;
      case "PLAN_RETRY":
        await client.query(
          `INSERT INTO product_state.retry_attempt
            (id, task_id, episode_id, original_attempt_id, review_id, attempt_id, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            mutation.retry.id,
            mutation.retry.taskId,
            mutation.retry.episodeId,
            mutation.retry.originalAttemptId,
            mutation.retry.reviewId,
            mutation.retry.attemptId ?? null,
            mutation.retry.status,
            mutation.retry.createdAt,
          ],
        );
        return;
      case "SUBMIT_RETRY": {
        await insertAttempt(client, mutation.attempt);
        const result = await client.query(
          `UPDATE product_state.retry_attempt
           SET attempt_id = $2, status = 'SUBMITTED'
           WHERE id = $1 AND status = 'PLANNED'`,
          [mutation.retryAttemptId, mutation.attempt.id],
        );
        requireUpdated(result.rowCount, "PLANNED_RETRY_REQUIRED");
        return;
      }
      case "RECORD_RETRY_RESULT": {
        await insertObservation(client, mutation.observation);
        const result = await client.query(
          `UPDATE product_state.retry_attempt
           SET status = 'COMPLETED'
           WHERE id = $1 AND status = 'SUBMITTED' AND attempt_id = $2`,
          [mutation.retryAttemptId, mutation.observation.attemptId],
        );
        requireUpdated(result.rowCount, "SUBMITTED_RETRY_REQUIRED");
        return;
      }
      case "RECORD_OUTCOME":
        await client.query(
          `INSERT INTO product_state.learning_outcome
            (id, task_id, episode_id, original_attempt_id, retry_attempt_id, recorded_at, outcome_type, result, evidence_refs, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [
            mutation.outcome.id,
            mutation.outcome.taskId,
            mutation.outcome.episodeId,
            mutation.outcome.originalAttemptId,
            mutation.outcome.retryAttemptId,
            mutation.outcome.recordedAt,
            mutation.outcome.outcomeType,
            mutation.outcome.result,
            json(mutation.outcome.evidenceRefs),
            mutation.outcome.recordedBy,
          ],
        );
        requireUpdated((await client.query(
          `UPDATE product_state.learning_episode SET status = 'COMPLETED', completed_at = $2
           WHERE id = $1 AND status = 'ACTIVE'`,
          [mutation.outcome.episodeId, mutation.outcome.recordedAt],
        )).rowCount, "ACTIVE_EPISODE_REQUIRED");
        requireUpdated((await client.query(
          `UPDATE product_state.learning_task SET status = 'COMPLETED', updated_at = $2
           WHERE id = $1 AND status = 'ACTIVE'`,
          [mutation.outcome.taskId, mutation.outcome.recordedAt],
        )).rowCount, "ACTIVE_TASK_REQUIRED");
    }
  }
}

export function createPostgresProductStateRepository(connectionString: string): {
  readonly repository: PostgresProductStateRepository;
  readonly close: () => Promise<void>;
} {
  if (!connectionString.trim()) throw new Error("PRODUCT_STATE_DATABASE_URL_REQUIRED");
  const pool = new Pool({ connectionString, max: 10 });
  return {
    repository: new PostgresProductStateRepository(pool),
    close: () => pool.end(),
  };
}
