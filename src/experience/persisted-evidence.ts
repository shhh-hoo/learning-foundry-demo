import type { AgentTrace, InputOrigin } from "../agent/types";
import type { LearnerDiagnosisRecord } from "./types";

interface PersistedToolExecution { readonly name: string; readonly arguments: unknown; readonly resultRef: string; readonly status: "SUCCEEDED" | "FAILED"; readonly result?: unknown }
interface PersistedRun {
  readonly traceId: string; readonly status: string; readonly provider: "deepseek"; readonly model: string; readonly thinkingMode: "enabled" | "disabled";
  readonly request: { readonly conversationId: string; readonly inputOrigin: InputOrigin; readonly runPurpose: "PRODUCT" | "AGENT_EVAL" }; readonly initialRoute?: AgentTrace["initialRoute"]; readonly route?: AgentTrace["route"]; readonly obligations?: AgentTrace["obligations"];
  readonly prompt: { readonly version: string }; readonly capabilityRegistry: { readonly version: string };
  readonly startedAt: string; readonly completedAt?: string; readonly updatedAt: string; readonly toolExecutions: readonly PersistedToolExecution[]; readonly finalResponse?: AgentTrace["finalResponse"]; readonly tokenUsage?: AgentTrace["tokenUsage"];
}
interface PersistedDiagnosis {
  readonly traceId: string; readonly runPurpose: "PRODUCT" | "AGENT_EVAL"; readonly request: { readonly componentId: string }; readonly component: { readonly id: string; readonly version: string }; readonly diagnosis: { readonly decision: LearnerDiagnosisRecord["decision"]; readonly firstPedagogicalIssue?: string | null; readonly failureCode?: string | null; readonly evidence?: readonly string[] }; readonly recommendedSupport: string | null; readonly timestamp: string;
}
export interface PersistedLearningEvidence { readonly agentTraces: readonly AgentTrace[]; readonly diagnoses: readonly LearnerDiagnosisRecord[] }

function traceIdFromResult(value: unknown): string | null {
  return value && typeof value === "object" && "traceId" in value && typeof value.traceId === "string" ? value.traceId : null;
}

export async function loadPersistedLearningEvidence(fetcher: typeof fetch = fetch): Promise<PersistedLearningEvidence> {
  const [agentResponse, diagnosisResponse] = await Promise.all([fetcher("http://127.0.0.1:4176/agent/runs?runPurpose=PRODUCT"), fetcher("http://127.0.0.1:4177/diagnoses?runPurpose=PRODUCT")]);
  if (!agentResponse.ok || !diagnosisResponse.ok) throw new Error("Persisted evidence services are unavailable.");
  const agentBody = await agentResponse.json() as { readonly runs?: readonly PersistedRun[] };
  const diagnosisBody = await diagnosisResponse.json() as { readonly diagnoses?: readonly PersistedDiagnosis[] };
  const runs = (agentBody.runs ?? []).filter((run) => run.request.runPurpose === "PRODUCT");
  const completedRuns = runs.filter((run) => run.status === "COMPLETED" && run.finalResponse && run.completedAt);
  const agentTraces: AgentTrace[] = completedRuns.map((run) => ({
    traceId: run.traceId, conversationId: run.request.conversationId, inputOrigin: run.request.inputOrigin, runPurpose: run.request.runPurpose,
    ...(run.initialRoute ? { initialRoute: run.initialRoute } : {}), ...(run.route ? { route: run.route } : {}), ...(run.obligations ? { obligations: run.obligations } : {}),
    provider: run.provider, model: run.model, thinkingMode: run.thinkingMode,
    promptVersion: run.prompt.version, capabilityRegistryVersion: run.capabilityRegistry.version, startedAt: run.startedAt, completedAt: run.completedAt!,
    toolCalls: run.toolExecutions.map(({ name, arguments: argumentsValue, resultRef, status }) => ({ name, arguments: argumentsValue, resultRef, status })), finalResponse: run.finalResponse!,
    ...(run.tokenUsage ? { tokenUsage: run.tokenUsage } : {}), latencyMs: Math.max(0, Date.parse(run.completedAt!) - Date.parse(run.startedAt)),
  }));
  const agentForDiagnosis = new Map<string, PersistedRun>();
  for (const run of completedRuns) for (const execution of run.toolExecutions) { const diagnosisTraceId = traceIdFromResult(execution.result); if (execution.name === "run_learner_diagnosis" && diagnosisTraceId) agentForDiagnosis.set(diagnosisTraceId, run); }
  const diagnoses = (diagnosisBody.diagnoses ?? []).filter((record) => record.runPurpose === "PRODUCT").flatMap((record): LearnerDiagnosisRecord[] => {
    const run = agentForDiagnosis.get(record.traceId); if (!run) return [];
    return [{ traceId: record.traceId, agentTraceId: run.traceId, inputOrigin: run.request.inputOrigin, runPurpose: "PRODUCT", origin: "TOOL_OUTPUT", componentId: record.component.id, componentVersion: record.component.version, decision: record.diagnosis.decision, firstPedagogicalIssue: record.diagnosis.firstPedagogicalIssue ?? null, failureCode: record.diagnosis.failureCode ?? null, evidence: record.diagnosis.evidence ?? [], recommendedSupport: record.recommendedSupport, createdAt: record.timestamp }];
  });
  return { agentTraces: agentTraces.sort((left, right) => left.startedAt.localeCompare(right.startedAt)), diagnoses: diagnoses.sort((left, right) => left.createdAt.localeCompare(right.createdAt)) };
}
