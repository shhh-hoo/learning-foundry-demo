import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createComponentCandidate,
  createTeacherReview,
  decidePublication,
  deliverActiveComponentSupport,
  emergencyDisableComponent,
  recordComponentDeprecation,
  rollbackComponent,
  updateComponentVersion,
} from "@/application/commands";
import { getActor } from "@/application/actor";
import { getFoundryWorkspace, getTaskDetail } from "@/application/queries";
import { resumeWorkflow, startWorkflow, WorkflowProcessCrashForTests } from "@/application/workflow-service";
import { closeDb, getDb, getSql } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  capabilities,
  capabilityVersions,
  componentDeliveries,
  componentDeprecationDecisions,
  componentDisableDecisions,
  componentDraftRevisions,
  componentEvaluations,
  componentVersions,
  components,
  diagnosticObservations,
  publicationDecisions,
  workflowRuns,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import { CHEMISTRY_CAPABILITIES } from "@/reference-packs/chemistry/capabilities";
import { closeWorkflowCheckpointer } from "@/workflows/checkpointer";

const rubric = {
  domainCorrectness: "PASS",
  pedagogy: "PASS",
  safety: "PASS",
  reuseReadiness: "PASS",
  notes: "Expert verified the deterministic contract and teaching support.",
} as const;

const content = {
  teachingSupport: "Use the reviewed unit-conversion scaffold before substituting values.",
  scaffoldHint: "Track the unit beside every value.",
  workedExample: "Convert 500 mL to 0.500 L, then apply concentration equals amount divided by volume.",
  learnerAction: "Annotate each conversion and explain the final unit.",
  evidenceRefs: [],
};

describe.sequential("Complete governed Component Asset Loop", () => {
  let learner: Actor;
  let teacher: Actor;
  let expert: Actor;
  let capabilityId: string;
  let capabilityVersionId: string;
  const signalObservationIds: string[] = [];

  beforeAll(async () => {
    learner = await getActor(SEED.learner, SEED.institution, "asset-loop-test", `learner:${randomUUID()}`);
    teacher = await getActor(SEED.teacher, SEED.institution, "asset-loop-test", `teacher:${randomUUID()}`);
    expert = await getActor(SEED.expert, SEED.institution, "asset-loop-test", `expert:${randomUUID()}`);
    const definition = CHEMISTRY_CAPABILITIES[0];
    capabilityId = randomUUID();
    capabilityVersionId = randomUUID();
    await getDb().insert(capabilities).values({
      id: capabilityId,
      key: `asset-loop-${randomUUID()}`,
      name: "Asset Loop molar concentration fixture",
      referencePackKey: "chemistry-caie-9701",
      kind: "DETERMINISTIC",
    });
    await getDb().insert(capabilityVersions).values({
      id: capabilityVersionId,
      capabilityId,
      version: "1.0.0",
      contract: { ...definition.contract, evaluationFixture: definition.evaluationFixture },
      implementationKey: definition.implementationKey,
      status: "ACTIVE",
      contentHash: `asset-loop:${randomUUID()}`,
    });
    await getDb().update(capabilities).set({ activeVersionId: capabilityVersionId }).where(eq(capabilities.id, capabilityId));
  });

  afterAll(async () => {
    await closeWorkflowCheckpointer();
    await closeDb();
  });

  async function createReviewedSignal(label: string) {
    const diagnosis = await startWorkflow({
      kind: "DIAGNOSIS",
      actor: learner,
      state: {
        taskId: SEED.task,
        episodeId: SEED.episode,
        capabilityId,
        prompt: `Asset Loop signal ${label}`,
        response: "I used 2.0 mol/L without converting the volume.",
        structuredInput: { amount: { value: 1, unit: "mol" }, volume: { value: 2, unit: "L" }, learnerAnswer: 2, tolerance: 0.001 },
        sourceRefs: [],
        idempotencyKey: `asset-attempt:${randomUUID()}`,
      },
      taskId: SEED.task,
      episodeId: SEED.episode,
    });
    const observationId = String((diagnosis.result as Record<string, unknown>).observationId);
    const review = await createTeacherReview(teacher, {
      observationId,
      decision: "CORRECT",
      correction: "Convert and track the volume unit before dividing.",
      teachingSupport: "Use a unit ledger and state the target unit before calculation.",
      idempotencyKey: `asset-review:${randomUUID()}`,
    });
    signalObservationIds.push(observationId);
    return { observationId, reviewId: review.reviewId };
  }

  it("blocks publication with one signal, executes the expected-output fixture, then records immutable rejection", async () => {
    const first = await createReviewedSignal("one");
    const candidate = await createComponentCandidate(expert, {
      observationId: first.observationId,
      key: `asset-loop-component-${randomUUID()}`,
      title: "Unit-ledger teaching support",
      purpose: "Reuse reviewed support for a repeated concentration unit-conversion failure.",
      content,
      idempotencyKey: `asset-candidate:${randomUUID()}`,
    });
    const blocked = await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: expert, state: { componentId: candidate.componentId, componentVersionId: candidate.versionId! } });
    expect(blocked).toMatchObject({ status: "INTERRUPTED", interruptType: "EXPERT_PUBLICATION_REVIEW_REQUIRED" });
    const blockedState = blocked.result as Record<string, unknown>;
    expect(blockedState.systemStatus).toBe("BLOCKED");
    const [evaluation] = await getDb().select().from(componentEvaluations).where(eq(componentEvaluations.id, String(blockedState.evaluationId)));
    expect(evaluation.fixtureExecution).toMatchObject({ status: "EXECUTED_PASSED", expected: { expected: 0.5, unit: "mol/L", status: "CORRECT" } });
    expect(evaluation.evidenceChecks).toContainEqual(expect.objectContaining({ status: "NOT_REQUIRED", policy: "NOT_REQUIRED_DETERMINISTIC_SCAFFOLD" }));
    await expect(resumeWorkflow(expert, blocked.threadId, { expectedVersion: blocked.expectedVersion, action: "APPROVE", rationale: "Attempted approval must remain blocked.", rubric, idempotencyKey: `blocked-approve:${randomUUID()}` })).rejects.toMatchObject({ code: "COMPONENT_SYSTEM_GATES_BLOCKED" });
    const rejectRun = await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: expert, state: { componentId: candidate.componentId, componentVersionId: candidate.versionId! } });
    const rejected = await resumeWorkflow(expert, rejectRun.threadId, { expectedVersion: rejectRun.expectedVersion, action: "REJECT", rationale: "One signal cannot establish repeated reuse eligibility.", rubric, idempotencyKey: `reject:${randomUUID()}` });
    expect(rejected.status).toBe("COMPLETED");
    expect((await getDb().select().from(componentVersions).where(eq(componentVersions.id, candidate.versionId!)))[0]?.status).toBe("REJECTED");

    const directInsertId = randomUUID();
    await expect(getSql().unsafe(`INSERT INTO foundry_product.component_versions (id, component_id, version, contract, content, source_observation_ids, source_review_ids, validation, status, content_hash, created_by) SELECT '${directInsertId}', id, '99.0.0', '{}'::jsonb, '{}'::jsonb, '{}'::uuid[], '{}'::uuid[], '{}'::jsonb, 'PUBLISHED', 'forged', created_by FROM foundry_product.components WHERE id = '${candidate.componentId}'`)).rejects.toThrow(/governed Drafts/);
    await expect(getSql().unsafe(`UPDATE foundry_product.components SET status = 'PUBLISHED' WHERE id = '${candidate.componentId}'`)).rejects.toThrow(/lifecycle status/);
  });

  it("publishes after a second distinct Attempt, reuses immutable support, publishes a successor and rolls back", async () => {
    await createReviewedSignal("two");
    const [component] = await getDb().select().from(components).where(and(eq(components.capabilityId, capabilityId), eq(components.institutionId, expert.institutionId))).limit(1);
    const [rejectedVersion] = await getDb().select().from(componentVersions).where(and(eq(componentVersions.componentId, component.id), eq(componentVersions.status, "REJECTED"))).limit(1);
    const successor = await updateComponentVersion(expert, {
      componentId: component.id,
      componentVersionId: rejectedVersion.id,
      title: "Unit-ledger teaching support",
      purpose: "Reuse reviewed support for a repeated concentration unit-conversion failure.",
      content,
      idempotencyKey: `successor:${randomUUID()}`,
    });
    expect(successor.createdSuccessor).toBe(true);
    const publishRun = await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: expert, state: { componentId: component.id, componentVersionId: successor.componentVersionId } });
    expect((publishRun.result as Record<string, unknown>).systemStatus).toBe("PASSED");
    const publicationKey = `approve:${randomUUID()}`;
    const publicationPayload = { expectedVersion: publishRun.expectedVersion, action: "APPROVE" as const, rationale: "Two current reviewed Attempts and all system gates support publication.", rubric, idempotencyKey: publicationKey };
    await expect(resumeWorkflow(expert, publishRun.threadId, publicationPayload, { testFaults: { afterGraphCompletion() { throw new WorkflowProcessCrashForTests(); } } })).rejects.toBeInstanceOf(WorkflowProcessCrashForTests);
    const [crashedRun] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, publishRun.runId));
    expect(crashedRun.status).toBe("RESUMING");
    const [originalDecision] = await getDb().select().from(publicationDecisions).where(eq(publicationDecisions.componentVersionId, successor.componentVersionId));
    expect(originalDecision?.id).toBeTruthy();
    await getDb().update(workflowRuns).set({ resumeLeaseExpiresAt: new Date(Date.now() - 1) }).where(eq(workflowRuns.id, publishRun.runId));
    const published = await resumeWorkflow(expert, publishRun.threadId, publicationPayload);
    expect(published.status).toBe("COMPLETED");
    expect(String((published.result as Record<string, unknown>).decisionId)).toBe(originalDecision.id);
    expect(await getDb().select().from(publicationDecisions).where(eq(publicationDecisions.componentVersionId, successor.componentVersionId))).toEqual([originalDecision]);
    const evaluationId = String((publishRun.result as Record<string, unknown>).evaluationId);
    const replay = await decidePublication(expert, { componentVersionId: successor.componentVersionId, evaluationId, workflowThreadId: publishRun.threadId, action: "APPROVE", rationale: "Two current reviewed Attempts and all system gates support publication.", rubric, idempotencyKey: publicationKey });
    expect(replay.replayed).toBe(true);

    const deliveryKey = `delivery:${randomUUID()}`;
    const firstDelivery = await deliverActiveComponentSupport(teacher, { observationId: signalObservationIds[1], idempotencyKey: deliveryKey });
    const replayedDelivery = await deliverActiveComponentSupport(teacher, { observationId: signalObservationIds[1], idempotencyKey: deliveryKey });
    expect(replayedDelivery).toMatchObject({ deliveryId: firstDelivery.deliveryId, replayed: true });
    expect(await getDb().select().from(componentDeliveries).where(eq(componentDeliveries.id, firstDelivery.deliveryId))).toHaveLength(1);
    expect(firstDelivery.componentVersionId).toBe(successor.componentVersionId);
    const learnerDetail = await getTaskDetail(learner, SEED.task);
    expect(learnerDetail?.componentSupport.some(({ delivery }) => delivery.id === firstDelivery.deliveryId)).toBe(true);

    const successorTwo = await updateComponentVersion(expert, {
      componentId: component.id,
      componentVersionId: successor.componentVersionId,
      title: "Unit-ledger teaching support · concise",
      purpose: "Reuse reviewed support with a shorter scaffold for the same governed failure signal.",
      content: { ...content, scaffoldHint: "Write target units first, then convert." },
      idempotencyKey: `successor-two:${randomUUID()}`,
    });
    const publicBeforeApproval = (await getDb().select().from(components).where(eq(components.id, component.id)))[0];
    expect(publicBeforeApproval.activeVersionId).toBe(successor.componentVersionId);
    expect(publicBeforeApproval.title).toBe("Unit-ledger teaching support");
    const publishTwoRun = await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: expert, state: { componentId: component.id, componentVersionId: successorTwo.componentVersionId } });
    await resumeWorkflow(expert, publishTwoRun.threadId, { expectedVersion: publishTwoRun.expectedVersion, action: "APPROVE", rationale: "Successor preserves lineage and passes every current gate.", rubric, idempotencyKey: `approve-two:${randomUUID()}` });
    const activeSuccessor = (await getDb().select().from(components).where(eq(components.id, component.id)))[0];
    expect(activeSuccessor.activeVersionId).toBe(successorTwo.componentVersionId);
    expect(activeSuccessor.title).toBe("Unit-ledger teaching support · concise");
    const successorDelivery = await deliverActiveComponentSupport(teacher, { observationId: signalObservationIds[0], idempotencyKey: `delivery-successor:${randomUUID()}` });
    expect(successorDelivery.componentVersionId).toBe(successorTwo.componentVersionId);
    const revisionsBeforeHistoricalEdit = await getDb().select().from(componentDraftRevisions)
      .where(eq(componentDraftRevisions.componentId, component.id))
      .orderBy(componentDraftRevisions.revisionNumber);
    const latestBeforeHistoricalEdit = revisionsBeforeHistoricalEdit.at(-1)!;
    const [historicalSourceVersion] = await getDb().select().from(componentVersions).where(eq(componentVersions.id, successor.componentVersionId));
    const [successorTwoShell] = await getDb().select().from(componentVersions).where(eq(componentVersions.id, successorTwo.componentVersionId));
    const nonLatestEdit = await updateComponentVersion(expert, {
      componentId: component.id,
      componentVersionId: successor.componentVersionId,
      title: "Unit-ledger teaching support · historical-source branch",
      purpose: "Prove a non-latest immutable published source allocates the next global revision without rewriting prior history.",
      content: { ...content, scaffoldHint: "Start from the historical exact version, then author a new global revision." },
      idempotencyKey: `non-latest-successor:${randomUUID()}`,
    });
    const [nonLatestShell] = await getDb().select().from(componentVersions).where(eq(componentVersions.id, nonLatestEdit.componentVersionId));
    const [nonLatestRevision] = await getDb().select().from(componentDraftRevisions).where(eq(componentDraftRevisions.id, nonLatestShell.draftRevisionId));
    expect(nonLatestRevision).toMatchObject({
      revisionNumber: latestBeforeHistoricalEdit.revisionNumber + 1,
      predecessorRevisionId: historicalSourceVersion.draftRevisionId,
      derivedFromVersionId: successor.componentVersionId,
    });
    const historicalBranches = await getDb().select().from(componentDraftRevisions)
      .where(eq(componentDraftRevisions.predecessorRevisionId, historicalSourceVersion.draftRevisionId));
    expect(new Set(historicalBranches.map(({ id }) => id))).toEqual(new Set([successorTwoShell.draftRevisionId, nonLatestRevision.id]));
    expect((await getDb().select().from(componentDraftRevisions).where(eq(componentDraftRevisions.id, historicalSourceVersion.draftRevisionId)))[0]).toMatchObject({
      lifecycleState: "APPROVED",
      contentHash: historicalSourceVersion.contentHash,
    });
    await expect(getSql().unsafe(`UPDATE foundry_product.component_versions SET content_hash = 'forged' WHERE id = '${successor.componentVersionId}'`)).rejects.toThrow(/immutable/);
    await expect(getSql().unsafe(`UPDATE foundry_product.components SET active_version_id = '${successor.componentVersionId}' WHERE id = '${component.id}'`)).rejects.toThrow(/governed publication or rollback/);

    const rollbackInput = { componentId: component.id, targetVersionId: successor.componentVersionId, expectedActiveVersionId: successorTwo.componentVersionId, rationale: "Restore the earlier reviewed scaffold after expert comparison.", idempotencyKey: `rollback:${randomUUID()}` };
    const rollback = await rollbackComponent(expert, rollbackInput);
    expect(rollback.activeVersionId).toBe(successor.componentVersionId);
    await expect(rollbackComponent(expert, rollbackInput)).resolves.toMatchObject({ decisionId: rollback.decisionId, replayed: true });
    const restoredDelivery = await deliverActiveComponentSupport(teacher, { observationId: signalObservationIds[1], idempotencyKey: `delivery-restored:${randomUUID()}` });
    expect(restoredDelivery.componentVersionId).toBe(successor.componentVersionId);
    const deliveries = await getDb().select().from(componentDeliveries).where(eq(componentDeliveries.componentId, component.id));
    expect(new Set(deliveries.map((delivery) => delivery.componentVersionId))).toEqual(new Set([successor.componentVersionId, successorTwo.componentVersionId]));
    expect(deliveries.find((delivery) => delivery.id === successorDelivery.deliveryId)?.componentVersionId).toBe(successorTwo.componentVersionId);
    expect(deliveries.find((delivery) => delivery.id === restoredDelivery.deliveryId)?.componentVersionId).toBe(successor.componentVersionId);
    const historicalDecisionActions = (await getDb().select().from(publicationDecisions).where(eq(publicationDecisions.componentVersionId, successor.componentVersionId))).map((decision) => decision.action);
    expect(historicalDecisionActions).toContain("APPROVE");
    expect(historicalDecisionActions).toContain("ROLLBACK");
  });

  it("allows exactly one terminal winner across concurrent expert workflows and denies tenant/role bypass", async () => {
    const [component] = await getDb().select().from(components).where(eq(components.capabilityId, capabilityId)).limit(1);
    const [sourceVersion] = await getDb().select().from(componentVersions).where(eq(componentVersions.id, component.activeVersionId!)).limit(1);
    const raceVersion = await updateComponentVersion(expert, {
      componentId: component.id,
      componentVersionId: sourceVersion.id,
      title: "Unit-ledger teaching support · race fixture",
      purpose: "Prove that two expert workflow handoffs cannot create competing terminal decisions.",
      content,
      idempotencyKey: `race-successor:${randomUUID()}`,
    });
    await expect(startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: learner, state: { componentId: component.id, componentVersionId: raceVersion.componentVersionId } })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    const outsider: Actor = { ...expert, institutionId: randomUUID(), courseIds: [], sessionId: `outsider:${randomUUID()}` };
    await expect(startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: outsider, state: { componentId: component.id, componentVersionId: raceVersion.componentVersionId } })).rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    const approveRun = await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: expert, state: { componentId: component.id, componentVersionId: raceVersion.componentVersionId } });
    const rejectRun = await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: expert, state: { componentId: component.id, componentVersionId: raceVersion.componentVersionId } });
    const results = await Promise.allSettled([
      resumeWorkflow(expert, approveRun.threadId, { expectedVersion: approveRun.expectedVersion, action: "APPROVE", rationale: "Approve this fully evaluated race fixture.", rubric, idempotencyKey: `race-approve:${randomUUID()}` }),
      resumeWorkflow(expert, rejectRun.threadId, { expectedVersion: rejectRun.expectedVersion, action: "REJECT", rationale: "Reject this race fixture as the competing decision.", rubric, idempotencyKey: `race-reject:${randomUUID()}` }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const terminal = await getDb().select().from(publicationDecisions).where(and(eq(publicationDecisions.componentVersionId, raceVersion.componentVersionId)));
    expect(terminal).toHaveLength(1);
    expect(["APPROVE", "REJECT"]).toContain(terminal[0]?.action);
  });

  it("excludes a superseded source Observation and blocks its stale initial lineage", async () => {
    const staleSource = await createReviewedSignal("superseded-source");
    const candidate = await createComponentCandidate(expert, {
      observationId: staleSource.observationId,
      key: `superseded-source-${randomUUID()}`,
      title: "Superseded source fixture",
      purpose: "Prove that a corrected signal cannot authorize publication from its superseded predecessor.",
      content,
      idempotencyKey: `superseded-candidate:${randomUUID()}`,
    });
    const correctingSignal = await createReviewedSignal("correcting-source");
    await getDb().update(diagnosticObservations).set({ supersededById: correctingSignal.observationId }).where(eq(diagnosticObservations.id, staleSource.observationId));
    const run = await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: expert, state: { componentId: candidate.componentId, componentVersionId: candidate.versionId! } });
    const [evaluation] = await getDb().select().from(componentEvaluations).where(eq(componentEvaluations.id, String((run.result as Record<string, unknown>).evaluationId)));
    expect(evaluation.systemStatus).toBe("BLOCKED");
    expect(evaluation.sourceObservationIds).not.toContain(staleSource.observationId);
    expect(evaluation.systemChecks).toContainEqual(expect.objectContaining({ id: "source-current-human-review-provenance", status: "BLOCKED" }));
    await expect(deliverActiveComponentSupport(teacher, { observationId: staleSource.observationId, idempotencyKey: `stale-delivery:${randomUUID()}` })).rejects.toMatchObject({ code: "OBSERVATION_NOT_FOUND" });
  });

  it("excludes reviewed signals from a deactivated Capability version and admits the current binding", async () => {
    const historicalObservationIds = [...signalObservationIds];
    const beforeActivationChange = await getFoundryWorkspace(expert);
    expect(beforeActivationChange.reviewedPatterns.some((pattern) => pattern.capability_id === capabilityId)).toBe(true);

    const definition = CHEMISTRY_CAPABILITIES[0];
    const successorCapabilityVersionId = randomUUID();
    await getDb().insert(capabilityVersions).values({
      id: successorCapabilityVersionId,
      capabilityId,
      version: "1.1.0",
      contract: { ...definition.contract, evaluationFixture: definition.evaluationFixture },
      implementationKey: definition.implementationKey,
      status: "ACTIVE",
      contentHash: `asset-loop-successor:${randomUUID()}`,
    });
    await getDb().update(capabilities).set({ activeVersionId: successorCapabilityVersionId }).where(eq(capabilities.id, capabilityId));

    const withOnlyHistoricalSignals = await getFoundryWorkspace(expert);
    expect(withOnlyHistoricalSignals.reviewedPatterns.some((pattern) => pattern.capability_id === capabilityId)).toBe(false);
    expect(withOnlyHistoricalSignals.candidateSources.some((source) => source.capability_id === capabilityId)).toBe(false);

    const current = await createReviewedSignal("active-capability-successor");
    const withCurrentSignal = await getFoundryWorkspace(expert);
    expect(withCurrentSignal.reviewedPatterns).toContainEqual(expect.objectContaining({
      capability_id: capabilityId,
      observation_id: current.observationId,
      reference_pack_key: "chemistry-caie-9701",
    }));
    expect(withCurrentSignal.candidateSources).toContainEqual(expect.objectContaining({
      capability_id: capabilityId,
      observation_id: current.observationId,
      reference_pack_key: "chemistry-caie-9701",
      repeated_attempt_count: 1,
    }));
    expect(withCurrentSignal.candidateSources.some((source) => historicalObservationIds.includes(String(source.observation_id)))).toBe(false);
  });

  it("records replay-safe exact maintenance decisions without rewriting version or delivery history", async () => {
    const [component] = await getDb().select().from(components).where(eq(components.capabilityId, capabilityId)).limit(1);
    const publishedVersions = await getDb().select().from(componentVersions)
      .where(and(eq(componentVersions.componentId, component.id), eq(componentVersions.status, "PUBLISHED")));
    const successor = publishedVersions.find((candidate) => publishedVersions.some((prior) => prior.id === candidate.successorOfVersionId));
    const predecessor = successor && publishedVersions.find((candidate) => candidate.id === successor.successorOfVersionId);
    expect(predecessor).toBeTruthy();
    expect(successor).toBeTruthy();

    if (component.activeVersionId !== predecessor!.id) {
      await rollbackComponent(expert, {
        componentId: component.id,
        targetVersionId: predecessor!.id,
        expectedActiveVersionId: component.activeVersionId!,
        rationale: "Set the exact historical predecessor active for the bounded maintenance exercise.",
        idempotencyKey: `maintenance-setup:${randomUUID()}`,
      });
    }

    const versionsBefore = await getDb().select().from(componentVersions)
      .where(eq(componentVersions.componentId, component.id))
      .orderBy(componentVersions.createdAt, componentVersions.id);
    const deliveriesBefore = await getDb().select().from(componentDeliveries)
      .where(eq(componentDeliveries.componentId, component.id))
      .orderBy(componentDeliveries.createdAt, componentDeliveries.id);

    await expect(recordComponentDeprecation(learner, {
      componentId: component.id,
      componentVersionId: predecessor!.id,
      successorVersionId: successor!.id,
      action: "DEPRECATE",
      migrationGuidance: "Use the exact governed published successor.",
      reason: "The successor is the maintained future-delivery version.",
      idempotencyKey: `learner-maintenance-denied:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });

    const deprecationInput = {
      componentId: component.id,
      componentVersionId: predecessor!.id,
      successorVersionId: successor!.id,
      action: "DEPRECATE" as const,
      migrationGuidance: "Use the exact governed published successor.",
      reason: "The successor is the maintained future-delivery version.",
      idempotencyKey: `deprecate:${randomUUID()}`,
    };
    const deprecation = await recordComponentDeprecation(expert, deprecationInput);
    expect(deprecation).toMatchObject({ targetVersionId: predecessor!.id, activeStatusChanged: true, status: "DEPRECATED", replayed: false });
    await expect(recordComponentDeprecation(expert, deprecationInput)).resolves.toMatchObject({ decisionId: deprecation.decisionId, replayed: true });
    expect(await getDb().select().from(componentDeprecationDecisions).where(eq(componentDeprecationDecisions.id, deprecation.decisionId))).toHaveLength(1);
    await expect(deliverActiveComponentSupport(teacher, {
      observationId: signalObservationIds.at(-1)!,
      idempotencyKey: `delivery-deprecated:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "COMPONENT_SUPPORT_UNAVAILABLE" });

    await rollbackComponent(expert, {
      componentId: component.id,
      targetVersionId: successor!.id,
      expectedActiveVersionId: predecessor!.id,
      rationale: "Move future delivery to the exact maintained successor.",
      idempotencyKey: `maintenance-successor:${randomUUID()}`,
    });
    await expect(rollbackComponent(expert, {
      componentId: component.id,
      targetVersionId: predecessor!.id,
      expectedActiveVersionId: successor!.id,
      rationale: "A deprecated exact version must remain excluded from rollback targets.",
      idempotencyKey: `rollback-deprecated-denied:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "ROLLBACK_TARGET_INELIGIBLE" });

    const disableInput = {
      componentId: component.id,
      componentVersionId: successor!.id,
      reason: "Emergency disable this exact active version after bounded review.",
      idempotencyKey: `disable:${randomUUID()}`,
    };
    const disabled = await emergencyDisableComponent(expert, disableInput);
    expect(disabled).toMatchObject({ targetVersionId: successor!.id, activeStatusChanged: true, status: "EMERGENCY_DISABLED", replayed: false });
    await expect(emergencyDisableComponent(expert, disableInput)).resolves.toMatchObject({ decisionId: disabled.decisionId, replayed: true });
    expect(await getDb().select().from(componentDisableDecisions).where(eq(componentDisableDecisions.id, disabled.decisionId))).toHaveLength(1);
    await expect(deliverActiveComponentSupport(teacher, {
      observationId: signalObservationIds.at(-1)!,
      idempotencyKey: `delivery-disabled:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "COMPONENT_SUPPORT_UNAVAILABLE" });

    expect(await getDb().select().from(componentVersions)
      .where(eq(componentVersions.componentId, component.id))
      .orderBy(componentVersions.createdAt, componentVersions.id)).toEqual(versionsBefore);
    expect(await getDb().select().from(componentDeliveries)
      .where(eq(componentDeliveries.componentId, component.id))
      .orderBy(componentDeliveries.createdAt, componentDeliveries.id)).toEqual(deliveriesBefore);
  });
});
