import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getActor } from "@/application/actor";
import { executeAssetStage } from "@/application/asset-runtime";
import { planActivityForResolution } from "@/application/activity-planning";
import { resolveCapabilityForDiagnosis } from "@/application/capability-resolution";
import { assertExecutionActive, runWithExecutionControl } from "@/application/execution-control";
import { startWorkflow } from "@/application/workflow-service";
import { closeDb, getDb, withTenantDatabase } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  activityPlans,
  capabilities,
  capabilityVersions,
  componentDeliveries,
  contextItems,
  courseEnrollments,
  diagnosticObservations,
  institutionMemberships,
  learnerAttempts,
  learnerProfiles,
  learningEpisodes,
  learningEvents,
  learningOutcomes,
  learningTasks,
  runtimeDeliveries,
  teacherReviews,
  users,
  workflowRuns,
} from "@/db/schema";
import { getAssetRuntimeAdapter, type AssetRuntimeAdapter } from "@/reference-packs/capability-runtime";
import { buildAssetRuntimeGraph } from "@/workflows/asset-runtime";
import { closeWorkflowCheckpointer, getWorkflowCheckpointer } from "@/workflows/checkpointer";

function contract(capabilityKey: string) {
  return {
    resolution: {
      contractType: "CALLABLE_LEARNING_CAPABILITY",
      verified: true,
      learningProblem: "calculate molar concentration from amount and volume",
      exactMatchSignals: [capabilityKey, "molar concentration"],
      eligibility: {
        learnerLevels: ["*"],
        taskTypes: ["*"],
        curricula: ["*"],
        languages: ["en", "zh", "mixed"],
        accessibility: ["keyboard", "screen-reader", "text"],
        prerequisites: [],
        contraindications: [],
      },
      availability: {
        status: "AVAILABLE",
        institutionIds: [],
        courseIds: [],
        rights: "NOT_REQUIRED",
        dependencies: [{ key: "mathjs", status: "AVAILABLE" }],
        provider: null,
      },
      parameterization: { supported: false, signals: [], recommendation: {} },
      composition: { supported: false, contributes: [] },
      adaptation: { reviewed: true, signals: ["molar concentration"] },
      runtime: {
        kind: "TRUSTED_DETERMINISTIC_ADAPTER",
        input: "amount + volume + learnerAnswer",
        parameters: [{ key: "amount", kind: "quantity" }, { key: "volume", kind: "quantity" }, { key: "learnerAnswer", kind: "number" }],
        state: { mode: "STATELESS" },
        output: "mol/L with deterministic tolerance comparison",
        events: ["ATTEMPT_SUBMITTED", "CAPABILITY_RESULT"],
      },
    },
  };
}

type Fixture = Awaited<ReturnType<typeof readyFixture>>;

async function readyFixture(label: string, implementationKey = "chemistry.molar-concentration.v1") {
  const learnerId = randomUUID();
  const profileId = randomUUID();
  const taskId = randomUUID();
  const episodeId = randomUUID();
  const capabilityId = randomUUID();
  const capabilityVersionId = randomUUID();
  const sourceAttemptId = randomUUID();
  const observationId = randomUUID();
  const capabilityKey = `cap04-${label}-${capabilityId}`;
  const versionContract = contract(capabilityKey);
  await getDb().insert(users).values({ id: learnerId, email: `${label}-${learnerId}@cap04.invalid`, name: `CAP-04 ${label}` });
  await getDb().insert(institutionMemberships).values({ userId: learnerId, institutionId: SEED.institution, role: "LEARNER" });
  await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: learnerId, role: "LEARNER" });
  await getDb().insert(learnerProfiles).values({ id: profileId, institutionId: SEED.institution, learnerId, createdBy: learnerId });
  await getDb().insert(learningTasks).values({
    id: taskId,
    institutionId: SEED.institution,
    courseId: SEED.course,
    learnerId,
    learnerProfileId: profileId,
    title: `CAP-04 ${label}`,
    goal: "Calculate molar concentration from amount and volume.",
  });
  await getDb().insert(learningEpisodes).values({ id: episodeId, taskId, sequence: 1 });
  await getDb().insert(capabilities).values({
    id: capabilityId,
    key: capabilityKey,
    name: `CAP-04 ${label} runtime`,
    referencePackKey: "chemistry-caie-9701",
    kind: "DETERMINISTIC_ADAPTER",
    activeVersionId: capabilityVersionId,
  });
  await getDb().insert(capabilityVersions).values({
    id: capabilityVersionId,
    capabilityId,
    version: "4.0.0",
    contract: versionContract,
    implementationKey,
    status: "ACTIVE",
    contentHash: `sha256:cap04-${label}-${capabilityVersionId}`,
  });
  await getDb().insert(contextItems).values({
    id: randomUUID(),
    institutionId: SEED.institution,
    learnerProfileId: profileId,
    courseId: SEED.course,
    taskId,
    kind: "CAPABILITY_REQUIREMENT",
    scope: "TASK",
    payload: {
      requiredCapabilityKey: capabilityKey,
      learningProblem: "molar concentration",
      language: "en",
      accessibility: ["keyboard"],
    },
    provenance: { authority: "CAP-04 integration fixture" },
    ruleVersion: "cap-04-test.1",
    actorUserId: SEED.teacher,
  });
  await getDb().insert(learnerAttempts).values({
    id: sourceAttemptId,
    taskId,
    episodeId,
    learnerId,
    capabilityId,
    prompt: "What is the molar concentration?",
    response: "I need another calculation activity.",
    structuredInput: { responseType: "NATURAL_ATTEMPT" },
    sourceRefs: [],
  });
  await getDb().insert(diagnosticObservations).values({
    id: observationId,
    attemptId: sourceAttemptId,
    capabilityVersionId,
    observationSource: "CAPABILITY",
    status: "NEEDS_REVIEW",
    failureCode: "NUMERIC_MISMATCH",
    firstInvalidStep: "FINAL_NUMERIC_COMPARISON",
    summary: "The learner needs a molar concentration calculation activity.",
    structuredResult: { learningProblem: "molar concentration", diagnosticClaim: true },
    inputLineage: { attemptId: sourceAttemptId, capabilityId },
    outputLineage: { capabilityVersionId, deterministic: true },
  });
  const actor = await getActor(learnerId, SEED.institution, "integration-test", `cap04:${learnerId}`);
  const resolution = await resolveCapabilityForDiagnosis(actor, { taskId, episodeId, diagnosticObservationId: observationId });
  const plan = await planActivityForResolution(actor, { taskId, episodeId, capabilityResolutionId: resolution.id });
  expect(plan.state).toBe("READY");
  return { actor, taskId, episodeId, capabilityId, capabilityVersionId, sourceAttemptId, observationId, resolution, plan, versionContract };
}

function request(fixture: Fixture, suffix: string) {
  return {
    taskId: fixture.taskId,
    episodeId: fixture.episodeId,
    activityPlanProposalId: fixture.plan.id,
    prompt: "Calculate concentration for 1 mol in 2 L.",
    response: "0.5 mol/L",
    structuredInput: {
      amount: { value: 1, unit: "mol" },
      volume: { value: 2, unit: "L" },
      learnerAnswer: 0.5,
      tolerance: 0.001,
    },
    modality: "STRUCTURED" as const,
    idempotencyKey: `cap04:${suffix}:${randomUUID()}`,
    deadlineMs: 1_000,
  };
}

describe.sequential("CAP-04 PostgreSQL Asset Stage Runtime", () => {
  afterAll(async () => {
    await closeWorkflowCheckpointer();
    await closeDb();
  });

  it("executes one current READY exact version and replays delivery, Attempt and ordered Events by exact identity", async () => {
    const fixture = await readyFixture("success");
    const input = request(fixture, "success");
    const first = await executeAssetStage(fixture.actor, input);
    const replay = await executeAssetStage(fixture.actor, input);
    expect(first.delivery).toMatchObject({
      id: replay.delivery.id,
      status: "SUCCEEDED",
      capabilityVersionId: fixture.capabilityVersionId,
      implementationKey: "chemistry.molar-concentration.v1",
    });
    expect(first.attempt.id).toBe(replay.attempt.id);
    expect(first.delivery.normalizedOutput).toMatchObject({ status: "CORRECT", expected: 0.5, unit: "mol/L" });
    expect(await getDb().select().from(activityPlans).where(eq(activityPlans.activityPlanProposalId, fixture.plan.id))).toHaveLength(1);
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.id, first.delivery.id))).toHaveLength(1);
    const attempts = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, first.delivery.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      capabilityVersionId: fixture.capabilityVersionId,
      activityPlanId: first.delivery.activityPlanId,
      modality: "STRUCTURED",
    });
    const events = await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, first.delivery.id));
    expect(events.sort((left, right) => left.sequence - right.sequence).map((event) => [event.sequence, event.eventType])).toEqual([
      [1, "DELIVERY_STARTED"],
      [2, "LEARNER_INTERACTION_SUBMITTED"],
      [3, "LEARNER_ATTEMPT_CAPTURED"],
      [4, "CAPABILITY_RESULT"],
      [5, "DELIVERY_SUCCEEDED"],
    ]);
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, fixture.observationId))).toEqual([]);
    expect(await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.taskId, fixture.taskId))).toEqual([]);
    expect(await getDb().select().from(componentDeliveries).where(eq(componentDeliveries.taskId, fixture.taskId))).toEqual([]);
    await expect(executeAssetStage(fixture.actor, { ...input, response: "changed replay" })).rejects.toMatchObject({ code: "ASSET_RUNTIME_REPLAY_CONFLICT" });
    await expect(getDb().update(runtimeDeliveries).set({ status: "FAILED" }).where(eq(runtimeDeliveries.id, first.delivery.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(getDb().update(activityPlans).set({ runtimeKind: "rewritten" }).where(eq(activityPlans.id, first.delivery.activityPlanId)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(getDb().update(learningEvents).set({ eventType: "rewritten" }).where(eq(learningEvents.runtimeDeliveryId, first.delivery.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(getDb().update(learnerAttempts).set({ response: "rewritten" }).where(eq(learnerAttempts.runtimeDeliveryId, first.delivery.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });

    const wrongLearnerId = randomUUID();
    await getDb().insert(users).values({ id: wrongLearnerId, email: `${wrongLearnerId}@cap04.invalid`, name: "CAP-04 wrong learner" });
    await getDb().insert(institutionMemberships).values({ userId: wrongLearnerId, institutionId: SEED.institution, role: "LEARNER" });
    await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: wrongLearnerId, role: "LEARNER" });
    const wrongLearner = await getActor(wrongLearnerId, SEED.institution, "integration-test", `cap04:${wrongLearnerId}`);
    await expect(executeAssetStage(wrongLearner, input)).rejects.toMatchObject({ code: "WORKFLOW_OWNERSHIP" });
    await expect(withTenantDatabase(wrongLearner, () => getDb().update(runtimeDeliveries)
      .set({ status: "FAILED", normalizedError: { code: "ILLEGAL", message: "illegal", retryable: false }, finishedAt: new Date() })
      .where(eq(runtimeDeliveries.id, first.delivery.id))))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
  });

  it("fails an unknown exact implementation honestly while preserving the learner Attempt", async () => {
    const fixture = await readyFixture("unknown", "cap04.unknown-runtime");
    const input = request(fixture, "unknown");
    await expect(executeAssetStage(fixture.actor, input)).rejects.toMatchObject({ code: "ASSET_RUNTIME_ADAPTER_UNAVAILABLE" });
    const [delivery] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, input.idempotencyKey));
    expect(delivery).toMatchObject({ status: "FAILED", normalizedError: { code: "ASSET_RUNTIME_ADAPTER_UNAVAILABLE" } });
    expect(await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, delivery.id))).toHaveLength(1);
    expect(await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, delivery.id))).toHaveLength(5);
    await expect(executeAssetStage(fixture.actor, input)).rejects.toMatchObject({ code: "ASSET_RUNTIME_ADAPTER_UNAVAILABLE" });
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, input.idempotencyKey))).toHaveLength(1);
  });

  it("uses the existing LangGraph checkpoint to recover a post-start crash without duplicate Product State", async () => {
    const fixture = await readyFixture("recovery");
    const input = request(fixture, "recovery");
    const threadId = `${fixture.actor.institutionId}:cap04-recovery:${randomUUID()}`;
    const state = { actor: fixture.actor, ...input };
    const checkpoint = getWorkflowCheckpointer(fixture.actor.institutionId);
    await expect(buildAssetRuntimeGraph(checkpoint, {
      getAdapter: getAssetRuntimeAdapter,
      afterDeliveryStarted() { throw new Error("INJECTED_POST_START_CRASH"); },
    }).invoke(state, { configurable: { thread_id: threadId }, recursionLimit: 50 })).rejects.toThrow("INJECTED_POST_START_CRASH");
    const [running] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, input.idempotencyKey));
    expect(running.status).toBe("RUNNING");
    expect(await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, running.id))).toHaveLength(1);
    expect(await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, running.id))).toHaveLength(3);
    const recovered = await buildAssetRuntimeGraph(checkpoint).invoke(state, { configurable: { thread_id: threadId }, recursionLimit: 50 });
    expect(recovered).toMatchObject({ runtimeDeliveryId: running.id, runtimeStatus: "SUCCEEDED" });
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.id, running.id))).toHaveLength(1);
    expect(await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, running.id))).toHaveLength(1);
    expect(await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, running.id))).toHaveLength(5);
  });

  it("normalizes deadline and request cancellation after durable start", async () => {
    const deadlineFixture = await readyFixture("deadline");
    const deadlineInput = { ...request(deadlineFixture, "deadline"), deadlineMs: 5 };
    const slowAdapter: AssetRuntimeAdapter = {
      implementationKey: "chemistry.molar-concentration.v1",
      runtimeKind: "TRUSTED_DETERMINISTIC_ADAPTER",
      replaySafe: true,
      async execute(_input, control) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        assertExecutionActive(control);
        return { status: "SHOULD_NOT_COMPLETE" };
      },
    };
    await expect(executeAssetStage(deadlineFixture.actor, deadlineInput, { getAdapter: () => slowAdapter }))
      .rejects.toMatchObject({ code: "EXECUTION_TIMED_OUT" });
    const [timedOut] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, deadlineInput.idempotencyKey));
    expect(timedOut).toMatchObject({ status: "TIMED_OUT", normalizedError: { code: "ASSET_RUNTIME_TIMED_OUT" } });

    const cancelFixture = await readyFixture("cancel");
    const cancelInput = request(cancelFixture, "cancel");
    const controller = new AbortController();
    await expect(runWithExecutionControl({ signal: controller.signal, deadlineMs: 1_000 }, () => executeAssetStage(cancelFixture.actor, cancelInput, {
      getAdapter: getAssetRuntimeAdapter,
      afterDeliveryStarted() { controller.abort(); },
    }))).rejects.toMatchObject({ code: "EXECUTION_ABORTED" });
    const [cancelled] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, cancelInput.idempotencyKey));
    expect(cancelled).toMatchObject({ status: "CANCELLED", normalizedError: { code: "ASSET_RUNTIME_CANCELLED" } });
  });

  it("commits cancelled and timed-out terminal evidence through the actual workflow transaction before returning an error", async () => {
    const cancelledFixture = await readyFixture("workflow-cancel");
    const cancelledInput = request(cancelledFixture, "workflow-cancel");
    const cancellation = new AbortController();
    const cancelledWorkflow = await withTenantDatabase(cancelledFixture.actor, () => startWorkflow({
      kind: "ASSET_RUNTIME",
      actor: cancelledFixture.actor,
      taskId: cancelledFixture.taskId,
      episodeId: cancelledFixture.episodeId,
      state: cancelledInput,
      execution: { signal: cancellation.signal, deadlineMs: 2_000 },
      testFaults: {
        assetRuntime: {
          getAdapter: getAssetRuntimeAdapter,
          afterDeliveryStarted() { cancellation.abort(); },
        },
      },
    }));
    expect(cancelledWorkflow).toMatchObject({ status: "CANCELLED", failureCode: "ASSET_RUNTIME_CANCELLED", result: { runtimeStatus: "CANCELLED" } });
    const [cancelledDelivery] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, cancelledInput.idempotencyKey));
    expect(cancelledDelivery).toMatchObject({ status: "CANCELLED", attemptNumber: 1, normalizedError: { code: "ASSET_RUNTIME_CANCELLED", retryable: true } });
    expect(await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, cancelledDelivery.id))).toHaveLength(1);
    expect((await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, cancelledDelivery.id))).map((event) => event.eventType)).toEqual(expect.arrayContaining(["RUNTIME_CANCELLED", "DELIVERY_CANCELLED"]));
    expect(await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, cancelledWorkflow.runId))).toEqual([
      expect.objectContaining({ status: "CANCELLED", productLinks: expect.objectContaining({ runtimeDeliveryId: cancelledDelivery.id, failureCode: "ASSET_RUNTIME_CANCELLED" }) }),
    ]);

    const cancelledReplay = await withTenantDatabase(cancelledFixture.actor, () => startWorkflow({
      kind: "ASSET_RUNTIME",
      actor: cancelledFixture.actor,
      taskId: cancelledFixture.taskId,
      episodeId: cancelledFixture.episodeId,
      state: cancelledInput,
    }));
    expect(cancelledReplay).toMatchObject({ status: "CANCELLED", result: { runtimeDeliveryId: cancelledDelivery.id, runtimeStatus: "CANCELLED" } });
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, cancelledInput.idempotencyKey))).toHaveLength(1);

    const boundedRetry = {
      ...cancelledInput,
      retryOfDeliveryId: cancelledDelivery.id,
      idempotencyKey: `cap04:workflow-cancel-retry:${randomUUID()}`,
    };
    const retriedWorkflow = await withTenantDatabase(cancelledFixture.actor, () => startWorkflow({
      kind: "ASSET_RUNTIME",
      actor: cancelledFixture.actor,
      taskId: cancelledFixture.taskId,
      episodeId: cancelledFixture.episodeId,
      state: boundedRetry,
    }));
    expect(retriedWorkflow).toMatchObject({ status: "COMPLETED", result: { runtimeStatus: "SUCCEEDED" } });
    const deliveriesAfterRetry = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.activityPlanId, cancelledDelivery.activityPlanId));
    expect(deliveriesAfterRetry.map((delivery) => [delivery.attemptNumber, delivery.status]).sort()).toEqual([[1, "CANCELLED"], [2, "SUCCEEDED"]]);

    const timedOutFixture = await readyFixture("workflow-timeout");
    const timedOutInput = request(timedOutFixture, "workflow-timeout");
    const timedOutWorkflow = await withTenantDatabase(timedOutFixture.actor, () => startWorkflow({
      kind: "ASSET_RUNTIME",
      actor: timedOutFixture.actor,
      taskId: timedOutFixture.taskId,
      episodeId: timedOutFixture.episodeId,
      state: timedOutInput,
      execution: { deadlineMs: 500 },
      testFaults: {
        assetRuntime: {
          getAdapter: () => ({
            implementationKey: "chemistry.molar-concentration.v1",
            runtimeKind: "TRUSTED_DETERMINISTIC_ADAPTER",
            replaySafe: true,
            async execute(_input, control) {
              await new Promise((resolve) => setTimeout(resolve, 650));
              assertExecutionActive(control);
              return { status: "SHOULD_NOT_COMPLETE" };
            },
          }),
        },
      },
    }));
    expect(timedOutWorkflow).toMatchObject({ status: "TIMED_OUT", failureCode: "ASSET_RUNTIME_TIMED_OUT", result: { runtimeStatus: "TIMED_OUT" } });
    const [timedOutDelivery] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, timedOutInput.idempotencyKey));
    expect(timedOutDelivery).toMatchObject({ status: "TIMED_OUT", normalizedError: { code: "ASSET_RUNTIME_TIMED_OUT", retryable: true } });
    expect(await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, timedOutDelivery.id))).toHaveLength(1);
    expect((await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, timedOutDelivery.id))).map((event) => event.eventType)).toEqual(expect.arrayContaining(["RUNTIME_TIMED_OUT", "DELIVERY_TIMED_OUT"]));
  });

  it("refuses altered, disabled, stale and cross-tenant input before a delivery", async () => {
    const altered = await readyFixture("altered");
    await getDb().update(capabilityVersions).set({ contract: { ...altered.versionContract, alteredAfterPlanning: true } }).where(eq(capabilityVersions.id, altered.capabilityVersionId));
    const alteredInput = request(altered, "altered");
    await expect(executeAssetStage(altered.actor, alteredInput)).rejects.toMatchObject({ code: "ASSET_RUNTIME_CONTRACT_CHANGED" });
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, alteredInput.idempotencyKey))).toEqual([]);
    await getDb().update(capabilityVersions).set({ contract: altered.versionContract, status: "DISABLED" }).where(eq(capabilityVersions.id, altered.capabilityVersionId));
    const disabledInput = { ...alteredInput, idempotencyKey: `cap04:disabled:${randomUUID()}` };
    await expect(executeAssetStage(altered.actor, disabledInput)).rejects.toMatchObject({ code: "ASSET_RUNTIME_VERSION_STALE" });
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, disabledInput.idempotencyKey))).toEqual([]);

    const stale = await readyFixture("stale");
    const newerAttemptId = randomUUID();
    const newerObservationId = randomUUID();
    await getDb().insert(learnerAttempts).values({
      id: newerAttemptId,
      taskId: stale.taskId,
      episodeId: stale.episodeId,
      learnerId: stale.actor.userId,
      capabilityId: stale.capabilityId,
      prompt: "Newer Attempt",
      response: "A newer learner result",
      structuredInput: {},
      sourceRefs: [],
    });
    await getDb().insert(diagnosticObservations).values({
      id: newerObservationId,
      attemptId: newerAttemptId,
      capabilityVersionId: stale.capabilityVersionId,
      observationSource: "CAPABILITY",
      status: "NEEDS_REVIEW",
      summary: "A newer molar concentration Diagnosis Proposal.",
      structuredResult: { learningProblem: "molar concentration" },
      inputLineage: { attemptId: newerAttemptId },
      outputLineage: { capabilityVersionId: stale.capabilityVersionId },
    });
    const newerResolution = await resolveCapabilityForDiagnosis(stale.actor, { taskId: stale.taskId, episodeId: stale.episodeId, diagnosticObservationId: newerObservationId });
    await planActivityForResolution(stale.actor, { taskId: stale.taskId, episodeId: stale.episodeId, capabilityResolutionId: newerResolution.id });
    const staleInput = request(stale, "stale");
    await expect(executeAssetStage(stale.actor, staleInput)).rejects.toMatchObject({ code: "ASSET_RUNTIME_PLAN_STALE" });
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, staleInput.idempotencyKey))).toEqual([]);

    const foreignInstitutionId = randomUUID();
    const foreignUserId = randomUUID();
    const foreignActor = { ...stale.actor, userId: foreignUserId, institutionId: foreignInstitutionId, sessionId: `foreign:${randomUUID()}` };
    await expect(executeAssetStage(foreignActor, { ...staleInput, idempotencyKey: `cap04:foreign:${randomUUID()}` }))
      .rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    expect(await getDb().select().from(runtimeDeliveries).where(and(eq(runtimeDeliveries.taskId, stale.taskId), eq(runtimeDeliveries.institutionId, foreignInstitutionId)))).toEqual([]);
  });
});
