import { classifyAgentRoute } from "../route-policy";
import type { AgentObligations, AgentRoute, AgentRunRequest } from "../types";
import type { ContextSelectionDecision, EvidenceRequirement, ExecutionDirective, ExecutionIntent, ExecutionPlanV1, ToolId } from "./execution-plan";
import { immutablePlan } from "./execution-plan";

const ALL_TOOLS: readonly ToolId[] = [
  "search_learning_resources",
  "list_capabilities",
  "get_capability",
  "run_learner_diagnosis",
  "record_capability_gap",
  "propose_library_artifact",
  "propose_schedule_followup",
];

function currentUserMessage(request: AgentRunRequest): string {
  return [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function requiresCapabilityInspection(input: string): boolean {
  return /\b(?:current|available|supported)\s+(?:tools?|capabilit(?:y|ies))\b/iu.test(input)
    || /\b(?:run|use)\b.{0,60}\bdiagnosis\s+tool\b/iu.test(input)
    || /\bdiagnos(?:e|is)\b.{0,80}\b(?:entire\s+multi-stage|across)\b/iu.test(input)
    || /\b(?:capabilit(?:y|ies)|tool\s+trace)\b/iu.test(input);
}

function obligations(route: AgentRoute, input: string): AgentObligations {
  return {
    retrievalRequired: route === "COURSE_EXPLANATION",
    capabilityInspectionRequired: route === "LEARNER_DIAGNOSIS_COMPLETE" || route === "CAPABILITY_GAP" || requiresCapabilityInspection(input),
    diagnosisRequired: route === "LEARNER_DIAGNOSIS_COMPLETE",
  };
}

function intent(route: AgentRoute, input: string): ExecutionIntent {
  if (/\b(?:save|add)\b.{0,40}\blibrary\b|(?:保存|加入).{0,20}(?:资料库|学习库)/iu.test(input)
    || /\b(?:schedule|plan)\b.{0,40}\b(?:follow[- ]?up|review)\b|(?:安排|计划).{0,20}(?:复习|跟进)/iu.test(input)) return "PRODUCT_ACTION";
  if (route === "COURSE_EXPLANATION") return "OPEN_EXPLANATION";
  if (route === "LEARNER_DIAGNOSIS_COMPLETE") return "COMPLETE_ATTEMPT_DIAGNOSIS";
  if (route === "LEARNER_DIAGNOSIS_INCOMPLETE") return "INCOMPLETE_ATTEMPT_DIAGNOSIS";
  if (route === "CAPABILITY_GAP") return "CAPABILITY_DISCOVERY";
  return "CONCRETE_CALCULATION";
}

function directive(executionIntent: ExecutionIntent): ExecutionDirective {
  if (executionIntent === "COMPLETE_ATTEMPT_DIAGNOSIS") return { mode: "GOVERNED_WORKFLOW", workflow: { id: "LEARNER_DIAGNOSIS", version: "1.0.0" } };
  if (executionIntent === "PRODUCT_ACTION") return { mode: "PRODUCT_ACTION" };
  if (executionIntent === "CONCRETE_CALCULATION") return { mode: "DIRECT_MODEL" };
  return { mode: "BOUNDED_AGENT" };
}

function policy(route: AgentRoute, routeObligations: AgentObligations, executionIntent: ExecutionIntent, input: string) {
  let permitted: readonly ToolId[] = ALL_TOOLS;
  let required: readonly ToolId[] = [];
  if (executionIntent === "PRODUCT_ACTION") {
    const tool: ToolId = /\b(?:schedule|plan)\b|(?:安排|计划)/iu.test(input) ? "propose_schedule_followup" : "propose_library_artifact";
    permitted = [tool]; required = [tool];
  }
  else if (route === "COURSE_EXPLANATION") { permitted = ["search_learning_resources"]; required = ["search_learning_resources"]; }
  else if (route === "LEARNER_DIAGNOSIS_COMPLETE") { permitted = ["list_capabilities", "get_capability", "run_learner_diagnosis"]; required = permitted; }
  else if (route === "CAPABILITY_GAP") { permitted = ["list_capabilities", "record_capability_gap"]; required = ["list_capabilities"]; }
  else if (routeObligations.capabilityInspectionRequired) { permitted = ["list_capabilities"]; required = ["list_capabilities"]; }
  else if (route === "LEARNER_DIAGNOSIS_INCOMPLETE") permitted = [];
  const maximumCallsPerTool = Object.fromEntries(ALL_TOOLS.map((tool) => [tool, tool === "search_learning_resources" ? 2 : 1])) as Record<ToolId, number>;
  return {
    permitted,
    required,
    forbidden: ALL_TOOLS.filter((tool) => !permitted.includes(tool)),
    maximumModelSteps: 6,
    maximumCallsPerTool,
  };
}

function evidenceRequirements(route: AgentRoute, routeObligations: AgentObligations): readonly EvidenceRequirement[] {
  const requirements: EvidenceRequirement[] = [];
  if (routeObligations.retrievalRequired) requirements.push("GOVERNED_SOURCE");
  if (routeObligations.capabilityInspectionRequired) requirements.push("CAPABILITY_REGISTRY");
  if (routeObligations.diagnosisRequired) requirements.push("PERSISTED_WORKFLOW_RESULT");
  return requirements;
}

/** Deep Foundry-owned Module: one request and Context decision produce the complete executable policy. */
export class ExecutionPlanner {
  plan(request: AgentRunRequest, contextSelection: ContextSelectionDecision): ExecutionPlanV1 {
    const route = classifyAgentRoute(request);
    const routeObligations = obligations(route, currentUserMessage(request));
    const input = currentUserMessage(request);
    const executionIntent = intent(route, input);
    return immutablePlan({
      schemaVersion: "1.0.0" as const,
      intent: executionIntent,
      execution: directive(executionIntent),
      route,
      obligations: routeObligations,
      contextSelection,
      toolPolicy: policy(route, routeObligations, executionIntent, input),
      terminalConditions: ["PLAN_REQUIREMENTS_SATISFIED", "EVIDENCE_INSUFFICIENT", "TOOL_BUDGET_EXHAUSTED", "GOVERNED_WORKFLOW_BLOCKED", "MODEL_STEP_BUDGET_EXHAUSTED"] as const,
      evidenceRequirements: evidenceRequirements(route, routeObligations),
    });
  }
}
