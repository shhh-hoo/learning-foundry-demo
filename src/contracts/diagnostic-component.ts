import type { ExpressionAst } from "./expression-ast";

export type DiagnosticTargetKind =
  | "KP"
  | "KC"
  | "AMOUNT"
  | "MASS"
  | "CONCENTRATION"
  | "VOLUME"
  | "PH"
  | "OTHER_BOUNDED";

export type DiagnosisCategory =
  | "DATA_EXTRACTION"
  | "TARGET_IDENTIFICATION"
  | "STRATEGY"
  | "FORMULA"
  | "SUBSTITUTION"
  | "ARITHMETIC"
  | "UNIT"
  | "PRECISION";

export type DiagnosisFailureCode =
  | "RELEVANT_DATA_OMITTED"
  | "IRRELEVANT_DATA_USED"
  | "TARGET_MISIDENTIFIED"
  | "WRONG_METHOD"
  | "MISSING_REASONING_LINK"
  | "WRONG_FORMULA"
  | "WRONG_STOICHIOMETRIC_RATIO"
  | "WRONG_VALUE_SUBSTITUTED"
  | "ARITHMETIC_ERROR"
  | "UNIT_ERROR"
  | "SIGNIFICANT_FIGURES_ERROR";

export type ReasoningEvidenceKind =
  | "EXPLICIT_STEP"
  | "FORMULA_AST"
  | "EQUATION"
  | "DECLARED_RESULT"
  | "FACT_USE"
  | "TARGET_STATEMENT"
  | "EMBEDDED_CALCULATION";

export interface AuthoredFact {
  readonly id: string;
  readonly label: string;
  readonly value: number | string;
  readonly unit?: string;
  readonly relevance: "REQUIRED" | "IRRELEVANT";
}

export interface DiagnosticTargetDefinition {
  readonly kind: DiagnosticTargetKind;
  readonly expectedValue: number;
  readonly acceptedUnits: readonly string[];
  readonly significantFigures: number;
  readonly absoluteTolerance: number;
  readonly resultReasoningNodeId: string;
}

export interface FormulaDefinition {
  readonly id: string;
  readonly targetReasoningNodeId: string;
  readonly expression: ExpressionAst;
}

export interface ReasoningNodeDefinition {
  readonly id: string;
  readonly label: string;
  readonly category: DiagnosisCategory;
  readonly concept: string | null;
  readonly dependencies: readonly string[];
  readonly solutionEvidenceKinds: readonly ReasoningEvidenceKind[];
}

export interface AcceptedStrategyDefinition {
  readonly id: string;
  readonly label: string;
  readonly nodeRequirements: readonly {
    readonly nodeId: string;
    readonly requirement: "REQUIRED" | "OPTIONAL";
    readonly allowedEvidenceKinds: readonly ReasoningEvidenceKind[];
  }[];
}

export interface HintDefinition {
  readonly id: string;
  readonly stage: DiagnosisCategory;
  readonly level: 1 | 2 | 3 | 4;
  readonly text: string;
  readonly revealedReasoningNodeIds: readonly string[];
}

export interface MarkSchemePoint {
  readonly id: string;
  readonly reasoningNodeId: string;
  readonly description: string;
  readonly marks: number;
}

export interface DiagnosticLearningComponent {
  readonly schemaVersion: string;
  readonly id: string;
  readonly version: string;
  readonly status: "DRAFT" | "APPROVED" | "PUBLISHED";
  readonly curriculum: {
    readonly board: "CAIE";
    readonly syllabusCode: "9701";
    readonly subject: "Chemistry";
    readonly topic: string;
    readonly learningObjectiveId: string;
    readonly learningObjectiveText: string;
    readonly sourceIds: readonly string[];
  };
  readonly presentation: {
    readonly title: string;
    readonly prompt: string;
    readonly reaction?: string;
    readonly marks: number;
  };
  readonly authoredFacts: readonly AuthoredFact[];
  readonly target: DiagnosticTargetDefinition;
  readonly formulaDefinitions: readonly FormulaDefinition[];
  readonly reasoningGraph: {
    readonly version: string;
    readonly pedagogicalOrder: readonly string[];
    readonly nodes: Readonly<Record<string, ReasoningNodeDefinition>>;
    readonly acceptedStrategies: readonly AcceptedStrategyDefinition[];
  };
  readonly diagnosisPolicy: {
    readonly version: string;
    readonly categoryOrder: readonly DiagnosisCategory[];
    readonly supportedFailureCodes: readonly DiagnosisFailureCode[];
  };
  readonly hintPolicy: {
    readonly version: string;
    readonly automaticEscalationAfterConsecutiveFailures: number;
    readonly hints: readonly HintDefinition[];
  };
  readonly markScheme: readonly MarkSchemePoint[];
  readonly provenance:
    | { readonly origin: "MIGRATED"; readonly sourceComponentId: string }
    | { readonly origin: "AI_GENERATED"; readonly generatorId: string; readonly promptVersion: string; readonly generatedAt: string }
    | { readonly origin: "EXPERT_AUTHORED" };
  readonly migration?: {
    readonly fidelity: "LOSSLESS" | "SIMPLIFIED";
    readonly sourceContractVersion?: string;
    readonly omittedCapabilities: readonly string[];
  };
  readonly review?: {
    readonly reviewer: string;
    readonly reviewedAt: string;
    readonly notes: string;
  };
  readonly publication?: {
    readonly publishedAt: string;
    readonly publishedBy: string;
    readonly contentHash: string;
  };
}

export interface PublishedDiagnosticLearningComponent extends DiagnosticLearningComponent {
  readonly status: "PUBLISHED";
  readonly review: NonNullable<DiagnosticLearningComponent["review"]>;
  readonly publication: NonNullable<DiagnosticLearningComponent["publication"]>;
}

export interface RuntimeCapabilityProfile {
  readonly runtimeId: string;
  readonly runtimeVersion: string;
  readonly supportedSchemaVersions: readonly string[];
  readonly supportedTargetKinds: readonly DiagnosticTargetKind[];
  readonly supportedExpressionNodes: readonly string[];
  readonly supportedDiagnosisCategories: readonly DiagnosisCategory[];
  readonly supportedFailureCodes: readonly DiagnosisFailureCode[];
  readonly limitations: readonly string[];
}
