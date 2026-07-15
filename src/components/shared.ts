import type { DiagnosisCategory, DiagnosisFailureCode, DiagnosticLearningComponent } from "../contracts/diagnostic-component";

export const categoryOrder: readonly DiagnosisCategory[] = [
  "DATA_EXTRACTION", "TARGET_IDENTIFICATION", "STRATEGY", "FORMULA",
  "SUBSTITUTION", "ARITHMETIC", "UNIT", "PRECISION",
];

export const failureCodes: readonly DiagnosisFailureCode[] = [
  "RELEVANT_DATA_OMITTED", "IRRELEVANT_DATA_USED", "TARGET_MISIDENTIFIED",
  "WRONG_METHOD", "MISSING_REASONING_LINK", "WRONG_FORMULA",
  "WRONG_STOICHIOMETRIC_RATIO", "WRONG_VALUE_SUBSTITUTED", "ARITHMETIC_ERROR",
  "UNIT_ERROR", "SIGNIFICANT_FIGURES_ERROR",
];

export const publishedReview: NonNullable<DiagnosticLearningComponent["review"]> = {
  reviewer: "Dr A. Chen, CAIE Chemistry reviewer",
  reviewedAt: "2026-07-15T08:00:00.000Z",
  notes: "Checked the authored reasoning contract, recomputation, units, precision and mark allocation.",
};

