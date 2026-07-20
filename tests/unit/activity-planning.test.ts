import { describe, expect, it } from "vitest";
import {
  activityPlanningHash,
  buildActivityPlanProposal,
  stableActivityPlanningJson,
  type ActivityPlanningInput,
} from "@/domain/activity-planning";

function input(overrides: Partial<ActivityPlanningInput> = {}): ActivityPlanningInput {
  return {
    taskGoal: "Repair the current calculation gap",
    taskId: "80000000-0000-4000-8000-000000000001",
    episodeId: "80000000-0000-4000-8000-000000000002",
    contextCompilationId: "80000000-0000-4000-8000-000000000003",
    contextSnapshotHash: "sha256:context",
    diagnosticObservationId: "80000000-0000-4000-8000-000000000004",
    diagnosisStatus: "NEEDS_REVIEW",
    diagnosisSummary: "The first unsupported step is the unit conversion.",
    diagnosisFailureCode: "UNIT_CONVERSION",
    capabilityResolutionId: "80000000-0000-4000-8000-000000000005",
    resolutionDecision: "EXISTING",
    resolutionRationale: "Selected the eligible exact version at deterministic rank 1.",
    teacherEscalation: false,
    noMatch: false,
    selectedCapabilityId: "50000000-0000-4000-8000-000000000001",
    selectedCapabilityVersionId: "50000000-0000-4000-8000-000000000002",
    selectedVersion: {
      capabilityId: "50000000-0000-4000-8000-000000000001",
      versionId: "50000000-0000-4000-8000-000000000002",
      version: "2.1.0",
      contentHash: "sha256:version",
      active: true,
      runtime: {
        kind: "TRUSTED_DETERMINISTIC_ADAPTER",
        input: "amount + volume + answer",
        parameters: [{ key: "amount" }],
        state: { mode: "STATELESS" },
        output: "result",
        events: ["CAPABILITY_RESULT", "ATTEMPT_SUBMITTED", "CAPABILITY_RESULT"],
      },
    },
    selectedCandidateEligible: true,
    teacherConstraints: [
      { contextItemId: "b", kind: "CAPABILITY_REQUIREMENT", payload: { capabilityKey: "target" } },
      { contextItemId: "a", kind: "TEACHER_CONSTRAINT", payload: { language: "en" } },
    ],
    staleInputReasons: [],
    ...overrides,
  };
}

describe("CAP-03 deterministic ActivityPlanProposal", () => {
  it("plans one ordered exact-version stage with runtime and governance handoff", () => {
    const first = buildActivityPlanProposal(input());
    const replay = buildActivityPlanProposal(input());
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      state: "READY",
      runtimeHandoff: { executable: true, capabilityVersionId: "50000000-0000-4000-8000-000000000002" },
      retryIntent: { kind: "TEACHER_REVIEW_REQUIRED", formalRetryCreated: false },
      teacherIntervention: { requiredBeforeRuntime: false, requiredBeforeFormalRetry: true },
    });
    expect(first.stages).toHaveLength(1);
    expect(first.stages[0]).toMatchObject({
      order: 1,
      kind: "CAPABILITY_ACTIVITY",
      capabilityVersionId: "50000000-0000-4000-8000-000000000002",
      capabilityVersionContentHash: "sha256:version",
      transition: { onSuccess: "DIAGNOSIS_PROPOSAL", onStop: "RECOVERY_OR_TEACHER_INTERVENTION" },
    });
    expect(first.stages[0]?.expected.events).toEqual(["ATTEMPT_SUBMITTED", "CAPABILITY_RESULT"]);
    expect(first.teacherConstraints.map((item) => item.contextItemId)).toEqual(["b", "a"]);
    expect(activityPlanningHash(first)).toBe(activityPlanningHash(replay));
    expect(stableActivityPlanningJson({ b: 1, a: 2 })).toBe(stableActivityPlanningJson({ a: 2, b: 1 }));
  });

  it.each(["PARAMETERIZE", "COMPOSE", "ADAPT", "GENERATE"] as const)("persists %s as blocked without an executable stage", (decision) => {
    const plan = buildActivityPlanProposal(input({
      resolutionDecision: decision,
      teacherEscalation: true,
      selectedCapabilityId: null,
      selectedCapabilityVersionId: null,
      selectedVersion: null,
      selectedCandidateEligible: false,
    }));
    expect(plan.state).toBe("BLOCKED");
    expect(plan.stages).toEqual([]);
    expect(plan.runtimeHandoff).toEqual({ executable: false, requiredRevalidation: [], capabilityVersionId: null });
    expect(plan.blockReasons).toEqual([`CAPABILITY_${decision}_NOT_EXECUTED`]);
  });

  it("persists no-match as escalated without fabricating a capability", () => {
    const plan = buildActivityPlanProposal(input({
      resolutionDecision: "NO_MATCH",
      teacherEscalation: true,
      noMatch: true,
      selectedCapabilityId: null,
      selectedCapabilityVersionId: null,
      selectedVersion: null,
      selectedCandidateEligible: false,
    }));
    expect(plan).toMatchObject({ state: "ESCALATED", stages: [], blockReasons: ["CAPABILITY_NO_MATCH"], runtimeHandoff: { executable: false } });
  });

  it.each([
    ["inactive version", { selectedVersion: { ...input().selectedVersion!, active: false } }],
    ["ineligible candidate", { selectedCandidateEligible: false }],
    ["stale Context", { staleInputReasons: ["CONTEXT_ITEM_NOT_CURRENT:item"] }],
    ["teacher pre-runtime gate", { teacherConstraints: [{ contextItemId: "teacher", kind: "TEACHER_CONSTRAINT", payload: { requiresTeacherReviewBeforeRuntime: true } }] }],
  ])("fails closed for %s", (_label, overrides) => {
    const plan = buildActivityPlanProposal(input(overrides as Partial<ActivityPlanningInput>));
    expect(plan.state).toBe("ESCALATED");
    expect(plan.stages).toEqual([]);
    expect(plan.runtimeHandoff.executable).toBe(false);
    expect(plan.teacherIntervention.requiredBeforeRuntime).toBe(true);
  });
});
