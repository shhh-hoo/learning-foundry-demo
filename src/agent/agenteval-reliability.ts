import type { AgentEvalCase } from "./agenteval";

export const AGENT_EVAL_RELIABILITY_CASE_IDS = [
  "retrieval-03",
  "retrieval-04",
  "retrieval-05",
  "diagnosis-01",
  "diagnosis-05",
  "diagnosis-06",
  "gap-01",
  "gap-02",
  "gap-03",
  "gap-04",
  "adversarial-02",
] as const;

export function buildAgentEvalReliabilitySprint(cases: readonly AgentEvalCase[]): readonly AgentEvalCase[] {
  const byId = new Map(cases.map((testCase) => [testCase.caseId, testCase]));
  const missing = AGENT_EVAL_RELIABILITY_CASE_IDS.filter((caseId) => !byId.has(caseId));
  if (missing.length) throw new Error(`AGENT_EVAL_RELIABILITY_CASES_MISSING: ${missing.join(", ")}`);
  return AGENT_EVAL_RELIABILITY_CASE_IDS.map((caseId) => byId.get(caseId)!);
}
