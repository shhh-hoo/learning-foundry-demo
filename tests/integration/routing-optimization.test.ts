import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getActor } from "@/application/actor";
import { planActivityForResolution } from "@/application/activity-planning";
import { executeAssetStage } from "@/application/asset-runtime";
import { resolveCapabilityForDiagnosis } from "@/application/capability-resolution";
import {
  createRoutingOptimizationProposal,
  decideRoutingOptimizationProposal,
  getRoutingOptimizationWorkspace,
} from "@/application/routing-optimization";
import { createTeacherAssignment, createTeacherIntervention } from "@/application/teacher-governance";
import { closeDb, getDb, getSql, withTenantDatabase } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  activityPlans,
  assetOptimizationProposals,
  capabilities,
  capabilityResolutions,
  capabilityVersions,
  componentVersions,
  courseEnrollments,
  diagnosticObservations,
  idempotencyKeys,
  institutionMemberships,
  learnerAttempts,
  learnerProfiles,
  learningOutcomes,
  routingOptimizationDecisions,
  routingOptimizationProposals,
  teacherReviews,
  users,
} from "@/db/schema";
import { closeWorkflowCheckpointer } from "@/workflows/checkpointer";

async function withRuntimeActor<T>(actor: Awaited<ReturnType<typeof getActor>>, operation: (transaction: Sql) => Promise<T>): Promise<T> {
  return getSql().begin(async (transaction) => {
    await transaction`
      SELECT set_config('foundry.institution_id',${actor.institutionId},true),
        set_config('foundry.user_id',${actor.userId},true),
        set_config('foundry.session_id',${actor.sessionId},true),
        set_config('foundry.auth_method',${actor.authMethod},true),
        set_config('foundry.roles',${actor.roles.join(",")},true),
        set_config('foundry.course_ids',${actor.courseIds.join(",")},true)
    `;
    await transaction.unsafe("SET LOCAL ROLE foundry_product_runtime");
    return operation(transaction as unknown as Sql);
  }) as Promise<T>;
}

async function people(label: string) {
  const teacherId = randomUUID();
  const learnerId = randomUUID();
  const profileId = randomUUID();
  await getDb().insert(users).values([
    { id: teacherId, email: `${label}-teacher-${teacherId}@cap08b.invalid`, name: `${label} teacher` },
    { id: learnerId, email: `${label}-learner-${learnerId}@cap08b.invalid`, name: `${label} learner` },
  ]);
  await getDb().insert(institutionMemberships).values([
    { userId: teacherId, institutionId: SEED.institution, role: "TEACHER" },
    { userId: learnerId, institutionId: SEED.institution, role: "LEARNER" },
  ]);
  await getDb().insert(courseEnrollments).values([
    { institutionId: SEED.institution, courseId: SEED.course, userId: teacherId, role: "TEACHER" },
    { institutionId: SEED.institution, courseId: SEED.course, userId: learnerId, role: "LEARNER" },
  ]);
  await getDb().insert(learnerProfiles).values({ id: profileId, institutionId: SEED.institution, learnerId, createdBy: learnerId });
  return {
    teacher: await getActor(teacherId, SEED.institution, "integration-test", `cap08b-teacher:${randomUUID()}`),
    learner: await getActor(learnerId, SEED.institution, "integration-test", `cap08b-learner:${randomUUID()}`),
    expert: await getActor(SEED.expert, SEED.institution, "integration-test", `cap08b-expert:${randomUUID()}`),
    teacherId,
    learnerId,
  };
}

async function questionedRoute(label: string, constraintCapabilityId: string = SEED.chemistryMolarConcentration) {
  const actors = await people(label);
  const assignment = await createTeacherAssignment(actors.teacher, {
    courseId: SEED.course,
    learnerId: actors.learnerId,
    title: `CAP-08B questioned route ${label}`,
    goal: "Complete one governed molar concentration activity with exact units.",
    instructions: "Use the current eligible concentration trainer and preserve exact route evidence.",
    completionRule: "Submit one complete structured Attempt.",
    requiredCapabilityIds: [],
    excludedCapabilityIds: [],
    idempotencyKey: `cap08b-assignment:${randomUUID()}`,
  });
  const sourceAttemptId = randomUUID();
  const diagnosisId = randomUUID();
  await getDb().insert(learnerAttempts).values({
    id: sourceAttemptId,
    taskId: assignment.taskId,
    episodeId: assignment.episodeId,
    learnerId: actors.learnerId,
    capabilityId: SEED.chemistryMolarConcentration,
    prompt: "Which governed activity should run?",
    response: "Use the exact molar concentration trainer.",
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
    summary: "The learner needs one molar concentration calculation activity.",
    structuredResult: { learningProblem: "calculate molar concentration from amount and volume", diagnosticClaim: true },
    inputLineage: { attemptId: sourceAttemptId, capabilityId: SEED.chemistryMolarConcentration },
    outputLineage: { capabilityVersionId: SEED.chemistryMolarConcentrationVersion, deterministic: true },
  });
  const resolution = await resolveCapabilityForDiagnosis(actors.learner, { taskId: assignment.taskId, episodeId: assignment.episodeId, diagnosticObservationId: diagnosisId });
  expect(resolution.selectedCapabilityId).toBe(SEED.chemistryMolarConcentration);
  const plan = await planActivityForResolution(actors.learner, { taskId: assignment.taskId, episodeId: assignment.episodeId, capabilityResolutionId: resolution.id });
  const runtime = await executeAssetStage(actors.learner, {
    taskId: assignment.taskId,
    episodeId: assignment.episodeId,
    activityPlanProposalId: plan.id,
    prompt: "Calculate concentration for 1 mol in 2 L.",
    response: "0.5 mol/L",
    structuredInput: { amount: { value: 1, unit: "mol" }, volume: { value: 2, unit: "L" }, learnerAnswer: 0.5, tolerance: 0.001 },
    modality: "STRUCTURED",
    idempotencyKey: `cap08b-runtime:${randomUUID()}`,
    deadlineMs: 1_000,
  });
  const intervention = await createTeacherIntervention(actors.teacher, {
    runtimeDeliveryId: runtime.delivery.id,
    actionType: "EXCLUDE_CAPABILITY",
    capabilityId: constraintCapabilityId,
    reason: constraintCapabilityId === resolution.selectedCapabilityId
      ? "Exclude this exact selected Capability next cycle; inspect whether this route should recur for comparable Context."
      : "Exclude a different Capability next cycle without questioning the delivered route.",
    idempotencyKey: `cap08b-intervention:${randomUUID()}`,
  });
  return { ...actors, assignment, diagnosisId, resolution, plan, runtime, intervention };
}

describe.sequential("CAP-08B PostgreSQL Routing Optimization", () => {
  afterAll(async () => {
    await closeWorkflowCheckpointer();
    await closeDb();
  });

  it("creates one exact evidence-bound proposal and append-only human next action without changing routing or learning authority", async () => {
    const fixture = await questionedRoute("governed");
    const [selectedCapabilityBaseline] = await getDb().select().from(capabilities).where(eq(capabilities.id, fixture.resolution.selectedCapabilityId!)).limit(1);
    const [selectedResolutionBaseline] = await getDb().select().from(capabilityResolutions).where(eq(capabilityResolutions.id, fixture.resolution.id)).limit(1);
    const baseline = {
      resolutions: (await getDb().select().from(capabilityResolutions)).length,
      plans: (await getDb().select().from(activityPlans)).length,
      componentVersions: (await getDb().select().from(componentVersions)).length,
      capabilityVersions: (await getDb().select().from(capabilityVersions)).length,
      reviews: (await getDb().select().from(teacherReviews)).length,
      outcomes: (await getDb().select().from(learningOutcomes)).length,
      assetProposals: (await getDb().select().from(assetOptimizationProposals)).length,
    };
    const keys = [`cap08b-proposal:${randomUUID()}`, `cap08b-proposal:${randomUUID()}`];
    const [first, concurrent] = await Promise.all(keys.map((idempotencyKey) => createRoutingOptimizationProposal(fixture.expert, {
      teacherInterventionId: fixture.intervention.intervention.id,
      idempotencyKey,
    })));
    expect(first.proposal.id).toBe(concurrent.proposal.id);
    expect(first.proposal).toMatchObject({
      proposalType: "ROUTING",
      signalKind: "TEACHER_EXCLUSION_OVERRIDE",
      contextCompilationId: fixture.intervention.intervention.contextCompilationId,
      diagnosticObservationId: fixture.diagnosisId,
      capabilityResolutionId: fixture.resolution.id,
      selectedCapabilityId: fixture.resolution.selectedCapabilityId,
      selectedCapabilityVersionId: fixture.resolution.selectedCapabilityVersionId,
      activityPlanId: fixture.runtime.delivery.activityPlanId,
      runtimeDeliveryId: fixture.runtime.delivery.id,
      learnerAttemptId: fixture.runtime.attempt.id,
      teacherInterventionId: fixture.intervention.intervention.id,
      state: "PENDING_GOVERNANCE",
    });
    expect(first.proposal.evidenceSnapshot).toMatchObject({
      capabilityResolution: {
        id: fixture.resolution.id,
        candidateSet: fixture.resolution.candidateSet,
        selectedCapabilityId: fixture.resolution.selectedCapabilityId,
        selectedCapabilityVersionId: fixture.resolution.selectedCapabilityVersionId,
      },
      learnerAttempt: { id: fixture.runtime.attempt.id, interpretation: "LINEAGE_ONLY_NOT_ROUTING_VERDICT" },
      teacherIntervention: { id: fixture.intervention.intervention.id, actionType: "EXCLUDE_CAPABILITY" },
      outcomeEvidenceUsed: false,
    });
    expect(first.proposal.proposedChange).toMatchObject({
      optimizationDomain: "ROUTING",
      currentPolicyRemainsActive: true,
      rankingChanged: false,
      eligibilityRuleChanged: false,
      automaticApproval: false,
    });

    const expertWorkspace = await getRoutingOptimizationWorkspace(fixture.expert);
    const teacherWorkspace = await getRoutingOptimizationWorkspace(fixture.teacher);
    expect(expertWorkspace.proposals.some((row) => row.proposal_id === first.proposal.id && row.source_current === true)).toBe(true);
    expect(teacherWorkspace.proposals.some((row) => row.proposal_id === first.proposal.id)).toBe(true);
    await expect(getRoutingOptimizationWorkspace(fixture.learner)).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    expect(await withRuntimeActor(fixture.learner, (transaction) => transaction`SELECT id FROM foundry_product.routing_optimization_proposals`)).toHaveLength(0);
    expect(await withRuntimeActor(fixture.expert, (transaction) => transaction`SELECT id FROM foundry_product.routing_optimization_proposals WHERE id=${first.proposal.id}::uuid`)).toHaveLength(1);
    await expect(createRoutingOptimizationProposal(fixture.learner, {
      teacherInterventionId: fixture.intervention.intervention.id,
      idempotencyKey: `cap08b-learner:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    await expect(createRoutingOptimizationProposal({ ...fixture.expert, institutionId: randomUUID(), courseIds: [] }, {
      teacherInterventionId: fixture.intervention.intervention.id,
      idempotencyKey: `cap08b-tenant:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "ROUTING_OPTIMIZATION_LINEAGE_NOT_FOUND" });

    await expect(withRuntimeActor(fixture.expert, async (transaction) => {
      const tamperedId = randomUUID();
      const tamperedRequestHash = `tampered:${randomUUID()}`;
      await transaction`
        INSERT INTO foundry_product.idempotency_keys(institution_id,key,command_type,request_hash,result_id,actor_user_id)
        VALUES (${fixture.expert.institutionId}::uuid,${`cap08b-tampered:${randomUUID()}`},'CREATE_ROUTING_OPTIMIZATION_PROPOSAL',${tamperedRequestHash},${tamperedId}::uuid,${fixture.expert.userId}::uuid)
      `;
      await transaction`
        INSERT INTO foundry_product.routing_optimization_proposals
          (id,institution_id,course_id,task_id,episode_id,context_compilation_id,context_snapshot_hash,
           diagnostic_observation_id,capability_resolution_id,capability_resolution_input_hash,
           selected_capability_id,selected_capability_version_id,selected_capability_version_content_hash,
           activity_plan_id,runtime_delivery_id,learner_attempt_id,learner_attempt_content_hash,teacher_intervention_id,
           proposal_type,signal_kind,rationale,proposed_change,evidence_snapshot,evidence_refs,evidence_hash,limitations,
           rule_key,rule_version,confidence,state,requested_by,requester_provenance,request_hash)
        SELECT ${tamperedId}::uuid,institution_id,course_id,task_id,episode_id,context_compilation_id,context_snapshot_hash,
          diagnostic_observation_id,capability_resolution_id,capability_resolution_input_hash,
          selected_capability_id,selected_capability_version_id,selected_capability_version_content_hash,
          activity_plan_id,runtime_delivery_id,learner_attempt_id,learner_attempt_content_hash,teacher_intervention_id,
          proposal_type,signal_kind,rationale,proposed_change,evidence_snapshot || '{"outcomeEvidenceUsed":true}'::jsonb,
          evidence_refs,evidence_hash,limitations,rule_key,rule_version,confidence,state,requested_by,requester_provenance,${tamperedRequestHash}
        FROM foundry_product.routing_optimization_proposals WHERE id=${first.proposal.id}::uuid
      `;
    })).rejects.toThrow(/evidence snapshot is not bound to the exact questioned route/);

    const decisionInput = {
      proposalId: first.proposal.id,
      action: "REQUEST_POLICY_REVIEW" as const,
      rationale: "Request a bounded policy-successor review while preserving the current ranking and exact historical route.",
      idempotencyKey: `cap08b-decision:${randomUUID()}`,
    };
    const decision = await decideRoutingOptimizationProposal(fixture.teacher, decisionInput);
    const replay = await decideRoutingOptimizationProposal(fixture.teacher, decisionInput);
    expect(replay).toMatchObject({ decision: { id: decision.decision.id }, replayed: true });
    await expect(decideRoutingOptimizationProposal(fixture.teacher, { ...decisionInput, action: "KEEP_CURRENT_POLICY" }))
      .rejects.toMatchObject({ code: "ROUTING_OPTIMIZATION_ALREADY_GOVERNED" });

    expect((await getDb().select().from(capabilityResolutions)).length).toBe(baseline.resolutions);
    expect((await getDb().select().from(activityPlans)).length).toBe(baseline.plans);
    expect((await getDb().select().from(componentVersions)).length).toBe(baseline.componentVersions);
    expect((await getDb().select().from(capabilityVersions)).length).toBe(baseline.capabilityVersions);
    expect((await getDb().select().from(capabilities).where(eq(capabilities.id, fixture.resolution.selectedCapabilityId!)))[0]).toEqual(selectedCapabilityBaseline);
    expect((await getDb().select().from(capabilityResolutions).where(eq(capabilityResolutions.id, fixture.resolution.id)))[0]).toEqual(selectedResolutionBaseline);
    expect((await getDb().select().from(teacherReviews)).length).toBe(baseline.reviews);
    expect((await getDb().select().from(learningOutcomes)).length).toBe(baseline.outcomes);
    expect((await getDb().select().from(assetOptimizationProposals)).length).toBe(baseline.assetProposals);
    expect(await getDb().select().from(routingOptimizationProposals).where(eq(routingOptimizationProposals.id, first.proposal.id))).toHaveLength(1);
    expect(await getDb().select().from(routingOptimizationDecisions).where(eq(routingOptimizationDecisions.proposalId, first.proposal.id))).toHaveLength(1);

    await expect(withTenantDatabase(fixture.expert, () => getDb().update(routingOptimizationProposals)
      .set({ state: "PENDING_GOVERNANCE" }).where(eq(routingOptimizationProposals.id, first.proposal.id))))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(withTenantDatabase(fixture.teacher, () => getDb().delete(routingOptimizationDecisions)
      .where(eq(routingOptimizationDecisions.id, decision.decision.id))))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(withTenantDatabase(fixture.expert, () => getDb().update(idempotencyKeys).set({ requestHash: first.proposal.requestHash })
      .where(and(eq(idempotencyKeys.commandType, "CREATE_ROUTING_OPTIMIZATION_PROPOSAL"), eq(idempotencyKeys.resultId, first.proposal.id)))))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
  });

  it("rejects a different-capability exclusion and preserves Attempt correctness as non-signal lineage", async () => {
    const different = await questionedRoute("different-capability", SEED.chemistrySolutionDilution);
    await expect(createRoutingOptimizationProposal(different.expert, {
      teacherInterventionId: different.intervention.intervention.id,
      idempotencyKey: `cap08b-different:${randomUUID()}`,
    })).rejects.toMatchObject({ code: "ROUTING_OPTIMIZATION_SIGNAL_INELIGIBLE" });

    const exact = await questionedRoute("attempt-correctness-independent");
    expect((exact.runtime.delivery.normalizedOutput as Record<string, unknown>).status).toBe("CORRECT");
    const proposal = await createRoutingOptimizationProposal(exact.expert, {
      teacherInterventionId: exact.intervention.intervention.id,
      idempotencyKey: `cap08b-correct-attempt:${randomUUID()}`,
    });
    expect(proposal.proposal.evidenceSnapshot).toMatchObject({ learnerAttempt: { interpretation: "LINEAGE_ONLY_NOT_ROUTING_VERDICT" } });
  });

  it("blocks a human next action when the exact teacher constraint is superseded", async () => {
    const fixture = await questionedRoute("stale");
    const proposal = await createRoutingOptimizationProposal(fixture.expert, {
      teacherInterventionId: fixture.intervention.intervention.id,
      idempotencyKey: `cap08b-stale-proposal:${randomUUID()}`,
    });
    await createTeacherIntervention(fixture.teacher, {
      runtimeDeliveryId: fixture.runtime.delivery.id,
      actionType: "REQUIRE_CAPABILITY",
      capabilityId: fixture.resolution.selectedCapabilityId!,
      reason: "Supersede the exclusion with a current exact teacher requirement.",
      idempotencyKey: `cap08b-stale-intervention:${randomUUID()}`,
    });
    await expect(decideRoutingOptimizationProposal(fixture.teacher, {
      proposalId: proposal.proposal.id,
      action: "KEEP_CURRENT_POLICY",
      rationale: "This stale source must fail rather than record a current-policy decision.",
      idempotencyKey: `cap08b-stale-decision:${randomUUID()}`,
    })).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    const workspace = await getRoutingOptimizationWorkspace(fixture.expert);
    expect(workspace.proposals.find((row) => row.proposal_id === proposal.proposal.id)?.source_current).toBe(false);
  });
});
