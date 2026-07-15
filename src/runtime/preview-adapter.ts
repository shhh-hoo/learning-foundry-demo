import type { DiagnosisFailureCode, PublishedDiagnosticLearningComponent } from "../contracts/diagnostic-component";

export interface PreviewAttempt {
  readonly value: number;
  readonly unit: string;
  readonly significantFigures: number;
  readonly strategy: "CANONICAL" | "WRONG_RATIO" | "MISSING_LINK";
  readonly arithmeticWorkingValue?: number;
}

export interface PreviewDiagnosis {
  readonly decision: "SOLVED" | "STUDENT_ERROR";
  readonly firstFailureCode: DiagnosisFailureCode | null;
  readonly stage: string | null;
  readonly evidence: readonly string[];
}

export function evaluatePreviewAttempt(component: PublishedDiagnosticLearningComponent, attempt: PreviewAttempt): PreviewDiagnosis {
  if (component.target.kind !== "KP" && component.target.kind !== "MASS") throw new Error(`No runtime adapter for ${component.target.kind}.`);
  if (attempt.strategy === "MISSING_LINK") return { decision: "STUDENT_ERROR", firstFailureCode: "MISSING_REASONING_LINK", stage: "STRATEGY", evidence: ["A required reasoning node was not evidenced."] };
  if (component.target.kind === "MASS" && attempt.strategy === "WRONG_RATIO") return { decision: "STUDENT_ERROR", firstFailureCode: "WRONG_STOICHIOMETRIC_RATIO", stage: "FORMULA", evidence: ["The learner ratio does not match the authored balanced-equation coefficients."] };
  if (attempt.arithmeticWorkingValue !== undefined && Math.abs(attempt.arithmeticWorkingValue - component.target.expectedValue) > component.target.absoluteTolerance) return { decision: "STUDENT_ERROR", firstFailureCode: "ARITHMETIC_ERROR", stage: "ARITHMETIC", evidence: ["The declared result does not match deterministic recomputation."] };
  if (Math.abs(attempt.value - component.target.expectedValue) > component.target.absoluteTolerance) return { decision: "STUDENT_ERROR", firstFailureCode: "WRONG_VALUE_SUBSTITUTED", stage: "SUBSTITUTION", evidence: [`Expected ${component.target.expectedValue}; observed ${attempt.value}.`] };
  if (!component.target.acceptedUnits.includes(attempt.unit)) return { decision: "STUDENT_ERROR", firstFailureCode: "UNIT_ERROR", stage: "UNIT", evidence: [`${attempt.unit || "No unit"} is outside ${component.target.acceptedUnits.join(" / ")}.`] };
  if (attempt.significantFigures !== component.target.significantFigures) return { decision: "STUDENT_ERROR", firstFailureCode: "SIGNIFICANT_FIGURES_ERROR", stage: "PRECISION", evidence: [`Expected ${component.target.significantFigures} significant figures.`] };
  return { decision: "SOLVED", firstFailureCode: null, stage: null, evidence: ["Target, reasoning route, value, unit and precision satisfy the published contract."] };
}

