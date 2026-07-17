import { createHash } from "node:crypto";
import { resolveAgentExecutionPlan } from "../agent/route-policy";
import { buildAgentSystemPrompt } from "../agent/run-agent";
import type { AgentRunRequest } from "../agent/types";
import type { BenchmarkCase } from "./index";

function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function requestForCase(testCase: BenchmarkCase): AgentRunRequest {
  return {
    conversationId: `manifest-${testCase.caseId}`, inputOrigin: "USER_INPUT", runPurpose: "AGENT_EVAL",
    ...(testCase.activeTaskId ? { activeTaskId: testCase.activeTaskId } : {}), ...(testCase.activeEpisodeId ? { activeEpisodeId: testCase.activeEpisodeId } : {}),
    messages: testCase.messages.map((message) => ({ role: message.role, content: message.content, ...(message.context ? { context: message.context } : {}) })),
  };
}

export function createBenchmarkCaseComposition(options: {
  readonly testCase: BenchmarkCase;
  readonly policyOnlyPrompt: string;
  readonly directAnswerContract: string;
  readonly authoritativeBasePrompt: string;
}) {
  const request = requestForCase(options.testCase);
  const plan = resolveAgentExecutionPlan(request);
  const selectedMessages = plan.contextSelection.selectedMessageIndexes.flatMap((index) => {
    const message = request.messages[index];
    return message ? [{ role: message.role, content: message.content }] : [];
  });
  const policyOnlyPlan = {
    schemaVersion: plan.schemaVersion, intent: plan.intent, execution: plan.execution, route: plan.route, obligations: plan.obligations,
    contextSelection: plan.contextSelection, terminalConditions: plan.terminalConditions, evidenceRequirements: plan.evidenceRequirements,
    toolAvailability: "NO_TOOLS_IN_BENCHMARK_ARM_B",
  } as const;
  const policyOnlySystemPrompt = `${options.policyOnlyPrompt}\nFrozen Foundry plan projection: ${JSON.stringify(policyOnlyPlan)}\n${options.directAnswerContract}`;
  const authoritativeSystemPrompt = buildAgentSystemPrompt(options.authoritativeBasePrompt, plan.route, plan.obligations);
  return {
    request,
    plan,
    selectedMessages,
    policyOnlySystemPrompt,
    authoritativeSystemPrompt,
    hashes: {
      executionPlan: hash(plan), contextSelection: hash(plan.contextSelection), policyOnlySystemPrompt: hash(policyOnlySystemPrompt),
      authoritativeSystemPrompt: hash(authoritativeSystemPrompt), selectedProviderMessages: hash(selectedMessages),
    },
  };
}

