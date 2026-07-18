import type { EvidenceSufficiencyAssessment } from "./observability";

interface AssessmentInput {
  readonly toolId: string;
  readonly toolCallIndex: number;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly result?: unknown;
}
interface AssessorOptions {
  readonly createId?: (toolCallIndex: number) => string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function searchResults(result: unknown): readonly Record<string, unknown>[] {
  const value = object(result);
  return Array.isArray(value?.results) ? value.results.map(object).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

/** Foundry-owned educational Evidence judgment, independent from transport success. */
export class EvidenceSufficiencyAssessor {
  constructor(private readonly options: AssessorOptions = {}) {}

  assess(input: AssessmentInput): EvidenceSufficiencyAssessment {
    const assessmentId = this.options.createId?.(input.toolCallIndex) ?? `evidence-assessment-${input.toolCallIndex + 1}`;
    if (input.status === "FAILED") return {
      assessmentId, toolId: input.toolId, toolCallIndex: input.toolCallIndex,
      outcome: "EXECUTION_FAILED", topicalFit: "UNKNOWN", sourceAuthority: "UNKNOWN", coverage: "NONE",
      missingAspects: ["successful tool execution"], lineageComplete: false, contaminationRisk: "UNKNOWN",
      anotherCallJustified: false, continueOrStopReason: "Stop: the required tool did not produce Evidence.",
    };
    if (input.toolId !== "search_learning_resources") return {
      assessmentId, toolId: input.toolId, toolCallIndex: input.toolCallIndex,
      outcome: "SUFFICIENT_EVIDENCE", topicalFit: "ADEQUATE", sourceAuthority: "GOVERNED", coverage: "SUFFICIENT",
      missingAspects: [], lineageComplete: true, contaminationRisk: "NONE", anotherCallJustified: false,
      continueOrStopReason: "Continue: the governed tool result is available for the next planned step.",
    };

    const root = object(input.result);
    const results = searchResults(input.result);
    if (results.length === 0) return {
      assessmentId, toolId: input.toolId, toolCallIndex: input.toolCallIndex,
      outcome: "NO_RESULTS", topicalFit: "LOW", sourceAuthority: "UNKNOWN", coverage: "NONE",
      missingAspects: ["relevant governed Evidence"], lineageComplete: false, contaminationRisk: "NONE",
      anotherCallJustified: false, continueOrStopReason: "Stop: retrieval returned no Evidence and the Plan does not permit speculative repeated search.",
    };

    const governed = results.some((item) => item.sourceType === "OFFICIAL_SYLLABUS" || item.sourceType === "TEACHER_NOTE" || item.sourceType === "STRUCTURED_CASE");
    const relevanceUnknown = results.some((item) => typeof item.score !== "number" || !Number.isFinite(item.score));
    const topical = !relevanceUnknown && results.some((item) => typeof item.score === "number" && item.score > 0);
    const lineageComplete = results.every((item) => typeof item.sourceId === "string" && (typeof item.page === "number" || typeof item.section === "string"));
    const contaminationRisk = root?.contaminationRisk === "DETECTED" ? "DETECTED" as const : "NONE" as const;
    const declaredMissing = Array.isArray(root?.missingAspects) ? root.missingAspects.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
    if (!topical || !governed) {
      const missingAspects = [
        ...declaredMissing,
        ...(!topical ? [relevanceUnknown ? "explicit relevance score" : "topical fit"] : []),
        ...(!governed ? ["governed source authority"] : []),
      ];
      return {
        assessmentId, toolId: input.toolId, toolCallIndex: input.toolCallIndex,
        outcome: "LOW_RELEVANCE", topicalFit: topical ? "ADEQUATE" : relevanceUnknown ? "UNKNOWN" : "LOW", sourceAuthority: governed ? "GOVERNED" : "INSUFFICIENT", coverage: "PARTIAL",
        missingAspects, lineageComplete, contaminationRisk, anotherCallJustified: true,
        continueOrStopReason: `Continue only with one materially different search for: ${missingAspects.join(", ")}.`,
      };
    }
    if (declaredMissing.length > 0 || contaminationRisk === "DETECTED" || !lineageComplete) {
      const missingAspects = [
        ...declaredMissing,
        ...(contaminationRisk === "DETECTED" ? ["uncontaminated Evidence"] : []),
        ...(!lineageComplete ? ["complete source/page-or-section lineage"] : []),
      ];
      return {
        assessmentId, toolId: input.toolId, toolCallIndex: input.toolCallIndex,
        outcome: "PARTIAL_COVERAGE", topicalFit: "ADEQUATE", sourceAuthority: "GOVERNED", coverage: "PARTIAL",
        missingAspects, lineageComplete, contaminationRisk, anotherCallJustified: true,
        continueOrStopReason: `Continue only with one materially different search for: ${missingAspects.join(", ")}.`,
      };
    }
    return {
      assessmentId, toolId: input.toolId, toolCallIndex: input.toolCallIndex,
      outcome: "SUFFICIENT_EVIDENCE", topicalFit: "ADEQUATE", sourceAuthority: "GOVERNED", coverage: "SUFFICIENT",
      missingAspects: [], lineageComplete, contaminationRisk, anotherCallJustified: false,
      continueOrStopReason: "Stop retrieval: sufficient governed Evidence is available.",
    };
  }
}
