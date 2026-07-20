import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getActor } from "@/application/actor";
import { resolveCapabilityForDiagnosis } from "@/application/capability-resolution";
import { planActivityForResolution } from "@/application/activity-planning";
import { closeDb, getDb } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  capabilities,
  activityPlanProposals,
  capabilityResolutions,
  capabilityVersions,
  contextCompilations,
  contextItems,
  courseEnrollments,
  courses,
  diagnosticObservations,
  institutionMemberships,
  institutions,
  learnerAttempts,
  learnerProfiles,
  learningEpisodes,
  learningTasks,
  subjects,
  users,
} from "@/db/schema";

function resolutionContract(input: {
  key: string;
  institutionIds?: string[];
  rights?: "AVAILABLE" | "BLOCKED";
  dependency?: { key: string; status: "AVAILABLE" | "UNAVAILABLE" };
  provider?: { key: string; status: "AVAILABLE" | "UNAVAILABLE" };
  contraindications?: string[];
  exactMatchSignals?: string[];
}) {
  return {
    resolution: {
      contractType: "CALLABLE_LEARNING_CAPABILITY",
      verified: true,
      learningProblem: "repair target skill",
      exactMatchSignals: input.exactMatchSignals ?? [input.key, "target-skill"],
      eligibility: {
        learnerLevels: ["BEGINNER"],
        taskTypes: ["REPAIR_MISCONCEPTION"],
        curricula: ["TEST"],
        languages: ["en"],
        accessibility: ["keyboard"],
        prerequisites: ["foundation"],
        contraindications: input.contraindications ?? [],
      },
      availability: {
        status: "AVAILABLE",
        institutionIds: input.institutionIds ?? [],
        courseIds: [],
        rights: input.rights ?? "AVAILABLE",
        dependencies: input.dependency ? [input.dependency] : [],
        provider: input.provider ?? null,
      },
      parameterization: { supported: false, signals: [], recommendation: {} },
      composition: { supported: false, contributes: [] },
      adaptation: { reviewed: false, signals: [] },
      runtime: {
        kind: "TEST_DETERMINISTIC_ADAPTER",
        input: { type: "object" },
        parameters: { type: "object" },
        state: { mode: "STATELESS" },
        output: { type: "object" },
        events: ["ATTEMPT"],
      },
    },
  };
}

describe.sequential("CAP-02 PostgreSQL Diagnosis-driven Capability Resolution", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("persists complete candidates, constraints, exact version and replay identity without executing an asset", async () => {
    const learnerId = randomUUID();
    const profileId = randomUUID();
    const taskId = randomUUID();
    const episodeId = randomUUID();
    const attemptId = randomUUID();
    const observationId = randomUUID();
    await getDb().insert(users).values({ id: learnerId, email: `cap02-${learnerId}@integration.invalid`, name: "CAP-02 learner" });
    await getDb().insert(institutionMemberships).values({ userId: learnerId, institutionId: SEED.institution, role: "LEARNER" });
    await getDb().insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: learnerId, role: "LEARNER" });
    await getDb().insert(learnerProfiles).values({ id: profileId, institutionId: SEED.institution, learnerId, createdBy: learnerId });
    await getDb().insert(learningTasks).values({
      id: taskId,
      institutionId: SEED.institution,
      courseId: SEED.course,
      learnerId,
      learnerProfileId: profileId,
      title: "CAP-02 exact resolution",
      goal: "Repair target skill after the current numeric mismatch.",
    });
    await getDb().insert(learningEpisodes).values({ id: episodeId, taskId, sequence: 1 });

    const addCapability = async (label: string, options: Parameters<typeof resolutionContract>[0] & { status?: string; active?: boolean }) => {
      const capabilityId = randomUUID();
      const versionId = randomUUID();
      const key = `cap02-${label}-${capabilityId}`;
      const contentHash = `cap02-${label}-${versionId}`;
      await getDb().insert(capabilities).values({
        id: capabilityId,
        key,
        name: `CAP-02 ${label}`,
        referencePackKey: "chemistry-caie-9701",
        kind: "DETERMINISTIC_ADAPTER",
        activeVersionId: options.active === false ? null : versionId,
      });
      await getDb().insert(capabilityVersions).values({
        id: versionId,
        capabilityId,
        version: "2.0.0",
        contract: resolutionContract({ ...options, key }),
        implementationKey: `cap02.${label}`,
        status: options.status ?? "ACTIVE",
        contentHash,
      });
      return { capabilityId, versionId, key, contentHash };
    };

    const selected = await addCapability("selected", { key: "selected" });
    const teacherExcluded = await addCapability("teacher-excluded", { key: "teacher-excluded" });
    const rightsBlocked = await addCapability("rights-blocked", { key: "rights-blocked" });
    const dependencyUnavailable = await addCapability("dependency-unavailable", { key: "dependency-unavailable", dependency: { key: "cap02-engine", status: "AVAILABLE" } });
    const providerUnavailable = await addCapability("provider-unavailable", { key: "provider-unavailable", provider: { key: "cap02-provider", status: "AVAILABLE" } });
    const tenantDenied = await addCapability("tenant-denied", { key: "tenant-denied", institutionIds: [randomUUID()] });
    const contraindicated = await addCapability("contraindicated", { key: "contraindicated", contraindications: ["visual-overload"] });
    const disabled = await addCapability("disabled", { key: "disabled", status: "DISABLED" });
    const noMatch = await addCapability("no-match", { key: "no-match", exactMatchSignals: ["unrelated-capability"] });
    const staleVersionId = randomUUID();
    await getDb().insert(capabilityVersions).values({
      id: staleVersionId,
      capabilityId: selected.capabilityId,
      version: "1.0.0",
      contract: resolutionContract({ key: selected.key }),
      implementationKey: "cap02.selected.old",
      status: "ACTIVE",
      contentHash: `cap02-stale-${staleVersionId}`,
    });

    await getDb().insert(contextItems).values({
      id: randomUUID(),
      institutionId: SEED.institution,
      learnerProfileId: profileId,
      courseId: SEED.course,
      taskId,
      kind: "TEACHER_CONSTRAINT",
      scope: "TASK",
      payload: {
        requiredCapabilityKeys: [selected.key],
        excludedCapabilityKeys: [teacherExcluded.key],
        taskType: "REPAIR_MISCONCEPTION",
        curriculum: "TEST",
        learnerLevel: "BEGINNER",
        language: "en",
        accessibility: ["keyboard"],
        prerequisiteEvidence: ["foundation"],
        contraindications: ["visual-overload"],
        rightsAvailability: { [rightsBlocked.key]: "BLOCKED" },
        dependencyAvailability: { "cap02-engine": "UNAVAILABLE" },
        providerAvailability: { "cap02-provider": "UNAVAILABLE" },
        generationAllowed: false,
        modality: "TEXT",
      },
      provenance: { test: "CAP-02", authority: "teacher" },
      ruleVersion: "cap-02-test.1",
      actorUserId: SEED.teacher,
    });
    await getDb().insert(learnerAttempts).values({
      id: attemptId,
      taskId,
      episodeId,
      learnerId,
      capabilityId: selected.capabilityId,
      prompt: "Repair target skill",
      response: "I obtained the wrong value.",
      structuredInput: { responseType: "NATURAL_ATTEMPT" },
      sourceRefs: [],
    });
    await getDb().insert(diagnosticObservations).values({
      id: observationId,
      attemptId,
      capabilityVersionId: selected.versionId,
      observationSource: "CAPABILITY",
      status: "NEEDS_REVIEW",
      failureCode: "NUMERIC_MISMATCH",
      firstInvalidStep: "FINAL_NUMERIC_COMPARISON",
      summary: "The current attempt needs target-skill repair.",
      structuredResult: { issue: "target-skill", diagnosticClaim: true },
      inputLineage: { attemptId, capabilityId: selected.capabilityId },
      outputLineage: { capabilityVersionId: selected.versionId, deterministic: true },
    });

    const actor = await getActor(learnerId, SEED.institution, "integration-test", `cap02:${learnerId}`);
    const first = await resolveCapabilityForDiagnosis(actor, { taskId, episodeId, diagnosticObservationId: observationId });
    const replay = await resolveCapabilityForDiagnosis(actor, { taskId, episodeId, diagnosticObservationId: observationId });
    expect(first).toMatchObject({
      decision: "EXISTING",
      selectedCapabilityId: selected.capabilityId,
      selectedCapabilityVersionId: selected.versionId,
      noMatch: false,
      teacherEscalation: false,
      replayed: false,
    });
    expect(replay).toMatchObject({ id: first.id, inputHash: first.inputHash, replayed: true });
    expect(await getDb().select().from(capabilityResolutions).where(eq(capabilityResolutions.id, first.id))).toHaveLength(1);
    expect(await getDb().select().from(contextCompilations).where(and(
      eq(contextCompilations.id, first.contextCompilationId),
      eq(contextCompilations.consumer, "CAPABILITY_RESOLUTION"),
    ))).toHaveLength(1);

    const candidates = first.candidateSet as Array<{ capabilityKey: string; versionId: string; exclusionReasons: string[]; compatibility: unknown[] }>;
    const reasons = new Set(candidates.flatMap((candidate) => candidate.exclusionReasons));
    for (const reason of [
      "INELIGIBLE",
      "CONTRAINDICATED",
      "TEACHER_EXCLUDED",
      "RIGHTS_BLOCKED",
      "DEPENDENCY_UNAVAILABLE",
      "PROVIDER_UNAVAILABLE",
      "VERSION_DISABLED",
      "TENANT_DENIED",
      "NO_MATCH",
    ]) expect(reasons, reason).toContain(reason);
    expect(candidates.find((candidate) => candidate.versionId === staleVersionId)?.exclusionReasons).toContain("VERSION_DISABLED");
    expect(candidates.find((candidate) => candidate.capabilityKey === noMatch.key)?.exclusionReasons).toContain("NO_MATCH");
    expect(candidates.every((candidate) => candidate.compatibility.length > 0)).toBe(true);
    expect(candidates.some((candidate) => candidate.capabilityKey === tenantDenied.key && candidate.exclusionReasons.includes("TENANT_DENIED"))).toBe(true);
    expect(candidates.some((candidate) => candidate.capabilityKey === contraindicated.key && candidate.exclusionReasons.includes("CONTRAINDICATED"))).toBe(true);
    expect(candidates.some((candidate) => candidate.capabilityKey === disabled.key && candidate.exclusionReasons.includes("VERSION_DISABLED"))).toBe(true);
    expect(candidates.some((candidate) => candidate.capabilityKey === dependencyUnavailable.key && candidate.exclusionReasons.includes("DEPENDENCY_UNAVAILABLE"))).toBe(true);
    expect(candidates.some((candidate) => candidate.capabilityKey === providerUnavailable.key && candidate.exclusionReasons.includes("PROVIDER_UNAVAILABLE"))).toBe(true);

    const firstPlan = await planActivityForResolution(actor, { taskId, episodeId, capabilityResolutionId: first.id });
    const replayedPlan = await planActivityForResolution(actor, { taskId, episodeId, capabilityResolutionId: first.id });
    expect(firstPlan).toMatchObject({
      state: "READY",
      capabilityResolutionId: first.id,
      contextCompilationId: first.contextCompilationId,
      diagnosticObservationId: observationId,
      selectedCapabilityId: selected.capabilityId,
      selectedCapabilityVersionId: selected.versionId,
      selectedVersionContentHash: selected.contentHash,
      replayed: false,
    });
    expect(replayedPlan).toMatchObject({ id: firstPlan.id, inputHash: firstPlan.inputHash, replayed: true });
    expect(firstPlan.stages).toHaveLength(1);
    expect(firstPlan.stages[0]).toMatchObject({ order: 1, kind: "CAPABILITY_ACTIVITY", capabilityVersionId: selected.versionId });
    expect(firstPlan.runtimeHandoff).toMatchObject({ executable: true, capabilityVersionId: selected.versionId });
    expect(firstPlan.retryIntent).toMatchObject({ kind: "TEACHER_REVIEW_REQUIRED", formalRetryCreated: false });
    expect(await getDb().select().from(activityPlanProposals).where(eq(activityPlanProposals.capabilityResolutionId, first.id))).toHaveLength(1);
    await expect(getDb().update(activityPlanProposals).set({ rationale: "rewritten" }).where(eq(activityPlanProposals.id, firstPlan.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });

    const foreignInstitutionId = randomUUID();
    const foreignLearnerId = randomUUID();
    await getDb().insert(institutions).values({ id: foreignInstitutionId, slug: `cap03-${foreignInstitutionId}`, name: "CAP-03 foreign institution" });
    await getDb().insert(users).values({ id: foreignLearnerId, email: `cap03-${foreignLearnerId}@integration.invalid`, name: "CAP-03 foreign learner" });
    await getDb().insert(institutionMemberships).values({ userId: foreignLearnerId, institutionId: foreignInstitutionId, role: "LEARNER" });
    const foreignActor = await getActor(foreignLearnerId, foreignInstitutionId, "integration-test", `cap03:${foreignLearnerId}`);
    await expect(planActivityForResolution(foreignActor, { taskId, episodeId, capabilityResolutionId: first.id }))
      .rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    expect(await getDb().select().from(activityPlanProposals).where(eq(activityPlanProposals.capabilityResolutionId, first.id))).toHaveLength(1);
  });

  it("denies a learner's cross-tenant Task before Context, Diagnosis or resolution persistence", async () => {
    const institutionId = randomUUID();
    const subjectId = randomUUID();
    const courseId = randomUUID();
    const learnerId = randomUUID();
    const profileId = randomUUID();
    const taskId = randomUUID();
    const episodeId = randomUUID();
    const attemptId = randomUUID();
    const observationId = randomUUID();
    await getDb().insert(institutions).values({ id: institutionId, slug: `cap02-${institutionId}`, name: "CAP-02 foreign institution" });
    await getDb().insert(users).values({ id: learnerId, email: `cap02-foreign-${learnerId}@integration.invalid`, name: "CAP-02 foreign learner" });
    await getDb().insert(institutionMemberships).values({ userId: learnerId, institutionId, role: "LEARNER" });
    await getDb().insert(subjects).values({ id: subjectId, institutionId, key: `cap02-${subjectId}`, name: "Foreign subject", referencePackKey: "foreign-pack" });
    await getDb().insert(courses).values({ id: courseId, institutionId, subjectId, code: `CAP02-${courseId.slice(0, 6)}`, name: "Foreign course" });
    await getDb().insert(courseEnrollments).values({ institutionId, courseId, userId: learnerId, role: "LEARNER" });
    await getDb().insert(learnerProfiles).values({ id: profileId, institutionId, learnerId, createdBy: learnerId });
    await getDb().insert(learningTasks).values({ id: taskId, institutionId, courseId, learnerId, learnerProfileId: profileId, title: "Foreign Task", goal: "Must remain tenant isolated" });
    await getDb().insert(learningEpisodes).values({ id: episodeId, taskId, sequence: 1 });
    await getDb().insert(learnerAttempts).values({ id: attemptId, taskId, episodeId, learnerId, prompt: "Foreign", response: "Foreign", structuredInput: {}, sourceRefs: [] });
    await getDb().insert(diagnosticObservations).values({ id: observationId, attemptId, observationSource: "CAPABILITY_UNAVAILABLE", status: "REVIEW_REQUIRED", summary: "Foreign", structuredResult: {}, inputLineage: {}, outputLineage: {} });

    const actor = await getActor(SEED.learner, SEED.institution, "integration-test", `cap02-cross-tenant:${randomUUID()}`);
    await expect(resolveCapabilityForDiagnosis(actor, { taskId, episodeId, diagnosticObservationId: observationId }))
      .rejects.toMatchObject({ code: "TENANT_ISOLATION" });
    expect(await getDb().select().from(capabilityResolutions).where(eq(capabilityResolutions.taskId, taskId))).toHaveLength(0);
  });
});
