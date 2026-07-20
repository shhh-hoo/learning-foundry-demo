import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getActor } from "@/application/actor";
import { executeAssetStage } from "@/application/asset-runtime";
import { planActivityForResolution } from "@/application/activity-planning";
import { resolveCapabilityForDiagnosis } from "@/application/capability-resolution";
import { compileAuthorizedContext } from "@/application/context-service";
import { createTeacherAssignment, createTeacherIntervention } from "@/application/teacher-governance";
import { closeDb, getDb, withTenantDatabase } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  activityPlans,
  contextCompilations,
  courseEnrollments,
  courses,
  diagnosticObservations,
  institutionMemberships,
  institutions,
  learnerAttempts,
  learnerProfiles,
  learningEpisodes,
  learningEvents,
  learningTasks,
  runtimeDeliveries,
  subjects,
  teacherAssignments,
  teacherCapabilityConstraints,
  teacherInterventions,
  users,
} from "@/db/schema";
import type { TeacherAssignmentCommand } from "@/domain/teacher-governance";
import { getAssetRuntimeAdapter } from "@/reference-packs/capability-runtime";
import { buildAssetRuntimeGraph } from "@/workflows/asset-runtime";
import { closeWorkflowCheckpointer, getWorkflowCheckpointer } from "@/workflows/checkpointer";

async function teacherAndLearner(label: string, institutionId: string = SEED.institution, courseId: string = SEED.course) {
  const teacherId = randomUUID();
  const learnerId = randomUUID();
  const profileId = randomUUID();
  await getDb().insert(users).values([
    { id: teacherId, email: `${label}-teacher-${teacherId}@cap05.invalid`, name: `${label} teacher` },
    { id: learnerId, email: `${label}-learner-${learnerId}@cap05.invalid`, name: `${label} learner` },
  ]);
  await getDb().insert(institutionMemberships).values([
    { userId: teacherId, institutionId, role: "TEACHER" },
    { userId: learnerId, institutionId, role: "LEARNER" },
  ]);
  await getDb().insert(courseEnrollments).values([
    { institutionId, courseId, userId: teacherId, role: "TEACHER" },
    { institutionId, courseId, userId: learnerId, role: "LEARNER" },
  ]);
  await getDb().insert(learnerProfiles).values({ id: profileId, institutionId, learnerId, createdBy: learnerId });
  return {
    teacherId,
    learnerId,
    profileId,
    teacher: await getActor(teacherId, institutionId, "integration-test", `cap05-teacher:${randomUUID()}`),
    learner: await getActor(learnerId, institutionId, "integration-test", `cap05-learner:${randomUUID()}`),
  };
}

function assignmentInput(courseId: string, learnerId: string, idempotencyKey: string, dueAt?: string): TeacherAssignmentCommand {
  return {
    courseId,
    learnerId,
    title: "Teacher-assigned concentration Task",
    goal: "Complete one governed concentration learning activity.",
    instructions: "Show the numerical method and include units.",
    completionRule: "Submit one complete learner Attempt with units.",
    dueAt,
    requiredCapabilityIds: [],
    excludedCapabilityIds: [],
    idempotencyKey,
  };
}

async function completedRuntime(label: string) {
  const people = await teacherAndLearner(label);
  const assignment = await createTeacherAssignment(people.teacher, assignmentInput(SEED.course, people.learnerId, `cap05-runtime:${randomUUID()}`));
  const sourceAttemptId = randomUUID();
  const diagnosisId = randomUUID();
  await getDb().insert(learnerAttempts).values({
    id: sourceAttemptId,
    taskId: assignment.taskId,
    episodeId: assignment.episodeId,
    learnerId: people.learnerId,
    capabilityId: SEED.chemistryMolarConcentration,
    prompt: "What is the molar concentration?",
    response: "I need a governed concentration activity.",
    structuredInput: { responseType: "NATURAL_ATTEMPT" },
    sourceRefs: [],
  });
  await getDb().insert(diagnosticObservations).values({
    id: diagnosisId,
    attemptId: sourceAttemptId,
    capabilityVersionId: SEED.chemistryMolarConcentrationVersion,
    observationSource: "CAPABILITY",
    status: "NEEDS_REVIEW",
    failureCode: "NUMERIC_MISMATCH",
    firstInvalidStep: "FINAL_NUMERIC_COMPARISON",
    summary: "The learner needs a molar concentration calculation activity.",
    structuredResult: { learningProblem: "calculate molar concentration from amount and volume", diagnosticClaim: true },
    inputLineage: { attemptId: sourceAttemptId, capabilityId: SEED.chemistryMolarConcentration },
    outputLineage: { capabilityVersionId: SEED.chemistryMolarConcentrationVersion, deterministic: true },
  });
  const resolution = await resolveCapabilityForDiagnosis(people.learner, { taskId: assignment.taskId, episodeId: assignment.episodeId, diagnosticObservationId: diagnosisId });
  const proposal = await planActivityForResolution(people.learner, { taskId: assignment.taskId, episodeId: assignment.episodeId, capabilityResolutionId: resolution.id });
  expect(proposal.state).toBe("READY");
  const runtime = await executeAssetStage(people.learner, {
    taskId: assignment.taskId,
    episodeId: assignment.episodeId,
    activityPlanProposalId: proposal.id,
    prompt: "Calculate concentration for 1 mol in 2 L.",
    response: "0.5 mol/L",
    structuredInput: { amount: { value: 1, unit: "mol" }, volume: { value: 2, unit: "L" }, learnerAnswer: 0.5, tolerance: 0.001 },
    modality: "STRUCTURED",
    idempotencyKey: `cap05-runtime-delivery:${randomUUID()}`,
    deadlineMs: 1_000,
  });
  return { ...people, assignment, diagnosisId, resolution, proposal, runtime };
}

async function runningRuntime(label: string) {
  const people = await teacherAndLearner(label);
  const assignment = await createTeacherAssignment(people.teacher, assignmentInput(SEED.course, people.learnerId, `cap05-running:${randomUUID()}`));
  const sourceAttemptId = randomUUID();
  const diagnosisId = randomUUID();
  await getDb().insert(learnerAttempts).values({ id: sourceAttemptId, taskId: assignment.taskId, episodeId: assignment.episodeId, learnerId: people.learnerId, capabilityId: SEED.chemistryMolarConcentration, prompt: "Concentration support", response: "Start a new activity.", structuredInput: {}, sourceRefs: [] });
  await getDb().insert(diagnosticObservations).values({
    id: diagnosisId, attemptId: sourceAttemptId, capabilityVersionId: SEED.chemistryMolarConcentrationVersion,
    observationSource: "CAPABILITY", status: "NEEDS_REVIEW", failureCode: "NUMERIC_MISMATCH",
    summary: "The learner needs a molar concentration calculation activity.",
    structuredResult: { learningProblem: "calculate molar concentration from amount and volume" },
    inputLineage: { attemptId: sourceAttemptId }, outputLineage: { capabilityVersionId: SEED.chemistryMolarConcentrationVersion },
  });
  const resolution = await resolveCapabilityForDiagnosis(people.learner, { taskId: assignment.taskId, episodeId: assignment.episodeId, diagnosticObservationId: diagnosisId });
  const proposal = await planActivityForResolution(people.learner, { taskId: assignment.taskId, episodeId: assignment.episodeId, capabilityResolutionId: resolution.id });
  const request = {
    taskId: assignment.taskId, episodeId: assignment.episodeId, activityPlanProposalId: proposal.id,
    prompt: "Calculate concentration for 1 mol in 2 L.", response: "0.5 mol/L",
    structuredInput: { amount: { value: 1, unit: "mol" }, volume: { value: 2, unit: "L" }, learnerAnswer: 0.5, tolerance: 0.001 },
    modality: "STRUCTURED" as const, idempotencyKey: `cap05-running-delivery:${randomUUID()}`, deadlineMs: 1_000,
  };
  await expect(buildAssetRuntimeGraph(getWorkflowCheckpointer(people.learner.institutionId), {
    getAdapter: getAssetRuntimeAdapter,
    afterDeliveryStarted() { throw new Error("CAP05_LEAVE_RUNNING"); },
  }).invoke({ actor: people.learner, ...request }, { configurable: { thread_id: `${people.learner.institutionId}:cap05-running:${randomUUID()}` }, recursionLimit: 50 }))
    .rejects.toThrow("CAP05_LEAVE_RUNNING");
  const [delivery] = await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.idempotencyKey, request.idempotencyKey));
  expect(delivery.status).toBe("RUNNING");
  return { ...people, assignment, delivery };
}

describe.sequential("CAP-05 PostgreSQL teacher assignment and intervention", () => {
  afterAll(async () => {
    await closeWorkflowCheckpointer();
    await closeDb();
  });

  it("scopes assignment replay to tenant/teacher, survives deadline expiry, and denies revoked authority/direct wrong lineage", async () => {
    const people = await teacherAndLearner("assignment");
    const key = `shared-raw-key:${randomUUID()}`;
    const input = {
      ...assignmentInput(SEED.course, people.learnerId, key, new Date(Date.now() + 80).toISOString()),
      requiredCapabilityIds: [SEED.chemistryMolarConcentration],
    };
    const first = await createTeacherAssignment(people.teacher, input);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const replay = await createTeacherAssignment(people.teacher, input);
    expect(replay).toMatchObject({ taskId: first.taskId, episodeId: first.episodeId, replayed: true });
    expect(await getDb().select().from(teacherAssignments).where(eq(teacherAssignments.id, first.assignment.id))).toHaveLength(1);
    await expect(createTeacherAssignment(people.teacher, { ...input, goal: "Changed replay content must fail." }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });

    const laterEpisodeId = randomUUID();
    await getDb().insert(learningEpisodes).values({ id: laterEpisodeId, taskId: first.taskId, sequence: 2 });
    const firstConstraint = first.constraints[0]!;
    const forgedItem = {
      id: `teacher-capability-constraint:${firstConstraint.id}`,
      institutionId: SEED.institution, courseId: SEED.course, learnerProfileId: people.profileId,
      taskId: first.taskId, episodeId: laterEpisodeId, kind: "CAPABILITY_REQUIREMENT", scope: "EPISODE", state: "ACTIVE",
      content: "forged cross-Episode provenance", payload: { requiredCapabilityKey: firstConstraint.capabilityKeySnapshot, capabilityId: firstConstraint.capabilityId },
      provenanceRefs: [
        { type: "CAPABILITY_CONSTRAINT", id: firstConstraint.id },
        { type: "TEACHER_ASSIGNMENT", id: first.assignment.id },
        { type: "ACTOR", id: people.teacherId },
      ],
    };
    await expect(withTenantDatabase(people.learner, () => getDb().insert(contextCompilations).values({
      id: randomUUID(), taskId: first.taskId, episodeId: laterEpisodeId, consumer: "CAPABILITY_RESOLUTION",
      compilerVersion: "cap05-forgery", contextPolicyVersion: "cap05-forgery", inputHash: `sha256:${randomUUID()}`,
      snapshotHash: `sha256:${randomUUID()}`, tokenBudget: 100, modalityBudget: { TEXT: 4 }, tokenizer: "o200k_base",
      selectedTokenCount: 1, modalityUsage: { TEXT: 1 }, candidateItems: [forgedItem], selectedItems: [forgedItem],
      excludedItems: [], provenanceRefs: forgedItem.provenanceRefs, referencedPriorTaskIds: [],
    }))).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    const forgedReasonItem = {
      ...forgedItem,
      episodeId: first.episodeId,
      content: "fabricated teacher explanation",
      payload: {
        requiredCapabilityKey: firstConstraint.capabilityKeySnapshot,
        capabilityId: firstConstraint.capabilityId,
        reason: "A fabricated reason not recorded by the teacher.",
      },
    };
    await expect(withTenantDatabase(people.learner, () => getDb().insert(contextCompilations).values({
      id: randomUUID(), taskId: first.taskId, episodeId: first.episodeId, consumer: "RUNTIME_ORCHESTRATION",
      compilerVersion: "cap05-forged-reason", contextPolicyVersion: "cap05-forged-reason", inputHash: `sha256:${randomUUID()}`,
      snapshotHash: `sha256:${randomUUID()}`, tokenBudget: 100, modalityBudget: { TEXT: 4 }, tokenizer: "o200k_base",
      selectedTokenCount: 1, modalityUsage: { TEXT: 1 }, candidateItems: [forgedReasonItem], selectedItems: [forgedReasonItem],
      excludedItems: [], provenanceRefs: forgedReasonItem.provenanceRefs, referencedPriorTaskIds: [],
    }))).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(withTenantDatabase(people.teacher, () => getDb().insert(teacherCapabilityConstraints).values({
      id: randomUUID(), institutionId: SEED.institution, courseId: SEED.course, taskId: first.taskId,
      episodeId: laterEpisodeId, teacherId: people.teacherId, effect: "EXCLUDE",
      capabilityId: SEED.chemistrySolutionDilution, capabilityKeySnapshot: "chemistry-solution-dilution",
      reason: "Wrong Episode source must be denied.", sourceAssignmentId: first.assignment.id,
    }))).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(withTenantDatabase(people.teacher, () => getDb().insert(teacherCapabilityConstraints).values({
      id: randomUUID(), institutionId: SEED.institution, courseId: SEED.course, taskId: first.taskId,
      episodeId: first.episodeId, teacherId: people.teacherId, effect: "EXCLUDE",
      capabilityId: SEED.chemistryIdealGasMoles, capabilityKeySnapshot: "chemistry-ideal-gas-moles",
      reason: "A fabricated Assignment-sourced reason must be denied.", sourceAssignmentId: first.assignment.id,
    }))).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });

    await getDb().delete(courseEnrollments).where(eq(courseEnrollments.userId, people.teacherId));
    const refreshedTeacher = await getActor(people.teacherId, SEED.institution, "integration-test", `cap05-revoked:${randomUUID()}`);
    await expect(createTeacherAssignment(refreshedTeacher, input)).rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    await expect(withTenantDatabase(people.teacher, () => getDb().insert(teacherCapabilityConstraints).values({
      id: randomUUID(), institutionId: SEED.institution, courseId: SEED.course, taskId: first.taskId,
      episodeId: first.episodeId, teacherId: people.teacherId, effect: "EXCLUDE",
      capabilityId: SEED.chemistryIdealGasMoles, capabilityKeySnapshot: "chemistry-ideal-gas-moles",
      reason: `Excluded by teacher assignment: ${input.instructions}`, sourceAssignmentId: first.assignment.id,
    }))).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });

    const otherInstitutionId = randomUUID();
    const otherSubjectId = randomUUID();
    const otherCourseId = randomUUID();
    await getDb().insert(institutions).values({ id: otherInstitutionId, slug: `cap05-${otherInstitutionId}`, name: "CAP-05 other institution" });
    await getDb().insert(subjects).values({ id: otherSubjectId, institutionId: otherInstitutionId, key: `cap05-${otherSubjectId}`, name: "CAP-05 chemistry", referencePackKey: "chemistry-caie-9701" });
    await getDb().insert(courses).values({ id: otherCourseId, institutionId: otherInstitutionId, subjectId: otherSubjectId, code: `C${otherCourseId.slice(0, 6)}`, name: "CAP-05 other course" });
    const otherPeople = await teacherAndLearner("other-tenant", otherInstitutionId, otherCourseId);
    const other = await createTeacherAssignment(otherPeople.teacher, assignmentInput(otherCourseId, otherPeople.learnerId, key));
    expect(other.assignment.id).not.toBe(first.assignment.id);
    await expect(createTeacherAssignment(otherPeople.teacher, assignmentInput(SEED.course, people.learnerId, `cap05-cross-tenant:${randomUUID()}`)))
      .rejects.toMatchObject({ code: "TENANT_ISOLATION" });
  });

  it("carries non-empty assignment constraints into the Episode Context and Capability Resolution", async () => {
    const people = await teacherAndLearner("assignment-constraints");
    const assigned = await createTeacherAssignment(people.teacher, {
      ...assignmentInput(SEED.course, people.learnerId, `cap05-assignment-constraints:${randomUUID()}`),
      requiredCapabilityIds: [SEED.chemistryMolarConcentration],
      excludedCapabilityIds: [SEED.chemistrySolutionDilution],
    });
    expect(assigned.constraints.map((constraint) => constraint.effect).sort()).toEqual(["EXCLUDE", "REQUIRE"]);
    const sourceAttemptId = randomUUID();
    const diagnosisId = randomUUID();
    await getDb().insert(learnerAttempts).values({ id: sourceAttemptId, taskId: assigned.taskId, episodeId: assigned.episodeId, learnerId: people.learnerId, capabilityId: SEED.chemistryMolarConcentration, prompt: "Concentration problem", response: "I need support.", structuredInput: {}, sourceRefs: [] });
    await getDb().insert(diagnosticObservations).values({
      id: diagnosisId, attemptId: sourceAttemptId, capabilityVersionId: SEED.chemistryMolarConcentrationVersion,
      observationSource: "CAPABILITY", status: "NEEDS_REVIEW", failureCode: "NUMERIC_MISMATCH",
      summary: "The learner needs a molar concentration calculation activity.",
      structuredResult: { learningProblem: "calculate molar concentration from amount and volume" },
      inputLineage: { attemptId: sourceAttemptId }, outputLineage: { capabilityVersionId: SEED.chemistryMolarConcentrationVersion },
    });
    const context = await compileAuthorizedContext(people.learner, { taskId: assigned.taskId, episodeId: assigned.episodeId, consumer: "CAPABILITY_RESOLUTION" });
    expect(context.selectedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "CAPABILITY_REQUIREMENT", payload: expect.objectContaining({ requiredCapabilityKey: "chemistry-molar-concentration" }) }),
      expect.objectContaining({ kind: "CAPABILITY_EXCLUSION", payload: expect.objectContaining({ excludedCapabilityKey: "chemistry-solution-dilution" }) }),
    ]));
    const resolution = await resolveCapabilityForDiagnosis(people.learner, { taskId: assigned.taskId, episodeId: assigned.episodeId, diagnosticObservationId: diagnosisId });
    expect(resolution.selectedCapabilityId).toBe(SEED.chemistryMolarConcentration);
    expect(resolution.candidateSet).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityKey: "chemistry-solution-dilution", exclusionReasons: expect.arrayContaining(["TEACHER_EXCLUDED"]) })]));
  });

  it("records exact immutable interventions, changes the next Context/Resolution/Plan, and replays after mutable closure", async () => {
    const fixture = await completedRuntime("intervention");
    const deliveryId = fixture.runtime.delivery.id;
    const historicalBefore = {
      plan: await getDb().select().from(activityPlans).where(eq(activityPlans.id, fixture.runtime.delivery.activityPlanId)),
      delivery: await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.id, deliveryId)),
      attempt: await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, deliveryId)),
      events: await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, deliveryId)),
      diagnosis: await getDb().select().from(diagnosticObservations).where(eq(diagnosticObservations.id, fixture.diagnosisId)),
    };
    const requireInput = {
      runtimeDeliveryId: deliveryId,
      actionType: "REQUIRE_CAPABILITY" as const,
      capabilityId: SEED.chemistryMolarConcentration,
      reason: "Require the exact concentration Capability for the next cycle.",
      idempotencyKey: `cap05-require:${randomUUID()}`,
    };
    const required = await createTeacherIntervention(fixture.teacher, requireInput);
    expect(required.intervention.targetLineage).toMatchObject({ runtimeDeliveryId: deliveryId, learnerAttemptId: fixture.runtime.attempt.id, diagnosticObservationId: fixture.diagnosisId });
    const requiredContext = await compileAuthorizedContext(fixture.learner, { taskId: fixture.assignment.taskId, episodeId: fixture.assignment.episodeId, consumer: "CAPABILITY_RESOLUTION" });
    expect(requiredContext.selectedItems).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "CAPABILITY_REQUIREMENT", scope: "EPISODE",
      payload: expect.objectContaining({ requiredCapabilityKey: "chemistry-molar-concentration" }),
    })]));
    const requiredResolution = await resolveCapabilityForDiagnosis(fixture.learner, { taskId: fixture.assignment.taskId, episodeId: fixture.assignment.episodeId, diagnosticObservationId: fixture.diagnosisId });
    expect(requiredResolution.selectedCapabilityId).toBe(SEED.chemistryMolarConcentration);
    const requiredPlan = await planActivityForResolution(fixture.learner, { taskId: fixture.assignment.taskId, episodeId: fixture.assignment.episodeId, capabilityResolutionId: requiredResolution.id });
    expect(requiredPlan.teacherConstraints).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "CAPABILITY_REQUIREMENT" })]));

    await createTeacherIntervention(fixture.teacher, {
      runtimeDeliveryId: deliveryId,
      actionType: "EXCLUDE_CAPABILITY",
      capabilityId: SEED.chemistryMolarConcentration,
      reason: "Exclude the prior Capability and request a bounded next-cycle replan.",
      idempotencyKey: `cap05-exclude:${randomUUID()}`,
    });
    const excludedContext = await compileAuthorizedContext(fixture.learner, { taskId: fixture.assignment.taskId, episodeId: fixture.assignment.episodeId, consumer: "CAPABILITY_RESOLUTION" });
    expect(excludedContext.selectedItems).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "CAPABILITY_EXCLUSION", payload: expect.objectContaining({ excludedCapabilityKey: "chemistry-molar-concentration" }),
    })]));
    expect(excludedContext.excludedItems).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "CAPABILITY_REQUIREMENT", exclusionReason: "SUPERSEDED_FACT",
    })]));
    const excludedResolution = await resolveCapabilityForDiagnosis(fixture.learner, { taskId: fixture.assignment.taskId, episodeId: fixture.assignment.episodeId, diagnosticObservationId: fixture.diagnosisId });
    expect(excludedResolution.candidateSet).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityKey: "chemistry-molar-concentration", exclusionReasons: expect.arrayContaining(["TEACHER_EXCLUDED"]) })]));
    const excludedPlan = await planActivityForResolution(fixture.learner, { taskId: fixture.assignment.taskId, episodeId: fixture.assignment.episodeId, capabilityResolutionId: excludedResolution.id });
    expect(excludedPlan.teacherConstraints).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "CAPABILITY_EXCLUSION" })]));

    await getDb().update(learningTasks).set({ status: "CLOSED" }).where(eq(learningTasks.id, fixture.assignment.taskId));
    const replay = await createTeacherIntervention(fixture.teacher, requireInput);
    expect(replay).toMatchObject({ replayed: true, intervention: { id: required.intervention.id } });
    await expect(createTeacherIntervention(fixture.teacher, { ...requireInput, idempotencyKey: `cap05-closed:${randomUUID()}` }))
      .rejects.toMatchObject({ code: "INTERVENTION_TARGET_TERMINAL" });

    expect(await getDb().select().from(activityPlans).where(eq(activityPlans.id, fixture.runtime.delivery.activityPlanId))).toEqual(historicalBefore.plan);
    expect(await getDb().select().from(runtimeDeliveries).where(eq(runtimeDeliveries.id, deliveryId))).toEqual(historicalBefore.delivery);
    expect(await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.runtimeDeliveryId, deliveryId))).toEqual(historicalBefore.attempt);
    expect(await getDb().select().from(learningEvents).where(eq(learningEvents.runtimeDeliveryId, deliveryId))).toEqual(historicalBefore.events);
    expect(await getDb().select().from(diagnosticObservations).where(eq(diagnosticObservations.id, fixture.diagnosisId))).toEqual(historicalBefore.diagnosis);
    await getDb().delete(courseEnrollments).where(eq(courseEnrollments.userId, fixture.teacherId));
    const revokedTeacher = await getActor(fixture.teacherId, SEED.institution, "integration-test", `cap05-revoked-intervention:${randomUUID()}`);
    await expect(createTeacherIntervention(revokedTeacher, requireInput)).rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    await expect(withTenantDatabase(fixture.teacher, () => getDb().update(teacherInterventions).set({ reason: "rewritten" }).where(eq(teacherInterventions.id, required.intervention.id))))
      .rejects.toBeTruthy();
    await expect(withTenantDatabase(fixture.teacher, () => getDb().update(teacherCapabilityConstraints).set({ reason: "rewritten" }).where(eq(teacherCapabilityConstraints.id, required.constraint.id))))
      .rejects.toBeTruthy();
  });

  it("rejects an intervention against an actual non-terminal RuntimeDelivery", async () => {
    const fixture = await runningRuntime("non-terminal");
    await expect(createTeacherIntervention(fixture.teacher, {
      runtimeDeliveryId: fixture.delivery.id,
      actionType: "REQUIRE_CAPABILITY",
      capabilityId: SEED.chemistryMolarConcentration,
      reason: "A RUNNING delivery cannot receive this intervention.",
      idempotencyKey: `cap05-non-terminal:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "INTERVENTION_DELIVERY_NOT_TERMINAL" });
    expect(await getDb().select().from(teacherInterventions).where(eq(teacherInterventions.runtimeDeliveryId, fixture.delivery.id))).toEqual([]);
  });

  it("keeps CAP-05 command authority teacher-only in both application and database layers", async () => {
    const adminId = randomUUID();
    await getDb().insert(users).values({ id: adminId, email: `${adminId}@cap05-admin.invalid`, name: "CAP-05 admin" });
    await getDb().insert(institutionMemberships).values({ userId: adminId, institutionId: SEED.institution, role: "ADMIN" });
    await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: adminId, role: "ADMIN" });
    const admin = await getActor(adminId, SEED.institution, "integration-test", `cap05-admin:${randomUUID()}`);
    await expect(createTeacherAssignment(admin, assignmentInput(SEED.course, SEED.learner, `cap05-admin:${randomUUID()}`)))
      .rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    await expect(createTeacherIntervention(admin, { runtimeDeliveryId: randomUUID(), actionType: "REQUIRE_CAPABILITY", capabilityId: SEED.chemistryMolarConcentration, reason: "Admin must not command.", idempotencyKey: `cap05-admin-intervention:${randomUUID()}` }))
      .rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    await expect(withTenantDatabase(admin, () => getDb().insert(teacherAssignments).values({
      id: randomUUID(), institutionId: SEED.institution, courseId: SEED.course, learnerId: SEED.learner,
      taskId: SEED.task, teacherId: adminId, instructions: "Admin must not assign.", completionRule: "Denied.",
      actorProvenance: { userId: adminId, institutionId: SEED.institution, roles: ["ADMIN"], authMethod: "integration-test", sessionId: admin.sessionId, authenticatedAt: new Date().toISOString() },
      idempotencyKey: `cap05-admin-direct:${randomUUID()}`,
    }))).rejects.toBeTruthy();
  });
});
