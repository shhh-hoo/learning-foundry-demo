import type { AgentEvalCase } from "./agenteval";

export const AGENT_EVAL_LAYERS = ["SMOKE", "CONTRACT", "GENERALIZATION", "ADVERSARIAL", "RETRIEVAL"] as const;
export type AgentEvalLayer = typeof AGENT_EVAL_LAYERS[number];
export const RETRIEVAL_GENERALIZATION_VARIANTS = ["ENGLISH_PARAPHRASE", "CHINESE", "BILINGUAL", "IMPLICIT_CONCEPT", "NEAR_NEIGHBOR"] as const;
export type RetrievalGeneralizationVariant = typeof RETRIEVAL_GENERALIZATION_VARIANTS[number];
export const DIAGNOSIS_GENERALIZATION_DIMENSIONS = ["REACTION", "NUMBERS", "UNITS", "WORD_ORDER", "CORRECT_RESULT", "WRONG_RATIO", "ARITHMETIC", "SIGNIFICANT_FIGURES", "CAPABILITY_BOUNDARY"] as const;
export type DiagnosisGeneralizationDimension = typeof DIAGNOSIS_GENERALIZATION_DIMENSIONS[number];

export function parseAgentEvalLayer(value: string): AgentEvalLayer {
  if (AGENT_EVAL_LAYERS.includes(value as AgentEvalLayer)) return value as AgentEvalLayer;
  throw new Error(`AGENT_EVAL_LAYER_INVALID: ${value}`);
}

export function selectAgentEvalLayer(cases: readonly AgentEvalCase[], layer: AgentEvalLayer): readonly AgentEvalCase[] {
  return cases.filter((testCase) => testCase.suiteLayers?.includes(layer));
}

export function validateAgentEvalSuite(cases: readonly AgentEvalCase[]): void {
  const counts = new Map<string, number>();
  cases.forEach((testCase) => counts.set(testCase.caseId, (counts.get(testCase.caseId) ?? 0) + 1));
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([caseId]) => caseId).sort();
  if (duplicated.length) throw new Error(`AGENT_EVAL_CASE_IDS_DUPLICATED: ${duplicated.join(", ")}`);
  const unlayered = cases.filter((testCase) => !testCase.suiteLayers?.length).map((testCase) => testCase.caseId).sort();
  if (unlayered.length) throw new Error(`AGENT_EVAL_CASE_LAYERS_MISSING: ${unlayered.join(", ")}`);
  const invalidLayers = cases.flatMap((testCase) =>
    (testCase.suiteLayers ?? [])
      .filter((layer) => !AGENT_EVAL_LAYERS.includes(layer))
      .map((layer) => `${testCase.caseId}=${layer}`),
  ).sort();
  if (invalidLayers.length) throw new Error(`AGENT_EVAL_CASE_LAYERS_INVALID: ${invalidLayers.join(", ")}`);
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
      || !testCase.suiteLayers.includes("RETRIEVAL")
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
