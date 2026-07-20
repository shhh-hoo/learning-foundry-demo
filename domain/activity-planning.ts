import { createHash } from "node:crypto";

export const ACTIVITY_PLANNING_POLICY_VERSION = "cap-03.1";

export type ActivityPlanProposalState = "READY" | "BLOCKED" | "ESCALATED";
export type CapabilityResolutionDecision = "EXISTING" | "PARAMETERIZE" | "COMPOSE" | "ADAPT" | "GENERATE" | "NO_MATCH";

export type ActivityTeacherConstraint = {
  contextItemId: string;
  kind: string;
  payload: Record<string, unknown>;
  ruleVersion?: string;
  reviewStatus?: string;
};

export type ActivityPlanStage = {
  order: number;
  kind: "CAPABILITY_ACTIVITY";
  purpose: string;
  capabilityId: string;
  capabilityVersionId: string;
  capabilityVersion: string;
  capabilityVersionContentHash: string;
  inputs: Record<string, unknown>;
  parameters: unknown;
  expected: {
    output: unknown;
    events: string[];
    evidence: string[];
  };
  successCondition: string;
  stopConditions: string[];
  transition: { onSuccess: string; onStop: string };
};

export type ActivityPlanProposal = {
  policyVersion: string;
  state: ActivityPlanProposalState;
  rationale: string;
  stages: ActivityPlanStage[];
  teacherConstraints: ActivityTeacherConstraint[];
  teacherIntervention: {
    requiredBeforeRuntime: boolean;
    requiredBeforeFormalRetry: boolean;
    reason: string;
  };
  retryIntent: {
    kind: "NONE" | "TEACHER_REVIEW_REQUIRED";
    formalRetryCreated: false;
    reason: string;
  };
  runtimeHandoff: {
    executable: boolean;
    requiredRevalidation: string[];
    capabilityVersionId: string | null;
  };
  blockReasons: string[];
};

export type ActivityPlanningInput = {
  taskGoal: string;
  taskId: string;
  episodeId: string;
  contextCompilationId: string;
  contextSnapshotHash: string;
  diagnosticObservationId: string;
  diagnosisStatus: string;
  diagnosisSummary: string;
  diagnosisFailureCode: string | null;
  capabilityResolutionId: string;
  resolutionDecision: CapabilityResolutionDecision;
  resolutionRationale: string;
  teacherEscalation: boolean;
  noMatch: boolean;
  selectedCapabilityId: string | null;
  selectedCapabilityVersionId: string | null;
  selectedVersion: {
    capabilityId: string;
    versionId: string;
    version: string;
    contentHash: string;
    active: boolean;
    runtime: {
      kind: string;
      input: unknown;
      parameters: unknown;
      state: unknown;
      output: unknown;
      events: string[];
    };
  } | null;
  selectedCandidateEligible: boolean;
  teacherConstraints: ActivityTeacherConstraint[];
  staleInputReasons: string[];
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function stableActivityPlanningJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function activityPlanningHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableActivityPlanningJson(value)).digest("hex")}`;
}

export function activityPlanProposalId(inputHash: string): string {
  const raw = inputHash.replace(/^sha256:/, "").slice(0, 32).split("");
  raw[12] = "5";
  raw[16] = ((Number.parseInt(raw[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = raw.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function sortedConstraints(constraints: ActivityTeacherConstraint[]): ActivityTeacherConstraint[] {
  return [...constraints].sort((left, right) => left.kind.localeCompare(right.kind)
    || left.contextItemId.localeCompare(right.contextItemId));
}

function requiresTeacherBeforeRuntime(constraints: ActivityTeacherConstraint[]): boolean {
  return constraints.some(({ payload }) => payload.requiresTeacherReviewBeforeRuntime === true
    || payload.teacherInterventionRule === "REQUIRED_BEFORE_RUNTIME");
}

export function buildActivityPlanProposal(input: ActivityPlanningInput): ActivityPlanProposal {
  const teacherConstraints = sortedConstraints(input.teacherConstraints);
  const structuredTeacherGate = requiresTeacherBeforeRuntime(teacherConstraints);
  const retryRequired = Boolean(input.diagnosisFailureCode) || input.diagnosisStatus === "NEEDS_REVIEW";
  const retryIntent: ActivityPlanProposal["retryIntent"] = retryRequired
    ? { kind: "TEACHER_REVIEW_REQUIRED", formalRetryCreated: false, reason: "A formal Retry requires an authorized TeacherReview; this proposal creates no Retry assignment." }
    : { kind: "NONE", formalRetryCreated: false, reason: "The current Diagnosis Proposal does not establish a formal Retry intent." };

  const exactVersionReady = input.resolutionDecision === "EXISTING"
    && !input.teacherEscalation
    && !input.noMatch
    && input.selectedCapabilityId !== null
    && input.selectedCapabilityVersionId !== null
    && input.selectedVersion !== null
    && input.selectedVersion.active
    && input.selectedVersion.capabilityId === input.selectedCapabilityId
    && input.selectedVersion.versionId === input.selectedCapabilityVersionId
    && input.selectedCandidateEligible;
  const blockReasons = [...new Set([
    ...input.staleInputReasons,
    ...(structuredTeacherGate ? ["TEACHER_REVIEW_REQUIRED_BEFORE_RUNTIME"] : []),
    ...(!exactVersionReady && input.resolutionDecision === "EXISTING" ? ["EXACT_VERSION_NOT_CURRENT_OR_ELIGIBLE"] : []),
  ])].sort((left, right) => left.localeCompare(right));

  if (input.resolutionDecision !== "EXISTING") {
    const state: ActivityPlanProposalState = input.resolutionDecision === "NO_MATCH" ? "ESCALATED" : "BLOCKED";
    return {
      policyVersion: ACTIVITY_PLANNING_POLICY_VERSION,
      state,
      rationale: `${input.resolutionRationale} No runtime stage was planned because ${input.resolutionDecision.toLocaleLowerCase("en-US")} is a recommendation or gap, not an available exact capability.`,
      stages: [],
      teacherConstraints,
      teacherIntervention: {
        requiredBeforeRuntime: true,
        requiredBeforeFormalRetry: retryRequired,
        reason: "Teacher action is required before a recommendation or no-match can become executable Product State.",
      },
      retryIntent,
      runtimeHandoff: { executable: false, requiredRevalidation: [], capabilityVersionId: null },
      blockReasons: [input.resolutionDecision === "NO_MATCH" ? "CAPABILITY_NO_MATCH" : `CAPABILITY_${input.resolutionDecision}_NOT_EXECUTED`],
    };
  }

  if (!exactVersionReady || structuredTeacherGate || input.staleInputReasons.length > 0 || !input.selectedVersion) {
    return {
      policyVersion: ACTIVITY_PLANNING_POLICY_VERSION,
      state: "ESCALATED",
      rationale: `${input.resolutionRationale} Planning failed closed because the exact resolution, version, Context, or teacher-governance input is not currently executable.`,
      stages: [],
      teacherConstraints,
      teacherIntervention: {
        requiredBeforeRuntime: true,
        requiredBeforeFormalRetry: retryRequired,
        reason: "Current authorized inputs must be resolved before runtime handoff.",
      },
      retryIntent,
      runtimeHandoff: { executable: false, requiredRevalidation: [], capabilityVersionId: null },
      blockReasons,
    };
  }

  const version = input.selectedVersion;
  const events = [...new Set(version.runtime.events)].sort((left, right) => left.localeCompare(right));
  return {
    policyVersion: ACTIVITY_PLANNING_POLICY_VERSION,
    state: "READY",
    rationale: `${input.resolutionRationale} Planned one deterministic exact-version learning stage for the current Task and Diagnosis Proposal.`,
    stages: [{
      order: 1,
      kind: "CAPABILITY_ACTIVITY",
      purpose: `${input.taskGoal} Current learning need: ${input.diagnosisSummary}`,
      capabilityId: version.capabilityId,
      capabilityVersionId: version.versionId,
      capabilityVersion: version.version,
      capabilityVersionContentHash: version.contentHash,
      inputs: {
        taskId: input.taskId,
        episodeId: input.episodeId,
        contextCompilationId: input.contextCompilationId,
        contextSnapshotHash: input.contextSnapshotHash,
        diagnosticObservationId: input.diagnosticObservationId,
        inputContract: version.runtime.input,
      },
      parameters: version.runtime.parameters,
      expected: {
        output: version.runtime.output,
        events,
        evidence: ["RUNTIME_DELIVERY", "LEARNING_EVENT", "LEARNER_ATTEMPT", "DIAGNOSTIC_OBSERVATION_PROPOSAL"],
      },
      successCondition: "Runtime reports successful completion and persists a new immutable LearnerAttempt.",
      stopConditions: ["CAPABILITY_DISABLED", "CANCELLED", "INPUT_INVALID", "RUNTIME_FAILURE", "TEACHER_INTERRUPT", "TIMEOUT"],
      transition: { onSuccess: "DIAGNOSIS_PROPOSAL", onStop: "RECOVERY_OR_TEACHER_INTERVENTION" },
    }],
    teacherConstraints,
    teacherIntervention: {
      requiredBeforeRuntime: false,
      requiredBeforeFormalRetry: retryRequired,
      reason: retryRequired
        ? "Bounded provisional activity may proceed; formal Retry and consequential interpretation still require TeacherReview."
        : "No structured pre-runtime teacher gate is present; later consequential interpretation remains governed.",
    },
    retryIntent,
    runtimeHandoff: {
      executable: true,
      requiredRevalidation: ["ACTOR_SCOPE", "CONTEXT_CURRENT", "DIAGNOSIS_CURRENT", "EXACT_VERSION_ACTIVE", "INPUT_CONTRACT", "DEPENDENCIES_AVAILABLE", "TEACHER_POLICY"],
      capabilityVersionId: version.versionId,
    },
    blockReasons: [],
  };
}
