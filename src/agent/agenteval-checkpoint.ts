import type { AgentEvalCase } from "./agenteval";

const checkpointPlan = [
  ["A-course-explanation", "retrieval-01"],
  ["B-incomplete-working", "diagnosis-missing-context-01"],
  ["C-complete-MgO-diagnosis", "diagnosis-01"],
  ["D-multi-stage-capability-gap", "gap-01"],
  ["diagnosis-01", "diagnosis-01"],
  ["diagnosis-02", "diagnosis-02"],
] as const;

export function buildAgentEvalCheckpoint(fullCases: readonly AgentEvalCase[]): readonly AgentEvalCase[] {
  const byId = new Map(fullCases.map((testCase) => [testCase.caseId, testCase]));
  return checkpointPlan.map(([checkpointId, sourceCaseId]) => {
    const source = byId.get(sourceCaseId);
    if (!source) throw new Error(`AGENT_EVAL_CASE_MISSING: ${sourceCaseId}`);
    return {
      ...source,
      caseId: checkpointId,
      ...(checkpointId === "D-multi-stage-capability-gap" ? { requiredTools: [] } : {}),
    };
  });
}
