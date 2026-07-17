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
  LearningLoopView,
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
      case "APPEND_CONVERSATION_EVENT":
        this.insert(this.events, mutation.event);
        break;
      case "SUBMIT_ATTEMPT":
        this.insert(this.attempts, mutation.attempt);
        break;
      case "RECORD_OBSERVATION":
        this.insert(this.observations, mutation.observation);
        break;
      case "RECORD_REVIEW": {
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
        this.insert(this.retries, mutation.retry);
        break;
      case "SUBMIT_RETRY": {
        this.insert(this.attempts, mutation.attempt);
        const retry = this.retries.get(mutation.retryAttemptId);
        if (!retry || retry.status !== "PLANNED") throw new Error("PLANNED_RETRY_REQUIRED");
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

  async getTask(taskId: string): Promise<LearningTask | null> { return this.clone(this.tasks.get(taskId)); }
  async getEpisode(episodeId: string): Promise<LearningEpisode | null> { return this.clone(this.episodes.get(episodeId)); }
  async getAttempt(attemptId: string): Promise<LearnerAttempt | null> { return this.clone(this.attempts.get(attemptId)); }
  async getObservation(observationId: string): Promise<DiagnosticObservation | null> { return this.clone(this.observations.get(observationId)); }
  async getReview(reviewId: string): Promise<TeacherReview | null> { return this.clone(this.reviews.get(reviewId)); }
  async getRetry(retryAttemptId: string): Promise<RetryAttempt | null> { return this.clone(this.retries.get(retryAttemptId)); }
  async getOutcomeForRetry(retryAttemptId: string): Promise<LearningOutcome | null> {
    return this.clone([...this.outcomes.values()].find((item) => item.retryAttemptId === retryAttemptId));
  }
  async nextConversationEventSequence(episodeId: string): Promise<number> {
    return [...this.events.values()].filter((item) => item.episodeId === episodeId).length + 1;
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
  async health() { return { ready: true, schemaVersion: "1.0.0", readOnly: false }; }

  private insert<T extends { readonly id: string }>(map: Map<string, T>, value: T): void {
    if (map.has(value.id)) throw new Error("DUPLICATE_PRODUCT_STATE_RECORD");
    map.set(value.id, structuredClone(value));
  }

  private clone<T>(value: T | undefined): T | null {
    return value === undefined ? null : structuredClone(value);
  }
}
