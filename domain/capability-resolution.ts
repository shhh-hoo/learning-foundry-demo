import { createHash } from "node:crypto";
import { z } from "zod";

export const CAPABILITY_RESOLUTION_POLICY_VERSION = "cap-02.1";

export const CapabilityExclusionReason = z.enum([
  "INELIGIBLE",
  "CONTRAINDICATED",
  "TEACHER_EXCLUDED",
  "RIGHTS_BLOCKED",
  "DEPENDENCY_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "VERSION_DISABLED",
  "TENANT_DENIED",
  "NO_MATCH",
]);
export type CapabilityExclusionReason = z.infer<typeof CapabilityExclusionReason>;

const AvailabilityState = z.enum(["AVAILABLE", "UNAVAILABLE", "BLOCKED", "NOT_REQUIRED"]);

export const CallableCapabilityResolutionContract = z.object({
  contractType: z.literal("CALLABLE_LEARNING_CAPABILITY"),
  verified: z.boolean(),
  learningProblem: z.string().trim().min(1),
  exactMatchSignals: z.array(z.string().trim().min(1)).min(1),
  eligibility: z.object({
    learnerLevels: z.array(z.string().trim().min(1)).min(1),
    taskTypes: z.array(z.string().trim().min(1)).min(1),
    curricula: z.array(z.string().trim().min(1)).min(1),
    languages: z.array(z.string().trim().min(1)).min(1),
    accessibility: z.array(z.string().trim().min(1)).min(1),
    prerequisites: z.array(z.string().trim().min(1)),
    contraindications: z.array(z.string().trim().min(1)),
  }),
  availability: z.object({
    status: z.enum(["AVAILABLE", "DISABLED"]),
    institutionIds: z.array(z.string().uuid()),
    courseIds: z.array(z.string().uuid()),
    rights: AvailabilityState,
    dependencies: z.array(z.object({ key: z.string().trim().min(1), status: AvailabilityState })),
    provider: z.object({ key: z.string().trim().min(1), status: AvailabilityState }).nullable(),
  }),
  parameterization: z.object({
    supported: z.boolean(),
    signals: z.array(z.string().trim().min(1)),
    recommendation: z.record(z.string(), z.unknown()),
  }),
  composition: z.object({
    supported: z.boolean(),
    contributes: z.array(z.string().trim().min(1)),
  }),
  adaptation: z.object({
    reviewed: z.boolean(),
    signals: z.array(z.string().trim().min(1)),
  }),
  runtime: z.object({
    kind: z.string().trim().min(1),
    input: z.unknown(),
    parameters: z.unknown(),
    state: z.unknown(),
    output: z.unknown(),
    events: z.array(z.string().trim().min(1)).min(1),
  }),
});

export type CallableCapabilityResolutionContract = z.infer<typeof CallableCapabilityResolutionContract>;

export type CapabilityResolutionNeed = {
  institutionId: string;
  courseId: string;
  referencePackKey: string;
  taskGoal: string;
  diagnosticObservationId?: string;
  taskType?: string;
  curriculum?: string;
  learnerLevel?: string;
  languages: string[];
  accessibility: string[];
  prerequisiteEvidence: string[];
  contraindications: string[];
  signals: string[];
  compositionRequiredTags: string[];
  requiredCapabilityKeys: string[];
  excludedCapabilityKeys: string[];
  currentCapabilityId?: string;
  generationAllowed: boolean;
  rightsAvailability: Record<string, z.infer<typeof AvailabilityState>>;
  dependencyAvailability: Record<string, z.infer<typeof AvailabilityState>>;
  providerAvailability: Record<string, z.infer<typeof AvailabilityState>>;
};

export type RegistryCapabilityVersion = {
  capabilityId: string;
  capabilityKey: string;
  capabilityName: string;
  referencePackKey: string;
  activeVersionId: string | null;
  versionId: string;
  version: string;
  versionStatus: string;
  contentHash: string;
  contract: unknown;
  sourceDiagnosticObservationId?: string | null;
};

export type CompatibilityCheck = {
  dimension: string;
  compatible: boolean;
  detail: string;
};

export type CapabilityCandidateDecision = RegistryCapabilityVersion & {
  rank: number;
  eligibility: "ELIGIBLE" | "EXCLUDED";
  exclusionReasons: CapabilityExclusionReason[];
  compatibility: CompatibilityCheck[];
  matchMode: "EXACT" | "PARAMETERIZE" | "COMPOSE" | "ADAPT" | "NONE";
  score: number;
  rationale: string;
  parsedContract: CallableCapabilityResolutionContract | null;
};

export type CapabilityResolutionDecision = {
  policyVersion: string;
  inputHash: string;
  candidates: CapabilityCandidateDecision[];
  decision: "EXISTING" | "PARAMETERIZE" | "COMPOSE" | "ADAPT" | "GENERATE" | "NO_MATCH";
  selectedCapabilityId: string | null;
  selectedCapabilityVersionId: string | null;
  selectionRationale: string;
  parameterizationRecommendation: Record<string, unknown> | null;
  compositionRecommendation: { capabilityVersionIds: string[]; coveredTags: string[] } | null;
  gapSignal: {
    kind: "ADAPTATION_REQUIRED" | "GENERATION_REQUIRED" | "NO_MATCH";
    reason: string;
    relatedCapabilityVersionId: string | null;
  } | null;
  noMatch: boolean;
  teacherEscalation: boolean;
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

export function stableCapabilityResolutionJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function capabilityResolutionHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableCapabilityResolutionJson(value)).digest("hex")}`;
}

export function capabilityResolutionId(inputHash: string): string {
  const raw = inputHash.replace(/^sha256:/, "").slice(0, 32).split("");
  raw[12] = "5";
  raw[16] = ((Number.parseInt(raw[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = raw.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map(normalized).filter(Boolean));
}

function tokenSet(values: string[]): Set<string> {
  return new Set(values.flatMap((value) => normalized(value).split(/[^\p{L}\p{N}]+/u)).filter((token) => token.length > 1));
}

function supports(allowed: string[], requested: string | undefined): boolean {
  if (!requested) return true;
  const values = normalizedSet(allowed);
  return values.has("*") || values.has(normalized(requested));
}

function supportsAll(allowed: string[], requested: string[]): boolean {
  const values = normalizedSet(allowed);
  return values.has("*") || requested.every((value) => values.has(normalized(value)));
}

function intersectCount(left: string[], right: string[]): number {
  const rightTokens = tokenSet(right);
  return [...tokenSet(left)].filter((token) => rightTokens.has(token)).length;
}

function phraseMatchCount(left: string[], right: string[]): number {
  const normalizedRight = right.map((value) => normalized(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  return left.map((value) => normalized(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim())
    .filter((value) => normalizedRight.some((candidate) => candidate === value || (value.length >= 8 && candidate.includes(value)))).length;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference) return difference;
  }
  return right.localeCompare(left);
}

const matchRank = { EXACT: 0, PARAMETERIZE: 1, COMPOSE: 2, ADAPT: 3, NONE: 4 } as const;

function candidateOrder(left: CapabilityCandidateDecision, right: CapabilityCandidateDecision): number {
  return Number(right.eligibility === "ELIGIBLE") - Number(left.eligibility === "ELIGIBLE")
    || matchRank[left.matchMode] - matchRank[right.matchMode]
    || right.score - left.score
    || left.capabilityKey.localeCompare(right.capabilityKey)
    || compareVersions(left.version, right.version)
    || left.versionId.localeCompare(right.versionId);
}

function uniqueReasons(reasons: CapabilityExclusionReason[]): CapabilityExclusionReason[] {
  return [...new Set(reasons)].sort((left, right) => CapabilityExclusionReason.options.indexOf(left) - CapabilityExclusionReason.options.indexOf(right));
}

function evaluateCandidate(need: CapabilityResolutionNeed, candidate: RegistryCapabilityVersion): CapabilityCandidateDecision {
  const contractEnvelope = candidate.contract && typeof candidate.contract === "object"
    ? (candidate.contract as Record<string, unknown>).resolution ?? candidate.contract
    : candidate.contract;
  const parsed = CallableCapabilityResolutionContract.safeParse(contractEnvelope);
  const reasons: CapabilityExclusionReason[] = [];
  const compatibility: CompatibilityCheck[] = [];
  const addCheck = (dimension: string, compatible: boolean, detail: string, reason?: CapabilityExclusionReason) => {
    compatibility.push({ dimension, compatible, detail });
    if (!compatible && reason) reasons.push(reason);
  };

  addCheck("exact-version", candidate.versionStatus === "ACTIVE" && candidate.activeVersionId === candidate.versionId,
    candidate.activeVersionId === candidate.versionId ? `Version ${candidate.version} is the active exact version.` : `Version ${candidate.version} is stale, disabled or not active.`, "VERSION_DISABLED");
  addCheck("registry-contract", parsed.success, parsed.success ? "Callable resolution contract is complete." : "Callable resolution contract is incomplete.", "INELIGIBLE");

  if (!parsed.success) {
    const exclusionReasons = uniqueReasons(reasons);
    return {
      ...candidate,
      rank: 0,
      eligibility: "EXCLUDED",
      exclusionReasons,
      compatibility,
      matchMode: "NONE",
      score: 0,
      rationale: `Excluded ${candidate.capabilityKey}@${candidate.version}: ${exclusionReasons.join(", ")}.`,
      parsedContract: null,
    };
  }

  const contract = parsed.data;
  const requiredKeys = normalizedSet(need.requiredCapabilityKeys);
  const excludedKeys = normalizedSet(need.excludedCapabilityKeys);
  const capabilityKey = normalized(candidate.capabilityKey);
  const relevantSignals = [need.taskGoal, ...need.signals];
  const exactOverlap = phraseMatchCount(contract.exactMatchSignals, relevantSignals);
  const parameterOverlap = intersectCount(contract.parameterization.signals, relevantSignals);
  const compositionOverlap = intersectCount(contract.composition.contributes, [...relevantSignals, ...need.compositionRequiredTags]);
  const adaptationOverlap = intersectCount(contract.adaptation.signals, relevantSignals);
  const currentMatch = candidate.capabilityId === need.currentCapabilityId;
  const sourceGapMatch = Boolean(need.diagnosticObservationId
    && candidate.sourceDiagnosticObservationId === need.diagnosticObservationId);
  const requiredMatch = requiredKeys.has(capabilityKey);
  const referencePackMatch = candidate.referencePackKey === need.referencePackKey;

  addCheck("verified", contract.verified, contract.verified ? "Registry capability is verified." : "Registry capability is not verified.", "INELIGIBLE");
  addCheck("registry-availability", contract.availability.status === "AVAILABLE", `Declared availability is ${contract.availability.status}.`, "VERSION_DISABLED");
  addCheck("reference-pack", referencePackMatch, referencePackMatch ? "Reference Pack matches the Task course." : "Reference Pack does not match the Task course.", "INELIGIBLE");
  addCheck("teacher-exclusion", !excludedKeys.has(capabilityKey), excludedKeys.has(capabilityKey) ? "An authorized teacher excluded this capability." : "No teacher exclusion applies.", "TEACHER_EXCLUDED");
  addCheck("teacher-requirement", requiredKeys.size === 0 || requiredMatch, requiredKeys.size === 0 || requiredMatch ? "Teacher requirement is satisfied." : "Another capability is explicitly required.", "INELIGIBLE");
  addCheck("tenant", contract.availability.institutionIds.length === 0 || contract.availability.institutionIds.includes(need.institutionId), "Capability institution scope checked.", "TENANT_DENIED");
  addCheck("course", contract.availability.courseIds.length === 0 || contract.availability.courseIds.includes(need.courseId), "Capability course scope checked.", "TENANT_DENIED");
  addCheck("learner-level", supports(contract.eligibility.learnerLevels, need.learnerLevel), "Learner-level eligibility checked.", "INELIGIBLE");
  addCheck("task-type", supports(contract.eligibility.taskTypes, need.taskType), "Task-type eligibility checked.", "INELIGIBLE");
  addCheck("curriculum", supports(contract.eligibility.curricula, need.curriculum), "Curriculum eligibility checked.", "INELIGIBLE");
  addCheck("language", supportsAll(contract.eligibility.languages, need.languages), "Language compatibility checked.", "INELIGIBLE");
  addCheck("accessibility", supportsAll(contract.eligibility.accessibility, need.accessibility), "Accessibility compatibility checked.", "INELIGIBLE");

  const availablePrerequisites = normalizedSet(need.prerequisiteEvidence);
  const missingPrerequisites = contract.eligibility.prerequisites.filter((item) => !availablePrerequisites.has(normalized(item)));
  addCheck("prerequisites", missingPrerequisites.length === 0, missingPrerequisites.length ? `Missing prerequisite Evidence: ${missingPrerequisites.join(", ")}.` : "Prerequisite Evidence is sufficient.", "INELIGIBLE");

  const activeContraindications = normalizedSet([...need.contraindications, ...need.signals]);
  const contraindications = contract.eligibility.contraindications.filter((item) => activeContraindications.has(normalized(item)));
  addCheck("contraindications", contraindications.length === 0, contraindications.length ? `Contraindicated by: ${contraindications.join(", ")}.` : "No contraindication applies.", "CONTRAINDICATED");

  const rights = need.rightsAvailability[candidate.capabilityKey] ?? contract.availability.rights;
  addCheck("rights", rights === "AVAILABLE" || rights === "NOT_REQUIRED", `Rights state is ${rights}.`, "RIGHTS_BLOCKED");
  const unavailableDependencies = contract.availability.dependencies.filter((dependency) => {
    const state = need.dependencyAvailability[dependency.key] ?? dependency.status;
    return state !== "AVAILABLE" && state !== "NOT_REQUIRED";
  });
  addCheck("dependencies", unavailableDependencies.length === 0, unavailableDependencies.length ? `Unavailable dependencies: ${unavailableDependencies.map((item) => item.key).join(", ")}.` : "Dependencies are available.", "DEPENDENCY_UNAVAILABLE");
  const provider = contract.availability.provider;
  const providerState = provider ? (need.providerAvailability[provider.key] ?? provider.status) : "NOT_REQUIRED";
  addCheck("provider", providerState === "AVAILABLE" || providerState === "NOT_REQUIRED", `Provider state is ${providerState}.`, "PROVIDER_UNAVAILABLE");

  let matchMode: CapabilityCandidateDecision["matchMode"] = "NONE";
  if (currentMatch || requiredMatch || sourceGapMatch || exactOverlap > 0) matchMode = "EXACT";
  else if (contract.parameterization.supported && parameterOverlap > 0) matchMode = "PARAMETERIZE";
  else if (contract.composition.supported && compositionOverlap > 0) matchMode = "COMPOSE";
  else if (contract.adaptation.reviewed && adaptationOverlap > 0) matchMode = "ADAPT";
  else reasons.push("NO_MATCH");

  const score = (sourceGapMatch ? 2_000 : 0) + (requiredMatch ? 1_000 : 0) + (currentMatch ? 500 : 0) + exactOverlap * 20 + parameterOverlap * 10 + compositionOverlap * 5 + adaptationOverlap * 2;
  const exclusionReasons = uniqueReasons(reasons);
  const eligibility = exclusionReasons.length === 0 ? "ELIGIBLE" : "EXCLUDED";
  return {
    ...candidate,
    rank: 0,
    eligibility,
    exclusionReasons,
    compatibility,
    matchMode,
    score,
    rationale: eligibility === "ELIGIBLE"
      ? `Eligible ${matchMode.toLocaleLowerCase("en-US")} candidate ${candidate.capabilityKey}@${candidate.version}; deterministic compatibility score ${score}.`
      : `Excluded ${candidate.capabilityKey}@${candidate.version}: ${exclusionReasons.join(", ")}.`,
    parsedContract: contract,
  };
}

function eligibleByMode(candidates: CapabilityCandidateDecision[], mode: CapabilityCandidateDecision["matchMode"]): CapabilityCandidateDecision[] {
  return candidates.filter((candidate) => candidate.eligibility === "ELIGIBLE" && candidate.matchMode === mode);
}

export function resolveCapabilityCandidates(input: {
  need: CapabilityResolutionNeed;
  registry: RegistryCapabilityVersion[];
}): CapabilityResolutionDecision {
  const candidates = input.registry.map((candidate) => evaluateCandidate(input.need, candidate)).sort(candidateOrder)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const exact = eligibleByMode(candidates, "EXACT")[0];
  const parameterized = eligibleByMode(candidates, "PARAMETERIZE")[0];
  const composable = eligibleByMode(candidates, "COMPOSE");
  const adaptable = candidates.find((candidate) => candidate.matchMode === "ADAPT"
    && candidate.parsedContract?.adaptation.reviewed
    && !candidate.exclusionReasons.some((reason) => reason !== "INELIGIBLE" && reason !== "NO_MATCH"));
  const inputHash = capabilityResolutionHash({
    policyVersion: CAPABILITY_RESOLUTION_POLICY_VERSION,
    need: input.need,
    registry: [...input.registry].sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey)
      || compareVersions(left.version, right.version)
      || left.versionId.localeCompare(right.versionId)),
  });

  const common = { policyVersion: CAPABILITY_RESOLUTION_POLICY_VERSION, inputHash, candidates };
  if (exact) {
    return {
      ...common,
      decision: "EXISTING",
      selectedCapabilityId: exact.capabilityId,
      selectedCapabilityVersionId: exact.versionId,
      selectionRationale: `Selected verified eligible exact version ${exact.capabilityKey}@${exact.version} at deterministic rank ${exact.rank}.`,
      parameterizationRecommendation: null,
      compositionRecommendation: null,
      gapSignal: null,
      noMatch: false,
      teacherEscalation: false,
    };
  }
  if (parameterized?.parsedContract) {
    return {
      ...common,
      decision: "PARAMETERIZE",
      selectedCapabilityId: null,
      selectedCapabilityVersionId: null,
      selectionRationale: `No exact match; recommend parameterizing eligible ${parameterized.capabilityKey}@${parameterized.version}.`,
      parameterizationRecommendation: {
        capabilityId: parameterized.capabilityId,
        capabilityVersionId: parameterized.versionId,
        parameters: parameterized.parsedContract.parameterization.recommendation,
      },
      compositionRecommendation: null,
      gapSignal: null,
      noMatch: false,
      teacherEscalation: true,
    };
  }
  if (composable.length >= 2) {
    const requiredTags = normalizedSet(input.need.compositionRequiredTags);
    const selected: CapabilityCandidateDecision[] = [];
    const covered = new Set<string>();
    for (const candidate of composable) {
      const contributions = candidate.parsedContract?.composition.contributes ?? [];
      if (!contributions.some((tag) => requiredTags.size === 0 || requiredTags.has(normalized(tag)))) continue;
      selected.push(candidate);
      for (const tag of contributions) covered.add(normalized(tag));
      if (selected.length >= 2 && (requiredTags.size === 0 || [...requiredTags].every((tag) => covered.has(tag)))) break;
    }
    if (selected.length >= 2 && (requiredTags.size === 0 || [...requiredTags].every((tag) => covered.has(tag)))) {
      return {
        ...common,
        decision: "COMPOSE",
        selectedCapabilityId: null,
        selectedCapabilityVersionId: null,
        selectionRationale: `No exact or parameterized match; recommend composing ${selected.map((candidate) => `${candidate.capabilityKey}@${candidate.version}`).join(" + ")}.`,
        parameterizationRecommendation: null,
        compositionRecommendation: { capabilityVersionIds: selected.map((candidate) => candidate.versionId), coveredTags: [...covered].sort() },
        gapSignal: null,
        noMatch: false,
        teacherEscalation: true,
      };
    }
  }
  if (adaptable) {
    return {
      ...common,
      decision: "ADAPT",
      selectedCapabilityId: null,
      selectedCapabilityVersionId: null,
      selectionRationale: `No eligible reusable match; recommend governed adaptation of reviewed ${adaptable.capabilityKey}@${adaptable.version}.`,
      parameterizationRecommendation: null,
      compositionRecommendation: null,
      gapSignal: {
        kind: "ADAPTATION_REQUIRED",
        reason: "A related reviewed capability exists but is not currently an eligible exact, parameterized or composite match.",
        relatedCapabilityVersionId: adaptable.versionId,
      },
      noMatch: true,
      teacherEscalation: true,
    };
  }
  if (input.need.generationAllowed) {
    return {
      ...common,
      decision: "GENERATE",
      selectedCapabilityId: null,
      selectedCapabilityVersionId: null,
      selectionRationale: "No eligible existing, parameterized, composite or reviewed adaptation match; recommend a governed generated ComponentAsset proposal.",
      parameterizationRecommendation: null,
      compositionRecommendation: null,
      gapSignal: {
        kind: "GENERATION_REQUIRED",
        reason: "The complete meaningful Registry candidate set produced no eligible reusable match.",
        relatedCapabilityVersionId: null,
      },
      noMatch: true,
      teacherEscalation: true,
    };
  }
  return {
    ...common,
    decision: "NO_MATCH",
    selectedCapabilityId: null,
    selectedCapabilityVersionId: null,
    selectionRationale: "No eligible Registry capability exists and governed generation is not permitted by the current Context.",
    parameterizationRecommendation: null,
    compositionRecommendation: null,
    gapSignal: {
      kind: "NO_MATCH",
      reason: "No eligible match; an authorized teacher must decide the next action.",
      relatedCapabilityVersionId: null,
    },
    noMatch: true,
    teacherEscalation: true,
  };
}
