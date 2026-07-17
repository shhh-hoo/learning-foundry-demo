import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContextCompiler } from "../src/agent/control-plane/context-compiler";
import { ExecutionPlanner } from "../src/agent/control-plane/execution-planner";
import type { AgentRunRequest } from "../src/agent/types";

interface Fixture {
  readonly planCases: readonly { readonly caseId: string; readonly input: string; readonly expectedIntent: string; readonly expectedRoute: string; readonly requiredTools: readonly string[]; readonly forbiddenTools: readonly string[] }[];
  readonly contextCases: readonly { readonly caseId: string; readonly activeTaskId: string; readonly messages: AgentRunRequest["messages"]; readonly selectedMessageIndexes: readonly number[]; readonly excludedReasons: readonly string[] }[];
}

const fixture = JSON.parse(await readFile(join(process.cwd(), "tests/fixtures/control-plane-regressions.json"), "utf8")) as Fixture;

describe("Control Plane regression fixtures", () => {
  for (const testCase of fixture.planCases) {
    it(testCase.caseId, () => {
      const request: AgentRunRequest = { conversationId: testCase.caseId, inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", messages: [{ role: "user", content: testCase.input }] };
      const plan = new ExecutionPlanner().plan(request, new ContextCompiler().compile(request));
      expect(plan).toMatchObject({ intent: testCase.expectedIntent, route: testCase.expectedRoute });
      expect(plan.toolPolicy.required).toEqual(testCase.requiredTools);
      expect(plan.toolPolicy.forbidden).toEqual(expect.arrayContaining([...testCase.forbiddenTools]));
    });
  }

  for (const testCase of fixture.contextCases) {
    it(testCase.caseId, () => {
      const request: AgentRunRequest = { conversationId: testCase.caseId, inputOrigin: "PRESET_INPUT", runPurpose: "AGENT_EVAL", activeTaskId: testCase.activeTaskId, messages: testCase.messages };
      const decision = new ContextCompiler().compile(request);
      expect(decision.selectedMessageIndexes).toEqual(testCase.selectedMessageIndexes);
      expect(decision.excludedContextItems.map((item) => item.reason)).toEqual(testCase.excludedReasons);
    });
  }
});
