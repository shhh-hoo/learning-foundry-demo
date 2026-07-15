import patternPolicy from "../../config/product/pattern-policy.json";
import { publishedComponents } from "../components/published";
import type { DiagnosticLearningComponent } from "../contracts/diagnostic-component";
import type { AgentTrace } from "../agent/types";
import { createDemoEvent } from "../demo/events";
import { incrementVersion } from "../governance/publishing";
import type { ComponentCandidate, ExperienceState, FoundryCandidateHandoff, GatewayToolResult, LearnerDiagnosisRecord, PatternAggregate } from "./types";

const id = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;

export function createInitialExperienceState(): ExperienceState {
  return {
    conversationId: id("conversation"), messages: [], agentConfigured: null, gatewayModel: null,
    agentTraces: [], diagnoses: [], library: [], schedule: [], capabilityGaps: [], pendingResponse: null,
    candidate: null, publishedCandidate: null, registryAccepted: false, eventLog: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export function applyAgentRun(state: ExperienceState, userInput: string, trace: AgentTrace, toolResults: readonly GatewayToolResult[]): ExperienceState {
  const diagnoses = toolResults.filter((item) => item.name === "run_learner_diagnosis" && isRecord(item.data)).flatMap((item): LearnerDiagnosisRecord[] => {
    const data = item.data as Record<string, unknown>;
    const diagnosis = isRecord(data.diagnosis) ? data.diagnosis : null;
    if (!diagnosis || typeof data.traceId !== "string" || typeof data.componentId !== "string" || typeof data.componentVersion !== "string") return [];
    return [{
      traceId: data.traceId, agentTraceId: trace.traceId, inputOrigin: trace.inputOrigin, origin: "TOOL_OUTPUT",
      componentId: data.componentId, componentVersion: data.componentVersion,
      decision: diagnosis.decision as LearnerDiagnosisRecord["decision"],
      firstPedagogicalIssue: typeof diagnosis.firstPedagogicalIssue === "string" ? diagnosis.firstPedagogicalIssue : null,
      failureCode: typeof diagnosis.failureCode === "string" ? diagnosis.failureCode : null,
      evidence: Array.isArray(diagnosis.evidence) ? diagnosis.evidence.filter((value): value is string => typeof value === "string") : [],
      recommendedSupport: typeof data.recommendedSupport === "string" ? data.recommendedSupport : null,
      createdAt: trace.completedAt,
    }];
  });
  const gaps = toolResults.filter((item) => item.name === "record_capability_gap" && isRecord(item.data)).flatMap((item) => {
    const data = item.data as Record<string, unknown>;
    return typeof data.id === "string" && typeof data.summary === "string" ? [{ id: data.id, summary: data.summary, missingEvidence: Array.isArray(data.missingEvidence) ? data.missingEvidence.filter((value): value is string => typeof value === "string") : [], origin: "TOOL_OUTPUT" as const }] : [];
  });
  const allDiagnoses = [...state.diagnoses, ...diagnoses];
  const previousPattern = aggregatePatternEvidence(state.diagnoses);
  const nextPattern = aggregatePatternEvidence(allDiagnoses);
  const newEvents = [createDemoEvent("LEARNER_ATTEMPT_SUBMITTED", "LEARNER", { conversationId: state.conversationId, inputOrigin: trace.inputOrigin }), ...diagnoses.map((diagnosis) => createDemoEvent("LEARNER_DIAGNOSIS_COMPLETED", "FOUNDRY", { traceId: diagnosis.traceId, failureCode: diagnosis.failureCode, componentId: diagnosis.componentId })), ...(!previousPattern.thresholdReached && nextPattern.thresholdReached ? [createDemoEvent("PATTERN_THRESHOLD_REACHED", "FOUNDRY", { occurrenceCount: nextPattern.occurrenceCount, threshold: nextPattern.threshold, traceIds: nextPattern.traceIds })] : [])];
  return {
    ...state,
    messages: [...state.messages, { id: id("message"), role: "USER", content: userInput, inputOrigin: trace.inputOrigin }, { id: id("message"), role: "AGENT", content: trace.finalResponse.learnerMessage, sourceRefs: trace.finalResponse.sourceRefs }],
    agentTraces: [...state.agentTraces, trace], diagnoses: allDiagnoses, capabilityGaps: [...state.capabilityGaps, ...gaps], pendingResponse: trace.finalResponse,
    eventLog: [...state.eventLog, ...newEvents],
  };
}

export function aggregatePatternEvidence(diagnoses: readonly LearnerDiagnosisRecord[]): PatternAggregate {
  const groups = new Map<string, LearnerDiagnosisRecord[]>();
  diagnoses.filter((item) => item.failureCode).forEach((item) => {
    const key = `${item.componentId}::${item.failureCode}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  const strongest = [...groups.values()].sort((left, right) => right.length - left.length)[0] ?? [];
  const first = strongest[0];
  return { componentId: first?.componentId ?? null, failureCode: first?.failureCode ?? null, occurrenceCount: strongest.length, threshold: patternPolicy.minimumMatchingRuns, thresholdReached: strongest.length >= patternPolicy.minimumMatchingRuns, traceIds: strongest.map((item) => item.traceId), agentTraceIds: strongest.map((item) => item.agentTraceId) };
}

export function confirmLibraryProposal(state: ExperienceState): ExperienceState {
  const proposal = state.pendingResponse?.proposedLibraryArtifact;
  if (!proposal) return state;
  const artifact = { id: id("library"), ...proposal, origin: "HUMAN_ACTION" as const, createdAt: new Date().toISOString() };
  return { ...state, library: [...state.library, artifact], pendingResponse: { ...state.pendingResponse, proposedLibraryArtifact: undefined }, eventLog: [...state.eventLog, createDemoEvent("EVIDENCE_PERSISTED", "LEARNER", { artifactId: artifact.id, origin: artifact.origin })] };
}

export function confirmScheduleProposal(state: ExperienceState): ExperienceState {
  const proposal = state.pendingResponse?.proposedFollowUp;
  if (!proposal) return state;
  const due = new Date(); due.setUTCDate(due.getUTCDate() + proposal.delayDays);
  const item = { id: id("schedule"), title: proposal.title, reason: proposal.reason, dueAt: due.toISOString(), status: "SCHEDULED" as const, origin: "HUMAN_ACTION" as const };
  return { ...state, schedule: [...state.schedule, item], pendingResponse: { ...state.pendingResponse, proposedFollowUp: undefined }, eventLog: [...state.eventLog, createDemoEvent("RETRY_SCHEDULED", "LEARNER", { scheduleItemId: item.id, dueAt: item.dueAt, origin: item.origin })] };
}

export function setScheduleItemStatus(state: ExperienceState, itemId: string, status: "SCHEDULED" | "COMPLETED"): ExperienceState { return { ...state, schedule: state.schedule.map((item) => item.id === itemId ? { ...item, status } : item) }; }

export function createComponentCandidate(state: ExperienceState): ExperienceState {
  if (state.candidate) return state;
  const pattern = aggregatePatternEvidence(state.diagnoses);
  if (!pattern.thresholdReached || !pattern.componentId || !pattern.failureCode) throw new Error("A component candidate requires three matching actual local Agent runs.");
  const candidate: ComponentCandidate = { id: id("candidate"), source: "ACTUAL_AGENT_RUNS", sourceTraceIds: pattern.traceIds, sourceDiagnosisTraceIds: pattern.traceIds, sourceAgentTraceIds: pattern.agentTraceIds, pattern: { componentId: pattern.componentId, failureCode: pattern.failureCode, occurrenceCount: pattern.occurrenceCount }, proposedChange: "Strengthen governed support for the repeated first pedagogical issue.", status: "CREATED" };
  return { ...state, candidate, eventLog: [...state.eventLog, createDemoEvent("CANDIDATE_CREATED", "TEACHER", { candidateId: candidate.id, sourceTraceIds: candidate.sourceTraceIds })] };
}

export function promoteComponentCandidate(state: ExperienceState): { readonly state: ExperienceState; readonly handoff: FoundryCandidateHandoff } {
  if (!state.candidate) throw new Error("Create a component candidate first.");
  const component = publishedComponents.find((item) => item.id === state.candidate!.pattern.componentId);
  if (!component) throw new Error("The matching published component is unavailable.");
  const draft = { ...structuredClone(component), version: incrementVersion(component.version, "CONTENT"), status: "DRAFT" as const, review: undefined, publication: undefined };
  return { state: { ...state, candidate: { ...state.candidate, status: "PROMOTED_TO_FOUNDRY" } }, handoff: { baseComponent: structuredClone(component), component: draft, contractChecks: null, revision: null, candidateSource: { kind: "ACTUAL_AGENT_RUNS", diagnosisTraceIds: state.candidate.sourceDiagnosisTraceIds, agentTraceIds: state.candidate.sourceAgentTraceIds, candidateId: state.candidate.id } } };
}

function semanticComponent(component: DiagnosticLearningComponent) {
  const { version: _version, status: _status, review: _review, publication: _publication, ...semantic } = component;
  return semantic;
}

export function hasSemanticComponentDiff(base: DiagnosticLearningComponent, draft: DiagnosticLearningComponent): boolean {
  return JSON.stringify(semanticComponent(base)) !== JSON.stringify(semanticComponent(draft));
}

export function applyComponentRevision(handoff: FoundryCandidateHandoff, hintId: string, afterValue: string, teacherRationale: string): FoundryCandidateHandoff {
  const rationale = teacherRationale.trim(); const changedValue = afterValue.trim();
  if (!rationale) throw new Error("A teacher rationale is required for a component revision.");
  const hint = handoff.component.hintPolicy.hints.find((item) => item.id === hintId);
  if (!hint) throw new Error(`Governed hint ${hintId} does not exist.`);
  if (!changedValue || changedValue === hint.text) throw new Error("The draft must contain a real semantic content change.");
  const component: DiagnosticLearningComponent = { ...handoff.component, hintPolicy: { ...handoff.component.hintPolicy, hints: handoff.component.hintPolicy.hints.map((item) => item.id === hintId ? { ...item, text: changedValue } : item) } };
  if (!hasSemanticComponentDiff(handoff.baseComponent, component)) throw new Error("The draft must differ semantically from the base component.");
  return {
    ...handoff, component, contractChecks: null,
    revision: {
      baseComponentVersion: handoff.baseComponent.version, changedField: `hintPolicy.hints.${hintId}.text`, beforeValue: hint.text, afterValue: changedValue,
      teacherRationale: rationale, sourceDiagnosisTraceIds: handoff.candidateSource.diagnosisTraceIds, sourceAgentTraceIds: handoff.candidateSource.agentTraceIds, changedAt: new Date().toISOString(),
    },
  };
}
