import { publishedComponents } from "../components/published";
import type { DiagnosticLearningComponent } from "../contracts/diagnostic-component";
import { incrementVersion } from "../governance/publishing";
import { evaluatePreviewAttempt } from "../runtime/preview-adapter";
import type { ExperienceState, FoundryCandidateHandoff } from "./types";

const learnerMessage = `I calculated the mass of MgO as 4.00 g.
I used 4.80 / 24.0 and then multiplied by 0.5.
Where did I go wrong?`;

const groundedResponse = `Your conversion from 4.80 g Mg to 0.200 mol Mg is correct.

The first error is the mole ratio. In 2Mg + O₂ → 2MgO, the Mg:MgO ratio is 2:2, or 1:1—not 0.5.

So 0.200 mol Mg forms 0.200 mol MgO, giving 0.200 × 40.0 = 8.00 g.`;

export function createInitialExperienceState(): ExperienceState {
  return {
    conversation: {
      id: "conversation-mgo-001",
      messages: [{ id: "message-student-001", role: "STUDENT", content: learnerMessage }],
      retrievedSourceIds: ["CAIE-9701-SYLLABUS-CONCEPTS"],
      selectedCapabilityId: "standard-trainer@1.0.0",
      selectedComponentId: "stoichiometric-product-mass@1.0.0",
    },
    diagnosis: null,
    evidence: [],
    learningArtifacts: [],
    schedule: [],
    candidate: {
      id: "candidate-ratio-transfer-001",
      source: "CONVERSATION_DERIVED",
      sourceConversationIds: ["conversation-mgo-001", "conversation-seeded-002", "conversation-seeded-003"],
      sourceEvidenceIds: ["case-001", "case-002", "case-003"],
      pattern: { stage: "FORMULA", failureCode: "WRONG_STOICHIOMETRIC_RATIO", occurrenceCount: 3 },
      proposedChange: "Strengthen the diagnostic hint and add a delayed mole-ratio transfer item.",
      status: "DETECTED",
    },
    publishedCandidate: null,
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
    evidence: alreadyDiagnosed ? state.evidence : [...state.evidence, {
      id: "evidence-mgo-ratio-001",
      conversationId: state.conversation.id,
      componentId: component.id,
      componentVersion: component.version,
      stage: "FORMULA",
      failureCode: runtimeDiagnosis.firstFailureCode,
      observedEvidence: { observedRatio: 0.5, expectedRatio: 1 },
      createdAt: diagnosedAt,
    }],
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
  };
}

export function promoteComponentCandidate(state: ExperienceState): { readonly state: ExperienceState; readonly handoff: FoundryCandidateHandoff } {
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
        text: "Read the Mg and MgO coefficients as a transfer ratio: 2:2 simplifies to 1:1, so each mole of Mg forms one mole of MgO.",
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
