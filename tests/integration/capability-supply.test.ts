import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { resolveCapabilityForDiagnosis, resolveCapabilityForSupplyRelation } from "@/application/capability-resolution";
import { planActivityForResolution } from "@/application/activity-planning";
import { createWebComponentAssetProposal, previewWebComponentAsset } from "@/application/capability-supply";
import { executeAssetStageResult } from "@/application/asset-runtime";
import { deriveWebComponentAssetRuntimeRequest } from "@/application/web-component-runtime";
import { commandRequestHash } from "@/application/commands";
import {
  resumeWorkflow,
  startWorkflow,
  WorkflowProcessCrashForTests,
} from "@/application/workflow-service";
import { closeDb, getDb, getSql, withTenantDatabase } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  activityPlanProposals,
  capabilities,
  capabilityAvailabilityDecisions,
  capabilityResolutions,
  capabilityVersions,
  componentAssetPreviews,
  componentEvaluations,
  componentVersions,
  components,
  courseEnrollments,
  courses,
  institutionMemberships,
  learnerAttempts,
  learningEvents,
  learningOutcomes,
  publicationDecisions,
  runtimeDeliveries,
  teacherReviews,
  users,
  workflowRuns,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import {
  CallableCapabilityResolutionContract,
  resolveCapabilityCandidates,
  type CapabilityResolutionNeed,
} from "@/domain/capability-resolution";
import { WebComponentAssetContract, WebComponentAssetPackage } from "@/domain/web-component-asset";
import { closeWorkflowCheckpointer } from "@/workflows/checkpointer";
import { startComponentExecutorTestProcess, type ComponentExecutorTestProcess } from "@/tests/helpers/component-executor-process";

const learner: Actor = { userId: SEED.learner, institutionId: SEED.institution, roles: ["LEARNER"], courseIds: [SEED.course], authMethod: "cap07-integration", sessionId: "cap07-learner" };
const expert: Actor = { userId: SEED.expert, institutionId: SEED.institution, roles: ["EXPERT"], courseIds: [SEED.course], authMethod: "cap07-integration", sessionId: "cap07-expert" };
const rubric = { domainCorrectness: "PASS", pedagogy: "PASS", safety: "PASS", reuseReadiness: "PASS", notes: "Reviewed the exact learner interaction, checks and explicit non-claims." } as const;

let gapId = "";
let proposalId = "";
let proposalVersionId = "";
let lifecycleThreadId = "";
let lifecycleExpectedVersion = 0;
let publicationKey = "";
let componentPackage: WebComponentAssetPackage;
let registeredCapabilityId = "";
let registeredCapabilityVersionId = "";
let readyPlanId = "";
let executorProcess: ComponentExecutorTestProcess;

function publicationPayload() {
  return {
    expectedVersion: lifecycleExpectedVersion,
    action: "APPROVE" as const,
    rationale: "Exact preview and checks authorize this exact version for the source course only.",
    rubric,
    idempotencyKey: publicationKey,
  };
}

async function executorPost(path: string, body: unknown) {
  return fetch(`${executorProcess.endpoint}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${executorProcess.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectNoRegistration(): Promise<void> {
  expect(await getDb().select().from(publicationDecisions).where(eq(publicationDecisions.componentVersionId, proposalVersionId))).toHaveLength(0);
  expect(await getDb().select().from(capabilityAvailabilityDecisions).where(eq(capabilityAvailabilityDecisions.componentVersionId, proposalVersionId))).toHaveLength(0);
  const [component] = await getDb().select().from(components).where(eq(components.id, proposalId)).limit(1);
  const [version] = await getDb().select().from(componentVersions).where(eq(componentVersions.id, proposalVersionId)).limit(1);
  expect(component).toMatchObject({ status: "CANDIDATE", activeVersionId: null, registeredCapabilityId: null, registeredCapabilityVersionId: null });
  expect(version?.status).toBe("DRAFT");
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.PRODUCT_DATABASE_URL;
  if (!databaseUrl) throw new Error("CAP-07 integration requires DATABASE_URL");
  executorProcess = await startComponentExecutorTestProcess(databaseUrl);
});

afterAll(async () => {
  await executorProcess?.stop();
  await closeWorkflowCheckpointer();
  await closeDb();
});

describe.sequential("CAP-07 capability gap and supply", () => {
  it("creates one canonical de-identified ADAPT proposal, exact checks and an atomic concurrent preview", async () => {
    const gap = await resolveCapabilityForDiagnosis(learner, { taskId: SEED.task, episodeId: SEED.episode, diagnosticObservationId: SEED.observation });
    expect(gap).toMatchObject({ decision: "ADAPT", noMatch: true, teacherEscalation: true });
    gapId = gap.id;
    const blocked = await planActivityForResolution(learner, { taskId: SEED.task, episodeId: SEED.episode, capabilityResolutionId: gap.id });
    expect(blocked).toMatchObject({ state: "BLOCKED", resolutionDecision: "ADAPT", selectedCapabilityVersionId: null });

    const [first, concurrent] = await Promise.all([
      createWebComponentAssetProposal(expert, { capabilityResolutionId: gap.id, idempotencyKey: `cap07-proposal:${randomUUID()}` }),
      createWebComponentAssetProposal(expert, { capabilityResolutionId: gap.id, idempotencyKey: `cap07-proposal:${randomUUID()}` }),
    ]);
    expect(first.componentId).toBe(concurrent.componentId);
    expect(first.versionId).toBe(concurrent.versionId);
    expect([first.replayed, concurrent.replayed].sort()).toEqual([false, true]);
    proposalId = first.componentId;
    proposalVersionId = first.versionId!;
    expect(await getDb().select().from(components).where(eq(components.sourceCapabilityResolutionId, gap.id))).toHaveLength(1);

    const [version] = await getDb().select().from(componentVersions).where(eq(componentVersions.id, proposalVersionId)).limit(1);
    componentPackage = WebComponentAssetPackage.parse(version?.content);
    const contract = WebComponentAssetContract.parse(version?.contract);
    expect(contract).toMatchObject({ supplyStrategy: "ADAPT", dataClassification: "DEIDENTIFIED_INSTRUCTIONAL", arbitraryCodeAllowed: false });
    expect(componentPackage.interactionMode).toBe("STATELESS_ONE_SHOT");
    expect(componentPackage).not.toHaveProperty("stateContract");
    const reusablePayload = JSON.stringify({ contract, componentPackage }).toLocaleLowerCase("en-US");
    const [sourceResolution] = await getDb().select().from(capabilityResolutions).where(eq(capabilityResolutions.id, gap.id)).limit(1);
    expect(reusablePayload).not.toContain(SEED.task.toLocaleLowerCase("en-US"));
    expect(reusablePayload).not.toContain(SEED.observation.toLocaleLowerCase("en-US"));
    expect(reusablePayload).not.toContain(sourceResolution!.selectionRationale.toLocaleLowerCase("en-US"));

    const exactEvaluationCommand = {
      command: "EVALUATE_WEB_COMPONENT_DRAFT",
      actor: { userId: expert.userId, institutionId: expert.institutionId, authMethod: expert.authMethod, sessionId: expert.sessionId },
      componentVersionId: proposalVersionId,
      expectedContentHash: version!.contentHash,
    };
    const fabricatedEvaluation = await executorPost("/commands/evaluate", { ...exactEvaluationCommand, systemChecks: [{ id: "forged", status: "PASSED" }] });
    expect(fabricatedEvaluation.status).toBe(400);
    expect(await fabricatedEvaluation.json()).toMatchObject({ code: "COMPONENT_EXECUTOR_PAYLOAD_REJECTED" });
    expect(await getDb().select().from(componentEvaluations).where(eq(componentEvaluations.componentVersionId, proposalVersionId))).toHaveLength(0);
    const staleHashEvaluation = await executorPost("/commands/evaluate", { ...exactEvaluationCommand, expectedContentHash: `sha256:${"0".repeat(64)}` });
    expect(staleHashEvaluation.status).toBe(422);
    expect(await staleHashEvaluation.json()).toMatchObject({ code: "COMPONENT_EVALUATION_CONFLICT" });

    const started = await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: expert, state: { componentId: proposalId, componentVersionId: proposalVersionId } });
    expect(started).toMatchObject({ status: "INTERRUPTED", interruptType: "EXPERT_PUBLICATION_REVIEW_REQUIRED", expectedVersion: 1 });
    lifecycleThreadId = started.threadId;
    lifecycleExpectedVersion = started.expectedVersion;
    const startReplay = await startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: expert, state: { componentId: proposalId, componentVersionId: proposalVersionId } });
    expect(startReplay).toMatchObject({ runId: started.runId, threadId: started.threadId, status: "INTERRUPTED", replayed: true });

    const otherExpertId = randomUUID();
    const courseAExpertId = randomUUID();
    const courseAId = randomUUID();
    await getDb().insert(users).values([
      { id: otherExpertId, email: `cap07-other-${otherExpertId}@example.invalid`, name: "Other same-course expert" },
      { id: courseAExpertId, email: `cap07-course-a-${courseAExpertId}@example.invalid`, name: "Course A expert" },
    ]);
    await getDb().insert(courses).values({ id: courseAId, institutionId: SEED.institution, subjectId: SEED.subject, code: `CAP07-A-${courseAId.slice(0, 8)}`, name: "CAP-07 authority course A" });
    await getDb().insert(institutionMemberships).values([
      { userId: otherExpertId, institutionId: SEED.institution, role: "EXPERT" },
      { userId: courseAExpertId, institutionId: SEED.institution, role: "EXPERT" },
    ]);
    await getDb().insert(courseEnrollments).values([
      { institutionId: SEED.institution, courseId: SEED.course, userId: otherExpertId, role: "EXPERT" },
      { institutionId: SEED.institution, courseId: courseAId, userId: courseAExpertId, role: "EXPERT" },
    ]);
    const otherExpert: Actor = { ...expert, userId: otherExpertId, sessionId: "cap07-other-expert" };
    const courseAExpert: Actor = { ...expert, userId: courseAExpertId, courseIds: [courseAId], sessionId: "cap07-course-a-expert" };
    const deniedExecutorPreview = await executorPost("/commands/preview", {
      command: "PREVIEW_WEB_COMPONENT_DRAFT",
      actor: { userId: courseAExpert.userId, institutionId: courseAExpert.institutionId, authMethod: courseAExpert.authMethod, sessionId: courseAExpert.sessionId },
      componentId: proposalId,
      componentVersionId: proposalVersionId,
      expectedContentHash: version!.contentHash,
      selectedChoiceId: componentPackage.correctChoiceId,
      idempotencyKey: `cap07-course-a-preview:${randomUUID()}`,
    });
    expect(deniedExecutorPreview.status).toBe(403);
    expect(await deniedExecutorPreview.json()).toMatchObject({ code: "TENANT_ISOLATION" });
    await expect(startWorkflow({ kind: "COMPONENT_LIFECYCLE", actor: otherExpert, state: { componentId: proposalId, componentVersionId: proposalVersionId } }))
      .rejects.toMatchObject({ code: "WORKFLOW_IDEMPOTENCY_MISMATCH" });
    const [dbCourseAuthority] = await withTenantDatabase(courseAExpert, () => getSql()<Array<{ allowed: boolean }>>`SELECT foundry_product.cap07_actor_can_confirm(${SEED.course}::uuid) AS allowed`);
    expect(dbCourseAuthority?.allowed).toBe(false);
    await expect(withTenantDatabase(courseAExpert, () => getSql()`SELECT foundry_product.lock_cap07_publication_source(${proposalId}::uuid,${proposalVersionId}::uuid,${String((started.result as Record<string, unknown>).evaluationId)}::uuid)`))
      .rejects.toThrow(/course-authorized ComponentAsset lineage/);
    publicationKey = `cap07-confirm:${randomUUID()}`;
    await expect(resumeWorkflow(courseAExpert, lifecycleThreadId, publicationPayload())).rejects.toMatchObject({ code: "TENANT_ISOLATION" });

    const foreignExpert: Actor = { ...expert, institutionId: randomUUID(), courseIds: [] };
    await expect(previewWebComponentAsset(foreignExpert, { componentId: proposalId, componentVersionId: proposalVersionId, selectedChoiceId: componentPackage.correctChoiceId, idempotencyKey: `cap07-foreign-preview:${randomUUID()}` }))
      .rejects.toMatchObject({ code: "TENANT_ISOLATION" });

    const previewKey = `cap07-preview:${randomUUID()}`;
    const [preview, previewReplay] = await Promise.all([
      previewWebComponentAsset(expert, { componentId: proposalId, componentVersionId: proposalVersionId, selectedChoiceId: componentPackage.correctChoiceId, idempotencyKey: previewKey }),
      previewWebComponentAsset(expert, { componentId: proposalId, componentVersionId: proposalVersionId, selectedChoiceId: componentPackage.correctChoiceId, idempotencyKey: previewKey }),
    ]);
    expect(preview.preview.id).toBe(previewReplay.preview.id);
    expect([preview.replayed, previewReplay.replayed].sort()).toEqual([false, true]);
    expect(await getDb().select().from(componentAssetPreviews).where(eq(componentAssetPreviews.idempotencyKey, previewKey))).toHaveLength(1);
    const alternateChoice = componentPackage.choices.find((choice) => choice.id !== componentPackage.correctChoiceId)!;
    await expect(previewWebComponentAsset(expert, { componentId: proposalId, componentVersionId: proposalVersionId, selectedChoiceId: alternateChoice.id, idempotencyKey: previewKey }))
      .rejects.toThrow(/different input/);
  });

  it("fails stale and partial registration atomically, then reconciles a completed checkpoint after process loss", async () => {
    class FreshnessRollback extends Error {}
    await expect(withTenantDatabase(expert, async () => {
      const [sourceResolution] = await getDb().select().from(capabilityResolutions).where(eq(capabilityResolutions.id, gapId)).limit(1);
      const [sourcePlan] = await getDb().select().from(activityPlanProposals).where(eq(activityPlanProposals.capabilityResolutionId, gapId)).limit(1);
      const newerResolutionId = randomUUID();
      await getSql().unsafe("SET LOCAL session_replication_role = replica");
      try {
        await getDb().insert(capabilityResolutions).values({ ...sourceResolution!, id: newerResolutionId, inputHash: `${sourceResolution!.inputHash}:freshness:${newerResolutionId}`, createdAt: new Date(Date.now() + 60_000) });
        await getDb().insert(activityPlanProposals).values({ ...sourcePlan!, id: randomUUID(), capabilityResolutionId: newerResolutionId, inputHash: `${sourcePlan!.inputHash}:freshness:${newerResolutionId}`, createdAt: new Date(Date.now() + 60_000) });
      } finally {
        await getSql().unsafe("SET LOCAL session_replication_role = origin");
      }
      try {
        await resumeWorkflow(expert, lifecycleThreadId, publicationPayload());
      } catch (error) {
        expect(error).toMatchObject({ code: "COMPONENT_EVALUATION_STALE" });
        throw new FreshnessRollback("rollback freshness fixture");
      }
      throw new Error("Stale source gap unexpectedly confirmed");
    })).rejects.toBeInstanceOf(FreshnessRollback);
    await expectNoRegistration();

    await expect(resumeWorkflow(expert, lifecycleThreadId, publicationPayload(), {
      testFaults: {
        componentPublication: {
          resolveCapability: resolveCapabilityForSupplyRelation,
          planActivity: planActivityForResolution,
          beforeReplan: () => { throw new Error("injected failure before exact re-resolution"); },
        },
      },
    })).rejects.toThrow(/injected failure before exact re-resolution/);
    await expectNoRegistration();
    const [stillInterrupted] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.threadId, lifecycleThreadId)).limit(1);
    expect(stillInterrupted).toMatchObject({ status: "INTERRUPTED", interruptType: "EXPERT_PUBLICATION_REVIEW_REQUIRED" });

    await expect(resumeWorkflow(expert, lifecycleThreadId, publicationPayload(), {
      testFaults: {
        afterGraphCompletion: ({ kind }) => {
          if (kind === "COMPONENT_LIFECYCLE") throw new WorkflowProcessCrashForTests("lost response after completed Component lifecycle checkpoint");
        },
      },
    })).rejects.toBeInstanceOf(WorkflowProcessCrashForTests);
    await expectNoRegistration();

    const confirmed = await resumeWorkflow(expert, lifecycleThreadId, publicationPayload());
    expect(confirmed).toMatchObject({ status: "COMPLETED", interruptType: null });
    const confirmedResult = confirmed.result as Record<string, unknown>;
    registeredCapabilityId = String(confirmedResult.registeredCapabilityId);
    registeredCapabilityVersionId = String(confirmedResult.registeredCapabilityVersionId);
    readyPlanId = String(confirmedResult.activityPlanProposalId);
    expect(registeredCapabilityId).toMatch(/^[0-9a-f-]{36}$/);
    expect(registeredCapabilityVersionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(readyPlanId).toMatch(/^[0-9a-f-]{36}$/);

    const exactReplay = await resumeWorkflow(expert, lifecycleThreadId, publicationPayload());
    expect(exactReplay).toMatchObject({ status: "COMPLETED", replayed: true });
    await expect(resumeWorkflow(expert, lifecycleThreadId, { ...publicationPayload(), rationale: "A changed replay rationale is forbidden." }))
      .rejects.toMatchObject({ code: "WORKFLOW_REPLAY_IDEMPOTENCY_MISMATCH" });
    await expect(resumeWorkflow({ ...expert, courseIds: [] }, lifecycleThreadId, publicationPayload()))
      .rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    await expect(resumeWorkflow({ ...expert, userId: randomUUID() }, lifecycleThreadId, publicationPayload()))
      .rejects.toMatchObject({ code: "WORKFLOW_OWNERSHIP" });
    await expect(resumeWorkflow(expert, lifecycleThreadId, { ...publicationPayload(), expectedVersion: lifecycleExpectedVersion + 1 }))
      .rejects.toMatchObject({ code: "RESUME_CONFLICT" });
    await expect(resumeWorkflow(expert, `${SEED.institution}:component_lifecycle:missing`, publicationPayload()))
      .rejects.toMatchObject({ code: "TENANT_ISOLATION" });

    const [component] = await getDb().select().from(components).where(eq(components.id, proposalId)).limit(1);
    const [registered] = await getDb().select({ capability: capabilities, version: capabilityVersions })
      .from(capabilities).innerJoin(capabilityVersions, eq(capabilityVersions.id, capabilities.activeVersionId))
      .where(eq(capabilities.id, registeredCapabilityId)).limit(1);
    const [availability] = await getDb().select().from(capabilityAvailabilityDecisions).where(eq(capabilityAvailabilityDecisions.componentVersionId, proposalVersionId)).limit(1);
    const [ready] = await getDb().select().from(activityPlanProposals).where(eq(activityPlanProposals.id, readyPlanId)).limit(1);
    expect(component).toMatchObject({ status: "PUBLISHED", activeVersionId: proposalVersionId, registeredCapabilityId, registeredCapabilityVersionId });
    expect(availability).toMatchObject({ availabilityStatus: "AVAILABLE", availabilityScope: { kind: "INSTITUTION_COURSE_PRIVATE", crossTenantReuse: false } });
    expect(ready).toMatchObject({ state: "READY", resolutionDecision: "EXISTING", selectedCapabilityVersionId: registeredCapabilityVersionId });
    const resolutionContract = CallableCapabilityResolutionContract.parse((registered!.version.contract as Record<string, unknown>).resolution);
    expect(Object.values(resolutionContract.eligibility).flat()).not.toContain("*");
    expect(resolutionContract.availability).toMatchObject({ institutionIds: [SEED.institution], courseIds: [SEED.course] });
    const incompatibleNeed: CapabilityResolutionNeed = {
      institutionId: SEED.institution,
      courseId: SEED.course,
      referencePackKey: registered!.capability.referencePackKey,
      taskGoal: resolutionContract.learningProblem,
      diagnosticObservationId: SEED.observation,
      taskType: "CAPABILITY_GAP_REMEDIATION",
      curriculum: registered!.capability.referencePackKey,
      learnerLevel: "COURSE_AUTHORIZED_UNSPECIFIED",
      languages: ["fr"],
      accessibility: ["keyboard"],
      prerequisiteEvidence: [],
      contraindications: [],
      signals: resolutionContract.exactMatchSignals,
      compositionRequiredTags: [],
      requiredCapabilityKeys: [],
      excludedCapabilityKeys: [],
      generationAllowed: false,
      rightsAvailability: {},
      dependencyAvailability: {},
      providerAvailability: {},
    };
    const incompatible = resolveCapabilityCandidates({
      need: incompatibleNeed,
      registry: [{
        capabilityId: registered!.capability.id,
        capabilityKey: registered!.capability.key,
        capabilityName: registered!.capability.name,
        referencePackKey: registered!.capability.referencePackKey,
        activeVersionId: registered!.capability.activeVersionId,
        versionId: registered!.version.id,
        version: registered!.version.version,
        versionStatus: registered!.version.status,
        contentHash: registered!.version.contentHash,
        contract: registered!.version.contract,
        sourceDiagnosticObservationId: SEED.observation,
      }],
    });
    expect(incompatible.selectedCapabilityVersionId).toBeNull();
    expect(incompatible.candidates[0]).toMatchObject({ eligibility: "EXCLUDED", exclusionReasons: expect.arrayContaining(["INELIGIBLE"]) });

    const canonicalResult = {
      decisionId: String(confirmedResult.decisionId),
      decision: "APPROVE",
      registeredCapabilityId,
      registeredCapabilityVersionId,
      capabilityResolutionId: String(confirmedResult.capabilityResolutionId),
      activityPlanProposalId: readyPlanId,
    };
    for (const terminalStatus of ["FAILED", "CANCELLED"] as const) {
      const terminalThreadId = `${SEED.institution}:component_lifecycle:terminal-${terminalStatus.toLocaleLowerCase("en-US")}-${randomUUID()}`;
      const resumeHash = commandRequestHash(expert, "RESUME_COMPONENT_LIFECYCLE_WORKFLOW", { threadId: terminalThreadId, expectedVersion: lifecycleExpectedVersion, payload: { action: "APPROVE", rationale: publicationPayload().rationale, rubric, idempotencyKey: publicationKey } });
      await getDb().insert(workflowRuns).values({
        threadId: terminalThreadId,
        workflowKind: "COMPONENT_LIFECYCLE",
        institutionId: SEED.institution,
        actorUserId: expert.userId,
        status: terminalStatus,
        interruptVersion: lifecycleExpectedVersion,
        productLinks: {
          componentId: proposalId,
          componentVersionId: proposalVersionId,
          evaluationId: String(confirmedResult.evaluationId),
          [`componentResumeReplay:${lifecycleExpectedVersion}:actorUserId`]: expert.userId,
          [`componentResumeReplay:${lifecycleExpectedVersion}:requestHash`]: resumeHash,
          [`componentResumeReplay:${lifecycleExpectedVersion}:status`]: "COMPLETED",
          [`componentResumeReplay:${lifecycleExpectedVersion}:result`]: JSON.stringify(canonicalResult),
        },
      });
      await expect(resumeWorkflow(expert, terminalThreadId, publicationPayload())).rejects.toMatchObject({ code: "WORKFLOW_NOT_INTERRUPTED" });
    }
  });

  it("derives immutable learner prose server-side, persists honest failure evidence, and succeeds only through a bounded exact retry", async () => {
    const initialRequest = await deriveWebComponentAssetRuntimeRequest(learner, {
      taskId: SEED.task,
      episodeId: SEED.episode,
      activityPlanProposalId: readyPlanId,
      selectedChoiceId: componentPackage.correctChoiceId,
      idempotencyKey: `cap07-delivery:${randomUUID()}`,
    });
    expect(initialRequest).toMatchObject({ prompt: componentPackage.prompt, response: componentPackage.choices.find((choice) => choice.id === componentPackage.correctChoiceId)!.label, structuredInput: { selectedChoiceId: componentPackage.correctChoiceId } });
    const failed = await executeAssetStageResult(learner, initialRequest, {
      getAdapter: () => ({
        implementationKey: "foundry.web.pause-predict",
        runtimeKind: "TRUSTED_WEB_COMPONENT",
        replaySafe: true,
        async execute() { throw new Error("injected adapter fault"); },
      }),
    });
    expect(failed.delivery).toMatchObject({ status: "FAILED", attemptNumber: 1, normalizedError: { code: "ASSET_RUNTIME_ADAPTER_FAILED", retryable: true } });
    const failedReplay = await executeAssetStageResult(learner, initialRequest);
    expect(failedReplay).toMatchObject({ replayed: true, delivery: { id: failed.delivery.id, status: "FAILED" } });
    const [failedAttempt] = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, failed.delivery.id)).limit(1);
    expect(failedAttempt).toMatchObject({ prompt: componentPackage.prompt, response: initialRequest.response, structuredInput: { assetRuntimeInput: { selectedChoiceId: componentPackage.correctChoiceId } } });

    const retryRequest = await deriveWebComponentAssetRuntimeRequest(learner, {
      taskId: SEED.task,
      episodeId: SEED.episode,
      activityPlanProposalId: readyPlanId,
      retryOfDeliveryId: failed.delivery.id,
      selectedChoiceId: componentPackage.correctChoiceId,
      idempotencyKey: `cap07-delivery-retry:${randomUUID()}`,
    });
    const delivered = await executeAssetStageResult(learner, retryRequest);
    expect(delivered.delivery).toMatchObject({ status: "SUCCEEDED", retryOfDeliveryId: failed.delivery.id, attemptNumber: 2, capabilityVersionId: registeredCapabilityVersionId });
    expect(delivered.delivery.normalizedOutput).toMatchObject({ componentCompleted: true, correct: true });
    await expect(executeAssetStageResult(learner, {
      ...retryRequest,
      retryOfDeliveryId: delivered.delivery.id,
      idempotencyKey: `cap07-illegal-retry:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "ASSET_RUNTIME_RETRY_DENIED" });

    const deliveries = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.capabilityVersionId, registeredCapabilityVersionId)).orderBy(desc(runtimeDeliveries.attemptNumber));
    expect(deliveries.map((delivery) => [delivery.attemptNumber, delivery.status])).toEqual([[2, "SUCCEEDED"], [1, "FAILED"]]);
    expect((await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, failed.delivery.id))).map((event) => event.eventType)).toEqual(expect.arrayContaining(["RUNTIME_FAILED", "DELIVERY_FAILED"]));
    expect((await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, delivered.delivery.id))).map((event) => event.eventType)).toEqual(expect.arrayContaining(["CAPABILITY_RESULT", "DELIVERY_SUCCEEDED"]));
    expect(await getDb().select().from(teacherReviews).where(eq(teacherReviews.observationId, SEED.observation))).toHaveLength(0);
    expect(await getDb().select().from(learningOutcomes).where(eq(learningOutcomes.taskId, SEED.task))).toHaveLength(0);
  });
});
