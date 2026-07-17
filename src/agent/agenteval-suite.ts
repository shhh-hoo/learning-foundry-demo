import type { AgentEvalCase } from "./agenteval";

export const AGENT_EVAL_LAYERS = ["SMOKE", "CORE_CONTRACT", "REFERENCE_PACK", "GENERALIZATION", "ADVERSARIAL", "LEARNING_LOOP"] as const;
export type AgentEvalLayer = typeof AGENT_EVAL_LAYERS[number];
export const AGENT_EVAL_DIMENSIONS = ["CONTEXT", "RETRIEVAL", "INTERPRETATION", "PEDAGOGY", "COMPONENT", "OUTCOME", "CAPABILITY_BOUNDARY"] as const;
export type AgentEvalDimension = typeof AGENT_EVAL_DIMENSIONS[number];
export const RETRIEVAL_GENERALIZATION_VARIANTS = ["ENGLISH_PARAPHRASE", "CHINESE", "BILINGUAL", "IMPLICIT_CONCEPT", "NEAR_NEIGHBOR"] as const;
export type RetrievalGeneralizationVariant = typeof RETRIEVAL_GENERALIZATION_VARIANTS[number];
export const DIAGNOSIS_GENERALIZATION_DIMENSIONS = ["REACTION", "NUMBERS", "UNITS", "WORD_ORDER", "CORRECT_RESULT", "WRONG_RATIO", "ARITHMETIC", "SIGNIFICANT_FIGURES", "CAPABILITY_BOUNDARY"] as const;
export type DiagnosisGeneralizationDimension = typeof DIAGNOSIS_GENERALIZATION_DIMENSIONS[number];
export const EXPECTED_CAPABILITY_RESOLUTIONS = ["FULL_MATCH", "PARTIAL_MATCH", "NO_MATCH"] as const;
export type ExpectedCapabilityResolution = typeof EXPECTED_CAPABILITY_RESOLUTIONS[number];

export interface AgentEvalSelection {
  readonly mode: "FULL" | "CHECKPOINT" | "BASELINE" | "LAYER" | "DIMENSION";
  readonly value?: string;
}

export interface AgentEvalBehaviorContract {
  readonly caseId: string;
  readonly input: string;
  readonly expectedStatus: readonly string[];
  readonly requiredTools: readonly string[];
  readonly forbiddenTools: readonly string[];
  readonly allowedCapabilities: readonly string[];
  readonly requiredSourceIds?: readonly string[];
  readonly expectedFailureCode?: string | null;
  readonly forbiddenClaims?: readonly string[];
}

export function parseAgentEvalLayer(value: string): AgentEvalLayer {
  if (AGENT_EVAL_LAYERS.includes(value as AgentEvalLayer)) return value as AgentEvalLayer;
  throw new Error(`AGENT_EVAL_LAYER_INVALID: ${value}`);
}

export function parseAgentEvalDimension(value: string): AgentEvalDimension {
  if (AGENT_EVAL_DIMENSIONS.includes(value as AgentEvalDimension)) return value as AgentEvalDimension;
  throw new Error(`AGENT_EVAL_DIMENSION_INVALID: ${value}`);
}

export function selectAgentEvalLayer(cases: readonly AgentEvalCase[], layer: AgentEvalLayer): readonly AgentEvalCase[] {
  return cases.filter((testCase) => testCase.suiteLayers?.includes(layer));
}

export function selectAgentEvalDimension(cases: readonly AgentEvalCase[], dimension: AgentEvalDimension): readonly AgentEvalCase[] {
  return cases.filter((testCase) => testCase.evaluationDimensions?.includes(dimension));
}

export function requireNonEmptyAgentEvalSelection<T>(selection: AgentEvalSelection, cases: readonly T[]): readonly T[] {
  if ((selection.mode === "LAYER" || selection.mode === "DIMENSION") && cases.length === 0) {
    throw new Error(`AGENT_EVAL_SELECTION_EMPTY: ${selection.mode} ${selection.value ?? "UNKNOWN"} selected 0 cases`);
  }
  return cases;
}

export function buildAgentEvalSuitePlan(cases: readonly AgentEvalCase[]) {
  return {
    layerCaseIds: Object.fromEntries(AGENT_EVAL_LAYERS.map((layer) => [
      layer,
      selectAgentEvalLayer(cases, layer).map((testCase) => testCase.caseId),
    ])) as Record<AgentEvalLayer, string[]>,
    dimensionCaseIds: Object.fromEntries(AGENT_EVAL_DIMENSIONS.map((dimension) => [
      dimension,
      selectAgentEvalDimension(cases, dimension).map((testCase) => testCase.caseId),
    ])) as Record<AgentEvalDimension, string[]>,
    capabilityResolutionCaseIds: Object.fromEntries(EXPECTED_CAPABILITY_RESOLUTIONS.map((resolution) => [
      resolution,
      cases.filter((testCase) => testCase.expectedCapabilityResolution === resolution).map((testCase) => testCase.caseId),
    ])) as Record<ExpectedCapabilityResolution, string[]>,
  };
}

function behaviorContract(testCase: AgentEvalCase): AgentEvalBehaviorContract {
  return {
    caseId: testCase.caseId,
    input: testCase.input,
    expectedStatus: testCase.expectedStatus,
    requiredTools: testCase.requiredTools,
    forbiddenTools: testCase.forbiddenTools,
    allowedCapabilities: testCase.allowedCapabilities,
    ...(testCase.requiredSourceIds !== undefined ? { requiredSourceIds: testCase.requiredSourceIds } : {}),
    ...(testCase.expectedFailureCode !== undefined ? { expectedFailureCode: testCase.expectedFailureCode } : {}),
    ...(testCase.forbiddenClaims !== undefined ? { forbiddenClaims: testCase.forbiddenClaims } : {}),
  };
}

export function selectAgentEvalBaseline(cases: readonly AgentEvalCase[], baseline: readonly AgentEvalBehaviorContract[]): readonly AgentEvalCase[] {
  const byId = new Map(cases.map((testCase) => [testCase.caseId, testCase]));
  return baseline.map((expected) => {
    const current = byId.get(expected.caseId);
    if (!current) throw new Error(`AGENT_EVAL_BASELINE_CASE_MISSING: ${expected.caseId}`);
    if (JSON.stringify(behaviorContract(current)) !== JSON.stringify(expected)) {
      throw new Error(`AGENT_EVAL_BASELINE_DRIFT: ${expected.caseId}`);
    }
    return current;
  });
}

export function validateAgentEvalSuite(cases: readonly AgentEvalCase[]): void {
  const counts = new Map<string, number>();
  cases.forEach((testCase) => counts.set(testCase.caseId, (counts.get(testCase.caseId) ?? 0) + 1));
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([caseId]) => caseId).sort();
  if (duplicated.length) throw new Error(`AGENT_EVAL_CASE_IDS_DUPLICATED: ${duplicated.join(", ")}`);
  const unlayered = cases.filter((testCase) => !testCase.suiteLayers?.length).map((testCase) => testCase.caseId).sort();
  if (unlayered.length) throw new Error(`AGENT_EVAL_CASE_LAYERS_MISSING: ${unlayered.join(", ")}`);
  const undimensioned = cases.filter((testCase) => !testCase.evaluationDimensions?.length).map((testCase) => testCase.caseId).sort();
  if (undimensioned.length) throw new Error(`AGENT_EVAL_CASE_DIMENSIONS_MISSING: ${undimensioned.join(", ")}`);
  const invalidLayers = cases.flatMap((testCase) =>
    (testCase.suiteLayers ?? [])
      .filter((layer) => !AGENT_EVAL_LAYERS.includes(layer))
      .map((layer) => `${testCase.caseId}=${layer}`),
  ).sort();
  if (invalidLayers.length) throw new Error(`AGENT_EVAL_CASE_LAYERS_INVALID: ${invalidLayers.join(", ")}`);
  const invalidDimensions = cases.flatMap((testCase) =>
    (testCase.evaluationDimensions ?? [])
      .filter((dimension) => !AGENT_EVAL_DIMENSIONS.includes(dimension))
      .map((dimension) => `${testCase.caseId}=${dimension}`),
  ).sort();
  if (invalidDimensions.length) throw new Error(`AGENT_EVAL_CASE_DIMENSIONS_INVALID: ${invalidDimensions.join(", ")}`);
  const invalidRetrievalVariants = cases
    .filter((testCase) => testCase.retrievalVariant && !RETRIEVAL_GENERALIZATION_VARIANTS.includes(testCase.retrievalVariant))
    .map((testCase) => `${testCase.caseId}=${testCase.retrievalVariant}`)
    .sort();
  if (invalidRetrievalVariants.length) throw new Error(`AGENT_EVAL_RETRIEVAL_VARIANTS_INVALID: ${invalidRetrievalVariants.join(", ")}`);
  const invalidDiagnosisDimensions = cases.flatMap((testCase) =>
    (testCase.diagnosisDimensions ?? [])
      .filter((dimension) => !DIAGNOSIS_GENERALIZATION_DIMENSIONS.includes(dimension))
      .map((dimension) => `${testCase.caseId}=${dimension}`),
  ).sort();
  if (invalidDiagnosisDimensions.length) throw new Error(`AGENT_EVAL_DIAGNOSIS_DIMENSIONS_INVALID: ${invalidDiagnosisDimensions.join(", ")}`);
  const invalidRetrievalContracts = cases
    .filter((testCase) => testCase.retrievalVariant && (
      testCase.category !== "retrieval"
      || !testCase.suiteLayers?.includes("GENERALIZATION")
      || !testCase.evaluationDimensions?.includes("RETRIEVAL")
      || !testCase.requiredSourceIds?.length
    ))
    .map((testCase) => testCase.caseId)
    .sort();
  if (invalidRetrievalContracts.length) throw new Error(`AGENT_EVAL_RETRIEVAL_CONTRACT_INVALID: ${invalidRetrievalContracts.join(", ")}`);
  const invalidDiagnosisContracts = cases
    .filter((testCase) => testCase.diagnosisDimensions?.length && (
      !["diagnosis", "capability-gap"].includes(testCase.category)
      || !testCase.suiteLayers?.includes("GENERALIZATION")
    ))
    .map((testCase) => testCase.caseId)
    .sort();
  if (invalidDiagnosisContracts.length) throw new Error(`AGENT_EVAL_DIAGNOSIS_CONTRACT_INVALID: ${invalidDiagnosisContracts.join(", ")}`);
  const invalidCapabilityResolutions = cases
    .filter((testCase) => testCase.expectedCapabilityResolution && !EXPECTED_CAPABILITY_RESOLUTIONS.includes(testCase.expectedCapabilityResolution))
    .map((testCase) => `${testCase.caseId}=${testCase.expectedCapabilityResolution}`)
    .sort();
  if (invalidCapabilityResolutions.length) throw new Error(`AGENT_EVAL_CAPABILITY_RESOLUTIONS_INVALID: ${invalidCapabilityResolutions.join(", ")}`);
  const invalidCapabilityResolutionContracts = cases
    .filter((testCase) => (
      testCase.suiteLayers?.includes("GENERALIZATION") && !testCase.expectedCapabilityResolution
    ) || (
      testCase.expectedCapabilityResolution && !testCase.suiteLayers?.includes("GENERALIZATION")
    ) || (
      testCase.expectedCapabilityResolution === "NO_MATCH" && !testCase.evaluationDimensions?.includes("CAPABILITY_BOUNDARY")
    ) || (
      testCase.expectedCapabilityResolution === "FULL_MATCH" && testCase.evaluationDimensions?.includes("CAPABILITY_BOUNDARY")
    ))
    .map((testCase) => testCase.caseId)
    .sort();
  if (invalidCapabilityResolutionContracts.length) throw new Error(`AGENT_EVAL_CAPABILITY_RESOLUTION_CONTRACT_INVALID: ${invalidCapabilityResolutionContracts.join(", ")}`);
}

export function summarizeAgentEvalCoverage(cases: readonly AgentEvalCase[]) {
  const retrievalVariants = Object.fromEntries(RETRIEVAL_GENERALIZATION_VARIANTS.map((variant) => [variant, 0])) as Record<RetrievalGeneralizationVariant, number>;
  const diagnosisDimensions = Object.fromEntries(DIAGNOSIS_GENERALIZATION_DIMENSIONS.map((dimension) => [dimension, 0])) as Record<DiagnosisGeneralizationDimension, number>;
  cases.forEach((testCase) => {
    if (testCase.retrievalVariant) retrievalVariants[testCase.retrievalVariant] += 1;
    testCase.diagnosisDimensions?.forEach((dimension) => { diagnosisDimensions[dimension] += 1; });
  });
  return { retrievalVariants, diagnosisDimensions };
}
