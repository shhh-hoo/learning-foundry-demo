import type {
  ConversationEvent,
  DiagnosticObservation,
  LearningEpisode,
  LearningOutcome,
  LearningTask,
  LearnerAttempt,
  RetryAttempt,
  TeacherReview,
} from "../../src/core/domain/learning";
import type {
  ConversationEventWrite,
  LearningLoopView,
  LegacyImportReceipt,
  LegacyProductStateBundle,
  ProductStateCutoverAcceptance,
  ProductStateImportDecision,
  ProductStateOutboxMessage,
  ProductStateRepository,
  ProductStateWrite,
} from "../../src/core/ports/product-state-repository";

export class TestProductStateRepository implements ProductStateRepository {
  readonly tasks = new Map<string, LearningTask>();
  readonly episodes = new Map<string, LearningEpisode>();
  readonly events = new Map<string, ConversationEvent>();
  readonly attempts = new Map<string, LearnerAttempt>();
  readonly observations = new Map<string, DiagnosticObservation>();
  readonly reviews = new Map<string, TeacherReview>();
  readonly retries = new Map<string, RetryAttempt>();
  readonly outcomes = new Map<string, LearningOutcome>();
  readonly outbox: ProductStateOutboxMessage[] = [];
  readonly decisions: ProductStateWrite["decision"][] = [];
  readonly importReceipts = new Map<string, LegacyImportReceipt>();
  readonly importDecisions = new Map<string, ProductStateImportDecision>();
  readonly cutoverAcceptances = new Map<string, ProductStateCutoverAcceptance>();

  async apply(write: ProductStateWrite): Promise<void> {
    const mutation = write.mutation;
    if (this.outbox.some((item) => item.id === write.outbox.id)) throw new Error("DUPLICATE_PRODUCT_STATE_WRITE");
    switch (mutation.kind) {
      case "CREATE_TASK":
        this.insert(this.tasks, mutation.task);
        break;
      case "START_EPISODE":
        this.insert(this.episodes, mutation.episode);
        break;
      case "SUBMIT_ATTEMPT": {
        const superseded = mutation.attempt.supersedesAttemptId
          ? this.attempts.get(mutation.attempt.supersedesAttemptId)
          : undefined;
        if (mutation.attempt.supersedesAttemptId && (!superseded
          || superseded.status !== "SUBMITTED"
          || superseded.taskId !== mutation.attempt.taskId
          || superseded.episodeId !== mutation.attempt.episodeId)) {
          throw new Error("SUPERSEDED_ATTEMPT_MUST_BE_CURRENT_AND_IN_SAME_LEARNING_SCOPE");
        }
        this.insert(this.attempts, mutation.attempt);
        if (superseded) this.attempts.set(superseded.id, { ...superseded, status: "SUPERSEDED" });
        break;
      }
      case "RECORD_OBSERVATION":
        this.insert(this.observations, mutation.observation);
        break;
      case "RECORD_REVIEW": {
        const current = await this.getCurrentReviewForObservation(mutation.review.observationId);
        if ((current?.id ?? null) !== (mutation.review.supersedesReviewId ?? null)) {
          throw new Error("CURRENT_TEACHER_REVIEW_SUPERSESSION_REQUIRED");
        }
        if (current && [...this.retries.values()].some((item) => item.reviewId === current.id)) {
          throw new Error("TEACHER_REVIEW_WITH_PLANNED_RETRY_CANNOT_BE_SUPERSEDED");
        }
        if (mutation.review.supersedesReviewId
          && [...this.reviews.values()].some((item) => item.supersedesReviewId === mutation.review.supersedesReviewId)) {
          throw new Error("TEACHER_REVIEW_SUPERSESSION_FORK_PROHIBITED");
        }
        this.insert(this.reviews, mutation.review);
        if (mutation.correction) {
          const observation = this.observations.get(mutation.correction.observationId);
          if (!observation) throw new Error("ACTIVE_OBSERVATION_REQUIRED");
          this.observations.set(observation.id, {
            ...observation,
            corrections: [...observation.corrections, mutation.correction],
          });
        }
        break;
      }
      case "PLAN_RETRY":
        if ([...this.retries.values()].some((item) => item.reviewId === mutation.retry.reviewId)) {
          throw new Error("RETRY_ALREADY_PLANNED_FOR_REVIEW");
        }
        this.insert(this.retries, mutation.retry);
        break;
      case "SUBMIT_RETRY": {
        const retry = this.retries.get(mutation.retryAttemptId);
        if (!retry || retry.status !== "PLANNED") throw new Error("PLANNED_RETRY_REQUIRED");
        const superseded = this.attempts.get(mutation.attempt.supersedesAttemptId!);
        if (!superseded || superseded.status !== "SUBMITTED") throw new Error("SUBMITTED_SUPERSEDED_ATTEMPT_REQUIRED");
        this.insert(this.attempts, mutation.attempt);
        this.attempts.set(superseded.id, { ...superseded, status: "SUPERSEDED" });
        this.retries.set(retry.id, { ...retry, attemptId: mutation.attempt.id, status: "SUBMITTED" });
        break;
      }
      case "RECORD_RETRY_RESULT": {
        this.insert(this.observations, mutation.observation);
        const retry = this.retries.get(mutation.retryAttemptId);
        if (!retry || retry.status !== "SUBMITTED") throw new Error("SUBMITTED_RETRY_REQUIRED");
        this.retries.set(retry.id, { ...retry, status: "COMPLETED" });
        break;
      }
      case "RECORD_OUTCOME": {
        this.insert(this.outcomes, mutation.outcome);
        const task = this.tasks.get(mutation.outcome.taskId);
        const episode = this.episodes.get(mutation.outcome.episodeId);
        if (task) this.tasks.set(task.id, { ...task, status: "COMPLETED", updatedAt: mutation.outcome.recordedAt });
        if (episode) this.episodes.set(episode.id, { ...episode, status: "COMPLETED", completedAt: mutation.outcome.recordedAt });
        break;
      }
    }
    this.decisions.push(structuredClone(write.decision));
    this.outbox.push(structuredClone(write.outbox));
  }

  async appendConversationEvent(write: ConversationEventWrite): Promise<ConversationEvent> {
    const episode = this.episodes.get(write.event.episodeId);
    if (!episode || episode.taskId !== write.event.taskId || episode.status !== "ACTIVE") throw new Error("ACTIVE_EPISODE_REQUIRED");
    const sequence = [...this.events.values()].filter((item) => item.episodeId === write.event.episodeId).length + 1;
    const event: ConversationEvent = { ...write.event, sequence };
    this.insert(this.events, event);
    this.decisions.push(structuredClone({ ...write.decision, details: { ...write.decision.details, sequence } }));
    this.outbox.push(structuredClone({ ...write.outbox, payload: { ...write.outbox.payload, sequence } }));
    return structuredClone(event);
  }

  async getTask(taskId: string): Promise<LearningTask | null> { return this.clone(this.tasks.get(taskId)); }
  async getEpisode(episodeId: string): Promise<LearningEpisode | null> { return this.clone(this.episodes.get(episodeId)); }
  async getAttempt(attemptId: string): Promise<LearnerAttempt | null> { return this.clone(this.attempts.get(attemptId)); }
  async getObservation(observationId: string): Promise<DiagnosticObservation | null> { return this.clone(this.observations.get(observationId)); }
  async getReview(reviewId: string): Promise<TeacherReview | null> { return this.clone(this.reviews.get(reviewId)); }
  async getCurrentReviewForObservation(observationId: string): Promise<TeacherReview | null> {
    const supersededIds = new Set([...this.reviews.values()].flatMap((item) => item.supersedesReviewId ? [item.supersedesReviewId] : []));
    return this.clone([...this.reviews.values()].find((item) => item.observationId === observationId && !supersededIds.has(item.id)));
  }
  async getRetry(retryAttemptId: string): Promise<RetryAttempt | null> { return this.clone(this.retries.get(retryAttemptId)); }
  async getOutcomeForRetry(retryAttemptId: string): Promise<LearningOutcome | null> {
    return this.clone([...this.outcomes.values()].find((item) => item.retryAttemptId === retryAttemptId));
  }
  async getLearningLoop(taskId: string): Promise<LearningLoopView | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    const attempts = [...this.attempts.values()].filter((item) => item.taskId === taskId);
    const attemptIds = new Set(attempts.map((item) => item.id));
    return structuredClone({
      task,
      episodes: [...this.episodes.values()].filter((item) => item.taskId === taskId),
      conversationEvents: [...this.events.values()].filter((item) => item.taskId === taskId),
      attempts,
      observations: [...this.observations.values()].filter((item) => attemptIds.has(item.attemptId)),
      reviews: [...this.reviews.values()].filter((item) => {
        const observation = this.observations.get(item.observationId);
        return Boolean(observation && attemptIds.has(observation.attemptId));
      }),
      retries: [...this.retries.values()].filter((item) => item.taskId === taskId),
      outcomes: [...this.outcomes.values()].filter((item) => item.taskId === taskId),
    });
  }
  async health() { return { ready: true, schemaVersion: "0003", readOnly: false }; }

  async getLegacyImportReceipt(sourceSystem: "LEGACY_SHOWCASE", sourceKey: string): Promise<LegacyImportReceipt | null> {
    return this.clone(this.importReceipts.get(`${sourceSystem}:${sourceKey}`));
  }

  async getLegacyImportReceiptById(receiptId: string): Promise<LegacyImportReceipt | null> {
    return this.clone([...this.importReceipts.values()].find((item) => item.id === receiptId));
  }

  async importLegacyBundle(bundle: LegacyProductStateBundle): Promise<void> {
    const key = `${bundle.receipt.sourceSystem}:${bundle.receipt.sourceKey}`;
    if (this.importReceipts.has(key)) throw new Error("DUPLICATE_LEGACY_IMPORT");
    this.insert(this.tasks, bundle.task);
    this.insert(this.episodes, bundle.episode);
    for (const event of bundle.conversationEvents) this.insert(this.events, event);
    this.importReceipts.set(key, structuredClone(bundle.receipt));
    this.decisions.push(structuredClone(bundle.decision));
    this.outbox.push(structuredClone(bundle.outbox));
  }

  async recordImportDecision(decision: ProductStateImportDecision): Promise<void> {
    if ([...this.importDecisions.values()].some((item) => item.id === decision.id)) throw new Error("DUPLICATE_IMPORT_DECISION");
    this.importDecisions.set(decision.environment, structuredClone(decision));
  }

  async getImportDecision(environment: string): Promise<ProductStateImportDecision | null> {
    return this.clone(this.importDecisions.get(environment));
  }

  async recordCutoverAcceptance(acceptance: ProductStateCutoverAcceptance): Promise<void> {
    if (this.cutoverAcceptances.has(acceptance.environment)) throw new Error("CUTOVER_ALREADY_ACCEPTED");
    this.cutoverAcceptances.set(acceptance.environment, structuredClone(acceptance));
  }

  async getCutoverAcceptance(environment: string): Promise<ProductStateCutoverAcceptance | null> {
    return this.clone(this.cutoverAcceptances.get(environment));
  }

  private insert<T extends { readonly id: string }>(map: Map<string, T>, value: T): void {
    if (map.has(value.id)) throw new Error("DUPLICATE_PRODUCT_STATE_RECORD");
    map.set(value.id, structuredClone(value));
  }

  private clone<T>(value: T | undefined): T | null {
    return value === undefined ? null : structuredClone(value);
  }
}
