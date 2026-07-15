import { binaryExpression as b, factVariable as f, numberExpression as n, quantityVariable as q } from "../contracts/expression-ast";
import type { DiagnosticLearningComponent } from "../contracts/diagnostic-component";
import { COMPONENT_SCHEMA_VERSION } from "../contracts/schema-version";
import { categoryOrder, failureCodes, publishedReview } from "./shared";

const nodes: DiagnosticLearningComponent["reasoningGraph"]["nodes"] = Object.fromEntries([
  ["select-data", "Select equilibrium amounts and total pressure", "DATA_EXTRACTION", []],
  ["identify-target", "Identify Kp as the target", "TARGET_IDENTIFICATION", []],
  ["total-moles", "Calculate total equilibrium amount", "STRATEGY", ["select-data"]],
  ["partial-pressure-n2o4", "Calculate partial pressure of N₂O₄", "STRATEGY", ["total-moles"]],
  ["partial-pressure-no2", "Calculate partial pressure of NO₂", "STRATEGY", ["total-moles"]],
  ["construct-expression", "Construct the Kp expression", "FORMULA", ["identify-target"]],
  ["substitute-values", "Substitute partial pressures", "SUBSTITUTION", ["construct-expression", "partial-pressure-n2o4", "partial-pressure-no2"]],
  ["calculate-result", "Calculate Kp", "ARITHMETIC", ["substitute-values"]],
  ["report-unit", "Report pressure unit", "UNIT", ["calculate-result"]],
  ["report-precision", "Report three significant figures", "PRECISION", ["calculate-result"]],
].map(([id, label, category, dependencies]) => [id, {
  id, label, category, dependencies, concept: id, solutionEvidenceKinds: ["EXPLICIT_STEP", "EQUATION", "DECLARED_RESULT"],
}])) as DiagnosticLearningComponent["reasoningGraph"]["nodes"];

export const kpDraft: DiagnosticLearningComponent = {
  schemaVersion: COMPONENT_SCHEMA_VERSION,
  id: "kp-from-equilibrium-moles",
  version: "1.0.0",
  status: "APPROVED",
  curriculum: {
    board: "CAIE", syllabusCode: "9701", subject: "Chemistry", topic: "Equilibria",
    learningObjectiveId: "9701-EQUILIBRIA-KP-01",
    learningObjectiveText: "Calculate Kp from equilibrium amounts and total pressure.",
    sourceIds: ["CAIE-9701-SYLLABUS-CONCEPTS", "KP_FROM_EQUILIBRIUM_MOLES_V2_GOLD"],
  },
  presentation: {
    title: "Kp from equilibrium amounts",
    reaction: "N₂O₄(g) ⇌ 2NO₂(g)",
    prompt: "At equilibrium, a 2.00 dm³ vessel contains 0.400 mol N₂O₄ and 0.600 mol NO₂. The total pressure is 500 kPa. Calculate Kp and give the answer to 3 significant figures.",
    marks: 5,
  },
  authoredFacts: [
    { id: "n-n2o4", label: "Equilibrium amount N₂O₄", value: 0.4, unit: "mol", relevance: "REQUIRED" },
    { id: "n-no2", label: "Equilibrium amount NO₂", value: 0.6, unit: "mol", relevance: "REQUIRED" },
    { id: "total-pressure", label: "Total pressure", value: 500, unit: "kPa", relevance: "REQUIRED" },
    { id: "vessel-volume", label: "Vessel volume", value: 2, unit: "dm³", relevance: "IRRELEVANT" },
  ],
  target: { kind: "KP", expectedValue: 450, acceptedUnits: ["kPa"], significantFigures: 3, absoluteTolerance: 0.001, resultReasoningNodeId: "calculate-result" },
  formulaDefinitions: [
    { id: "total-moles-formula", targetReasoningNodeId: "total-moles", expression: { kind: "FUNCTION", name: "SUM", arguments: [f("n-n2o4", "n_N2O4"), f("n-no2", "n_NO2")] } },
    { id: "partial-pressure-n2o4-formula", targetReasoningNodeId: "partial-pressure-n2o4", expression: b("MULTIPLY", b("DIVIDE", f("n-n2o4", "n_N2O4"), q("total-moles", "n_total")), f("total-pressure", "P_total")) },
    { id: "partial-pressure-no2-formula", targetReasoningNodeId: "partial-pressure-no2", expression: b("MULTIPLY", b("DIVIDE", f("n-no2", "n_NO2"), q("total-moles", "n_total")), f("total-pressure", "P_total")) },
    { id: "kp-expression", targetReasoningNodeId: "calculate-result", expression: b("DIVIDE", b("POWER", q("partial-pressure-no2", "p_NO2"), n(2)), q("partial-pressure-n2o4", "p_N2O4")) },
  ],
  reasoningGraph: {
    version: "kp-reasoning-graph-1.0.0", pedagogicalOrder: Object.keys(nodes), nodes,
    acceptedStrategies: [{ id: "PARTIAL_PRESSURE_ROUTE", label: "Calculate both partial pressures before Kp", nodeRequirements: Object.keys(nodes).map((nodeId) => ({ nodeId, requirement: "REQUIRED", allowedEvidenceKinds: ["EXPLICIT_STEP", "EQUATION", "DECLARED_RESULT"] })) }],
  },
  diagnosisPolicy: { version: "diagnosis-policy-1.0.0", categoryOrder, supportedFailureCodes: failureCodes },
  hintPolicy: { version: "hint-policy-1.0.0", automaticEscalationAfterConsecutiveFailures: 2, hints: [
    { id: "kp-strategy", stage: "STRATEGY", level: 2, text: "Use mole fraction to obtain each partial pressure.", revealedReasoningNodeIds: ["total-moles"] },
    { id: "kp-formula", stage: "FORMULA", level: 3, text: "Use the stoichiometric powers in the Kp expression.", revealedReasoningNodeIds: ["construct-expression"] },
  ] },
  markScheme: [
    { id: "kp-m1", reasoningNodeId: "total-moles", description: "Uses equilibrium amounts to calculate mole fractions", marks: 1 },
    { id: "kp-m2", reasoningNodeId: "partial-pressure-n2o4", description: "Calculates partial pressure of N₂O₄", marks: 1 },
    { id: "kp-m3", reasoningNodeId: "partial-pressure-no2", description: "Calculates partial pressure of NO₂", marks: 1 },
    { id: "kp-m4", reasoningNodeId: "construct-expression", description: "Uses p(NO₂)² / p(N₂O₄)", marks: 1 },
    { id: "kp-a1", reasoningNodeId: "calculate-result", description: "Reports 450 kPa to 3 significant figures", marks: 1 },
  ],
  provenance: { origin: "MIGRATED", sourceComponentId: "KP_FROM_EQUILIBRIUM_MOLES_V2_GOLD" },
  review: publishedReview,
};

