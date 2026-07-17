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
});
