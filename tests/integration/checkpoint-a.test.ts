import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  captureAttempt,
  appendConversationEvent,
  addLibraryItem,
  createRetry,
  createTeacherReview,
  createComponentCandidate,
  createTask,
  linkRetryResult,
  persistUnavailableObservation,
  scheduleStudyReview,
} from "@/application/commands";
import { compileAndPersistContext } from "@/application/context-service";
import { getActor } from "@/application/actor";
import { authenticateSyntheticPrincipal, issueAuthSession, verifyAndRotateAuthSession } from "@/application/auth-session";
import { getAuthorizedEvidenceCatalog, getFoundryWorkspace, getStaleResumingRuns, getTaskDetail, getTeacherWorkspace } from "@/application/queries";
import { retrieveEvidence } from "@/application/retrieval";
import { resumeWorkflow, startWorkflow, WorkflowProcessCrashForTests } from "@/application/workflow-service";
import { claimWorkflowResume, finalizeWorkflowResumeClaim, RESUME_LEASE_MS } from "@/application/workflow-resume-lease";
import { closeDb, getDb, getSql } from "@/db/client";
import { SEED } from "@/db/ids";
import { authSessions, conversationEvents, courseEnrollments, courses, evidenceUnits, idempotencyKeys, institutionMemberships, learningOutcomes, libraryItems, retryAttempts, scheduleItems, sourceRecords, teacherReviews, users, workflowRuns } from "@/db/schema";
import type { Actor } from "@/domain/model";
import { DomainInvariantError } from "@/domain/invariants";
import { closeWorkflowCheckpointer, getWorkflowCheckpointer } from "@/workflows/checkpointer";
import { buildLearnerTaskGraph } from "@/workflows/learner-task";

type EligiblePatternSignal = {
  observation_id: string;
  failure_code: string;
  attempt_id: string;
  learner_id: string;
  capability_id: string;
  course_id: string;
  reference_pack_key: string;
};

async function queryEligiblePatternSignals(actor: Actor, requireCurrentCapabilityBinding: boolean): Promise<EligiblePatternSignal[]> {
  return getSql()<EligiblePatternSignal[]>`
    SELECT o.id AS observation_id, o.failure_code, a.id AS attempt_id, a.learner_id,
           a.capability_id, t.course_id, subject.reference_pack_key
    FROM foundry_product.diagnostic_observations o
    JOIN foundry_product.learner_attempts a ON a.id = o.attempt_id
    JOIN foundry_product.learning_tasks t ON t.id = a.task_id
    JOIN foundry_product.courses course_scope ON course_scope.id = t.course_id
    JOIN foundry_product.subjects subject ON subject.id = course_scope.subject_id
    JOIN LATERAL (
      SELECT r.decision, r.teacher_id, r.actor_provenance
      FROM foundry_product.teacher_reviews r
      WHERE r.observation_id = o.id
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1
    ) current_review ON true
    WHERE t.institution_id = ${actor.institutionId}
      AND t.course_id = ANY(${actor.courseIds}::uuid[])
      AND o.observation_source = 'CAPABILITY'
      AND o.failure_code IS NOT NULL
      AND o.superseded_by_id IS NULL
      AND a.capability_id IS NOT NULL
      AND (
        ${!requireCurrentCapabilityBinding}
        OR EXISTS (
          SELECT 1
          FROM foundry_product.capabilities current_capability
          WHERE current_capability.id = a.capability_id
            AND current_capability.active_version_id = o.capability_version_id
            AND subject.reference_pack_key = current_capability.reference_pack_key
        )
      )
      AND current_review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')
      AND current_review.actor_provenance->>'userId' = current_review.teacher_id::text
      AND current_review.actor_provenance->>'institutionId' = t.institution_id::text
      AND length(COALESCE(current_review.actor_provenance->>'sessionId', '')) > 0
      AND COALESCE(current_review.actor_provenance->>'authMethod', '') NOT LIKE 'migrated-%'
  `;
}

function getTeacherPatternHistorySignals(actor: Actor): Promise<EligiblePatternSignal[]> {
  return queryEligiblePatternSignals(actor, false);
}

function getCurrentReusablePatternSignals(actor: Actor): Promise<EligiblePatternSignal[]> {
  return queryEligiblePatternSignals(actor, true);
}

describe.sequential("Checkpoint A PostgreSQL integration", () => {
  let learner: Actor;
  let teacher: Actor;
  let expert: Actor;
  let engineer: Actor;
  let fixtureObservationId: string;

  beforeAll(async () => {
    learner = await getActor(SEED.learner, SEED.institution, "integration-test", "learner-session");
    teacher = await getActor(SEED.teacher, SEED.institution, "integration-test", "teacher-session");
    expert = await getActor(SEED.expert, SEED.institution, "integration-test", "expert-session");
    engineer = await getActor(SEED.engineer, SEED.institution, "integration-test", "engineer-session");
    const fixtureKey = randomUUID();
    const attempt = await captureAttempt(learner, {
      taskId: SEED.task,
      episodeId: SEED.episode,
      prompt: `Repeatable integration fixture ${fixtureKey}`,
      response: "I will justify each transformation and verify its units.",
      structuredInput: { responseType: "FREE_TEXT", integrationFixture: fixtureKey },
      idempotencyKey: `integration-fixture:${fixtureKey}`,
    });
    const observation = await persistUnavailableObservation({ attemptId: attempt.id, reason: "Isolated integration fixture; no capability execution is claimed." });
    fixtureObservationId = observation.id;
  });

  afterAll(async () => {
    await closeWorkflowCheckpointer();
    await closeDb();
  });

  it("keeps Product State, operational state and LangGraph checkpoints physically separate", async () => {
    const schemas = await getSql()<Array<{ schema_name: string }>>`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name IN ('foundry_product', 'foundry_operational', 'langgraph_checkpoint')
      ORDER BY schema_name
    `;
    expect(schemas.map((row) => row.schema_name)).toEqual(["foundry_operational", "foundry_product", "langgraph_checkpoint"]);
    const productOperationalTables = await getSql()<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'foundry_product' AND table_name IN ('workflow_runs', 'retrieval_runs', 'eval_runs')
    `;
    expect(productOperationalTables[0].count).toBe(0);
  });

  it("scopes explicit active institution membership and course enrollments", async () => {
    expect(learner.institutionId).toBe(SEED.institution);
    expect(learner.courseIds).toEqual([SEED.course]);
    await expect(getActor(SEED.learner, randomUUID(), "integration-test", "wrong-institution")).rejects.toMatchObject({ code: "NO_MEMBERSHIP" });
  });

  it("rejects disabled principals and excludes inactive courses", async () => {
    const fixture = randomUUID();
    const disabledUserId = randomUUID();
    await getDb().insert(users).values({ id: disabledUserId, email: `disabled-${fixture}@integration.invalid`, name: "Disabled Integration User", active: false });
    await getDb().insert(institutionMemberships).values({ userId: disabledUserId, institutionId: SEED.institution, role: "LEARNER" });
    await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: disabledUserId, role: "LEARNER" });
    await expect(getActor(disabledUserId, SEED.institution, "integration-test", `disabled:${fixture}`)).rejects.toMatchObject({ code: "PRINCIPAL_INACTIVE" });

    const inactiveCourseId = randomUUID();
    await getDb().insert(courses).values({
      id: inactiveCourseId,
      institutionId: SEED.institution,
      subjectId: SEED.subject,
      code: `INACTIVE-${fixture.slice(0, 8)}`,
      name: "Inactive integration course",
      active: false,
    });
    await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: inactiveCourseId, userId: learner.userId, role: "LEARNER" });
    const refreshed = await getActor(learner.userId, SEED.institution, "integration-test", `inactive-course:${fixture}`);
    expect(refreshed.courseIds).toContain(SEED.course);
    expect(refreshed.courseIds).not.toContain(inactiveCourseId);
  });

  it("rejects mismatched idempotency-key reuse", async () => {
    const idempotencyKey = `integration-task:${randomUUID()}`;
    const first = await createTask(learner, { courseId: SEED.course, title: "Integration Task", goal: "Verify idempotency request identity", idempotencyKey });
    const replay = await createTask(learner, { courseId: SEED.course, title: "Integration Task", goal: "Verify idempotency request identity", idempotencyKey });
    expect(replay.taskId).toBe(first.taskId);
    expect(replay.replayed).toBe(true);
    await expect(createTask(learner, { courseId: SEED.course, title: "Changed request", goal: "This body must not reuse the key", idempotencyKey })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("returns the exact original ConversationEvent and rejects changed replay payloads", async () => {
    const fixture = randomUUID();
    const input = {
      taskId: SEED.task,
      episodeId: SEED.episode,
      kind: "MESSAGE",
      actorType: "LEARNER",
      content: `Stable Event command ${fixture}`,
      idempotencyKey: `conversation-event:${fixture}`,
    };
    const first = await appendConversationEvent(learner, input);
    const replay = await appendConversationEvent(learner, input);
    expect(replay).toMatchObject({ id: first.id, replayed: true });
    expect(await getDb().select().from(conversationEvents).where(eq(conversationEvents.id, first.id))).toHaveLength(1);
    await expect(appendConversationEvent(learner, { ...input, content: `Changed Event command ${fixture}` })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("binds command idempotency to the authenticated actor", async () => {
    const fixture = randomUUID();
    const secondLearnerId = randomUUID();
    await getDb().insert(users).values({ id: secondLearnerId, email: `task-actor-${fixture}@integration.invalid`, name: "Second Task Actor" });
    await getDb().insert(institutionMemberships).values({ userId: secondLearnerId, institutionId: SEED.institution, role: "LEARNER" });
    await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: secondLearnerId, role: "LEARNER" });
    const secondLearner = await getActor(secondLearnerId, SEED.institution, "integration-test", `task-actor:${fixture}`);
    const taskInput = { courseId: SEED.course, title: "Actor-bound Task", goal: "Prove cross-actor replay is rejected", idempotencyKey: `actor-task:${fixture}` };
    const firstTask = await createTask(learner, taskInput);
    await expect(createTask(secondLearner, taskInput)).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await getTaskDetail(learner, firstTask.taskId))?.task.learnerId).toBe(learner.userId);

    const secondTeacherId = randomUUID();
    await getDb().insert(users).values({ id: secondTeacherId, email: `teacher-actor-${fixture}@integration.invalid`, name: "Second Teacher Actor" });
    await getDb().insert(institutionMemberships).values({ userId: secondTeacherId, institutionId: SEED.institution, role: "TEACHER" });
    await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: secondTeacherId, role: "TEACHER" });
    const secondTeacher = await getActor(secondTeacherId, SEED.institution, "integration-test", `teacher-actor:${fixture}`);
    const attempt = await captureAttempt(learner, { taskId: SEED.task, episodeId: SEED.episode, prompt: `Actor review ${fixture}`, response: "Teacher authority fixture", structuredInput: {}, idempotencyKey: `actor-attempt:${fixture}` });
    const observation = await persistUnavailableObservation({ attemptId: attempt.id, reason: "Actor-bound governance fixture" });
    const reviewInput = { observationId: observation.id, decision: "ACCEPT", teachingSupport: "Authenticate the human reviewer for this decision.", idempotencyKey: `actor-review:${fixture}` };
    const firstReview = await createTeacherReview(teacher, reviewInput);
    await expect(createTeacherReview(secondTeacher, reviewInput)).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await getDb().select().from(teacherReviews).where(eq(teacherReviews.id, firstReview.reviewId)))[0]?.teacherId).toBe(teacher.userId);
  });

  it("makes Library and Study Review writes replay-safe without creating Retry state", async () => {
    const libraryKey = `integration-library:${randomUUID()}`;
    const libraryInput = { courseId: SEED.course, evidenceUnitId: SEED.textEvidence, title: "Authorized synthetic note", reason: "Save for a later study session", idempotencyKey: libraryKey };
    const firstLibrary = await addLibraryItem(learner, libraryInput);
    const replayedLibrary = await addLibraryItem(learner, libraryInput);
    expect(replayedLibrary).toMatchObject({ id: firstLibrary.id, replayed: true });
    expect(await getDb().select().from(libraryItems).where(eq(libraryItems.id, firstLibrary.id))).toHaveLength(1);
    await expect(addLibraryItem(learner, { ...libraryInput, reason: "A different request", idempotencyKey: libraryKey })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });

    const reminderKey = `integration-study-review:${randomUUID()}`;
    const dueAt = new Date("2030-01-02T10:00:00.000Z");
    const firstReminder = await scheduleStudyReview(learner, { taskId: SEED.task, dueAt, idempotencyKey: reminderKey });
    const replayedReminder = await scheduleStudyReview(learner, { taskId: SEED.task, dueAt, idempotencyKey: reminderKey });
    expect(replayedReminder).toMatchObject({ id: firstReminder.id, activityType: "STUDY_REVIEW", replayed: true });
    expect(await getDb().select().from(scheduleItems).where(eq(scheduleItems.id, firstReminder.id))).toHaveLength(1);
    expect(await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, firstReminder.id))).toEqual([]);
    await expect(scheduleStudyReview(learner, { taskId: SEED.task, dueAt: new Date("2030-01-03T10:00:00.000Z"), idempotencyKey: reminderKey })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("fails Evidence delivery closed unless persisted rights are explicitly APPROVED", async () => {
    const approvedCatalog = await getAuthorizedEvidenceCatalog(learner, SEED.task);
    expect(approvedCatalog.some((row) => row.evidence.id === SEED.textEvidence && row.source.rightsAuthorizationStatus === "APPROVED")).toBe(true);
    const approvedRetrieval = await retrieveEvidence({ actor: learner, taskId: SEED.task, query: "calculation route units", purpose: "LEARNING" });
    expect(approvedRetrieval.hits.some((hit) => hit.evidenceUnitId === SEED.textEvidence && hit.rightsAuthorizationStatus === "APPROVED")).toBe(true);

    const fixture = randomUUID();
    const reviewSourceId = randomUUID();
    const reviewEvidenceId = randomUUID();
    await getDb().insert(sourceRecords).values({
      id: reviewSourceId,
      sourceKey: `rights-review-${fixture}`,
      title: "Rights review fixture",
      sourceType: "TEST_FIXTURE",
      version: "1",
      authority: "INTEGRATION_TEST",
      rights: "LICENSE_TEXT_RETAINED_FOR_REVIEW",
      rightsAuthorizationStatus: "REVIEW_REQUIRED",
      distributionScope: "PUBLIC",
      allowedPurposes: ["LEARNING"],
      contentHash: fixture,
    });
    await getDb().insert(evidenceUnits).values({
      id: reviewEvidenceId,
      sourceId: reviewSourceId,
      modality: "TEXT",
      locator: `fixture#${fixture}`,
      title: "Review-required Evidence",
      content: "rightsreviewfixture must never be delivered",
      searchDocument: "rightsreviewfixture",
      metadata: { courseIds: [SEED.course], referencePackKey: "chemistry-caie-9701" },
      contentHash: fixture,
    });
    expect((await getAuthorizedEvidenceCatalog(learner, SEED.task)).some((row) => row.evidence.id === reviewEvidenceId)).toBe(false);
    expect((await retrieveEvidence({ actor: learner, taskId: SEED.task, query: "rightsreviewfixture", purpose: "LEARNING" })).hits).toEqual([]);
    await expect(addLibraryItem(learner, { courseId: SEED.course, evidenceUnitId: reviewEvidenceId, title: "Must not save", reason: "Rights are unresolved", idempotencyKey: `rights-review:${fixture}` })).rejects.toMatchObject({ code: "EVIDENCE_RIGHTS_DENIED" });

    await expect(getDb().insert(sourceRecords).values({
      id: randomUUID(),
      sourceKey: `rights-unknown-${fixture}`,
      title: "Unknown rights fixture",
      sourceType: "TEST_FIXTURE",
      version: "1",
      authority: "INTEGRATION_TEST",
      rights: "UNKNOWN_LICENSE_TEXT",
      rightsAuthorizationStatus: "UNKNOWN",
      distributionScope: "PUBLIC",
      allowedPurposes: ["LEARNING"],
      contentHash: randomUUID(),
    })).rejects.toBeTruthy();
  });

  it("does not replay one learner's Library item to another learner in the same institution", async () => {
    const fixture = randomUUID();
    const secondLearnerId = randomUUID();
    await getDb().insert(users).values({ id: secondLearnerId, email: `second-learner-${fixture}@integration.invalid`, name: "Second Integration Learner" });
    await getDb().insert(institutionMemberships).values({ userId: secondLearnerId, institutionId: SEED.institution, role: "LEARNER" });
    await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: secondLearnerId, role: "LEARNER" });
    const secondLearner = await getActor(secondLearnerId, SEED.institution, "integration-test", `second-learner:${fixture}`);
    const idempotencyKey = `learner-scoped-library:${fixture}`;
    const input = { courseId: SEED.course, evidenceUnitId: SEED.textEvidence, title: "Learner-scoped resource", reason: "Prove replay ownership", idempotencyKey };
    const first = await addLibraryItem(learner, input);
    await expect(addLibraryItem(secondLearner, input)).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect(await getDb().select().from(libraryItems).where(eq(libraryItems.id, first.id))).toMatchObject([{ learnerId: learner.userId }]);
    expect(await getDb().select().from(libraryItems).where(eq(libraryItems.learnerId, secondLearnerId))).toEqual([]);
  });

  it("rejects cross-Task Episode pairs at commands, Context and workflow starts", async () => {
    const fixture = randomUUID();
    const otherTask = await createTask(learner, {
      courseId: SEED.course,
      title: "Episode lineage fixture",
      goal: "Reject a valid Episode from another Task",
      idempotencyKey: `episode-lineage:${fixture}`,
    });
    const mismatchedPair = { taskId: SEED.task, episodeId: otherTask.episodeId! };

    await expect(appendConversationEvent(learner, { ...mismatchedPair, kind: "MESSAGE", actorType: "LEARNER", content: "Must not cross Task lineage", idempotencyKey: `cross-pair-event:${fixture}` })).rejects.toMatchObject({ code: "TASK_EPISODE_LINEAGE" });
    await expect(captureAttempt(learner, { ...mismatchedPair, prompt: "Cross pair", response: "Must fail", structuredInput: {}, idempotencyKey: `cross-pair-attempt:${fixture}` })).rejects.toMatchObject({ code: "TASK_EPISODE_LINEAGE" });
    await expect(compileAndPersistContext(learner, mismatchedPair)).rejects.toMatchObject({ code: "TASK_EPISODE_LINEAGE" });
    await expect(startWorkflow({
      kind: "LEARNER_TASK",
      actor: learner,
      state: { ...mismatchedPair, courseId: SEED.course, message: "Cross pair", requestedAction: "EXPLAIN", idempotencyKey: `cross-pair-task:${fixture}` },
    })).rejects.toMatchObject({ code: "TASK_EPISODE_LINEAGE" });
    await expect(startWorkflow({
      kind: "EXPLANATION",
      actor: learner,
      state: { ...mismatchedPair, question: "Cross pair explanation", idempotencyKey: `cross-pair-explanation:${fixture}` },
    })).rejects.toMatchObject({ code: "TASK_EPISODE_LINEAGE" });
    await expect(startWorkflow({
      kind: "DIAGNOSIS",
      actor: learner,
      state: { ...mismatchedPair, prompt: "Cross pair diagnosis", response: "Must fail", structuredInput: {}, idempotencyKey: `cross-pair-diagnosis:${fixture}` },
    })).rejects.toMatchObject({ code: "TASK_EPISODE_LINEAGE" });
    await expect(startWorkflow({
      kind: "LEARNER_TASK",
      actor: learner,
      taskId: SEED.task,
      episodeId: SEED.episode,
      state: { taskId: SEED.task, episodeId: SEED.episode, courseId: randomUUID(), message: "Wrong course", requestedAction: "EXPLAIN", idempotencyKey: `wrong-course:${fixture}` },
    })).rejects.toMatchObject({ code: "WORKFLOW_BINDING_MISMATCH" });
    await expect(startWorkflow({
      kind: "TEACHER_REVIEW",
      actor: learner,
      state: { observationId: fixtureObservationId },
      taskId: otherTask.taskId,
      episodeId: otherTask.episodeId,
    })).rejects.toMatchObject({ code: "WORKFLOW_BINDING_MISMATCH" });
  });

  it("replays learner and Foundry Events by exact ID after node/checkpoint failures", async () => {
    const checkpoint = getWorkflowCheckpointer(learner.institutionId);
    const learnerFixture = randomUUID();
    const learnerKey = `learner-node-fault:${learnerFixture}`;
    const learnerMessage = `Learner node fault ${learnerFixture}`;
    const beforeLearner = await getDb().select().from(conversationEvents).where(and(eq(conversationEvents.taskId, SEED.task), eq(conversationEvents.actorType, "LEARNER")));
    let committedLearnerId = "";
    const learnerFaultGraph = buildLearnerTaskGraph(checkpoint, {
      afterLearnerEventPersisted(eventId) {
        committedLearnerId = eventId;
        throw new Error("INJECTED_AFTER_LEARNER_EVENT");
      },
    });
    const learnerState = { actor: learner, taskId: SEED.task, episodeId: SEED.episode, courseId: SEED.course, message: learnerMessage, requestedAction: "EXPLAIN" as const, idempotencyKey: learnerKey };
    const learnerThread = `${learner.institutionId}:learner-node-fault:${randomUUID()}`;
    await expect(learnerFaultGraph.invoke(learnerState, { configurable: { thread_id: learnerThread }, recursionLimit: 50 })).rejects.toThrow("INJECTED_AFTER_LEARNER_EVENT");
    expect(committedLearnerId).not.toBe("");
    expect(await getDb().select().from(conversationEvents).where(and(eq(conversationEvents.taskId, SEED.task), eq(conversationEvents.actorType, "LEARNER")))).toHaveLength(beforeLearner.length + 1);
    const learnerReplay = await buildLearnerTaskGraph(checkpoint).invoke(learnerState, { configurable: { thread_id: learnerThread }, recursionLimit: 50 });
    expect(learnerReplay.learnerEventId).toBe(committedLearnerId);
    expect(await getDb().select().from(conversationEvents).where(and(eq(conversationEvents.taskId, SEED.task), eq(conversationEvents.actorType, "LEARNER")))).toHaveLength(beforeLearner.length + 1);

    const foundryFixture = randomUUID();
    const foundryKey = `foundry-node-fault:${foundryFixture}`;
    const beforeFoundry = await getDb().select().from(conversationEvents).where(and(eq(conversationEvents.taskId, SEED.task), eq(conversationEvents.actorType, "FOUNDRY")));
    let committedFoundryId = "";
    const foundryFaultGraph = buildLearnerTaskGraph(checkpoint, {
      explanation: {
        afterFoundryEventPersisted(eventId) {
          committedFoundryId = eventId;
          throw new Error("INJECTED_AFTER_FOUNDRY_EVENT");
        },
      },
    });
    const foundryState = { actor: learner, taskId: SEED.task, episodeId: SEED.episode, courseId: SEED.course, message: `Foundry node fault ${foundryFixture}`, requestedAction: "EXPLAIN" as const, idempotencyKey: foundryKey };
    const foundryThread = `${learner.institutionId}:foundry-node-fault:${randomUUID()}`;
    await expect(foundryFaultGraph.invoke(foundryState, { configurable: { thread_id: foundryThread }, recursionLimit: 50 })).rejects.toThrow("INJECTED_AFTER_FOUNDRY_EVENT");
    expect(committedFoundryId).not.toBe("");
    expect(await getDb().select().from(conversationEvents).where(and(eq(conversationEvents.taskId, SEED.task), eq(conversationEvents.actorType, "FOUNDRY")))).toHaveLength(beforeFoundry.length + 1);
    const foundryReplay = await buildLearnerTaskGraph(checkpoint).invoke(foundryState, { configurable: { thread_id: foundryThread }, recursionLimit: 50 });
    expect((foundryReplay.result as { responseEventId?: string }).responseEventId).toBe(committedFoundryId);
    expect(await getDb().select().from(conversationEvents).where(and(eq(conversationEvents.taskId, SEED.task), eq(conversationEvents.actorType, "FOUNDRY")))).toHaveLength(beforeFoundry.length + 1);
  });

  it("replays completed graph Events without duplication after an operational terminal-write crash", async () => {
    const fixture = randomUUID();
    const state = { taskId: SEED.task, episodeId: SEED.episode, courseId: SEED.course, message: `Operational terminal fault ${fixture}`, requestedAction: "EXPLAIN" as const, idempotencyKey: `operational-fault:${fixture}` };
    const before = await getDb().select().from(conversationEvents).where(eq(conversationEvents.taskId, SEED.task));
    let crashedRunId = "";
    await expect(startWorkflow({
      kind: "LEARNER_TASK",
      actor: learner,
      state,
      testFaults: {
        afterGraphCompletion({ runId }) {
          crashedRunId = runId;
          throw new WorkflowProcessCrashForTests();
        },
      },
    })).rejects.toBeInstanceOf(WorkflowProcessCrashForTests);
    const [crashed] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, crashedRunId));
    expect(crashed.status).toBe("RUNNING");
    const afterCrash = await getDb().select().from(conversationEvents).where(eq(conversationEvents.taskId, SEED.task));
    expect(afterCrash).toHaveLength(before.length + 2);
    const learnerEvent = afterCrash.find((event) => event.actorType === "LEARNER" && event.content === state.message);
    const foundryEvent = afterCrash.find((event) => event.actorType === "FOUNDRY" && !before.some((prior) => prior.id === event.id));
    expect(learnerEvent?.id).toBeTruthy();
    expect(foundryEvent?.id).toBeTruthy();

    const replay = await startWorkflow({ kind: "LEARNER_TASK", actor: learner, state });
    const replayResult = replay.result as { learnerEventId?: string; result?: { responseEventId?: string } };
    expect(replayResult.learnerEventId).toBe(learnerEvent?.id);
    expect(replayResult.result?.responseEventId).toBe(foundryEvent?.id);
    expect(await getDb().select().from(conversationEvents).where(eq(conversationEvents.taskId, SEED.task))).toHaveLength(afterCrash.length);
  });

  it("records request abort and deadline honestly and stops before later canonical writes", async () => {
    const abortFixture = randomUUID();
    const abortThread = `${learner.institutionId}:abort-control:${abortFixture}`;
    const abortKey = `abort-control:${abortFixture}`;
    const abortController = new AbortController();
    await expect(startWorkflow({
      kind: "LEARNER_TASK",
      actor: learner,
      threadId: abortThread,
      state: { taskId: SEED.task, episodeId: SEED.episode, courseId: SEED.course, message: `Abort after learner Event ${abortFixture}`, requestedAction: "EXPLAIN", idempotencyKey: abortKey },
      execution: { signal: abortController.signal, deadlineMs: 1_000 },
      testFaults: { afterLearnerEventPersisted() { abortController.abort(); } },
    })).rejects.toMatchObject({ code: "EXECUTION_ABORTED" });
    const [aborted] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.threadId, abortThread));
    expect(aborted.status).toBe("ABORTED");
    expect(await getDb().select().from(conversationEvents).where(and(eq(conversationEvents.taskId, SEED.task), eq(conversationEvents.content, `Abort after learner Event ${abortFixture}`)))).toHaveLength(1);
    expect(await getDb().select().from(idempotencyKeys).where(and(eq(idempotencyKeys.commandType, "APPEND_CONVERSATION_EVENT"), eq(idempotencyKeys.key, `${abortKey}:conversation:foundry`)))).toEqual([]);

    const deadlineFixture = randomUUID();
    const deadlineThread = `${learner.institutionId}:deadline-control:${deadlineFixture}`;
    const deadlineKey = `deadline-control:${deadlineFixture}`;
    await expect(startWorkflow({
      kind: "LEARNER_TASK",
      actor: learner,
      threadId: deadlineThread,
      state: { taskId: SEED.task, episodeId: SEED.episode, courseId: SEED.course, message: `Deadline after learner Event ${deadlineFixture}`, requestedAction: "EXPLAIN", idempotencyKey: deadlineKey },
      execution: { deadlineMs: 100 },
      testFaults: { async afterLearnerEventPersisted() { await new Promise((resolve) => setTimeout(resolve, 125)); } },
    })).rejects.toMatchObject({ code: "EXECUTION_TIMED_OUT" });
    const [timedOut] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.threadId, deadlineThread));
    expect(timedOut.status).toBe("TIMED_OUT");
    expect(await getDb().select().from(conversationEvents).where(and(eq(conversationEvents.taskId, SEED.task), eq(conversationEvents.content, `Deadline after learner Event ${deadlineFixture}`)))).toHaveLength(1);
    expect(await getDb().select().from(idempotencyKeys).where(and(eq(idempotencyKeys.commandType, "APPEND_CONVERSATION_EVENT"), eq(idempotencyKeys.key, `${deadlineKey}:conversation:foundry`)))).toEqual([]);
  });

  it("blocks cross-tenant Task and Teacher queries", async () => {
    const authorizedWorkspace = await getTeacherWorkspace(teacher);
    expect(authorizedWorkspace.queue.length).toBeGreaterThan(0);
    expect(authorizedWorkspace.queue[0]).toHaveProperty("waiting_interrupt_version");
    const eligibleSignals = await getTeacherPatternHistorySignals(teacher);
    expect(eligibleSignals.map((signal) => signal.observation_id)).not.toContain(fixtureObservationId);
    const expectedPatterns = new Map<string, { count: number; learners: Set<string> }>();
    for (const signal of eligibleSignals) {
      const pattern = expectedPatterns.get(signal.failure_code) ?? { count: 0, learners: new Set<string>() };
      pattern.count += 1;
      pattern.learners.add(signal.learner_id);
      expectedPatterns.set(signal.failure_code, pattern);
    }
    expect(authorizedWorkspace.patterns.map((pattern) => ({ pattern: String(pattern.pattern), count: Number(pattern.count), learners: Number(pattern.learners) })).sort((left, right) => left.pattern.localeCompare(right.pattern))).toEqual(
      [...expectedPatterns].map(([pattern, proof]) => ({ pattern, count: proof.count, learners: proof.learners.size })).sort((left, right) => left.pattern.localeCompare(right.pattern)),
    );
    const outsider: Actor = { ...teacher, institutionId: randomUUID(), sessionId: "outsider", courseIds: [SEED.course] };
    await expect(getTaskDetail(outsider, SEED.task)).rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    const workspace = await getTeacherWorkspace(outsider);
    expect(workspace.queue).toEqual([]);
    expect(workspace.retries).toEqual([]);
  });

  it("allows exactly one concurrent human resume and rejects replay", async () => {
    const started = await startWorkflow({
      kind: "TEACHER_REVIEW",
      actor: learner,
      state: { observationId: fixtureObservationId },
      taskId: SEED.task,
      episodeId: SEED.episode,
    });
    expect(started.interruptType).toBe("TEACHER_REVIEW_REQUIRED");
    const payload = (suffix: string) => ({ expectedVersion: started.expectedVersion, decision: "ACCEPT", teachingSupport: "Inspect each transformation and its units.", idempotencyKey: `concurrent-review:${suffix}:${randomUUID()}` });
    const results = await Promise.allSettled([
      resumeWorkflow(teacher, started.threadId, payload("one")),
      resumeWorkflow(teacher, started.threadId, payload("two")),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(resumeWorkflow(teacher, started.threadId, payload("replay"))).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("preserves an interrupted workflow across session expiry and safe reauthentication", async () => {
    const fixture = randomUUID();
    const attempt = await captureAttempt(learner, {
      taskId: SEED.task,
      episodeId: SEED.episode,
      prompt: `Session-expiry resume ${fixture}`,
      response: "The saved interrupt must survive a required reauthentication.",
      structuredInput: {},
      idempotencyKey: `session-expiry-attempt:${fixture}`,
    });
    const observation = await persistUnavailableObservation({ attemptId: attempt.id, reason: "OPS-06 reauthentication fixture" });
    const started = await startWorkflow({ kind: "TEACHER_REVIEW", actor: learner, state: { observationId: observation.id } });

    const principal = await authenticateSyntheticPrincipal({ userId: teacher.userId, activeInstitutionId: teacher.institutionId });
    const expiredSession = await issueAuthSession(principal);
    await getDb().update(authSessions).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(authSessions.id, expiredSession.sessionId));
    const expiredReference = {
      sessionId: expiredSession.sessionId,
      sessionVersion: expiredSession.sessionVersion,
      userId: expiredSession.userId,
      issuer: expiredSession.issuer,
      subject: expiredSession.subject,
      activeInstitutionId: expiredSession.activeInstitutionId,
    };
    await expect(verifyAndRotateAuthSession(expiredReference)).rejects.toMatchObject({ code: "SESSION_REAUTH_REQUIRED" });

    const replacementSession = await issueAuthSession(principal);
    const verified = await verifyAndRotateAuthSession({
      sessionId: replacementSession.sessionId,
      sessionVersion: replacementSession.sessionVersion,
      userId: replacementSession.userId,
      issuer: replacementSession.issuer,
      subject: replacementSession.subject,
      activeInstitutionId: replacementSession.activeInstitutionId,
    });
    const reauthenticatedTeacher = await getActor(verified.userId, verified.activeInstitutionId, principal.authMethod, verified.sessionId);
    const resumed = await resumeWorkflow(reauthenticatedTeacher, started.threadId, {
      expectedVersion: started.expectedVersion,
      decision: "ACCEPT",
      teachingSupport: "Resume only after the replacement session is verified.",
      idempotencyKey: `session-expiry-review:${fixture}`,
    });
    expect(resumed.status).toBe("COMPLETED");
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, observation.id))).toHaveLength(1);
  });

  it("permits only one canonical Review across concurrent workflow handoffs", async () => {
    const fixture = randomUUID();
    const attempt = await captureAttempt(learner, {
      taskId: SEED.task,
      episodeId: SEED.episode,
      prompt: `Concurrent handoff ${fixture}`,
      response: "One Observation may have only one canonical Review.",
      structuredInput: {},
      idempotencyKey: `handoff-attempt:${fixture}`,
    });
    const observation = await persistUnavailableObservation({ attemptId: attempt.id, reason: "Concurrent workflow handoff fixture" });
    const [first, second] = await Promise.all([
      startWorkflow({ kind: "TEACHER_REVIEW", actor: learner, state: { observationId: observation.id } }),
      startWorkflow({ kind: "TEACHER_REVIEW", actor: learner, state: { observationId: observation.id } }),
    ]);
    const resume = (threadId: string, expectedVersion: number, suffix: string) => resumeWorkflow(teacher, threadId, {
      expectedVersion,
      decision: "ACCEPT",
      teachingSupport: "Preserve exactly one authenticated human decision.",
      idempotencyKey: `handoff-review:${fixture}:${suffix}`,
    });
    const results = await Promise.allSettled([
      resume(first.threadId, first.expectedVersion, "one"),
      resume(second.threadId, second.expectedVersion, "two"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "REVIEW_CONFLICT" } });
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, observation.id))).toHaveLength(1);
  });

  it("rejects a fresh resume lease and reclaims an expired crash lease without duplicating Review", async () => {
    const fixture = randomUUID();
    const attempt = await captureAttempt(learner, { taskId: SEED.task, episodeId: SEED.episode, prompt: `Lease fixture ${fixture}`, response: "Lease recovery requires one Review.", structuredInput: {}, idempotencyKey: `lease-attempt:${fixture}` });
    const observation = await persistUnavailableObservation({ attemptId: attempt.id, reason: "Lease recovery integration fixture" });
    const started = await startWorkflow({ kind: "TEACHER_REVIEW", actor: learner, state: { observationId: observation.id } });
    const [run] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, started.runId));
    const freshNow = new Date();
    await getDb().update(workflowRuns).set({ status: "RESUMING", resumeClaimedAt: freshNow, resumeClaimToken: `fresh:${fixture}`, resumeClaimVersion: 1, resumeLeaseExpiresAt: new Date(freshNow.getTime() + RESUME_LEASE_MS) }).where(eq(workflowRuns.id, run.id));
    const payload = { expectedVersion: started.expectedVersion, decision: "ACCEPT", teachingSupport: "Recover the exact interrupted Review safely.", idempotencyKey: `lease-review:${fixture}` };
    await expect(resumeWorkflow(teacher, started.threadId, payload)).rejects.toMatchObject({ code: "WORKFLOW_RESUME_IN_PROGRESS" });

    const expiredAt = new Date(Date.now() - 1_000);
    await getDb().update(workflowRuns).set({ resumeClaimedAt: new Date(expiredAt.getTime() - RESUME_LEASE_MS), resumeLeaseExpiresAt: expiredAt }).where(eq(workflowRuns.id, run.id));
    expect((await getStaleResumingRuns(engineer)).map((item) => item.id)).toContain(run.id);
    const recovered = await resumeWorkflow(teacher, started.threadId, payload);
    expect(recovered.status).toBe("COMPLETED");
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, observation.id))).toHaveLength(1);
    await expect(resumeWorkflow(teacher, started.threadId, payload)).rejects.toMatchObject({ code: "WORKFLOW_NOT_INTERRUPTED" });
  });

  it("reclaims an actual post-graph resume crash and preserves the exact canonical Review", async () => {
    const fixture = randomUUID();
    const attempt = await captureAttempt(learner, { taskId: SEED.task, episodeId: SEED.episode, prompt: `Post-graph crash ${fixture}`, response: "The resumed graph must not duplicate this Review.", structuredInput: {}, idempotencyKey: `post-graph-attempt:${fixture}` });
    const observation = await persistUnavailableObservation({ attemptId: attempt.id, reason: "Post-graph resume crash fixture" });
    const started = await startWorkflow({ kind: "TEACHER_REVIEW", actor: learner, state: { observationId: observation.id } });
    const payload = { expectedVersion: started.expectedVersion, decision: "ACCEPT", teachingSupport: "Preserve the exact human Review across reclaim.", idempotencyKey: `post-graph-review:${fixture}` };
    await expect(resumeWorkflow(teacher, started.threadId, payload, {
      testFaults: { afterGraphCompletion() { throw new WorkflowProcessCrashForTests(); } },
    })).rejects.toBeInstanceOf(WorkflowProcessCrashForTests);
    const [afterCrash] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, started.runId));
    expect(afterCrash).toMatchObject({ status: "RESUMING", resumeClaimVersion: 1 });
    expect(afterCrash.resumeClaimToken).toBeTruthy();
    const [originalReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, observation.id));
    expect(originalReview?.id).toBeTruthy();

    await getDb().update(workflowRuns).set({ resumeLeaseExpiresAt: new Date(Date.now() - 1) }).where(eq(workflowRuns.id, started.runId));
    const recovered = await resumeWorkflow(teacher, started.threadId, payload);
    expect(recovered.status).toBe("COMPLETED");
    expect((recovered.result as { reviewId?: string }).reviewId).toBe(originalReview.id);
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, observation.id))).toEqual([originalReview]);
  });

  it("allows only one concurrent expired-lease reclaim and denies old-token finalization", async () => {
    const started = await startWorkflow({ kind: "TEACHER_REVIEW", actor: learner, state: { observationId: fixtureObservationId } });
    const [original] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, started.runId));
    const first = await claimWorkflowResume(original, started.expectedVersion);
    await getDb().update(workflowRuns).set({ resumeLeaseExpiresAt: new Date(Date.now() - 1) }).where(eq(workflowRuns.id, original.id));
    const [expired] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, original.id));
    const results = await Promise.allSettled([
      claimWorkflowResume(expired, started.expectedVersion),
      claimWorkflowResume(expired, started.expectedVersion),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const current = (results.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof claimWorkflowResume>>> => result.status === "fulfilled"))!.value;
    await expect(finalizeWorkflowResumeClaim(first, { status: "COMPLETED", completedAt: new Date() })).rejects.toMatchObject({ code: "WORKFLOW_RESUME_LEASE_LOST" });
    await finalizeWorkflowResumeClaim(current, { status: "INTERRUPTED", completedAt: null });
    const [row] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, original.id));
    expect(row).toMatchObject({ status: "INTERRUPTED", resumeClaimToken: null, resumeClaimVersion: current.version });
  });

  it("enforces ACCEPT, CORRECT, SUPPLEMENT and terminal ESCALATE transitions", async () => {
    for (const decision of ["ACCEPT", "CORRECT", "SUPPLEMENT", "ESCALATE"] as const) {
      const key = randomUUID();
      const attempt = await captureAttempt(learner, {
        taskId: SEED.task,
        episodeId: SEED.episode,
        prompt: `Decision fixture ${decision} ${key}`,
        response: "This response is reserved for direct human inspection.",
        structuredInput: { decisionFixture: decision, key },
        idempotencyKey: `decision-attempt:${key}`,
      });
      const observation = await persistUnavailableObservation({ attemptId: attempt.id, reason: `Decision fixture ${decision}` });
      if (decision === "CORRECT") {
        await expect(createTeacherReview(teacher, { observationId: observation.id, decision, teachingSupport: "Human correction is required.", idempotencyKey: `invalid-correct:${key}` })).rejects.toMatchObject({ code: "REVIEW_CORRECTION_REQUIRED" });
      }
      if (decision === "SUPPLEMENT") {
        await expect(createTeacherReview(teacher, { observationId: observation.id, decision, teachingSupport: "Human supplement is required.", idempotencyKey: `invalid-supplement:${key}` })).rejects.toMatchObject({ code: "REVIEW_SUPPLEMENT_REQUIRED" });
      }
      const review = await createTeacherReview(teacher, {
        observationId: observation.id,
        decision,
        correction: decision === "CORRECT" ? "Correct the unit conversion." : undefined,
        supplement: decision === "SUPPLEMENT" ? "Add the missing evidence link." : undefined,
        teachingSupport: "Inspect the reasoning and its supporting evidence.",
        idempotencyKey: `decision-review:${key}`,
      });
      const retryInput = { observationId: observation.id, reviewId: review.reviewId, activityType: "RETRY" as const, prompt: "Retry with reviewed support.", idempotencyKey: `decision-retry:${key}` };
      const candidateInput = {
        observationId: observation.id,
        key: `decision-${decision.toLowerCase()}-${key.slice(0, 8)}`,
        title: `${decision} reviewed support`,
        purpose: "Verify decision-controlled Component candidate authority.",
        content: { teachingSupport: "Inspect each transformation carefully.", scaffoldHint: "Track units.", workedExample: "Convert the volume before applying the equation.", learnerAction: "Explain every conversion.", evidenceRefs: [] },
        idempotencyKey: `decision-component:${key}`,
      };
      if (decision === "ESCALATE") {
        await expect(createRetry(teacher, retryInput)).rejects.toMatchObject({ code: "REVIEW_ESCALATED" });
        await expect(createComponentCandidate(teacher, candidateInput)).rejects.toMatchObject({ code: "COMPONENT_SIGNAL_INELIGIBLE" });
      } else {
        await expect(createRetry(teacher, retryInput)).resolves.toMatchObject({ activityType: "RETRY" });
        await expect(createComponentCandidate(teacher, candidateInput)).rejects.toMatchObject({ code: "COMPONENT_SIGNAL_INELIGIBLE" });
      }
    }
  });

  it("derives Retry authority and rejects another learner, institution or Task result", async () => {
    const [currentReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, fixtureObservationId)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
    const retryState = {
      observationId: fixtureObservationId,
      reviewId: currentReview.id,
      activityType: "RETRY" as const,
      assignmentIdempotencyKey: `derived-retry:${randomUUID()}`,
      prompt: "Submit the reviewed retry.",
      taskId: randomUUID(),
      episodeId: randomUUID(),
      capabilityId: randomUUID(),
    };
    await expect(startWorkflow({
      kind: "RETRY_OUTCOME",
      actor: teacher,
      state: retryState,
      taskId: randomUUID(),
      episodeId: randomUUID(),
    })).rejects.toMatchObject({ code: "WORKFLOW_BINDING_MISMATCH" });
    const workflow = await startWorkflow({ kind: "RETRY_OUTCOME", actor: teacher, state: retryState });
    const wrongLearner: Actor = { ...learner, userId: randomUUID(), sessionId: `wrong-learner:${randomUUID()}` };
    await expect(resumeWorkflow(wrongLearner, workflow.threadId, { expectedVersion: workflow.expectedVersion, response: "Wrong learner", structuredInput: {}, idempotencyKey: `wrong-learner:${randomUUID()}` })).rejects.toMatchObject({ code: "WORKFLOW_OWNERSHIP" });
    const wrongInstitution: Actor = { ...learner, institutionId: randomUUID(), sessionId: `wrong-institution:${randomUUID()}` };
    await expect(resumeWorkflow(wrongInstitution, workflow.threadId, { expectedVersion: workflow.expectedVersion, response: "Wrong institution", structuredInput: {}, idempotencyKey: `wrong-institution:${randomUUID()}` })).rejects.toMatchObject({ code: "TENANT_ISOLATION" });

    const otherTask = await createTask(learner, { courseId: SEED.course, title: "Other lineage Task", goal: "Prove that retry results cannot cross Tasks", idempotencyKey: `other-task:${randomUUID()}` });
    const otherAttempt = await captureAttempt(learner, { taskId: otherTask.taskId, episodeId: otherTask.episodeId!, prompt: "Other Task", response: "Another Task result", structuredInput: {}, idempotencyKey: `other-attempt:${randomUUID()}` });
    const otherObservation = await persistUnavailableObservation({ attemptId: otherAttempt.id, reason: "Cross-lineage negative fixture" });
    const otherReview = await createTeacherReview(teacher, { observationId: otherObservation.id, decision: "ACCEPT", teachingSupport: "Review remains scoped to the other Task.", idempotencyKey: `other-review:${randomUUID()}` });
    const retry = await createRetry(teacher, { observationId: fixtureObservationId, reviewId: currentReview.id, activityType: "RETRY", prompt: "Original Task retry", idempotencyKey: `lineage-retry:${randomUUID()}` });
    await expect(linkRetryResult(teacher, { retryId: retry.id, resultAttemptId: otherAttempt.id, resultObservationId: otherObservation.id, resultReviewId: otherReview.reviewId })).rejects.toMatchObject({ code: "RETRY_LINEAGE_INVALID" });
  });

  it("validates an eligible retry-result payload before any Product State write", async () => {
    const [currentReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, fixtureObservationId)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
    const retry = await startWorkflow({
      kind: "RETRY_OUTCOME",
      actor: teacher,
      state: { observationId: fixtureObservationId, reviewId: currentReview.id, activityType: "RETRY", assignmentIdempotencyKey: `malformed-retry:${randomUUID()}`, prompt: "Submit a retry whose Review payload will be rejected." },
    });
    const learnerResume = await resumeWorkflow(learner, retry.threadId, { expectedVersion: retry.expectedVersion, response: "A real retry result awaiting Review.", structuredInput: { responseType: "FREE_TEXT" }, idempotencyKey: `malformed-attempt:${randomUUID()}` });
    const result = learnerResume.result as Record<string, unknown>;
    const retryId = String(result.retryId);
    const resultObservationId = String(result.resultObservationId);
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, resultObservationId))).toEqual([]);
    await expect(resumeWorkflow(teacher, retry.threadId, {
      expectedVersion: learnerResume.expectedVersion,
      decision: "ACCEPT",
      teachingSupport: "This malformed command omits every required Outcome field.",
      reviewIdempotencyKey: `malformed-review:${randomUUID()}`,
    })).rejects.toBeTruthy();
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, resultObservationId))).toEqual([]);
    const [unlinkedRetry] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, retryId)).limit(1);
    expect(unlinkedRetry).toMatchObject({ status: "ASSIGNED", resultAttemptId: null, resultObservationId: null, resultReviewId: null });
    expect(await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.retryId, retryId))).toEqual([]);
  });

  it("rolls back Review and Retry linkage when Outcome persistence fails", async () => {
    const [currentReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, fixtureObservationId)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
    const retry = await startWorkflow({
      kind: "RETRY_OUTCOME",
      actor: teacher,
      state: { observationId: fixtureObservationId, reviewId: currentReview.id, activityType: "RETRY", assignmentIdempotencyKey: `atomic-retry:${randomUUID()}`, prompt: "Submit a retry for atomic persistence proof." },
    });
    const learnerResume = await resumeWorkflow(learner, retry.threadId, { expectedVersion: retry.expectedVersion, response: "A retry result for atomic persistence proof.", structuredInput: { responseType: "FREE_TEXT" }, idempotencyKey: `atomic-attempt:${randomUUID()}` });
    const result = learnerResume.result as Record<string, unknown>;
    const retryId = String(result.retryId);
    const resultObservationId = String(result.resultObservationId);
    const conflictingOutcomeKey = `atomic-outcome:${randomUUID()}`;
    await getDb().insert(idempotencyKeys).values({ institutionId: teacher.institutionId, key: conflictingOutcomeKey, commandType: "LEARNING_OUTCOME", requestHash: "conflicting-request-hash", resultId: randomUUID() });
    await expect(resumeWorkflow(teacher, retry.threadId, {
      expectedVersion: learnerResume.expectedVersion,
      decision: "ACCEPT",
      teachingSupport: "This valid Review must roll back with the rejected Outcome.",
      outcomeStatus: "IMPROVED",
      outcomeNarrative: "This Outcome cannot claim the conflicting idempotency key.",
      reviewIdempotencyKey: `atomic-review:${randomUUID()}`,
      outcomeIdempotencyKey: conflictingOutcomeKey,
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, resultObservationId))).toEqual([]);
    const [unlinkedRetry] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, retryId)).limit(1);
    expect(unlinkedRetry).toMatchObject({ status: "ASSIGNED", resultAttemptId: null, resultObservationId: null, resultReviewId: null });
    expect(await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.retryId, retryId))).toEqual([]);
  });

  it("requires a reviewed retry Observation before creating an Outcome", async () => {
    const [currentReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, fixtureObservationId)).orderBy(desc(teacherReviews.createdAt)).limit(1);
    expect(currentReview).toBeTruthy();
    const retry = await startWorkflow({
      kind: "RETRY_OUTCOME",
      actor: teacher,
      state: {
        teacherActor: teacher,
        observationId: fixtureObservationId,
        reviewId: currentReview.id,
        activityType: "RETRY",
        assignmentIdempotencyKey: `assign-retry:${randomUUID()}`,
        prompt: "Review the reasoning again and justify each transformation.",
        taskId: SEED.task,
        episodeId: SEED.episode,
      },
      taskId: SEED.task,
      episodeId: SEED.episode,
    });
    expect(retry.interruptType).toBe("LEARNER_RETRY_REQUIRED");
    const learnerResume = await resumeWorkflow(learner, retry.threadId, { expectedVersion: retry.expectedVersion, response: "I checked units and justified each transformation.", structuredInput: { responseType: "FREE_TEXT" }, idempotencyKey: `retry-attempt:${randomUUID()}` });
    expect(learnerResume.interruptType).toBe("RETRY_RESULT_REVIEW_REQUIRED");
    const teacherPayload = { expectedVersion: learnerResume.expectedVersion, decision: "ACCEPT", teachingSupport: "The retry now states the evidence for each transformation.", outcomeStatus: "IMPROVED", outcomeNarrative: "The learner improved on the linked Retry after direct human Review.", reviewIdempotencyKey: `retry-review:${randomUUID()}`, outcomeIdempotencyKey: `retry-outcome:${randomUUID()}` } as const;
    await expect(resumeWorkflow(teacher, retry.threadId, teacherPayload, { testFaults: { afterGraphCompletion() { throw new WorkflowProcessCrashForTests(); } } })).rejects.toBeInstanceOf(WorkflowProcessCrashForTests);
    const crashedResult = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, retry.runId));
    expect(crashedResult[0]).toMatchObject({ status: "RESUMING" });
    const retryId = String((learnerResume.result as Record<string, unknown>).retryId);
    const resultObservationId = String((learnerResume.result as Record<string, unknown>).resultObservationId);
    const [originalReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, resultObservationId));
    const [originalOutcome] = await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.retryId, retryId));
    expect(originalReview?.id).toBeTruthy();
    expect(originalOutcome?.id).toBeTruthy();
    await getDb().update(workflowRuns).set({ resumeLeaseExpiresAt: new Date(Date.now() - 1) }).where(eq(workflowRuns.id, retry.runId));
    const teacherResume = await resumeWorkflow(teacher, retry.threadId, teacherPayload);
    expect(teacherResume.status).toBe("COMPLETED");
    const outcomeId = String((teacherResume.result as Record<string, unknown>).outcomeId);
    expect(outcomeId).toBe(originalOutcome.id);
    expect(String((teacherResume.result as Record<string, unknown>).resultReviewId)).toBe(originalReview.id);
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, resultObservationId))).toEqual([originalReview]);
    expect(await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.retryId, retryId))).toEqual([originalOutcome]);
    const [outcome] = await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.id, outcomeId)).limit(1);
    expect(outcome.outcomeType).toBe("RETRY");
    expect(outcome.evidenceRefs.map((reference) => reference.kind)).toEqual(["ATTEMPT", "DIAGNOSIS", "REVIEW"]);
    expect(outcome.actorProvenance.userId).toBe(teacher.userId);
  });

  it("records a retry-result ESCALATE without creating a LearningOutcome", async () => {
    const [currentReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, fixtureObservationId)).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)).limit(1);
    const retry = await startWorkflow({
      kind: "RETRY_OUTCOME",
      actor: teacher,
      state: { observationId: fixtureObservationId, reviewId: currentReview.id, activityType: "RETRY", assignmentIdempotencyKey: `escalated-retry:${randomUUID()}`, prompt: "Submit a retry for escalation review." },
    });
    const learnerResume = await resumeWorkflow(learner, retry.threadId, { expectedVersion: retry.expectedVersion, response: "This retry still needs specialist review.", structuredInput: { responseType: "FREE_TEXT" }, idempotencyKey: `escalated-attempt:${randomUUID()}` });
    const teacherResume = await resumeWorkflow(teacher, retry.threadId, { expectedVersion: learnerResume.expectedVersion, decision: "ESCALATE", teachingSupport: "Escalate to a subject specialist; do not record an Outcome.", reviewIdempotencyKey: `escalated-review:${randomUUID()}` });
    expect(teacherResume.status).toBe("COMPLETED");
    expect((teacherResume.result as Record<string, unknown>).outcomeId).toBeUndefined();
    const retryId = String((teacherResume.result as Record<string, unknown>).retryId);
    const resultObservationId = String((teacherResume.result as Record<string, unknown>).resultObservationId);
    const [linkedRetry] = await getDb().select().from(retryAttempts).where(eq(retryAttempts.id, retryId)).limit(1);
    expect(linkedRetry.status).toBe("ESCALATED");
    const outcomes = await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.retryId, retryId));
    expect(outcomes).toEqual([]);
    const workspace = await getTeacherWorkspace(teacher);
    expect(workspace.queue.find((row) => row.observation_id === resultObservationId)?.review_decision).toBe("ESCALATE");
  });

  it("rejects unavailable signals and mismatched Component workflow lineage", async () => {
    const [currentReview] = await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, fixtureObservationId)).orderBy(desc(teacherReviews.createdAt)).limit(1);
    await expect(createComponentCandidate(teacher, {
      observationId: fixtureObservationId,
      key: `reviewed-support-${randomUUID().slice(0, 8)}`,
      title: "Reviewed reasoning support",
      purpose: "Reuse a directly teacher-reviewed reasoning support pattern.",
      content: { teachingSupport: "Ask the learner to justify every transformation and verify units.", scaffoldHint: "Track every unit.", workedExample: "Convert millilitres to litres before substitution.", learnerAction: "Annotate each transformation.", evidenceRefs: [] },
      idempotencyKey: `component:${currentReview.id}:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "COMPONENT_SIGNAL_INELIGIBLE" });
    const foundryWorkspace = await getFoundryWorkspace(expert);
    const eligibleSignals = await getCurrentReusablePatternSignals(expert);
    expect(eligibleSignals.map((signal) => signal.observation_id)).not.toContain(fixtureObservationId);
    const expectedPatterns = new Map<string, Set<string>>();
    for (const signal of eligibleSignals) {
      const key = [signal.failure_code, signal.capability_id, signal.course_id, signal.reference_pack_key].join("|");
      const attempts = expectedPatterns.get(key) ?? new Set<string>();
      attempts.add(signal.attempt_id);
      expectedPatterns.set(key, attempts);
    }
    const actualPatterns = foundryWorkspace.reviewedPatterns.map((pattern) => ({
      key: [pattern.pattern, pattern.capability_id, pattern.course_id, pattern.reference_pack_key].join("|"),
      count: Number(pattern.count),
      observationId: String(pattern.observation_id),
    }));
    expect(actualPatterns.map(({ key, count }) => ({ key, count })).sort((left, right) => left.key.localeCompare(right.key))).toEqual(
      [...expectedPatterns].map(([key, attempts]) => ({ key, count: attempts.size })).sort((left, right) => left.key.localeCompare(right.key)),
    );
    for (const pattern of actualPatterns) {
      expect(eligibleSignals.some((signal) => signal.observation_id === pattern.observationId && [signal.failure_code, signal.capability_id, signal.course_id, signal.reference_pack_key].join("|") === pattern.key)).toBe(true);
    }
    await expect(startWorkflow({
      kind: "COMPONENT_LIFECYCLE",
      actor: expert,
      state: { componentId: randomUUID(), componentVersionId: randomUUID() },
    })).rejects.toMatchObject({ code: "COMPONENT_VERSION_LINEAGE" });
  });
});
