import { publishedComponents } from "../components/published";
import type { DiagnosticLearningComponent } from "../contracts/diagnostic-component";
import { incrementVersion } from "../governance/publishing";
import { evaluatePreviewAttempt } from "../runtime/preview-adapter";
import { createDemoEvent } from "../demo/events";
import type { DiagnosticEvidenceArtifact, ExperienceState, FoundryCandidateHandoff, PatternAggregate } from "./types";

const learnerMessage = `I calculated the mass of MgO as 4.00 g.
I used 4.80 / 24.0 and then multiplied by 0.5.
Where did I go wrong?`;

const groundedResponse = `Your conversion from 4.80 g Mg to 0.200 mol Mg is correct.

The first error is the mole ratio. In 2Mg + O₂ → 2MgO, the Mg:MgO ratio is 2:2, or 1:1—not 0.5.

So 0.200 mol Mg forms 0.200 mol MgO, giving 0.200 × 40.0 = 8.00 g.`;

export function createInitialExperienceState(): ExperienceState {
  const historicalEvidence: readonly DiagnosticEvidenceArtifact[] = [
    {
      id: "historical-case-001",
      conversationId: "historical-conversation-001",
      componentId: "stoichiometric-product-mass",
      componentVersion: "1.0.0",
      stage: "FORMULA",
      failureCode: "WRONG_STOICHIOMETRIC_RATIO",
      observedEvidence: { observedRatio: 2, expectedRatio: 1 },
      createdAt: "2026-06-20T09:00:00.000Z",
    },
    {
      id: "historical-case-002",
      conversationId: "historical-conversation-002",
      componentId: "stoichiometric-product-mass",
      componentVersion: "1.0.0",
      stage: "FORMULA",
      failureCode: "WRONG_STOICHIOMETRIC_RATIO",
      observedEvidence: { observedRatio: 0.5, expectedRatio: 1 },
      createdAt: "2026-07-03T09:00:00.000Z",
    },
  ];
  return {
    conversation: {
      id: "conversation-mgo-001",
      messages: [{ id: "message-student-001", role: "STUDENT", content: learnerMessage }],
      retrievedSourceIds: ["CAIE-9701-SYLLABUS-CONCEPTS"],
      selectedCapabilityId: "standard-trainer@1.0.0",
      selectedComponentId: "stoichiometric-product-mass@1.0.0",
    },
    diagnosis: null,
    evidence: historicalEvidence,
    learningArtifacts: [],
    schedule: [],
    candidate: null,
    publishedCandidate: null,
    registryAccepted: false,
    eventLog: [],
  };
}

export function aggregatePatternEvidence(
  evidence: readonly DiagnosticEvidenceArtifact[],
): PatternAggregate {
  const matching = evidence.filter(
    (item) =>
      item.componentId === "stoichiometric-product-mass" &&
      item.stage === "FORMULA" &&
      item.failureCode === "WRONG_STOICHIOMETRIC_RATIO",
  );
  return {
    stage: "FORMULA",
    failureCode: "WRONG_STOICHIOMETRIC_RATIO",
    componentId: "stoichiometric-product-mass",
    occurrenceCount: matching.length,
    threshold: 3,
    thresholdReached: matching.length >= 3,
    evidenceIds: matching.map((item) => item.id),
  };
}

export function diagnoseStoichiometryConversation(state: ExperienceState, diagnosedAt = new Date().toISOString()): ExperienceState {
  const component = publishedComponents.find((item) => item.id === "stoichiometric-product-mass");
  if (!component) throw new Error("Published Stoichiometric Product Mass component is unavailable.");
  const runtimeDiagnosis = evaluatePreviewAttempt(component, { value: 4, unit: "g", significantFigures: 3, strategy: "WRONG_RATIO" });
  if (runtimeDiagnosis.firstFailureCode !== "WRONG_STOICHIOMETRIC_RATIO" || runtimeDiagnosis.stage !== "FORMULA") {
    throw new Error("The published runtime did not return the expected bounded ratio diagnosis.");
  }
  const retryDueAt = new Date(diagnosedAt);
  retryDueAt.setUTCDate(retryDueAt.getUTCDate() + 3);
  const alreadyDiagnosed = state.evidence.some((item) => item.conversationId === state.conversation.id);

  const nextEvidence = alreadyDiagnosed ? state.evidence : [...state.evidence, {
    id: "evidence-mgo-ratio-current",
    conversationId: state.conversation.id,
    componentId: component.id,
    componentVersion: component.version,
    stage: "FORMULA" as const,
    failureCode: runtimeDiagnosis.firstFailureCode,
    observedEvidence: { observedRatio: 0.5, expectedRatio: 1 },
    createdAt: diagnosedAt,
  }];
  const threshold = aggregatePatternEvidence(nextEvidence);
  const newEvents = alreadyDiagnosed ? [] : [
    createDemoEvent("LEARNER_ATTEMPT_SUBMITTED", "LEARNER", { conversationId: state.conversation.id }, { occurredAt: diagnosedAt }),
    createDemoEvent("CAPABILITY_SELECTED", "FOUNDRY", { capabilityId: state.conversation.selectedCapabilityId, componentId: state.conversation.selectedComponentId }, { occurredAt: diagnosedAt }),
    createDemoEvent("LEARNER_DIAGNOSIS_COMPLETED", "FOUNDRY", { stage: "FORMULA", failureCode: runtimeDiagnosis.firstFailureCode, observed: 0.5, expected: 1 }, { occurredAt: diagnosedAt }),
    createDemoEvent("EVIDENCE_PERSISTED", "FOUNDRY", { evidenceId: "evidence-mgo-ratio-current" }, { occurredAt: diagnosedAt }),
    createDemoEvent("RETRY_SCHEDULED", "FOUNDRY", { scheduleItemId: "retry-stoichiometry-001", dueAt: retryDueAt.toISOString() }, { occurredAt: diagnosedAt }),
    ...(threshold.thresholdReached ? [createDemoEvent("PATTERN_THRESHOLD_REACHED", "FOUNDRY", { occurrenceCount: threshold.occurrenceCount, threshold: threshold.threshold, evidenceIds: threshold.evidenceIds }, { occurredAt: diagnosedAt })] : []),
  ];

  return {
    ...state,
    diagnosis: {
      stage: "FORMULA",
      failureCode: runtimeDiagnosis.firstFailureCode,
      groundedResponse,
      observedRatio: 0.5,
      expectedRatio: 1,
    },
    conversation: {
      ...state.conversation,
      messages: alreadyDiagnosed ? state.conversation.messages : [...state.conversation.messages, { id: "message-system-001", role: "SYSTEM", content: groundedResponse }],
    },
    evidence: nextEvidence,
    learningArtifacts: alreadyDiagnosed ? state.learningArtifacts : [...state.learningArtifacts, {
      id: "artifact-mgo-correction-001",
      title: "Worked correction · Magnesium to magnesium oxide",
      steps: ["4.80 g Mg", "0.200 mol Mg", "1:1 Mg:MgO", "0.200 mol MgO", "8.00 g MgO"],
      createdAt: diagnosedAt,
    }],
    schedule: alreadyDiagnosed ? state.schedule : [...state.schedule, {
      id: "retry-stoichiometry-001",
      title: "Retry: Stoichiometric product mass",
      dueAt: retryDueAt.toISOString(),
      reason: "Recheck mole-ratio transfer without viewing the worked answer",
      status: "SCHEDULED",
    }],
    eventLog: [...state.eventLog, ...newEvents],
  };
}

export function createComponentCandidate(state: ExperienceState): ExperienceState {
  if (state.candidate) return state;
  const pattern = aggregatePatternEvidence(state.evidence);
  if (!pattern.thresholdReached) {
    throw new Error("A component candidate requires three matching evidence traces.");
  }
  const sourceEvidence = state.evidence.filter((item) =>
    pattern.evidenceIds.includes(item.id),
  );
  return {
    ...state,
    candidate: {
      id: "candidate-ratio-transfer-001",
      source: "CONVERSATION_DERIVED",
      sourceConversationIds: sourceEvidence.map((item) => item.conversationId),
      sourceEvidenceIds: pattern.evidenceIds,
      pattern: {
        stage: pattern.stage,
        failureCode: pattern.failureCode,
        occurrenceCount: pattern.occurrenceCount,
      },
      proposedChange:
        "Strengthen the FORMULA-stage mole-ratio hint with the explicit 2:2 to 1:1 transfer.",
      status: "CREATED",
    },
    eventLog: [
      ...state.eventLog,
      createDemoEvent("CANDIDATE_CREATED", "TEACHER", {
        candidateId: "candidate-ratio-transfer-001",
        sourceEvidenceIds: pattern.evidenceIds,
        version: "1.1.0",
      }),
    ],
  };
}

export function promoteComponentCandidate(state: ExperienceState): { readonly state: ExperienceState; readonly handoff: FoundryCandidateHandoff } {
  if (!state.candidate) throw new Error("Create a component candidate before opening it in Foundry Studio.");
  const component = publishedComponents.find((item) => item.id === "stoichiometric-product-mass");
  if (!component) throw new Error("Published Stoichiometric Product Mass component is unavailable.");
  const ratioHint = component.hintPolicy.hints.find((hint) => hint.id === "mass-ratio");
  if (!ratioHint) throw new Error("The published component has no governed mole-ratio hint to strengthen.");
  const draft: DiagnosticLearningComponent = {
    ...structuredClone(component),
    version: incrementVersion(component.version, "CONTENT"),
    status: "DRAFT",
    review: undefined,
    publication: undefined,
    hintPolicy: {
      ...component.hintPolicy,
      hints: component.hintPolicy.hints.map((hint) => hint.id === ratioHint.id ? {
        ...hint,
        text: "2Mg : 2MgO simplifies to 1:1. Each mole of Mg forms one mole of MgO.",
      } : hint),
    },
  };

  return {
    state: { ...state, candidate: { ...state.candidate, status: "PROMOTED_TO_FOUNDRY" } },
    handoff: {
      component: draft,
      evaluation: null,
      candidateSource: {
        kind: "CONVERSATION_DERIVED",
        conversationIds: state.candidate.sourceConversationIds,
        evidenceIds: state.candidate.sourceEvidenceIds,
        candidateId: state.candidate.id,
      },
    },
  };
}

export function setScheduleItemStatus(state: ExperienceState, itemId: string, status: "SCHEDULED" | "COMPLETED"): ExperienceState {
  return {
    ...state,
    schedule: state.schedule.map((item) => item.id === itemId ? { ...item, status } : item),
  };
}
