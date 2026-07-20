import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getActor } from "@/application/actor";
import { captureAttempt, closeTask, createTask, createTeacherReview, persistDiagnosticObservation } from "@/application/commands";
import {
  cancelGovernedFollowup,
  createGovernedFollowup,
  executeGovernedFollowup,
  reviewGovernedFollowupResult,
} from "@/application/governed-followup";
import { startWorkflow, resumeWorkflow, WorkflowProcessCrashForTests } from "@/application/workflow-service";
import { closeDb, getDb, withTenantDatabase } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  learnerAttempts,
  contextItems,
  idempotencyKeys,
  learningEpisodes,
  learningOutcomes,
  learningTasks,
  retentionReviews,
  retryAttempts,
  runtimeDeliveries,
  teacherReviews,
  transferActivities,
  workflowRuns,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import { DomainInvariantError } from "@/domain/invariants";

const capabilityPublicKey = "chemistry-molar-concentration";
const fields = { amount: "1", amountUnit: "mol", volume: "2", volumeUnit: "L", learnerAnswer: "0.5" };

describe.sequential("CAP-06 governed Retry / Transfer / Retention integration", () => {
  let learner: Actor;
  let teacher: Actor;

  afterAll(async () => closeDb());

  async function source(label: string) {
    learner ??= await getActor(SEED.learner, SEED.institution, "cap06-integration", `learner:${randomUUID()}`);
    teacher ??= await getActor(SEED.teacher, SEED.institution, "cap06-integration", `teacher:${randomUUID()}`);
    const title = `CAP-06 ${label} ${randomUUID()}`;
    const goal = "Apply one reviewed chemistry issue through a governed follow-up.";
    const task = await createTask(learner, {
      courseId: SEED.course,
      title,
      goal,
      idempotencyKey: `cap06-task:${randomUUID()}`,
    });
    const attempt = await captureAttempt(learner, {
      taskId: task.taskId,
      episodeId: task.episodeId!,
      capabilityId: SEED.chemistryMolarConcentration,
      prompt: "Calculate concentration and explain the volume conversion.",
      response: "I divided one mole by two litres but need the reviewed issue linked.",
      structuredInput: { amount: { value: 1, unit: "mol" }, volume: { value: 2, unit: "L" }, learnerAnswer: 0.4 },
      idempotencyKey: `cap06-source-attempt:${randomUUID()}`,
    });
    const observation = await persistDiagnosticObservation({
      attemptId: attempt.id,
      capabilityId: SEED.chemistryMolarConcentration,
      capabilityVersionId: SEED.chemistryMolarConcentrationVersion,
      result: {
        status: "INCORRECT",
        failureCode: "NUMERIC_MISMATCH",
        firstInvalidStep: "FINAL_NUMERIC_COMPARISON",
        summary: "The final concentration does not match the deterministic calculation.",
      },
    });
    const review = await createTeacherReview(teacher, {
      observationId: observation.id,
      decision: "ACCEPT",
      teachingSupport: "Recalculate with the reviewed unit conversion and explain the result.",
      idempotencyKey: `cap06-source-review:${randomUUID()}`,
    });
    return { title, goal, task, attempt, observation, review };
  }

  async function complete(activityType: "RETRY" | "TRANSFER" | "RETENTION") {
    const fixture = await source(activityType.toLowerCase());
    const assignmentIdempotencyKey = `cap06-assignment:${activityType}:${randomUUID()}`;
    const scheduledFor = new Date(Date.now() + 2_000);
    const raw = activityType === "TRANSFER" ? {
      observationId: fixture.observation.id,
      reviewId: fixture.review.reviewId,
      activityType,
      prompt: "Apply the reviewed issue in a new laboratory context using the governed structured runtime.",
      assignmentIdempotencyKey,
      transfer: {
        target: { context: "laboratory comparison", representation: "STRUCTURED", itemFamily: capabilityPublicKey, problemStructure: "chemistry.molar-concentration.v1" },
        materialDifferenceRationale: "The learner must apply the same reviewed capability in a materially different laboratory context.",
      },
    } : activityType === "RETENTION" ? {
      observationId: fixture.observation.id,
      reviewId: fixture.review.reviewId,
      activityType,
      prompt: "Complete the delayed equivalent concentration check independently.",
      assignmentIdempotencyKey,
      retention: {
        declaredDelaySeconds: 1,
        scheduledFor: scheduledFor.toISOString(),
        interveningExposure: { kind: "NONE_DECLARED", detail: "No related practice is declared during this short integration delay." },
        contentEquivalence: { kind: "EQUIVALENT_FORM", rationale: "The item tests the same concentration relation in an equivalent form." },
        assistancePolicy: { kind: "INDEPENDENT", allowed: "No hints or worked examples during the delayed attempt." },
      },
    } : {
      observationId: fixture.observation.id,
      reviewId: fixture.review.reviewId,
      activityType,
      prompt: "Retry the same reviewed issue and justify the corrected concentration.",
      assignmentIdempotencyKey,
    };
    const assigned = await createGovernedFollowup(teacher, raw);
    const replayedAssignment = await createGovernedFollowup(teacher, raw);
    expect(replayedAssignment.id).toBe(assigned.id);
    expect(assigned).toMatchObject({ activityType, status: "ASSIGNED", originalAttemptId: fixture.attempt.id, reviewedObservationId: fixture.observation.id, teacherReviewId: fixture.review.reviewId });
    expect(assigned.targetEpisodeId).not.toBe(fixture.task.episodeId);
    expect(assigned.activityPlanProposalId).toBeTruthy();
    const [reservation] = await getDb().select().from(idempotencyKeys).where(and(
      eq(idempotencyKeys.institutionId, teacher.institutionId),
      eq(idempotencyKeys.commandType, "CREATE_GOVERNED_FOLLOWUP"),
      eq(idempotencyKeys.key, assignmentIdempotencyKey),
    ));
    const [assignmentEnvelope] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, assigned.id));
    expect(reservation).toMatchObject({ actorUserId: teacher.userId, resultId: assigned.id });
    expect(assignmentEnvelope.assignmentRequestHash).toBe(reservation.requestHash);

    if (activityType === "RETENTION") {
      await expect(executeGovernedFollowup(learner, {
        activityId: assigned.id,
        response: "Too early.", capabilityPublicKey, fields, idempotencyKey: `cap06-runtime:${activityType}:${randomUUID()}`,
      })).rejects.toMatchObject({ code: "RETENTION_NOT_DUE" });
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, scheduledFor.getTime() - Date.now() + 50)));
    }
    const runtimeKey = `cap06-runtime:${activityType}:${randomUUID()}`;
    const executed = await executeGovernedFollowup(learner, {
      activityId: assigned.id,
      response: "One mole divided by two litres is 0.5 mol/L.",
      capabilityPublicKey,
      fields,
      idempotencyKey: runtimeKey,
    });
    const replayedRuntime = await executeGovernedFollowup(learner, {
      activityId: assigned.id,
      response: "One mole divided by two litres is 0.5 mol/L.",
      capabilityPublicKey,
      fields,
      idempotencyKey: runtimeKey,
    });
    if (executed.status !== "WAITING_FOR_REVIEW" || replayedRuntime.status !== "WAITING_FOR_REVIEW") {
      throw new Error("Expected governed follow-up runtime to wait for human review");
    }
    expect(replayedRuntime.delivery.id).toBe(executed.delivery.id);
    expect(executed.attempt.id).not.toBe(fixture.attempt.id);
    expect(executed.attempt.episodeId).toBe(assigned.targetEpisodeId);

    const reviewInput = {
      activityId: assigned.id,
      decision: "ACCEPT",
      teachingSupport: "The new result and exact runtime lineage were reviewed by the course teacher.",
      reviewIdempotencyKey: `cap06-result-review:${activityType}:${randomUUID()}`,
      ...(activityType === "RETENTION" ? {
        retentionExposure: {
          kind: "NONE_DECLARED" as const,
          detail: "No related practice occurred during the tested delay.",
        },
      } : activityType === "TRANSFER" ? { transferContractConfirmed: true } : {}),
    };
    const reviewed = await reviewGovernedFollowupResult(teacher, reviewInput);
    const replayedReview = await reviewGovernedFollowupResult(teacher, reviewInput);
    expect(replayedReview.reviewId).toBe(reviewed.reviewId);
    expect(reviewed.outcomeId).toBeUndefined();
    const [stored] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, assigned.id));
    expect(stored).toMatchObject({ status: "REVIEWED", resultAttemptId: executed.attempt.id, resultObservationId: executed.observation.id, resultReviewId: reviewed.reviewId });
    expect(await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.retryId, assigned.id))).toEqual([]);
    const [targetEpisode] = await getDb().select().from(learningEpisodes).where(eq(learningEpisodes.id, assigned.targetEpisodeId!));
    expect(targetEpisode).toMatchObject({ taskId: fixture.task.taskId, predecessorEpisodeId: fixture.task.episodeId, purpose: activityType, status: "COMPLETED" });
    return { fixture, assigned, reviewed };
  }

  it("completes one new governed chain for Retry, Transfer and Retention without Outcome", async () => {
    const retry = await complete("RETRY");
    const transfer = await complete("TRANSFER");
    const retention = await complete("RETENTION");
    const [transferFact] = await getDb().select().from(transferActivities).where(eq(transferActivities.activityId, transfer.assigned.id));
    expect(transferFact.changedDimensions).toEqual(["context", "representation"]);
    expect(transferFact.declaration.evidenceLimit).toBe("TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN");
    const [retentionFact] = await getDb().select().from(retentionReviews).where(eq(retentionReviews.activityId, retention.assigned.id));
    expect(retentionFact.declaredDelaySeconds).toBe(1);
    await expect(withTenantDatabase(teacher, () => getDb().update(teacherReviews).set({
      teacherId: learner.userId,
      actorProvenance: {
        userId: learner.userId,
        institutionId: learner.institutionId,
        roles: ["LEARNER"],
        authMethod: "cap06-integration",
        sessionId: `forged-review:${randomUUID()}`,
        authenticatedAt: new Date().toISOString(),
      },
    }).where(eq(teacherReviews.id, retry.reviewed.reviewId))))
      .rejects.toThrow(/TeacherReview author\/provenance\/transition\/current course authority mismatch/);
    expect(retentionFact.dueAt.getTime()).toBeGreaterThanOrEqual(retention.assigned.assignedAt.getTime() + 1_000);
    expect(retentionFact.completedInterveningExposure).toEqual({
      kind: "NONE_DECLARED",
      detail: "No related practice occurred during the tested delay.",
    });
    expect(retentionFact.exposureConfirmedAt?.toISOString()).toBe(retentionFact.completedAt?.toISOString());
    expect(retentionFact.exposureConfirmedBy).toBe(teacher.userId);
    expect(retry.assigned.sourceEpisodeId).toBe(retry.fixture.task.episodeId);
  });

  it("uses one deterministic workflow/run/activity across concurrent starts and the learner-to-teacher journey", async () => {
    const fixture = await source("workflow-idempotency");
    const state = {
      observationId: fixture.observation.id,
      reviewId: fixture.review.reviewId,
      activityType: "RETRY" as const,
      prompt: "Retry the reviewed issue through the governed workflow and explain the correction.",
      assignmentIdempotencyKey: `cap06-workflow-assignment:${randomUUID()}`,
    };
    const [first, second] = await Promise.all([
      startWorkflow({ kind: "GOVERNED_FOLLOWUP", actor: teacher, state }),
      startWorkflow({ kind: "GOVERNED_FOLLOWUP", actor: teacher, state }),
    ]);
    expect(first.threadId).toBe(second.threadId);
    expect(first.runId).toBe(second.runId);
    expect(first).toMatchObject({ status: "INTERRUPTED", interruptType: "LEARNER_FOLLOWUP_REQUIRED", expectedVersion: 1 });
    const links = first.result as Record<string, unknown>;
    expect(typeof links.activityId).toBe("string");
    expect(await getDb().select().from(workflowRuns).where(eq(workflowRuns.threadId, first.threadId))).toHaveLength(1);
    expect(await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, links.activityId as string))).toHaveLength(1);

    const wrongLearner: Actor = { ...learner, userId: randomUUID(), sessionId: `cap06-wrong-learner:${randomUUID()}` };
    await expect(resumeWorkflow(wrongLearner, first.threadId, {
      expectedVersion: 1,
      response: "This learner does not own the Task.", capabilityPublicKey, fields,
      idempotencyKey: `cap06-wrong-runtime:${randomUUID()}`,
    })).rejects.toBeTruthy();

    const learnerPayload = {
      expectedVersion: 1,
      response: "One mole divided by two litres is 0.5 mol/L.", capabilityPublicKey, fields,
      idempotencyKey: `cap06-workflow-runtime:${randomUUID()}`,
    };
    const learnerResume = await resumeWorkflow(learner, first.threadId, learnerPayload);
    expect(learnerResume).toMatchObject({ status: "INTERRUPTED", interruptType: "FOLLOWUP_RESULT_REVIEW_REQUIRED", expectedVersion: 2 });
    const learnerReplay = await resumeWorkflow(learner, first.threadId, learnerPayload);
    expect(learnerReplay).toMatchObject({
      status: "INTERRUPTED",
      interruptType: "FOLLOWUP_RESULT_REVIEW_REQUIRED",
      expectedVersion: 2,
      replayed: true,
      result: {
        runtimeDeliveryId: (learnerResume.result as Record<string, unknown>).runtimeDeliveryId,
        resultAttemptId: (learnerResume.result as Record<string, unknown>).resultAttemptId,
        resultObservationId: (learnerResume.result as Record<string, unknown>).resultObservationId,
      },
    });
    await expect(resumeWorkflow({ ...learner, userId: randomUUID() }, first.threadId, learnerPayload))
      .rejects.toMatchObject({ code: "WORKFLOW_OWNERSHIP" });
    await expect(resumeWorkflow(learner, first.threadId, { ...learnerPayload, expectedVersion: 2 }))
      .rejects.toBeTruthy();
    await expect(resumeWorkflow(learner, `${learner.institutionId}:governed_followup:${randomUUID()}`, learnerPayload))
      .rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    await expect(resumeWorkflow({ ...learner, institutionId: randomUUID() }, first.threadId, learnerPayload))
      .rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    await expect(resumeWorkflow(learner, first.threadId, { ...learnerPayload, response: "Changed replay response." }))
      .rejects.toMatchObject({ code: "WORKFLOW_REPLAY_IDEMPOTENCY_MISMATCH" });
    await expect(resumeWorkflow(learner, first.threadId, { ...learnerPayload, idempotencyKey: `cap06-changed-runtime:${randomUUID()}` }))
      .rejects.toMatchObject({ code: "WORKFLOW_REPLAY_IDEMPOTENCY_MISMATCH" });
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.episodeId, (first.result as Record<string, unknown>).targetEpisodeId as string))).toHaveLength(1);

    const teacherPayload = {
      expectedVersion: 2,
      decision: "ACCEPT",
      teachingSupport: "The course teacher reviewed the exact follow-up runtime and Diagnosis Proposal.",
      reviewIdempotencyKey: `cap06-workflow-review:${randomUUID()}`,
    };
    const teacherResume = await resumeWorkflow(teacher, first.threadId, teacherPayload);
    expect(teacherResume).toMatchObject({ status: "COMPLETED", interruptType: null });
    const teacherReplay = await resumeWorkflow(teacher, first.threadId, teacherPayload);
    expect(teacherReplay).toMatchObject({
      status: "COMPLETED",
      interruptType: null,
      expectedVersion: 2,
      replayed: true,
      result: { resultReviewId: (teacherResume.result as Record<string, unknown>).resultReviewId },
    });
    await expect(resumeWorkflow({ ...teacher, roles: ["LEARNER"] }, first.threadId, teacherPayload))
      .rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    await expect(resumeWorkflow(teacher, first.threadId, { ...teacherPayload, teachingSupport: "Changed replay support." }))
      .rejects.toMatchObject({ code: "WORKFLOW_REPLAY_IDEMPOTENCY_MISMATCH" });
    const [activity] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, links.activityId as string));
    expect(activity.status).toBe("REVIEWED");
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, activity.resultObservationId!))).toHaveLength(1);
    expect(await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.retryId, activity.id))).toEqual([]);
  });

  it("ends a non-executable planning path without creating a learner interrupt", async () => {
    const fixture = await source("planner-terminal");
    const result = await startWorkflow({
      kind: "GOVERNED_FOLLOWUP",
      actor: teacher,
      state: {
        observationId: fixture.observation.id,
        reviewId: fixture.review.reviewId,
        activityType: "RETRY",
        prompt: "Exercise a planner path that cannot produce an executable governed activity.",
        assignmentIdempotencyKey: `cap06-planner-terminal:${randomUUID()}`,
      },
      testFaults: {
        governedFollowupPlanning: {
          async resolveCapability() {
            throw new DomainInvariantError("No executable capability can satisfy this governed follow-up", "CAPABILITY_NO_MATCH");
          },
          async planActivity() {
            throw new Error("Planner must not run after resolution failed");
          },
        },
      },
    });
    expect(result).toMatchObject({ status: "FAILED", interruptType: null, failureCode: "CAPABILITY_NO_MATCH" });
    const links = result.result as Record<string, unknown>;
    const [activity] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, links.activityId as string));
    const [episode] = await getDb().select().from(learningEpisodes).where(eq(learningEpisodes.id, activity.targetEpisodeId!));
    const [context] = await getDb().select().from(contextItems).where(eq(contextItems.id, activity.contextItemId!));
    expect(activity.status).toBe("FAILED_FINAL");
    expect(episode.status).toBe("FAILED");
    expect(context.state).toBe("INVALIDATED");
    expect(await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, result.runId)))
      .toMatchObject([{ status: "FAILED", interruptType: null }]);
  });

  it("records planner cancellation as cancellation and never creates a learner interrupt", async () => {
    const fixture = await source("planner-cancelled");
    const result = await startWorkflow({
      kind: "GOVERNED_FOLLOWUP",
      actor: teacher,
      state: {
        observationId: fixture.observation.id,
        reviewId: fixture.review.reviewId,
        activityType: "RETRY",
        prompt: "Exercise an explicitly cancelled governed planning path.",
        assignmentIdempotencyKey: `cap06-planner-cancelled:${randomUUID()}`,
      },
      testFaults: {
        governedFollowupPlanning: {
          async resolveCapability() {
            throw new DomainInvariantError("Planning was explicitly cancelled", "EXECUTION_ABORTED");
          },
          async planActivity() {
            throw new Error("Planner must not run after cancellation");
          },
        },
      },
    });
    expect(result).toMatchObject({
      status: "CANCELLED",
      interruptType: null,
      failureCode: "EXECUTION_ABORTED",
    });
    const links = result.result as Record<string, unknown>;
    const [activity] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, links.activityId as string));
    const [episode] = await getDb().select().from(learningEpisodes).where(eq(learningEpisodes.id, activity.targetEpisodeId!));
    expect(activity.status).toBe("CANCELLED");
    expect(activity.cancellationState).toMatchObject({ code: "EXECUTION_ABORTED" });
    expect(episode.status).toBe("CANCELLED");
  });

  it("reconciles deterministic Product State after start, learner-resume, and teacher-resume process crashes", async () => {
    const fixture = await source("process-crash-recovery");
    const state = {
      observationId: fixture.observation.id,
      reviewId: fixture.review.reviewId,
      activityType: "RETRY" as const,
      prompt: "Recover this exact governed follow-up after each simulated process-loss boundary.",
      assignmentIdempotencyKey: `cap06-crash-assignment:${randomUUID()}`,
    };
    const crash = { afterGraphCompletion() { throw new WorkflowProcessCrashForTests(); } };
    await expect(startWorkflow({ kind: "GOVERNED_FOLLOWUP", actor: teacher, state, testFaults: crash }))
      .rejects.toBeInstanceOf(WorkflowProcessCrashForTests);
    const started = await startWorkflow({ kind: "GOVERNED_FOLLOWUP", actor: teacher, state });
    expect(started).toMatchObject({ status: "INTERRUPTED", interruptType: "LEARNER_FOLLOWUP_REQUIRED", expectedVersion: 1 });
    const activityId = (started.result as Record<string, unknown>).activityId as string;
    expect(await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, activityId))).toHaveLength(1);

    const learnerPayload = {
      expectedVersion: 1,
      response: "One mole divided by two litres is 0.5 mol/L.", capabilityPublicKey, fields,
      idempotencyKey: `cap06-crash-runtime:${randomUUID()}`,
    };
    await expect(resumeWorkflow(learner, started.threadId, learnerPayload, { testFaults: crash }))
      .rejects.toBeInstanceOf(WorkflowProcessCrashForTests);
    const [afterLearnerCrash] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, activityId));
    expect(afterLearnerCrash.status).toBe("ASSIGNED");
    const learnerRecovered = await resumeWorkflow(learner, started.threadId, learnerPayload);
    expect(learnerRecovered).toMatchObject({ status: "INTERRUPTED", interruptType: "FOLLOWUP_RESULT_REVIEW_REQUIRED", expectedVersion: 2 });
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.episodeId, afterLearnerCrash.targetEpisodeId!))).toHaveLength(1);

    const teacherPayload = {
      expectedVersion: 2,
      decision: "ACCEPT",
      teachingSupport: "The course teacher reviewed the crash-recovered exact runtime lineage.",
      reviewIdempotencyKey: `cap06-crash-review:${randomUUID()}`,
    };
    await expect(resumeWorkflow(teacher, started.threadId, teacherPayload, { testFaults: crash }))
      .rejects.toBeInstanceOf(WorkflowProcessCrashForTests);
    const [afterTeacherCrash] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, activityId));
    expect(afterTeacherCrash.status).toBe("WAITING_FOR_REVIEW");
    const teacherRecovered = await resumeWorkflow(teacher, started.threadId, teacherPayload);
    expect(teacherRecovered).toMatchObject({ status: "COMPLETED", interruptType: null });
    const [completed] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, activityId));
    expect(completed.status).toBe("REVIEWED");
    expect(await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.retryId, activityId))).toEqual([]);
  });

  it("commits runtime failure/cancellation truth, invalidates Context, and rejects fake recovery", async () => {
    for (const terminal of ["FAILED", "CANCELLED"] as const) {
      const fixture = await source(`runtime-${terminal.toLowerCase()}`);
      const assigned = await createGovernedFollowup(teacher, {
        observationId: fixture.observation.id,
        reviewId: fixture.review.reviewId,
        activityType: "RETRY",
        prompt: `Exercise the ${terminal.toLowerCase()} governed runtime terminal path.`,
        assignmentIdempotencyKey: `cap06-terminal-assignment:${terminal}:${randomUUID()}`,
      });
      const request = {
        activityId: assigned.id,
        response: "One mole divided by two litres is 0.5 mol/L.",
        capabilityPublicKey,
        fields,
        idempotencyKey: `cap06-terminal-runtime:${terminal}:${randomUUID()}`,
      };
      const result = await withTenantDatabase(learner, () => executeGovernedFollowup(learner, request, {
        getAdapter: (implementationKey) => ({
          implementationKey,
          runtimeKind: "TRUSTED_DETERMINISTIC_ADAPTER",
          replaySafe: true,
          async execute() {
            if (terminal === "CANCELLED") {
              throw new DomainInvariantError("Injected governed cancellation", "EXECUTION_ABORTED");
            }
            throw new Error("Injected governed adapter failure");
          },
        }),
      }));
      expect(result.status).toBe(terminal === "CANCELLED" ? "CANCELLED" : "FAILED_FINAL");
      const [stored] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, assigned.id));
      const [episode] = await getDb().select().from(learningEpisodes).where(eq(learningEpisodes.id, assigned.targetEpisodeId!));
      const [context] = await getDb().select().from(contextItems).where(eq(contextItems.id, assigned.contextItemId!));
      const deliveries = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.episodeId, assigned.targetEpisodeId!));
      expect(stored.status).toBe(terminal === "CANCELLED" ? "CANCELLED" : "FAILED_FINAL");
      expect(episode.status).toBe(terminal === "CANCELLED" ? "CANCELLED" : "FAILED");
      expect(context).toMatchObject({ state: "INVALIDATED" });
      expect(context.invalidatedAt).toBeTruthy();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.status).toBe(terminal);

      const replay = await executeGovernedFollowup(learner, request);
      expect(replay.status).toBe(stored.status);
      expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.episodeId, assigned.targetEpisodeId!))).toHaveLength(1);
      await expect(executeGovernedFollowup(learner, { ...request, idempotencyKey: `cap06-fake-recovery:${randomUUID()}` }))
        .rejects.toMatchObject({ code: "FOLLOWUP_RECOVERY_IDEMPOTENCY_MISMATCH" });
    }
  });

  it("requires the exact learner role for formal attempts and leaves no impersonated Attempt", async () => {
    const fixture = await source("admin-impersonation");
    const assigned = await createGovernedFollowup(teacher, {
      observationId: fixture.observation.id,
      reviewId: fixture.review.reviewId,
      activityType: "RETRY",
      prompt: "Reject an administrator submitting the learner's formal follow-up Attempt.",
      assignmentIdempotencyKey: `cap06-admin-impersonation:${randomUUID()}`,
    });
    const adminOnly: Actor = {
      ...learner,
      roles: ["ADMIN"],
      sessionId: `cap06-admin-impersonation:${randomUUID()}`,
    };
    await expect(executeGovernedFollowup(adminOnly, {
      activityId: assigned.id,
      response: "An administrator must not author this learner Attempt.",
      capabilityPublicKey,
      fields,
      idempotencyKey: `cap06-admin-runtime:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    expect(await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.taskId, fixture.task.taskId))).toHaveLength(1);
  });

  it("blocks Task closure during an active follow-up and makes exact cancellation replayable", async () => {
    const fixture = await source("task-close-and-cancel");
    const workflow = await startWorkflow({
      kind: "GOVERNED_FOLLOWUP",
      actor: teacher,
      state: {
        observationId: fixture.observation.id,
        reviewId: fixture.review.reviewId,
        activityType: "RETRY",
        prompt: "Keep this governed follow-up active until it is explicitly cancelled.",
        assignmentIdempotencyKey: `cap06-close-cancel:${randomUUID()}`,
      },
    });
    expect(workflow).toMatchObject({ status: "INTERRUPTED", interruptType: "LEARNER_FOLLOWUP_REQUIRED" });
    const activityId = (workflow.result as Record<string, unknown>).activityId as string;
    await expect(closeTask(learner, fixture.task.taskId)).rejects.toMatchObject({ code: "FOLLOWUP_ACTIVE" });

    const reason = "Learner explicitly cancelled before starting runtime.";
    const cancelled = await cancelGovernedFollowup(learner, activityId, reason);
    const replayed = await cancelGovernedFollowup(learner, activityId, reason);
    expect(cancelled.status).toBe("CANCELLED");
    expect(replayed.id).toBe(cancelled.id);
    expect(replayed.latestTransitionEventId).toBe(cancelled.latestTransitionEventId);
    await expect(cancelGovernedFollowup(learner, activityId, "A different immutable cancellation reason."))
      .rejects.toMatchObject({ code: "FOLLOWUP_CANCELLATION_IDEMPOTENCY_MISMATCH" });

    const [storedRun] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, workflow.runId));
    expect(storedRun).toMatchObject({ status: "CANCELLED", interruptType: null });
    expect(storedRun.productLinks).toMatchObject({
      activityId,
      activityStatus: "CANCELLED",
      failureCode: "CANCELLED_BEFORE_RUNTIME",
      failureReason: reason,
    });
    await closeTask(learner, fixture.task.taskId);
    const [closed] = await getDb().select().from(learningTasks).where(eq(learningTasks.id, fixture.task.taskId));
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).toBeTruthy();
  });

  it("rejects wording-only Transfer before persisting a successor Episode", async () => {
    const fixture = await source("wording-only-transfer");
    await expect(createGovernedFollowup(teacher, {
      observationId: fixture.observation.id,
      reviewId: fixture.review.reviewId,
      activityType: "TRANSFER",
      prompt: "Change only the wording while preserving the same structure.",
      assignmentIdempotencyKey: `cap06-wording-only:${randomUUID()}`,
      transfer: {
        target: {
          context: `  ${fixture.title.toLocaleUpperCase("en-US")}  `,
          representation: " text ",
          itemFamily: capabilityPublicKey.toLocaleUpperCase("en-US"),
          problemStructure: " CHEMISTRY.MOLAR-CONCENTRATION.V1 ",
        },
        materialDifferenceRationale: "Only the wording changes, so this must be rejected as non-material.",
      },
    })).rejects.toBeTruthy();
    const episodes = await getDb().select().from(learningEpisodes).where(eq(learningEpisodes.taskId, fixture.task.taskId));
    expect(episodes).toHaveLength(1);
    expect(await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.taskId, fixture.task.taskId))).toHaveLength(1);
  });
});
