import { describe, expect, it } from "vitest";
import { ContextCompiler, TaskLocalContextFilterV1 } from "../src/agent/control-plane/context-compiler";
import { ExecutionPlanner } from "../src/agent/control-plane/execution-planner";
import { EvidenceSufficiencyAssessor } from "../src/agent/control-plane/evidence-sufficiency";
import { ToolExecutionGovernor } from "../src/agent/control-plane/tool-execution-governor";
import { DiagnosisSequenceGovernor } from "../src/agent/control-plane/diagnosis-workflow";
import { CapabilityResolutionAssessor } from "../src/agent/control-plane/capability-resolution";
import type { AgentRunRequest } from "../src/agent/types";

const request = (messages: AgentRunRequest["messages"]): AgentRunRequest => ({
  conversationId: "task-conversation",
  inputOrigin: "USER_INPUT",
  runPurpose: "PRODUCT",
  messages,
});

describe("Foundry Control Plane", () => {
  it("resolves only Registry-returned capability identities and distinguishes ambiguity and execution failure", () => {
    const assessor = new CapabilityResolutionAssessor();
    const registryResult = [
      { id: "supported-example", version: "1.0.0", purpose: "A governed calculation example." },
      { id: "review-example", version: "2.0.0", purpose: "A governed review example." },
    ];

    expect(assessor.assess({ route: "SOLVE_WITH_CHECKS", requestText: "Use absent-example as the main capability.", registryEvidenceRef: "registry-1", registryResult })).toMatchObject({
      status: "REQUESTED_CAPABILITY_NOT_FOUND",
      returnedCapabilities: [{ id: "supported-example", version: "1.0.0" }, { id: "review-example", version: "2.0.0" }],
      matchedCapabilities: [],
    });
    expect(assessor.assess({ route: "SOLVE_WITH_CHECKS", requestText: "Which capability should I use?", registryEvidenceRef: "registry-2", registryResult })).toMatchObject({
      status: "REQUEST_AMBIGUOUS",
      matchedCapabilities: [],
      missingClarification: expect.any(String),
    });
    const noisySingleRegistryResult = [{
      id: "supported-example",
      version: "1.0.0",
      purpose: "Diagnose one governed calculation family.",
      requiredInput: "Provide equations and values and complete working.",
    }];
    expect(assessor.assess({ route: "SOLVE_WITH_CHECKS", requestText: "I need a diagnosis across two unrelated domains, but I have not supplied equations, values or working.", registryEvidenceRef: "registry-3", registryResult: noisySingleRegistryResult })).toMatchObject({
      status: "REQUEST_AMBIGUOUS",
      matchedCapabilities: [],
    });
    expect(assessor.executionFailed("REGISTRY_UNAVAILABLE")).toEqual({
      status: "REGISTRY_EXECUTION_FAILED",
      returnedCapabilities: [],
      matchedCapabilities: [],
      failureCode: "REGISTRY_UNAVAILABLE",
    });
  });
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
      contextPolicyId: "TASK_LOCAL_CONTEXT_FILTER",
      semanticRelevance: "NOT_IMPLEMENTED",
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

  it("states the Task-local bootstrap boundary for long history, Topic switch and missing canonical metadata", () => {
    const longHistory = request(Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `turn-${index}`,
    })));
    const topicSwitch = request([
      { role: "user", content: "Help me compare two historical accounts." },
      { role: "assistant", content: "Which accounts?" },
      { role: "user", content: "Now help me outline a geometry proof." },
    ]);
    const shortFollowUp = request([
      { role: "user", content: "Explain the first approach." },
      { role: "assistant", content: "Here is the first approach." },
      { role: "user", content: "Why does its second step follow?" },
    ]);

    const compiler = new TaskLocalContextFilterV1();
    expect(compiler.compile(longHistory)).toMatchObject({
      selectedMessageIndexes: Array.from({ length: 24 }, (_, index) => index),
      semanticRelevance: "NOT_IMPLEMENTED",
    });
    expect(compiler.compile(topicSwitch)).toMatchObject({
      selectedMessageIndexes: [0, 1, 2],
      excludedContextItems: [],
      semanticRelevance: "NOT_IMPLEMENTED",
    });
    expect(compiler.compile(shortFollowUp).selectedMessageIndexes).toEqual([0, 1, 2]);
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
    const chunkLineage = assessor.assess({ toolId: "search_learning_resources", toolCallIndex: 4, status: "SUCCEEDED", result: { results: [{ sourceId: "note", sourceType: "TEACHER_NOTE", score: 5, chunkId: "note::chunk-1" }] } });

    expect(noResults).toMatchObject({ outcome: "NO_RESULTS", anotherCallJustified: false, coverage: "NONE" });
    expect(lowAuthority).toMatchObject({ outcome: "LOW_RELEVANCE", anotherCallJustified: true, sourceAuthority: "INSUFFICIENT" });
    expect(partial).toMatchObject({ outcome: "PARTIAL_COVERAGE", anotherCallJustified: true, missingAspects: ["worked-example evidence"] });
    expect(sufficient).toMatchObject({ outcome: "SUFFICIENT_EVIDENCE", anotherCallJustified: false, lineageComplete: true });
    expect(chunkLineage).toMatchObject({ outcome: "SUFFICIENT_EVIDENCE", anotherCallJustified: false, lineageComplete: true });
  });

  it("fails Evidence sufficiency closed on unknown relevance, incomplete lineage and contamination", () => {
    const assessor = new EvidenceSufficiencyAssessor({ createId: (index) => `assessment-${index}` });
    const missingScore = assessor.assess({
      toolId: "search_learning_resources",
      toolCallIndex: 0,
      status: "SUCCEEDED",
      result: { results: [{ sourceId: "official", sourceType: "OFFICIAL_SYLLABUS", page: 1 }] },
    });
    const nonpositiveScore = assessor.assess({
      toolId: "search_learning_resources",
      toolCallIndex: 1,
      status: "SUCCEEDED",
      result: { results: [{ sourceId: "official", sourceType: "OFFICIAL_SYLLABUS", score: 0, page: 1 }] },
    });
    const incompleteLineage = assessor.assess({
      toolId: "search_learning_resources",
      toolCallIndex: 2,
      status: "SUCCEEDED",
      result: { results: [{ sourceId: "official", sourceType: "OFFICIAL_SYLLABUS", score: 4 }] },
    });
    const contaminated = assessor.assess({
      toolId: "search_learning_resources",
      toolCallIndex: 3,
      status: "SUCCEEDED",
      result: {
        results: [{ sourceId: "official", sourceType: "OFFICIAL_SYLLABUS", score: 4, page: 2 }],
        contaminationRisk: "DETECTED",
      },
    });
    const wrongSubtopic = assessor.assess({
      toolId: "search_learning_resources",
      toolCallIndex: 4,
      status: "SUCCEEDED",
      result: {
        results: [{ sourceId: "official", sourceType: "OFFICIAL_SYLLABUS", score: 4, page: 2 }],
        missingAspects: ["requested subtopic", "second requested aspect"],
      },
    });

    expect(missingScore).toMatchObject({ outcome: "LOW_RELEVANCE", topicalFit: "UNKNOWN", anotherCallJustified: true });
    expect(nonpositiveScore).toMatchObject({ outcome: "LOW_RELEVANCE", topicalFit: "LOW", anotherCallJustified: true });
    expect(incompleteLineage).toMatchObject({ outcome: "PARTIAL_COVERAGE", lineageComplete: false, anotherCallJustified: true });
    expect(contaminated).toMatchObject({ outcome: "PARTIAL_COVERAGE", contaminationRisk: "DETECTED", anotherCallJustified: true });
    expect(wrongSubtopic).toMatchObject({ outcome: "PARTIAL_COVERAGE", missingAspects: ["requested subtopic", "second requested aspect"] });
  });

  it("enforces Plan-owned budgets, duplicate protection and justified second retrieval", () => {
    const input = request([{ role: "user", content: "Why is this relationship valid?" }]);
    const plan = new ExecutionPlanner().plan(input, new ContextCompiler().compile(input));
    const governor = new ToolExecutionGovernor(plan);

    expect(plan.toolPolicy.maximumCallsPerTool.search_learning_resources).toBe(2);
    expect(governor.authorize("search_learning_resources", { query: "coefficient relationship" }, [])).toMatchObject({ allowed: true, disposition: "ALLOW" });
    expect(governor.authorize("search_learning_resources", { query: "coefficient relationship" }, [], {
      routeAvailable: true,
      availableAlternativeTools: [],
      governedWorkflowStepRemaining: false,
    })).toMatchObject({ allowed: false, disposition: "REJECT_RECOVERABLE", code: "DUPLICATE_TOOL_CALL" });

    const partial = new EvidenceSufficiencyAssessor({ createId: () => "assessment-first" }).assess({
      toolId: "search_learning_resources",
      toolCallIndex: 0,
      status: "SUCCEEDED",
      result: { results: [{ sourceId: "official", sourceType: "OFFICIAL_SYLLABUS", score: 3, page: 1 }], missingAspects: ["pedagogical explanation"] },
    });
    expect(governor.authorize("search_learning_resources", { query: "coefficient relation details" }, [partial], {
      routeAvailable: true,
      availableAlternativeTools: [],
      governedWorkflowStepRemaining: false,
    })).toMatchObject({ allowed: false, disposition: "REJECT_TERMINAL", code: "SECOND_SEARCH_JUSTIFICATION_REQUIRED" });
    expect(governor.authorize("search_learning_resources", {
      query: "particle count scaling pedagogical explanation",
      retrievalJustification: { priorAssessmentId: "assessment-first", missingAspect: "pedagogical explanation", expectedCoverageGain: "find a teaching explanation" },
    }, [partial])).toMatchObject({ allowed: true });
    expect(governor.authorize("search_learning_resources", { query: "a third query" }, [partial], {
      routeAvailable: false,
      availableAlternativeTools: [],
      governedWorkflowStepRemaining: false,
    })).toMatchObject({ allowed: false, disposition: "REJECT_TERMINAL", code: "TOOL_BUDGET_EXCEEDED" });
    expect(governor.snapshot()).toContainEqual({ toolId: "search_learning_resources", consumed: 2, maximum: 2 });
  });

  it("owns the Diagnosis order and blocks every later step after a governed failure", () => {
    const workflow = new DiagnosisSequenceGovernor();
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

  it.each([
    ["Thanks — can you help me organize my thoughts?", "GENERAL_ASSISTANCE"],
    ["What is the weather outside?", "GENERAL_ASSISTANCE"],
    ["Calculate 17.5 / 2.5.", "CONCRETE_CALCULATION"],
    ["Solve 2x + 3 = 7.", "CONCRETE_CALCULATION"],
  ] as const)("denies every tool unless the Plan explicitly grants one: %s", (content, expectedIntent) => {
    const input = request([{ role: "user", content }]);
    const plan = new ExecutionPlanner().plan(input, new ContextCompiler().compile(input));

    expect(plan.intent).toBe(expectedIntent);
    expect(plan.execution.mode).toBe("DIRECT_MODEL");
    expect(plan.toolPolicy.permitted).toEqual([]);
    expect(plan.toolPolicy.required).toEqual([]);
    expect(plan.toolPolicy.forbidden).toEqual([
      "search_learning_resources",
      "list_capabilities",
      "get_capability",
      "run_learner_diagnosis",
      "record_capability_gap",
      "propose_library_artifact",
      "propose_schedule_followup",
    ]);
    expect(plan.toolPolicy.maximumCallsPerTool).toMatchObject({
      search_learning_resources: 0,
      list_capabilities: 0,
      get_capability: 0,
      run_learner_diagnosis: 0,
      propose_library_artifact: 0,
      propose_schedule_followup: 0,
    });
  });

  it("grants only the requested Product Action tool", () => {
    const input = request([{ role: "user", content: "Please save this explanation to my library." }]);
    const plan = new ExecutionPlanner().plan(input, new ContextCompiler().compile(input));

    expect(plan.toolPolicy.permitted).toEqual(["propose_library_artifact"]);
    expect(plan.toolPolicy.required).toEqual(["propose_library_artifact"]);
    expect(plan.toolPolicy.maximumCallsPerTool.propose_library_artifact).toBe(1);
    expect(plan.toolPolicy.maximumCallsPerTool.propose_schedule_followup).toBe(0);
  });
});
