import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getActor } from "@/application/actor";
import { compileAuthorizedContext } from "@/application/context-service";
import { closeDb, getDb, getSql } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  contextCarryoverRelations,
  contextCompilations,
  contextItems,
  conversationEvents,
  courseEnrollments,
  evidenceUnits,
  institutionMemberships,
  learnerProfiles,
  learnerStrategyVersions,
  learningEpisodes,
  learningTasks,
  sourceRecords,
  users,
} from "@/db/schema";
import type { Actor } from "@/domain/model";

type LearnerFixture = {
  actor: Actor;
  learnerId: string;
  profileId: string;
  taskId: string;
  episodeId: string;
};

async function createLearnerFixture(label: string): Promise<LearnerFixture> {
  const learnerId = randomUUID();
  const profileId = randomUUID();
  const taskId = randomUUID();
  const episodeId = randomUUID();
  await getDb().insert(users).values({
    id: learnerId,
    email: `${label}-${learnerId}@integration.invalid`,
    name: `${label} learner`,
  });
  await getDb().insert(institutionMemberships).values({ userId: learnerId, institutionId: SEED.institution, role: "LEARNER" });
  await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: learnerId, role: "LEARNER" });
  await getDb().insert(learnerProfiles).values({ id: profileId, institutionId: SEED.institution, learnerId, createdBy: learnerId });
  await getDb().insert(learningTasks).values({
    id: taskId,
    institutionId: SEED.institution,
    courseId: SEED.course,
    learnerId,
    learnerProfileId: profileId,
    title: `${label} Task`,
    goal: "Compile an isolated, provenance-complete Context snapshot.",
  });
  await getDb().insert(learningEpisodes).values({ id: episodeId, taskId, sequence: 1 });
  return {
    actor: await getActor(learnerId, SEED.institution, "integration-test", `context:${label}:${learnerId}`),
    learnerId,
    profileId,
    taskId,
    episodeId,
  };
}

describe.sequential("CAP-01 PostgreSQL Context Compiler", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("compiles canonical scope, carryover, strategy, teacher constraints and Evidence lineage idempotently", async () => {
    const fixture = await createLearnerFixture("context-positive");
    const teacher = await getActor(SEED.teacher, SEED.institution, "integration-test", `context-teacher:${randomUUID()}`);
    const engineer = await getActor(SEED.engineer, SEED.institution, "integration-test", `context-engineer:${randomUUID()}`);
    const priorTaskId = randomUUID();
    const priorEpisodeId = randomUUID();
    const directItemId = randomUUID();
    const priorItemId = randomUUID();
    const carryoverId = randomUUID();
    const teacherConstraintId = randomUUID();
    const strategyId = randomUUID();
    const unavailableSourceId = randomUUID();
    const unavailableEvidenceId = randomUUID();
    const unavailableContextId = randomUUID();
    const unavailableEventId = randomUUID();

    await getDb().insert(learningTasks).values({
      id: priorTaskId,
      institutionId: SEED.institution,
      courseId: SEED.course,
      learnerId: fixture.learnerId,
      learnerProfileId: fixture.profileId,
      title: "Explicit prior Task",
      goal: "Supply one explicitly referenced prior fact.",
    });
    await getDb().insert(learningEpisodes).values({ id: priorEpisodeId, taskId: priorTaskId, sequence: 1 });
    await getDb().insert(learnerStrategyVersions).values({
      id: strategyId,
      institutionId: SEED.institution,
      learnerProfileId: fixture.profileId,
      kind: "LANGUAGE_SUPPORT",
      strategy: { language: "en", support: "concise" },
      provenance: { test: "CAP-01", authority: "learner-profile" },
      ruleVersion: "cap-01-test.1",
      actorUserId: fixture.learnerId,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    });
    await getDb().insert(contextItems).values([
      {
        id: directItemId,
        institutionId: SEED.institution,
        learnerProfileId: fixture.profileId,
        courseId: SEED.course,
        taskId: fixture.taskId,
        episodeId: fixture.episodeId,
        kind: "TASK_FACT",
        scope: "EPISODE",
        payload: { fact: "Current Task fact", modality: "TEXT" },
        provenance: { test: "CAP-01", source: "current-task" },
        ruleVersion: "cap-01-test.1",
        actorUserId: fixture.learnerId,
      },
      {
        id: priorItemId,
        institutionId: SEED.institution,
        learnerProfileId: fixture.profileId,
        courseId: SEED.course,
        taskId: priorTaskId,
        episodeId: priorEpisodeId,
        kind: "TASK_FACT",
        scope: "TASK",
        payload: { fact: "Explicitly referenced prior fact", modality: "TEXT" },
        provenance: { test: "CAP-01", source: "prior-task" },
        ruleVersion: "cap-01-test.1",
        actorUserId: fixture.learnerId,
      },
      {
        id: teacherConstraintId,
        institutionId: SEED.institution,
        learnerProfileId: fixture.profileId,
        courseId: SEED.course,
        taskId: fixture.taskId,
        kind: "TEACHER_CONSTRAINT",
        scope: "TASK",
        payload: { constraint: "Require units in the learner response.", modality: "TEXT" },
        provenance: { test: "CAP-01", source: "authorized-teacher" },
        ruleVersion: "cap-01-test.1",
        actorUserId: teacher.userId,
      },
    ]);
    await getDb().insert(contextCarryoverRelations).values({
      id: carryoverId,
      institutionId: SEED.institution,
      sourceTaskId: priorTaskId,
      sourceContextItemId: priorItemId,
      targetTaskId: fixture.taskId,
      relationType: "EXPLICIT_REFERENCE",
      actorUserId: fixture.learnerId,
      reason: "The learner explicitly referenced this exact prior fact.",
    });

    await getDb().insert(sourceRecords).values({
      id: unavailableSourceId,
      institutionId: SEED.institution,
      courseId: SEED.course,
      sourceKey: `cap-01-rights-${unavailableSourceId}`,
      title: "Rights-unavailable Context fixture",
      sourceType: "INTERNAL_NOTE",
      version: "1",
      authority: "INTEGRATION_TEST",
      rights: "Requires review",
      rightsAuthorizationStatus: "REVIEW_REQUIRED",
      distributionScope: "INSTITUTION",
      allowedPurposes: ["LEARNING"],
      contentHash: `source-${unavailableSourceId}`,
    });
    await getDb().insert(evidenceUnits).values({
      id: unavailableEvidenceId,
      sourceId: unavailableSourceId,
      institutionId: SEED.institution,
      modality: "TEXT",
      locator: `cap-01#${unavailableEvidenceId}`,
      title: "Unavailable Evidence fixture",
      content: "This Evidence must be excluded until rights are approved.",
      searchDocument: "unavailable rights evidence",
      metadata: { test: "CAP-01" },
      contentHash: `evidence-${unavailableEvidenceId}`,
    });
    await getDb().insert(contextItems).values({
      id: unavailableContextId,
      institutionId: SEED.institution,
      learnerProfileId: fixture.profileId,
      courseId: SEED.course,
      taskId: fixture.taskId,
      kind: "EVIDENCE",
      scope: "TASK",
      payload: { evidence: "Rights-unavailable Evidence", modality: "TEXT" },
      provenance: { test: "CAP-01", source: "rights-unavailable" },
      ruleVersion: "cap-01-test.1",
      sourceRecordId: unavailableSourceId,
      evidenceUnitId: unavailableEvidenceId,
      actorUserId: fixture.learnerId,
    });
    await getDb().insert(conversationEvents).values({
      id: unavailableEventId,
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      actorUserId: fixture.learnerId,
      actorType: "LEARNER",
      kind: "MESSAGE",
      content: "This legacy-compatible Event references a Source whose rights are unresolved.",
      sourceRefs: [{ sourceId: unavailableSourceId, sourceVersion: "1", locator: "cap-01#legacy-event" }],
      evidenceRefs: [],
    });

    const first = await compileAuthorizedContext(fixture.actor, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "DIAGNOSIS",
    });
    const replay = await compileAuthorizedContext(fixture.actor, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "DIAGNOSIS",
    });

    expect(replay).toEqual(first);
    expect(first.selectedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `context-item:${directItemId}`, inclusionReason: "ACTIVE_EPISODE_SCOPE" }),
      expect.objectContaining({ id: `context-item:${priorItemId}`, inclusionReason: "EXPLICIT_CARRYOVER" }),
      expect.objectContaining({ id: `context-item:${teacherConstraintId}`, required: true }),
      expect.objectContaining({ id: `learner-strategy-version:${strategyId}`, inclusionReason: "CURRENT_LEARNER_STRATEGY" }),
    ]));
    expect(first.excludedItems).toContainEqual(expect.objectContaining({
      id: `context-item:${unavailableContextId}`,
      reason: "SOURCE_RIGHTS_UNAVAILABLE",
      truncated: false,
    }));
    expect(first.excludedItems).toContainEqual(expect.objectContaining({
      id: `conversation-event:${unavailableEventId}`,
      reason: "SOURCE_RIGHTS_UNAVAILABLE",
      truncated: false,
    }));
    expect(first.referencedPriorTaskIds).toEqual([priorTaskId]);
    expect(first.provenanceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "CONTEXT_ITEM", id: priorItemId }),
      expect.objectContaining({ type: "CONTEXT_CARRYOVER_RELATION", id: carryoverId }),
      expect.objectContaining({ type: "SOURCE_RECORD", id: unavailableSourceId }),
      expect.objectContaining({ type: "EVIDENCE_UNIT", id: unavailableEvidenceId }),
    ]));
    expect(await getDb().select().from(contextCompilations).where(eq(contextCompilations.id, first.id))).toHaveLength(1);

    const runtimeSnapshotId = randomUUID();
    const runtimeInputHash = `runtime-role:${runtimeSnapshotId}`;
    await getSql().begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
      await transaction`SELECT set_config('foundry.institution_id', ${SEED.institution}, true)`;
      await transaction`
        INSERT INTO foundry_product.context_compilations
          (id,task_id,episode_id,consumer,compiler_version,context_policy_version,input_hash,snapshot_hash,
           token_budget,modality_budget,tokenizer,selected_token_count,modality_usage,candidate_items,
           selected_items,excluded_items,provenance_refs,referenced_prior_task_ids)
        VALUES
          (${runtimeSnapshotId}::uuid,${first.activeTaskId}::uuid,${first.activeEpisodeId}::uuid,'CAPABILITY_RESOLUTION',
           ${first.compilerVersion},${first.contextPolicyVersion},${runtimeInputHash},${`runtime-role-snapshot:${runtimeSnapshotId}`},
           ${first.tokenBudget},${JSON.stringify(first.modalityBudget)}::jsonb,${first.tokenizer},${first.selectedTokenCount},
           ${JSON.stringify(first.modalityUsage)}::jsonb,${JSON.stringify(first.candidateItems)}::jsonb,
           ${JSON.stringify(first.selectedItems)}::jsonb,${JSON.stringify(first.excludedItems)}::jsonb,
           ${JSON.stringify(first.provenanceRefs)}::jsonb,${JSON.stringify(first.referencedPriorTaskIds)}::jsonb)
      `;
    });
    expect(await getDb().select().from(contextCompilations).where(eq(contextCompilations.id, runtimeSnapshotId))).toHaveLength(1);

    const tamperedCandidates = first.candidateItems.map((candidate, index) => index === 0
      ? { ...candidate, provenanceRefs: [{ type: "CONTEXT_ITEM", id: randomUUID() }] }
      : candidate);
    await expect(getSql().begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
      await transaction`SELECT set_config('foundry.institution_id', ${SEED.institution}, true)`;
      await transaction`
        INSERT INTO foundry_product.context_compilations
          (id,task_id,episode_id,consumer,compiler_version,context_policy_version,input_hash,snapshot_hash,
           token_budget,modality_budget,tokenizer,selected_token_count,modality_usage,candidate_items,
           selected_items,excluded_items,provenance_refs,referenced_prior_task_ids)
        VALUES
          (${randomUUID()}::uuid,${first.activeTaskId}::uuid,${first.activeEpisodeId}::uuid,'CAPABILITY_RESOLUTION',
           ${first.compilerVersion},${first.contextPolicyVersion},${`tampered:${randomUUID()}`},${`tampered:${randomUUID()}`},
           ${first.tokenBudget},${JSON.stringify(first.modalityBudget)}::jsonb,${first.tokenizer},${first.selectedTokenCount},
           ${JSON.stringify(first.modalityUsage)}::jsonb,${JSON.stringify(tamperedCandidates)}::jsonb,
           ${JSON.stringify(first.selectedItems)}::jsonb,${JSON.stringify(first.excludedItems)}::jsonb,
           ${JSON.stringify(first.provenanceRefs)}::jsonb,${JSON.stringify(first.referencedPriorTaskIds)}::jsonb)
      `;
    })).rejects.toMatchObject({ code: "23514" });

    const teacherSnapshot = await compileAuthorizedContext(teacher, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "RUNTIME_ORCHESTRATION",
    });
    expect(teacherSnapshot.consumer).toBe("RUNTIME_ORCHESTRATION");
    await expect(compileAuthorizedContext(engineer, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "DIAGNOSIS",
    })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });

    const wrongTenantActor: Actor = { ...fixture.actor, institutionId: randomUUID() };
    await expect(compileAuthorizedContext(wrongTenantActor, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "DIAGNOSIS",
    })).rejects.toMatchObject({ code: "TENANT_ISOLATION" });

    await expect(compileAuthorizedContext(fixture.actor, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "DIAGNOSIS",
      tokenBudget: 1,
    })).rejects.toMatchObject({ code: "CONTEXT_REQUIRED_ITEM_INELIGIBLE" });

    await getDb().insert(contextItems).values({
      institutionId: SEED.institution,
      learnerProfileId: fixture.profileId,
      courseId: SEED.course,
      taskId: fixture.taskId,
      kind: "TEACHER_CONSTRAINT",
      scope: "TASK",
      payload: { constraint: "This learner-authored row cannot acquire teacher authority." },
      provenance: { test: "CAP-01", source: "unauthorized-learner" },
      ruleVersion: "cap-01-test.1",
      actorUserId: fixture.learnerId,
    });
    await expect(compileAuthorizedContext(fixture.actor, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "RUNTIME_ORCHESTRATION",
    })).rejects.toMatchObject({ code: "CONTEXT_TEACHER_AUTHORITY" });
  });

  it("fails closed on missing scope and conflicting current strategy versions", async () => {
    const fixture = await createLearnerFixture("context-conflict");
    await getDb().insert(learnerStrategyVersions).values([
      {
        institutionId: SEED.institution,
        learnerProfileId: fixture.profileId,
        kind: "LANGUAGE_SUPPORT",
        strategy: { language: "en" },
        provenance: { test: "CAP-01", version: 1 },
        ruleVersion: "cap-01-test.1",
        actorUserId: fixture.learnerId,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        institutionId: SEED.institution,
        learnerProfileId: fixture.profileId,
        kind: "LANGUAGE_SUPPORT",
        strategy: { language: "zh" },
        provenance: { test: "CAP-01", version: 2 },
        ruleVersion: "cap-01-test.2",
        actorUserId: fixture.learnerId,
        effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);

    await expect(compileAuthorizedContext(fixture.actor, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "CAPABILITY_RESOLUTION",
    })).rejects.toMatchObject({ code: "CONTEXT_STRATEGY_VERSION_CONFLICT" });
    await expect(compileAuthorizedContext(fixture.actor, {
      taskId: randomUUID(),
      episodeId: randomUUID(),
      consumer: "DIAGNOSIS",
    })).rejects.toMatchObject({ code: "TASK_EPISODE_LINEAGE" });
  });

  it("rejects a teacher constraint whose actor has no authority in the Task course", async () => {
    const fixture = await createLearnerFixture("context-course-role");
    const unassignedTeacherId = randomUUID();
    await getDb().insert(users).values({
      id: unassignedTeacherId,
      email: `unassigned-teacher-${unassignedTeacherId}@integration.invalid`,
      name: "Unassigned teacher",
    });
    await getDb().insert(institutionMemberships).values({
      userId: unassignedTeacherId,
      institutionId: SEED.institution,
      role: "TEACHER",
    });
    await getDb().insert(contextItems).values({
      institutionId: SEED.institution,
      learnerProfileId: fixture.profileId,
      courseId: SEED.course,
      taskId: fixture.taskId,
      kind: "TEACHER_CONSTRAINT",
      scope: "TASK",
      payload: { constraint: "This actor is not assigned to the Task course." },
      provenance: { test: "CAP-01", source: "unassigned-teacher" },
      ruleVersion: "cap-01-test.1",
      actorUserId: unassignedTeacherId,
    });

    await expect(compileAuthorizedContext(fixture.actor, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "RUNTIME_ORCHESTRATION",
    })).rejects.toMatchObject({ code: "CONTEXT_TEACHER_AUTHORITY" });
  });

  it("fails closed when a compatibility Event names a conflicting Source version", async () => {
    const fixture = await createLearnerFixture("context-source-conflict");
    const sourceId = randomUUID();
    await getDb().insert(sourceRecords).values({
      id: sourceId,
      institutionId: SEED.institution,
      courseId: SEED.course,
      sourceKey: `cap-01-conflict-${sourceId}`,
      title: "Exact Source version fixture",
      sourceType: "INTERNAL_NOTE",
      version: "1",
      authority: "INTEGRATION_TEST",
      rights: "Test-only approved Source",
      rightsAuthorizationStatus: "APPROVED",
      distributionScope: "INSTITUTION",
      allowedPurposes: ["LEARNING"],
      contentHash: `source-conflict-${sourceId}`,
    });
    await getDb().insert(conversationEvents).values({
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      actorUserId: fixture.learnerId,
      actorType: "LEARNER",
      kind: "MESSAGE",
      content: "This reference falsely names a different version.",
      sourceRefs: [{ sourceId, sourceVersion: "2", locator: "cap-01#conflicting-version" }],
      evidenceRefs: [],
    });

    await expect(compileAuthorizedContext(fixture.actor, {
      taskId: fixture.taskId,
      episodeId: fixture.episodeId,
      consumer: "DIAGNOSIS",
    })).rejects.toMatchObject({ code: "CONTEXT_SOURCE_VERSION_CONFLICT" });
  });
});
