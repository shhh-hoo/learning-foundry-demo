import { describe, expect, it } from "vitest";
import { ContextCompiler } from "../src/agent/control-plane/context-compiler";
import { ExecutionPlanner } from "../src/agent/control-plane/execution-planner";
import { EvidenceSufficiencyAssessor } from "../src/agent/control-plane/evidence-sufficiency";
import { ToolExecutionGovernor } from "../src/agent/control-plane/tool-execution-governor";
import { DiagnosisWorkflow } from "../src/agent/control-plane/diagnosis-workflow";
import type { AgentRunRequest } from "../src/agent/types";

const request = (messages: AgentRunRequest["messages"]): AgentRunRequest => ({
  conversationId: "task-conversation",
  inputOrigin: "USER_INPUT",
  runPurpose: "PRODUCT",
  messages,
});

describe("Foundry Control Plane", () => {
  it("compiles a message-index decision and never copies message content into the Execution Plan", () => {
    const input = request([
      { role: "user", content: "Earlier task-local question" },
      { role: "assistant", content: "Earlier task-local answer" },
      { role: "user", content: "Why does this relationship hold?" },
    ]);
    const context = new ContextCompiler().compile(input);
    const plan = new ExecutionPlanner().plan(input, context);

    expect(context).toEqual({
      schemaVersion: "1.0.0",
      candidateMessageIndexes: [0, 1, 2],
      selectedMessageIndexes: [0, 1, 2],
      excludedContextItems: [],
      selectionReasons: [
        { messageIndex: 0, reason: "TASK_LOCAL_HISTORY" },
        { messageIndex: 1, reason: "TASK_LOCAL_HISTORY" },
        { messageIndex: 2, reason: "CURRENT_REQUEST" },
      ],
      contextPolicyVersion: "1.0.0",
    });
    expect(plan.schemaVersion).toBe("1.0.0");
    expect(plan.intent).toBe("OPEN_EXPLANATION");
    expect(plan.execution.mode).toBe("BOUNDED_AGENT");
    expect(plan.contextSelection).toEqual(context);
    expect(JSON.stringify(plan)).not.toContain("Earlier task-local question");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.toolPolicy.maximumCallsPerTool)).toBe(true);
  });

  it("excludes stale, superseded and other-Task Context before model execution", () => {
    const input: AgentRunRequest = {
      ...request([]),
      activeTaskId: "task-b",
      activeEpisodeId: "episode-b",
      messages: [
        { role: "user", content: "other task", context: { taskId: "task-a", lifecycle: "ACTIVE" } },
        { role: "assistant", content: "stale", context: { taskId: "task-b", lifecycle: "STALE" } },
        { role: "assistant", content: "corrected", context: { taskId: "task-b", lifecycle: "SUPERSEDED" } },
        { role: "user", content: "current request", context: { taskId: "task-b", episodeId: "episode-b", lifecycle: "ACTIVE" } },
      ],
    };

    expect(new ContextCompiler().compile(input)).toMatchObject({
      activeTaskId: "task-b",
      activeEpisodeId: "episode-b",
      selectedMessageIndexes: [3],
      excludedContextItems: [
        { messageIndex: 0, reason: "OTHER_TASK" },
        { messageIndex: 1, reason: "STALE" },
        { messageIndex: 2, reason: "SUPERSEDED" },
      ],
    });
  });

  it("distinguishes tool completion from sufficient governed Evidence", () => {
    const assessor = new EvidenceSufficiencyAssessor({ createId: (index) => `assessment-${index}` });
    const noResults = assessor.assess({ toolId: "search_learning_resources", toolCallIndex: 0, status: "SUCCEEDED", result: { results: [] } });
    const lowAuthority = assessor.assess({ toolId: "search_learning_resources", toolCallIndex: 1, status: "SUCCEEDED", result: { results: [{ sourceId: "secondary", sourceType: "SECONDARY_REFERENCE", score: 2, section: "s" }] } });
    const partial = assessor.assess({ toolId: "search_learning_resources", toolCallIndex: 2, status: "SUCCEEDED", result: { results: [{ sourceId: "official", sourceType: "OFFICIAL_SYLLABUS", score: 4, page: 2 }], missingAspects: ["worked-example evidence"] } });
    const sufficient = assessor.assess({ toolId: "search_learning_resources", toolCallIndex: 3, status: "SUCCEEDED", result: { results: [{ sourceId: "note", sourceType: "TEACHER_NOTE", score: 5, section: "route" }] } });

    expect(noResults).toMatchObject({ outcome: "NO_RESULTS", anotherCallJustified: false, coverage: "NONE" });
    expect(lowAuthority).toMatchObject({ outcome: "LOW_RELEVANCE", anotherCallJustified: true, sourceAuthority: "INSUFFICIENT" });
    expect(partial).toMatchObject({ outcome: "PARTIAL_COVERAGE", anotherCallJustified: true, missingAspects: ["worked-example evidence"] });
    expect(sufficient).toMatchObject({ outcome: "SUFFICIENT_EVIDENCE", anotherCallJustified: false, lineageComplete: true });
  });

  it("enforces Plan-owned budgets, duplicate protection and justified second retrieval", () => {
    const input = request([{ role: "user", content: "Why is this relationship valid?" }]);
    const plan = new ExecutionPlanner().plan(input, new ContextCompiler().compile(input));
    const governor = new ToolExecutionGovernor(plan);

    expect(plan.toolPolicy.maximumCallsPerTool.search_learning_resources).toBe(2);
    expect(governor.authorize("search_learning_resources", { query: "coefficient relationship" }, [])).toMatchObject({ allowed: true });
    expect(governor.authorize("search_learning_resources", { query: "coefficient relationship" }, [])).toMatchObject({ allowed: false, code: "DUPLICATE_TOOL_CALL" });

    const partial = new EvidenceSufficiencyAssessor({ createId: () => "assessment-first" }).assess({
      toolId: "search_learning_resources",
      toolCallIndex: 0,
      status: "SUCCEEDED",
      result: { results: [{ sourceId: "official", sourceType: "OFFICIAL_SYLLABUS", score: 3, page: 1 }], missingAspects: ["pedagogical explanation"] },
    });
    expect(governor.authorize("search_learning_resources", { query: "coefficient relation details" }, [partial])).toMatchObject({ allowed: false, code: "SECOND_SEARCH_JUSTIFICATION_REQUIRED" });
    expect(governor.authorize("search_learning_resources", {
      query: "particle count scaling pedagogical explanation",
      retrievalJustification: { priorAssessmentId: "assessment-first", missingAspect: "pedagogical explanation", expectedCoverageGain: "find a teaching explanation" },
    }, [partial])).toMatchObject({ allowed: true });
    expect(governor.authorize("search_learning_resources", { query: "a third query" }, [partial])).toMatchObject({ allowed: false, code: "TOOL_BUDGET_EXCEEDED" });
    expect(governor.snapshot()).toContainEqual({ toolId: "search_learning_resources", consumed: 2, maximum: 2 });
  });

  it("owns the Diagnosis order and blocks every later step after a governed failure", () => {
    const workflow = new DiagnosisWorkflow();
    const list = { name: "list_capabilities", arguments: {}, resultRef: "list", status: "SUCCEEDED" as const };
    const get = { name: "get_capability", arguments: {}, resultRef: "capability", status: "SUCCEEDED" as const };

    expect(workflow.nextTool([])).toBe("list_capabilities");
    expect(workflow.nextTool([list])).toBe("get_capability");
    expect(workflow.nextTool([list, get])).toBe("run_learner_diagnosis");
    expect(workflow.trace([list, get, { name: "run_learner_diagnosis", arguments: {}, resultRef: "failed", status: "FAILED" }])).toMatchObject({
      identity: { id: "LEARNER_DIAGNOSIS", version: "1.0.0" },
      steps: expect.arrayContaining([
        { id: "EXECUTE_CAPABILITY", status: "BLOCKED", reason: expect.stringContaining("failed") },
        { id: "VALIDATE_PERSISTED_RESULT", status: "BLOCKED" },
        { id: "COMPOSE_RESPONSE", status: "BLOCKED" },
      ]),
    });
    expect(workflow.nextTool([list, get, { name: "run_learner_diagnosis", arguments: {}, resultRef: "failed", status: "FAILED" }])).toBeNull();
  });

  it("keeps product actions distinct from Agent and governed-workflow execution", () => {
    const input = request([{ role: "user", content: "Please schedule a follow-up review in three days." }]);
    const plan = new ExecutionPlanner().plan(input, new ContextCompiler().compile(input));

    expect(plan).toMatchObject({
      intent: "PRODUCT_ACTION",
      execution: { mode: "PRODUCT_ACTION" },
      route: "SOLVE_WITH_CHECKS",
      toolPolicy: { permitted: ["propose_schedule_followup"], required: ["propose_schedule_followup"] },
    });
  });
});
