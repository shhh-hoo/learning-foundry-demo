import { binaryExpression as b, factVariable as f, quantityVariable as q } from "../contracts/expression-ast";
import type { DiagnosticLearningComponent } from "../contracts/diagnostic-component";
import { COMPONENT_SCHEMA_VERSION } from "../contracts/schema-version";
import { categoryOrder, failureCodes, publishedReview } from "./shared";

const order = ["select-data", "identify-target", "amount-magnesium", "apply-mole-ratio", "amount-magnesium-oxide", "mass-magnesium-oxide", "report-unit", "report-precision"];
const definitions: readonly [string, string, DiagnosticLearningComponent["diagnosisPolicy"]["categoryOrder"][number], readonly string[]][] = [
  ["select-data", "Select mass, relative masses and equation coefficients", "DATA_EXTRACTION", []],
  ["identify-target", "Identify product mass as the target", "TARGET_IDENTIFICATION", []],
  ["amount-magnesium", "Convert magnesium mass to amount", "STRATEGY", ["select-data"]],
  ["apply-mole-ratio", "Use the 2:2 stoichiometric ratio", "FORMULA", ["amount-magnesium"]],
  ["amount-magnesium-oxide", "Calculate amount of magnesium oxide", "SUBSTITUTION", ["apply-mole-ratio"]],
  ["mass-magnesium-oxide", "Calculate mass of magnesium oxide", "ARITHMETIC", ["amount-magnesium-oxide"]],
  ["report-unit", "Report the answer in grams", "UNIT", ["mass-magnesium-oxide"]],
  ["report-precision", "Report three significant figures", "PRECISION", ["mass-magnesium-oxide"]],
];
const nodes = Object.fromEntries(definitions.map(([id, label, category, dependencies]) => [id, { id, label, category, dependencies, concept: id, solutionEvidenceKinds: ["EXPLICIT_STEP", "EQUATION", "DECLARED_RESULT"] }])) as DiagnosticLearningComponent["reasoningGraph"]["nodes"];

export const massDraft: DiagnosticLearningComponent = {
  schemaVersion: COMPONENT_SCHEMA_VERSION,
  id: "stoichiometric-product-mass",
  version: "1.0.0",
  status: "APPROVED",
  curriculum: {
    board: "CAIE", syllabusCode: "9701", subject: "Chemistry", topic: "Stoichiometry",
    learningObjectiveId: "9701-STOICHIOMETRY-MASS-01",
    learningObjectiveText: "Calculate product mass using a balanced equation and mole ratio.",
    sourceIds: ["CAIE-9701-SYLLABUS-CONCEPTS", "LF-AUTHORED-PATTERNS-v1"],
  },
  presentation: {
    title: "Stoichiometric product mass", reaction: "2Mg + O₂ → 2MgO",
    prompt: "Magnesium reacts with excess oxygen. A student reacts 4.80 g Mg. Ar(Mg) = 24.0 and Mr(MgO) = 40.0. Calculate the mass of MgO formed to 3 significant figures.", marks: 4,
  },
  authoredFacts: [
    { id: "mass-magnesium", label: "Mass of magnesium", value: 4.8, unit: "g", relevance: "REQUIRED" },
    { id: "mr-magnesium", label: "Ar of magnesium", value: 24, relevance: "REQUIRED" },
    { id: "mr-magnesium-oxide", label: "Mr of magnesium oxide", value: 40, relevance: "REQUIRED" },
    { id: "coefficient-magnesium", label: "Equation coefficient Mg", value: 2, relevance: "REQUIRED" },
    { id: "coefficient-magnesium-oxide", label: "Equation coefficient MgO", value: 2, relevance: "REQUIRED" },
  ],
  target: { kind: "MASS", expectedValue: 8, acceptedUnits: ["g"], significantFigures: 3, absoluteTolerance: 0.001, resultReasoningNodeId: "mass-magnesium-oxide" },
  formulaDefinitions: [
    { id: "amount-magnesium-formula", targetReasoningNodeId: "amount-magnesium", expression: b("DIVIDE", f("mass-magnesium", "m_Mg"), f("mr-magnesium", "Ar_Mg")) },
    { id: "amount-mgo-formula", targetReasoningNodeId: "amount-magnesium-oxide", expression: b("MULTIPLY", q("amount-magnesium", "n_Mg"), b("DIVIDE", f("coefficient-magnesium-oxide", "coefficient_MgO"), f("coefficient-magnesium", "coefficient_Mg"))) },
    { id: "mass-mgo-formula", targetReasoningNodeId: "mass-magnesium-oxide", expression: b("MULTIPLY", q("amount-magnesium-oxide", "n_MgO"), f("mr-magnesium-oxide", "Mr_MgO")) },
  ],
  reasoningGraph: { version: "mass-reasoning-graph-1.0.0", pedagogicalOrder: order, nodes, acceptedStrategies: [{ id: "MOLES_RATIO_MASS", label: "Mass → amount → balanced ratio → mass", nodeRequirements: order.map((nodeId) => ({ nodeId, requirement: "REQUIRED", allowedEvidenceKinds: ["EXPLICIT_STEP", "EQUATION", "DECLARED_RESULT"] })) }] },
  diagnosisPolicy: { version: "diagnosis-policy-1.0.0", categoryOrder, supportedFailureCodes: failureCodes },
  hintPolicy: { version: "hint-policy-1.0.0", automaticEscalationAfterConsecutiveFailures: 2, hints: [
    { id: "mass-strategy", stage: "STRATEGY", level: 2, text: "Convert the magnesium mass to amount before using the equation.", revealedReasoningNodeIds: ["amount-magnesium"] },
    { id: "mass-ratio", stage: "FORMULA", level: 3, text: "Compare the coefficients of Mg and MgO in the balanced equation.", revealedReasoningNodeIds: ["apply-mole-ratio"] },
  ] },
  markScheme: [
    { id: "mass-m1", reasoningNodeId: "amount-magnesium", description: "Calculates 4.80 / 24.0 = 0.200 mol", marks: 1 },
    { id: "mass-m2", reasoningNodeId: "apply-mole-ratio", description: "Uses the 2:2 Mg:MgO mole ratio", marks: 1 },
    { id: "mass-m3", reasoningNodeId: "mass-magnesium-oxide", description: "Calculates 0.200 × 40.0 = 8.00", marks: 1 },
    { id: "mass-a1", reasoningNodeId: "report-unit", description: "Reports 8.00 g to 3 significant figures", marks: 1 },
  ],
  provenance: { origin: "EXPERT_AUTHORED" },
  review: publishedReview,
};

