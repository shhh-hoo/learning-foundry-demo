import { describe, expect, it } from "vitest";
import { createAgentToolExecutor } from "../src/agent/tool-executor";
import type { CorpusSearchService } from "../src/corpus/types";

const TEST_FIXTURE = "TEST_FIXTURE" as const;
const capabilities = [
  { id: "mass", version: "1.0.0", purpose: "Mass", requiredInput: "attempt", outputContract: "trace", limitations: [], readiness: "READY", runtimeEndpoint: "http://127.0.0.1:4177/diagnose", visibility: "AGENT" as const },
  { id: "kp", version: "1.0.0", purpose: "Legacy", requiredInput: "attempt", outputContract: "trace", limitations: [], readiness: "LEGACY", runtimeEndpoint: "http://127.0.0.1:4177/diagnose", visibility: "ENGINEERING_ONLY" as const },
];

const corpus = (excerpt = "At particle level, coefficients define a particle ratio. A mole is a fixed number of particles given by the Avogadro constant."): CorpusSearchService => ({
  search: async (query, filters) => ({
    retrievalTraceId: "retrieval-trace-test",
    query,
    filters,
    results: [{ chunkId: "note::1", sourceId: "TN-001-COEFFICIENTS-TO-MOLE-RATIOS", sourceType: "TEACHER_NOTE", distributionScope: "SCHOOL_INTERNAL", title: "Equation coefficients", excerpt, syllabusCode: "9701", syllabusVersion: "2025-2027", learningOutcomeIds: ["2.4.1"], calculationFamilyIds: ["CORE-001"], section: "Teacher Note", score: 12 }],
  }),
});

describe("agent tools", () => {
  it("searches governed corpus metadata and keeps capability IDs out of source references", async () => {
    expect(TEST_FIXTURE).toBe("TEST_FIXTURE");
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), diagnosisUrl: "http://127.0.0.1:4177/diagnose", createId: () => "test" });
    await expect(tools.execute("search_learning_resources", { query: "coefficients", examBoard: "CAIE", syllabusCode: "9701", syllabusVersion: "2025-2027" })).resolves.toMatchObject({ sourceRefs: ["TN-001-COEFFICIENTS-TO-MOLE-RATIOS"], evidenceRefs: ["retrieval-trace-test"] });
    const listed = await tools.execute("list_capabilities", {});
    expect(listed.data).toEqual([expect.objectContaining({ id: "mass" })]);
    expect(listed.sourceRefs).toBeUndefined();
    expect(listed.evidenceRefs).toEqual(["capability-list-test"]);
    await expect(tools.execute("get_capability", { id: "kp" })).rejects.toThrow("CAPABILITY_NOT_AVAILABLE");
  });

  it("returns the governed particle-to-mole explanation for coefficient-ratio questions", async () => {
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), diagnosisUrl: "http://127.0.0.1:4177/diagnose", createId: () => "test" });
    const result = await tools.execute("search_learning_resources", { query: "coefficients particle mole ratio Avogadro", calculationFamilyId: "CORE-001" });
    const content = JSON.stringify(result.data);
    expect(content).toMatch(/particle ratio/iu);
    expect(content).toMatch(/fixed number/iu);
    expect(content).toMatch(/Avogadro/iu);
  });

  it("calls the Trainer endpoint and resolves the persisted diagnosis trace", async () => {
    const requests: string[] = [];
    let requestedBody: unknown;
    const currentUserMessage = "A complete original chemistry problem prompt. 2Mg + O2 -> 2MgO. 4.8 g. Find mass MgO. Give 3 significant figures. Working: 4.8/24.0=0.2 mol, ratio 0.5, so I got 4 g.";
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), diagnosisUrl: "http://127.0.0.1:4177/diagnose", runPurpose: "PRODUCT", currentUserMessage, createId: () => "test", fetcher: async (input, init) => {
      requests.push(String(input));
      if (init?.method === "POST") {
        requestedBody = JSON.parse(String(init.body));
        return Response.json({ ok: true, result: { traceId: "trainer-trace-real", diagnosis: { failureCode: "WRONG_STOICHIOMETRIC_RATIO" } } });
      }
      return Response.json({ ok: true, diagnosis: { traceId: "trainer-trace-real" } });
    } });
    const result = await tools.execute("run_learner_diagnosis", { componentId: "mass", problemContext: { prompt: "A complete original chemistry problem prompt.", reactionEquation: "2Mg + O2 -> 2MgO", givenValues: [{ label: "mass Mg", value: 4.8, unit: "g" }], targetQuantity: "mass MgO", answerRequirement: "3 significant figures" }, problemContextEvidence: { promptQuote: "A complete original chemistry problem prompt.", reactionEquationQuote: "2Mg + O2 -> 2MgO", givenValueQuotes: ["4.8 g"], targetQuantityQuote: "mass MgO", answerRequirementQuote: "3 significant figures" }, attempt: { attemptId: "a", componentId: "mass", componentVersion: "1.0.0", strategyId: "s", evidencedReasoningNodeIds: [], substitutedFacts: {}, stoichiometricRatio: 0.5, finalAnswer: { value: 4, unit: "g", significantFigures: 3 } } });
    expect(requests).toEqual(["http://127.0.0.1:4177/diagnose", "http://127.0.0.1:4177/diagnoses/trainer-trace-real"]);
    expect(requestedBody).toMatchObject({ runPurpose: "PRODUCT", problemContextEvidence: { reactionEquationQuote: "2Mg + O2 -> 2MgO" } });
    expect(result.evidenceRefs).toEqual(["diagnosis-test", "trainer-trace-real"]);
    expect(result.sourceRefs).toBeUndefined();
  });

  it("rejects unknown tools and invalid local arguments before execution", async () => {
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), diagnosisUrl: "http://127.0.0.1:4177/diagnose" });
    await expect(tools.execute("unknown", {})).rejects.toThrow("UNKNOWN_AGENT_TOOL");
    await expect(tools.execute("search_learning_resources", { query: "" })).rejects.toThrow();
    await expect(tools.execute("run_learner_diagnosis", { componentId: "mass", problemContext: { prompt: "working only", reactionEquation: "", givenValues: [], targetQuantity: "" }, attempt: {} })).rejects.toThrow();
  });

  it("rejects complete-looking context and working that are not evidenced in the current message", async () => {
    let diagnosisCalled = false;
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), diagnosisUrl: "http://127.0.0.1:4177/diagnose", runPurpose: "PRODUCT", currentUserMessage: "Learner working only: 4.80 / 24.0 = 0.200 mol.", fetcher: async () => { diagnosisCalled = true; return Response.json({ ok: true }); } });
    await expect(tools.execute("run_learner_diagnosis", {
      componentId: "mass",
      problemContext: { prompt: "Magnesium reacts with excess oxygen. Calculate the mass of MgO.", reactionEquation: "2Mg + O2 -> 2MgO", givenValues: [{ label: "mass Mg", value: 4.8, unit: "g" }], targetQuantity: "mass of MgO", answerRequirement: "3 significant figures" },
      problemContextEvidence: { promptQuote: "Magnesium reacts with excess oxygen. Calculate the mass of MgO.", reactionEquationQuote: "2Mg + O2 -> 2MgO", givenValueQuotes: ["4.80 g Mg"], targetQuantityQuote: "mass of MgO", answerRequirementQuote: "3 significant figures" },
      attempt: { attemptId: "a", componentId: "mass", componentVersion: "1.0.0", strategyId: "s", evidencedReasoningNodeIds: [], substitutedFacts: {}, finalAnswer: { value: 4, unit: "g", significantFigures: 3 } },
    })).rejects.toThrow("UNVERIFIED_PROBLEM_CONTEXT");
    expect(diagnosisCalled).toBe(false);
  });
});
