import { describe, expect, it } from "vitest";
import { ProductStateService } from "../src/product-state/product-state-service";
import { TestProductStateRepository } from "./support/product-state-repository";

const at = "2026-07-18T09:00:00.000Z";
const learner = { actorId: "learner-1", role: "LEARNER" } as const;
const teacher = { actorId: "teacher-1", role: "TEACHER" } as const;
const foundry = { actorId: "foundry-diagnosis", role: "FOUNDRY" } as const;

const evidenceRef = {
  referenceClass: "EVIDENCE",
  evidenceUnitId: "student-work-1",
  provenanceId: "upload-1",
} as const;

describe("canonical Product State learning loop", () => {
  it("persists the complete governed Task-to-Outcome chain and emits every write through the outbox", async () => {
    const repository = new TestProductStateRepository();
    const service = new ProductStateService(repository, { now: () => at });

    await service.createTask(learner, {
      taskId: "task-1",
      goal: "Improve the submitted explanation",
      materialRefs: [],
    });
    await service.startEpisode(learner, { episodeId: "episode-1", taskId: "task-1" });
    await service.appendConversationEvent(learner, {
      eventId: "event-1",
      taskId: "task-1",
      episodeId: "episode-1",
      kind: "LEARNER_MESSAGE",
      payload: { content: "Here is my revised explanation." },
      artifactRefs: [],
      sourceRefs: [],
      evidenceRefs: [evidenceRef],
    });
    await service.submitAttempt(learner, {
      attemptId: "attempt-1",
      taskId: "task-1",
      episodeId: "episode-1",
      artifactRefs: [],
      evidenceRefs: [evidenceRef],
    });
    await service.recordObservation(foundry, {
      observationId: "observation-1",
      attemptId: "attempt-1",
      sourceRefs: [],
      evidenceRefs: [evidenceRef],
      provenance: {
        executionId: "execution-1",
        policyVersion: "1.0.0",
      },
      diagnosisPayload: {
        representationVersion: "1.0.0",
        derivedAt: at,
        derivation: {
          kind: "DETERMINISTIC",
          implementationId: "capability-1",
          implementationVersion: "1.0.0",
          sourceRecordIds: ["attempt-1"],
        },
        value: { finding: "missing justification" },
      },
    });
    await service.reviewObservation(teacher, {
      reviewId: "review-1",
      observationId: "observation-1",
      decision: "CORRECT",
      rationale: "The claim is correct but the missing step needs a clearer label.",
      evidenceRefs: [evidenceRef],
      correction: {
        correctionId: "correction-1",
        reason: "Replace the generated failure label with the reviewed label.",
      },
    });
    await service.planRetry(teacher, {
      retryAttemptId: "retry-1",
      taskId: "task-1",
      episodeId: "episode-1",
      originalAttemptId: "attempt-1",
      reviewId: "review-1",
    });
    await service.submitRetry(learner, {
      retryAttemptId: "retry-1",
      attemptId: "attempt-2",
      artifactRefs: [],
      evidenceRefs: [evidenceRef],
    });
    await service.recordRetryResult(foundry, {
      retryAttemptId: "retry-1",
      observationId: "observation-2",
      sourceRefs: [],
      evidenceRefs: [evidenceRef],
      provenance: {
        executionId: "execution-2",
        policyVersion: "1.0.0",
      },
      diagnosisPayload: {
        representationVersion: "1.0.0",
        derivedAt: at,
        derivation: {
          kind: "DETERMINISTIC",
          implementationId: "capability-1",
          implementationVersion: "1.0.0",
          sourceRecordIds: ["attempt-2"],
        },
        value: { finding: "reviewed step supplied" },
      },
    });
    await service.recordOutcome(teacher, {
      outcomeId: "outcome-1",
      retryAttemptId: "retry-1",
      outcomeType: "RETRY",
      result: "IMPROVED",
      evidenceRefs: [evidenceRef],
    });

    const loop = await service.getLearningLoop(learner, "task-1");
    expect(loop).toMatchObject({
      task: { id: "task-1" },
      episodes: [{ id: "episode-1" }],
      conversationEvents: [{ id: "event-1", sequence: 1 }],
      attempts: [{ id: "attempt-1" }, { id: "attempt-2" }],
      observations: [{ id: "observation-1" }, { id: "observation-2" }],
      reviews: [{ id: "review-1", decision: "CORRECT" }],
      retries: [{ id: "retry-1", attemptId: "attempt-2", status: "COMPLETED" }],
      outcomes: [{ id: "outcome-1", result: "IMPROVED", recordedBy: "teacher-1" }],
    });
    expect(loop.observations[0]?.corrections).toEqual([
      expect.objectContaining({ id: "correction-1", actorId: "teacher-1" }),
    ]);
    expect(repository.outbox).toHaveLength(10);
    expect(new Set(repository.outbox.map((message) => message.eventType))).toEqual(
      new Set([
        "LEARNING_TASK_CREATED",
        "LEARNING_EPISODE_STARTED",
        "CONVERSATION_EVENT_APPENDED",
        "LEARNER_ATTEMPT_SUBMITTED",
        "DIAGNOSTIC_OBSERVATION_RECORDED",
        "TEACHER_REVIEW_RECORDED",
        "RETRY_PLANNED",
        "RETRY_SUBMITTED",
        "RETRY_RESULT_RECORDED",
        "LEARNING_OUTCOME_RECORDED",
      ]),
    );
  });

  it("fails closed when a caller crosses the human authority or lifecycle boundary", async () => {
    const service = new ProductStateService(new TestProductStateRepository(), { now: () => at });

    await expect(
      service.reviewObservation(foundry, {
        reviewId: "review-forbidden",
        observationId: "observation-missing",
        decision: "ACCEPT",
        rationale: "Model-created review",
        evidenceRefs: [],
      }),
    ).rejects.toThrow("TEACHER permission required");

    await expect(
      service.recordOutcome(foundry, {
        outcomeId: "outcome-forbidden",
        retryAttemptId: "retry-missing",
        outcomeType: "RETRY",
        result: "IMPROVED",
        evidenceRefs: [],
      }),
    ).rejects.toThrow("TEACHER permission required");

    await expect(
      service.submitAttempt(learner, {
        attemptId: "attempt-orphan",
        taskId: "task-missing",
        episodeId: "episode-missing",
        artifactRefs: [],
        evidenceRefs: [],
      }),
    ).rejects.toThrow("ACTIVE_TASK_REQUIRED");
  });

  it("keeps TeacherReview as one explicit supersession chain and plans Retry only from its current actionable leaf", async () => {
    const repository = new TestProductStateRepository();
    const service = new ProductStateService(repository, { now: () => at });
    repository.tasks.set("task-review", {
      id: "task-review", learnerId: learner.actorId, status: "ACTIVE", goal: "Review safely", createdAt: at, updatedAt: at, materialRefs: [],
    });
    repository.episodes.set("episode-review", {
      id: "episode-review", taskId: "task-review", status: "ACTIVE", startedAt: at,
    });
    repository.attempts.set("attempt-review", {
      id: "attempt-review", taskId: "task-review", episodeId: "episode-review", submittedAt: at, status: "SUBMITTED", artifactRefs: [], evidenceRefs: [],
    });
    repository.observations.set("observation-review", {
      id: "observation-review",
      attemptId: "attempt-review",
      createdAt: at,
      sourceRefs: [],
      evidenceRefs: [],
      provenance: { executionId: "execution-review", policyVersion: "1.0.0" },
      diagnosisPayload: {
        representationVersion: "1.0.0",
        derivedAt: at,
        derivation: { kind: "DETERMINISTIC", implementationId: "test", implementationVersion: "1.0.0", sourceRecordIds: ["attempt-review"] },
        value: {},
      },
      corrections: [],
    });

    await service.reviewObservation(teacher, {
      reviewId: "review-root", observationId: "observation-review", decision: "ACCEPT", rationale: "Initial review", evidenceRefs: [],
    });
    await expect(service.reviewObservation(teacher, {
      reviewId: "review-unlinked", observationId: "observation-review", decision: "ACCEPT", rationale: "Implicit replacement", evidenceRefs: [],
    })).rejects.toThrow("CURRENT_TEACHER_REVIEW_SUPERSESSION_REQUIRED");
    await service.reviewObservation(teacher, {
      reviewId: "review-leaf",
      observationId: "observation-review",
      decision: "CORRECT",
      rationale: "Explicit correction",
      evidenceRefs: [],
      supersedesReviewId: "review-root",
      correction: { correctionId: "correction-leaf", reason: "Use the reviewed explanation." },
    });

    await expect(service.planRetry(teacher, {
      retryAttemptId: "retry-stale", taskId: "task-review", episodeId: "episode-review", originalAttemptId: "attempt-review", reviewId: "review-root",
    })).rejects.toThrow("CURRENT_ACTIONABLE_TEACHER_REVIEW_REQUIRED");
    await service.planRetry(teacher, {
      retryAttemptId: "retry-current", taskId: "task-review", episodeId: "episode-review", originalAttemptId: "attempt-review", reviewId: "review-leaf",
    });
    await expect(service.reviewObservation(teacher, {
      reviewId: "review-after-retry",
      observationId: "observation-review",
      decision: "ACCEPT",
      rationale: "Would invalidate the planned retry",
      evidenceRefs: [],
      supersedesReviewId: "review-leaf",
    })).rejects.toThrow("TEACHER_REVIEW_WITH_PLANNED_RETRY_CANNOT_BE_SUPERSEDED");
  });

  it("derives the current Observation from an explicit append-only supersession chain", async () => {
    const repository = new TestProductStateRepository();
    const service = new ProductStateService(repository, { now: () => at });
    await service.createTask(learner, { taskId: "task-observation", goal: "Observation chain", materialRefs: [] });
    await service.startEpisode(learner, { episodeId: "episode-observation", taskId: "task-observation" });
    await service.submitAttempt(learner, {
      attemptId: "attempt-observation", taskId: "task-observation", episodeId: "episode-observation", artifactRefs: [], evidenceRefs: [],
    });
    const observationInput = {
      attemptId: "attempt-observation",
      sourceRefs: [],
      evidenceRefs: [],
      provenance: { executionId: "execution-observation", policyVersion: "1.0.0" },
      diagnosisPayload: {
        representationVersion: "1.0.0",
        derivedAt: at,
        derivation: { kind: "DETERMINISTIC" as const, implementationId: "test", implementationVersion: "1.0.0", sourceRecordIds: ["attempt-observation"] },
        value: {},
      },
    };
    await service.recordObservation(foundry, { observationId: "observation-root", ...observationInput });
    await expect(service.recordObservation(foundry, {
      observationId: "observation-unlinked", ...observationInput,
    })).rejects.toThrow("CURRENT_OBSERVATION_SUPERSESSION_REQUIRED");
    const replacement = await service.recordObservation(foundry, {
      observationId: "observation-leaf",
      supersedesObservationId: "observation-root",
      ...observationInput,
    });

    expect(replacement.supersedesObservationId).toBe("observation-root");
    await expect(repository.getCurrentObservationForAttempt("attempt-observation")).resolves.toMatchObject({ id: "observation-leaf" });
    expect((await repository.getLearningLoop("task-observation"))?.observations.map((item) => item.id)).toEqual([
      "observation-root",
      "observation-leaf",
    ]);

    await service.reviewObservation(teacher, {
      reviewId: "review-observation-leaf",
      observationId: "observation-leaf",
      decision: "CORRECT",
      rationale: "Correction stays on the current immutable observation.",
      evidenceRefs: [],
      correction: { correctionId: "correction-observation-leaf", reason: "Reviewed wording." },
    });
    await expect(repository.getCurrentObservationForAttempt("attempt-observation")).resolves.toMatchObject({
      id: "observation-leaf",
      corrections: [expect.objectContaining({ id: "correction-observation-leaf" })],
    });
    await expect(service.recordObservation(foundry, {
      observationId: "observation-after-review",
      supersedesObservationId: "observation-leaf",
      ...observationInput,
    })).rejects.toThrow("REVIEWED_OBSERVATION_CANNOT_BE_SUPERSEDED");
    await expect(service.reviewObservation(teacher, {
      reviewId: "review-stale-observation",
      observationId: "observation-root",
      decision: "ACCEPT",
      rationale: "Stale observation must not be reviewed.",
      evidenceRefs: [],
    })).rejects.toThrow("CURRENT_OBSERVATION_REQUIRED");
  });

  it("supersedes Attempts only inside the same active task, episode and learner chain", async () => {
    const repository = new TestProductStateRepository();
    const service = new ProductStateService(repository, { now: () => at });
    await service.createTask(learner, { taskId: "task-chain", goal: "Attempt chain", materialRefs: [] });
    await service.startEpisode(learner, { episodeId: "episode-chain", taskId: "task-chain" });
    await service.startEpisode(learner, { episodeId: "episode-other", taskId: "task-chain" });
    await service.submitAttempt(learner, {
      attemptId: "attempt-chain-1", taskId: "task-chain", episodeId: "episode-chain", artifactRefs: [], evidenceRefs: [],
    });
    const successor = await service.submitAttempt(learner, {
      attemptId: "attempt-chain-2",
      taskId: "task-chain",
      episodeId: "episode-chain",
      artifactRefs: [],
      evidenceRefs: [],
      supersedesAttemptId: "attempt-chain-1",
    });
    expect(successor.supersedesAttemptId).toBe("attempt-chain-1");
    expect(repository.attempts.get("attempt-chain-1")?.status).toBe("SUPERSEDED");

    await expect(service.submitAttempt(learner, {
      attemptId: "attempt-fork", taskId: "task-chain", episodeId: "episode-chain", artifactRefs: [], evidenceRefs: [], supersedesAttemptId: "attempt-chain-1",
    })).rejects.toThrow("SUPERSEDED_ATTEMPT_MUST_BE_CURRENT_AND_IN_SAME_LEARNING_SCOPE");
    await expect(service.submitAttempt(learner, {
      attemptId: "attempt-cross-episode", taskId: "task-chain", episodeId: "episode-other", artifactRefs: [], evidenceRefs: [], supersedesAttemptId: "attempt-chain-2",
    })).rejects.toThrow("SUPERSEDED_ATTEMPT_MUST_BE_CURRENT_AND_IN_SAME_LEARNING_SCOPE");
  });
});
