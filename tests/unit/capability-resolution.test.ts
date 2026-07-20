import { describe, expect, it } from "vitest";
import {
  resolveCapabilityCandidates,
  type CapabilityResolutionNeed,
  type RegistryCapabilityVersion,
} from "@/domain/capability-resolution";

const institutionId = "10000000-0000-4000-8000-000000000001";
const otherInstitutionId = "10000000-0000-4000-8000-000000000002";
const courseId = "40000000-0000-4000-8000-000000000001";

function need(overrides: Partial<CapabilityResolutionNeed> = {}): CapabilityResolutionNeed {
  return {
    institutionId,
    courseId,
    referencePackKey: "test-pack",
    taskGoal: "repair target skill",
    taskType: "REPAIR_MISCONCEPTION",
    curriculum: "TEST",
    learnerLevel: "BEGINNER",
    languages: ["en"],
    accessibility: ["keyboard"],
    prerequisiteEvidence: ["foundation"],
    contraindications: [],
    signals: ["target-skill"],
    compositionRequiredTags: [],
    requiredCapabilityKeys: [],
    excludedCapabilityKeys: [],
    generationAllowed: false,
    rightsAvailability: {},
    dependencyAvailability: {},
    providerAvailability: {},
    ...overrides,
  };
}

function contract(overrides: Record<string, unknown> = {}) {
  const base = {
    contractType: "CALLABLE_LEARNING_CAPABILITY",
    verified: true,
    learningProblem: "repair target skill",
    exactMatchSignals: ["target-skill"],
    eligibility: {
      learnerLevels: ["BEGINNER"],
      taskTypes: ["REPAIR_MISCONCEPTION"],
      curricula: ["TEST"],
      languages: ["en"],
      accessibility: ["keyboard"],
      prerequisites: ["foundation"],
      contraindications: [],
    },
    availability: {
      status: "AVAILABLE",
      institutionIds: [],
      courseIds: [],
      rights: "AVAILABLE",
      dependencies: [{ key: "engine", status: "AVAILABLE" }],
      provider: null,
    },
    parameterization: { supported: false, signals: [], recommendation: {} },
    composition: { supported: false, contributes: [] },
    adaptation: { reviewed: false, signals: [] },
    runtime: {
      kind: "TEST_ADAPTER",
      input: { type: "object" },
      parameters: { type: "object" },
      state: { mode: "STATELESS" },
      output: { type: "object" },
      events: ["ATTEMPT"],
    },
  };
  return { ...base, ...overrides };
}

function candidate(index: number, overrides: Partial<RegistryCapabilityVersion> & { resolution?: Record<string, unknown> } = {}): RegistryCapabilityVersion {
  const capabilityId = `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const versionId = `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const { resolution, ...candidateOverrides } = overrides;
  return {
    capabilityId,
    capabilityKey: `capability-${index}`,
    capabilityName: `Capability ${index}`,
    referencePackKey: "test-pack",
    activeVersionId: versionId,
    versionId,
    version: "1.0.0",
    versionStatus: "ACTIVE",
    contentHash: `hash-${index}`,
    contract: { resolution: contract(resolution) },
    ...candidateOverrides,
  };
}

describe("CAP-02 deterministic capability policy", () => {
  it("pins the active exact version and keeps a stale predecessor in the complete ordered candidate set", () => {
    const current = candidate(1, { version: "2.0.0" });
    const stale = candidate(2, {
      capabilityId: current.capabilityId,
      capabilityKey: current.capabilityKey,
      activeVersionId: current.versionId,
      version: "1.0.0",
    });
    const result = resolveCapabilityCandidates({ need: need(), registry: [stale, current] });
    expect(result).toMatchObject({ decision: "EXISTING", selectedCapabilityId: current.capabilityId, selectedCapabilityVersionId: current.versionId, noMatch: false });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find((item) => item.versionId === stale.versionId)?.exclusionReasons).toContain("VERSION_DISABLED");
    expect(result.selectionRationale).toContain(`${current.capabilityKey}@2.0.0`);
  });

  it("orders deterministically independent of Registry query order", () => {
    const registry = [candidate(3), candidate(1), candidate(2)];
    const first = resolveCapabilityCandidates({ need: need(), registry });
    const replay = resolveCapabilityCandidates({ need: need(), registry: [...registry].reverse() });
    expect(replay.inputHash).toBe(first.inputHash);
    expect(replay.candidates.map((item) => [item.rank, item.versionId])).toEqual(first.candidates.map((item) => [item.rank, item.versionId]));
    expect(replay.selectionRationale).toBe(first.selectionRationale);
  });

  it.each([
    ["INELIGIBLE", candidate(1, { resolution: { eligibility: { ...contract().eligibility as object, learnerLevels: ["ADVANCED"] } } }), need()],
    ["CONTRAINDICATED", candidate(1, { resolution: { eligibility: { ...contract().eligibility as object, contraindications: ["visual-overload"] } } }), need({ contraindications: ["visual-overload"] })],
    ["TEACHER_EXCLUDED", candidate(1), need({ excludedCapabilityKeys: ["capability-1"] })],
    ["RIGHTS_BLOCKED", candidate(1, { resolution: { availability: { ...contract().availability as object, rights: "BLOCKED" } } }), need()],
    ["DEPENDENCY_UNAVAILABLE", candidate(1, { resolution: { availability: { ...contract().availability as object, dependencies: [{ key: "engine", status: "UNAVAILABLE" }] } } }), need()],
    ["PROVIDER_UNAVAILABLE", candidate(1, { resolution: { availability: { ...contract().availability as object, provider: { key: "model", status: "UNAVAILABLE" } } } }), need()],
    ["VERSION_DISABLED", candidate(1, { versionStatus: "DISABLED" }), need()],
    ["TENANT_DENIED", candidate(1, { resolution: { availability: { ...contract().availability as object, institutionIds: [otherInstitutionId] } } }), need()],
    ["NO_MATCH", candidate(1, { resolution: { exactMatchSignals: ["unrelated-skill"] } }), need()],
  ] as const)("records %s without dropping the candidate", (reason, registryCandidate, resolutionNeed) => {
    const result = resolveCapabilityCandidates({ need: resolutionNeed, registry: [registryCandidate] });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ eligibility: "EXCLUDED", exclusionReasons: expect.arrayContaining([reason]) });
    expect(result.candidates[0]?.compatibility.length).toBeGreaterThan(0);
  });

  it("enforces a structured teacher requirement before ranking", () => {
    const required = candidate(2);
    const other = candidate(1);
    const result = resolveCapabilityCandidates({ need: need({ requiredCapabilityKeys: [required.capabilityKey] }), registry: [other, required] });
    expect(result.selectedCapabilityVersionId).toBe(required.versionId);
    expect(result.candidates.find((item) => item.versionId === other.versionId)?.exclusionReasons).toContain("INELIGIBLE");
  });

  it("recommends parameterization without claiming selection or execution", () => {
    const parameterized = candidate(1, { resolution: {
      exactMatchSignals: ["different"],
      parameterization: { supported: true, signals: ["target-skill"], recommendation: { supportIntensity: "HIGH" } },
    } });
    const result = resolveCapabilityCandidates({ need: need(), registry: [parameterized] });
    expect(result).toMatchObject({ decision: "PARAMETERIZE", selectedCapabilityVersionId: null, noMatch: false, teacherEscalation: true });
    expect(result.parameterizationRecommendation).toMatchObject({ capabilityVersionId: parameterized.versionId, parameters: { supportIntensity: "HIGH" } });
  });

  it("recommends composition only when eligible versions cover the required tags", () => {
    const first = candidate(1, { resolution: { exactMatchSignals: ["different"], composition: { supported: true, contributes: ["step-a"] } } });
    const second = candidate(2, { resolution: { exactMatchSignals: ["different"], composition: { supported: true, contributes: ["step-b"] } } });
    const result = resolveCapabilityCandidates({
      need: need({ signals: ["step-a", "step-b"], compositionRequiredTags: ["step-a", "step-b"] }),
      registry: [second, first],
    });
    expect(result).toMatchObject({ decision: "COMPOSE", selectedCapabilityVersionId: null, teacherEscalation: true });
    expect(result.compositionRecommendation?.capabilityVersionIds).toHaveLength(2);
    expect(result.compositionRecommendation?.coveredTags).toEqual(["step-a", "step-b"]);
  });

  it("distinguishes reviewed adaptation, generated proposal recommendation and explicit no-match", () => {
    const adaptable = candidate(1, { resolution: {
      exactMatchSignals: ["different"],
      adaptation: { reviewed: true, signals: ["target-skill"] },
    } });
    expect(resolveCapabilityCandidates({ need: need(), registry: [adaptable] })).toMatchObject({
      decision: "ADAPT",
      selectedCapabilityVersionId: null,
      noMatch: true,
      gapSignal: { kind: "ADAPTATION_REQUIRED", relatedCapabilityVersionId: adaptable.versionId },
    });
    expect(resolveCapabilityCandidates({ need: need({ generationAllowed: true }), registry: [] })).toMatchObject({
      decision: "GENERATE",
      selectedCapabilityVersionId: null,
      noMatch: true,
      gapSignal: { kind: "GENERATION_REQUIRED" },
    });
    expect(resolveCapabilityCandidates({ need: need({ generationAllowed: false }), registry: [] })).toMatchObject({
      decision: "NO_MATCH",
      selectedCapabilityVersionId: null,
      noMatch: true,
      teacherEscalation: true,
      gapSignal: { kind: "NO_MATCH" },
    });
  });

  it("keeps incomplete legacy contracts visible and ineligible", () => {
    const legacy = candidate(1, { contract: { input: "text support", output: "article" } });
    const result = resolveCapabilityCandidates({ need: need(), registry: [legacy] });
    expect(result.candidates[0]).toMatchObject({ eligibility: "EXCLUDED", exclusionReasons: expect.arrayContaining(["INELIGIBLE"]) });
    expect(result.decision).toBe("NO_MATCH");
  });
});

