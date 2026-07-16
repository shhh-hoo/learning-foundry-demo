import { describe, expect, it } from "vitest";
import { createAgentToolExecutor } from "../src/agent/tool-executor";
import type { CorpusSearchService } from "../src/corpus/types";
import { createCorpusDeliveryPolicyRuntime } from "../src/corpus/delivery-policy";

const TEST_FIXTURE = "TEST_FIXTURE" as const;
const capabilities = [
  { id: "mass", version: "1.0.0", purpose: "Mass", requiredInput: "attempt", outputContract: "trace", limitations: [], readiness: "READY", runtimeEndpoint: "http://127.0.0.1:4177/diagnose", visibility: "AGENT" as const },
  { id: "kp", version: "1.0.0", purpose: "Legacy", requiredInput: "attempt", outputContract: "trace", limitations: [], readiness: "LEGACY", runtimeEndpoint: "http://127.0.0.1:4177/diagnose", visibility: "ENGINEERING_ONLY" as const },
];
const corpusDeliveryPolicy = createCorpusDeliveryPolicyRuntime({
  version: "TEST_FIXTURE",
  provider: "deepseek",
  allowedPurposes: ["PRODUCT", "AGENT_EVAL"],
  allowedDistributionScopes: ["SCHOOL_INTERNAL"],
  allowedSourceTypes: ["OFFICIAL_SYLLABUS", "SECONDARY_REFERENCE", "TEACHER_NOTE", "STRUCTURED_CASE"],
  maxExcerptWordsPerResult: 100,
  maxResultsPerRequest: 5,
  allowRawPdfBytes: false,
  allowFullDocument: false,
  persistDeliveredExcerpt: false,
  approvedBy: "TEST_FIXTURE",
  approvedAt: "2026-07-16",
}, "test-policy-hash");

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
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), corpusDeliveryPolicy, provider: "deepseek", runPurpose: "PRODUCT", diagnosisUrl: "http://127.0.0.1:4177/diagnose", createId: () => "test" });
    await expect(tools.execute("search_learning_resources", { query: "coefficients", examBoard: "CAIE", syllabusCode: "9701", syllabusVersion: "2025-2027" })).resolves.toMatchObject({ sourceRefs: ["TN-001-COEFFICIENTS-TO-MOLE-RATIOS"], evidenceRefs: ["retrieval-trace-test"] });
    const listed = await tools.execute("list_capabilities", {});
    expect(listed.data).toEqual([expect.objectContaining({ id: "mass" })]);
    expect(listed.sourceRefs).toBeUndefined();
    expect(listed.evidenceRefs).toEqual(["capability-list-test"]);
    await expect(tools.execute("get_capability", { id: "kp" })).rejects.toThrow("CAPABILITY_NOT_AVAILABLE");
  });

  it("returns the governed particle-to-mole explanation for coefficient-ratio questions", async () => {
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), corpusDeliveryPolicy, provider: "deepseek", runPurpose: "PRODUCT", diagnosisUrl: "http://127.0.0.1:4177/diagnose", createId: () => "test" });
    const result = await tools.execute("search_learning_resources", { query: "coefficients particle mole ratio Avogadro", calculationFamilyId: "CORE-001" });
    const content = JSON.stringify(result.data);
    expect(content).toMatch(/particle ratio/iu);
    expect(content).toMatch(/fixed number/iu);
    expect(content).toMatch(/Avogadro/iu);
  });

  it("does not let a provider-only syllabus filter bypass the governed coefficient explanation", async () => {
    let receivedFilters: Record<string, unknown> = {};
    const recordingCorpus: CorpusSearchService = { search: async (query, filters) => {
      receivedFilters = filters as Record<string, unknown>;
      return corpus().search(query, filters);
    } };
    const tools = createAgentToolExecutor({ capabilities, corpus: recordingCorpus, corpusDeliveryPolicy, provider: "deepseek", runPurpose: "AGENT_EVAL", currentUserMessage: "Why do coefficients in a balanced equation give mole ratios?", diagnosisUrl: "http://127.0.0.1:4177/diagnose" });
    await tools.execute("search_learning_resources", { query: "coefficients balanced equation mole ratios", sourceType: "OFFICIAL_SYLLABUS" });
    expect(receivedFilters).not.toHaveProperty("sourceType");
    expect(receivedFilters).toMatchObject({ calculationFamilyId: "CORE-001" });
  });

  it("maps an equation-to-mole-ratio explanation to the governed coefficient family", async () => {
    let receivedFilters: Record<string, unknown> = {};
    const recordingCorpus: CorpusSearchService = { search: async (query, filters) => {
      receivedFilters = filters as Record<string, unknown>;
      return corpus().search(query, filters);
    } };
    const tools = createAgentToolExecutor({ capabilities, corpus: recordingCorpus, corpusDeliveryPolicy, provider: "deepseek", runPurpose: "AGENT_EVAL", currentUserMessage: "Explain how 2Mg + O2 -> 2MgO becomes a 1:1 Mg to MgO mole ratio.", diagnosisUrl: "http://127.0.0.1:4177/diagnose" });

    await tools.execute("search_learning_resources", { query: "mole ratio from balanced chemical equation coefficients", topic: "Stoichiometry", calculationFamilyId: "MOLE_RATIO", sourceType: "OFFICIAL_SYLLABUS" });

    expect(receivedFilters).not.toHaveProperty("topic");
    expect(receivedFilters).not.toHaveProperty("sourceType");
    expect(receivedFilters).toMatchObject({ calculationFamilyId: "CORE-001" });
  });

  it("maps limiting-reagent teaching intent to the governed calculation family", async () => {
    let receivedFilters: Record<string, unknown> = {};
    const recordingCorpus: CorpusSearchService = { search: async (query, filters) => {
      receivedFilters = filters as Record<string, unknown>;
      return corpus().search(query, filters);
    } };
    const tools = createAgentToolExecutor({ capabilities, corpus: recordingCorpus, corpusDeliveryPolicy, provider: "deepseek", runPurpose: "AGENT_EVAL", currentUserMessage: "What evidence do I compare before choosing a limiting reagent?", diagnosisUrl: "http://127.0.0.1:4177/diagnose" });

    await tools.execute("search_learning_resources", { query: "limiting reagent evidence", topic: "Stoichiometry", calculationFamilyId: "limiting-reagent" });

    expect(receivedFilters).not.toHaveProperty("topic");
    expect(receivedFilters).toMatchObject({ calculationFamilyId: "STOICH-005" });
  });

  it("maps titration teaching intent to the governed calculation family", async () => {
    let receivedFilters: Record<string, unknown> = {};
    const recordingCorpus: CorpusSearchService = { search: async (query, filters) => {
      receivedFilters = filters as Record<string, unknown>;
      return corpus().search(query, filters);
    } };
    const tools = createAgentToolExecutor({ capabilities, corpus: recordingCorpus, corpusDeliveryPolicy, provider: "deepseek", runPurpose: "AGENT_EVAL", currentUserMessage: "Why must a titration calculation include volume and concentration evidence?", diagnosisUrl: "http://127.0.0.1:4177/diagnose" });

    await tools.execute("search_learning_resources", { query: "titration volume concentration evidence", topic: "Stoichiometry" });

    expect(receivedFilters).not.toHaveProperty("topic");
    expect(receivedFilters).toMatchObject({ calculationFamilyId: "TITR-001" });
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

  it("canonicalizes unqualified Ar and Mr values as dimensionless before Trainer delivery", async () => {
    let requestedBody: { problemContext?: { givenValues?: readonly { unit?: string }[] } } = {};
    const currentUserMessage = "Original problem: Magnesium reacts with excess oxygen according to 2Mg + O2 -> 2MgO. A 4.80 g sample of Mg is used. Calculate the mass of MgO formed using Ar(Mg)=24.0 and Mr(MgO)=40.0, to 3 significant figures. Learner working: 4.80/24.0=0.200 mol Mg, then multiplied by 0.5 and got 4.00 g MgO.";
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), corpusDeliveryPolicy, provider: "deepseek", diagnosisUrl: "http://127.0.0.1:4177/diagnose", runPurpose: "PRODUCT", currentUserMessage, fetcher: async (_input, init) => {
      if (init?.method === "POST") {
        requestedBody = JSON.parse(String(init.body));
        return Response.json({ ok: true, result: { traceId: "trainer-dimensionless", diagnosis: { failureCode: "WRONG_STOICHIOMETRIC_RATIO" } } });
      }
      return Response.json({ ok: true, diagnosis: { traceId: "trainer-dimensionless" } });
    } });

    await tools.execute("run_learner_diagnosis", {
      componentId: "mass",
      problemContext: { prompt: "Calculate MgO mass from the supplied magnesium problem.", reactionEquation: "2Mg + O2 -> 2MgO", givenValues: [{ label: "mass of Mg", value: 4.8, unit: "g" }, { label: "Ar(Mg)", value: 24, unit: "g/mol" }, { label: "Mr(MgO)", value: 40, unit: "g/mol" }], targetQuantity: "mass of MgO formed", answerRequirement: "Give your answer to 3 significant figures." },
      problemContextEvidence: { promptQuote: "Original problem: Magnesium reacts with excess oxygen according to 2Mg + O2 -> 2MgO. A 4.80 g sample of Mg is used. Calculate the mass of MgO formed using Ar(Mg)=24.0 and Mr(MgO)=40.0, to 3 significant figures.", reactionEquationQuote: "2Mg + O2 -> 2MgO", givenValueQuotes: ["4.80 g sample of Mg", "Ar(Mg)=24.0", "Mr(MgO)=40.0"], targetQuantityQuote: "mass of MgO formed", answerRequirementQuote: "to 3 significant figures" },
      attempt: { attemptId: "a", componentId: "mass", componentVersion: "1.0.0", strategyId: "MOLES_RATIO_MASS", evidencedReasoningNodeIds: ["amount-magnesium", "apply-mole-ratio"], substitutedFacts: {}, stoichiometricRatio: 0.5, finalAnswer: { value: 4, unit: "g", significantFigures: 3 } },
    });

    expect(requestedBody.problemContext?.givenValues?.map((item) => item.unit)).toEqual(["g", "1", "1"]);
    expect(requestedBody.problemContext).toMatchObject({ prompt: expect.stringContaining("Original problem: Magnesium reacts"), answerRequirement: "to 3 significant figures" });
  });

  it("maps evidenced stoichiometry facts and an explicit learner ratio to Trainer input IDs", async () => {
    let requestedAttempt: { substitutedFacts?: Record<string, number>; stoichiometricRatio?: number; arithmeticWorkingValue?: number } = {};
    const currentUserMessage = "Original problem: Magnesium reacts with excess oxygen according to 2Mg + O2 -> 2MgO. A 4.80 g sample of Mg is used. Calculate the mass of MgO formed using Ar(Mg)=24.0 and Mr(MgO)=40.0, to 3 significant figures. Learner working: 4.80/24.0=0.200 mol Mg, then multiplied by 0.5 and got 4.00 g MgO. Diagnose my first mistake.";
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), corpusDeliveryPolicy, provider: "deepseek", diagnosisUrl: "http://127.0.0.1:4177/diagnose", runPurpose: "AGENT_EVAL", currentUserMessage, fetcher: async (_input, init) => {
      if (init?.method === "POST") {
        requestedAttempt = (JSON.parse(String(init.body)) as { attempt: typeof requestedAttempt }).attempt;
        return Response.json({ ok: true, result: { traceId: "trainer-mapped", diagnosis: { failureCode: "WRONG_STOICHIOMETRIC_RATIO" } } });
      }
      return Response.json({ ok: true, diagnosis: { traceId: "trainer-mapped" } });
    } });

    await tools.execute("run_learner_diagnosis", {
      componentId: "stoichiometric-product-mass",
      componentVersion: "1.0.0",
      problemContext: { prompt: currentUserMessage, reactionEquation: "2Mg + O2 -> 2MgO", givenValues: [{ label: "Ar(Mg)", value: 24, unit: "1" }, { label: "mass of Mg", value: 4.8, unit: "g" }, { label: "Mr(MgO)", value: 40, unit: "1" }], targetQuantity: "mass of MgO formed", answerRequirement: "to 3 significant figures" },
      problemContextEvidence: { promptQuote: currentUserMessage, reactionEquationQuote: "2Mg + O2 -> 2MgO", givenValueQuotes: ["Ar(Mg)=24.0", "4.80 g sample of Mg", "Mr(MgO)=40.0"], targetQuantityQuote: "mass of MgO formed", answerRequirementQuote: "to 3 significant figures" },
      attempt: { attemptId: "a", componentId: "stoichiometric-product-mass", componentVersion: "1.0.0", strategyId: "MOLES_RATIO_MASS", evidencedReasoningNodeIds: ["amount-magnesium", "apply-mole-ratio", "mass-magnesium-oxide"], substitutedFacts: { "Ar(Mg)": 24, mass_of_Mg: 4.8, "Mr(MgO)": 40 }, finalAnswer: { value: 4, unit: "g", significantFigures: 3 } },
    });

    expect(requestedAttempt.substitutedFacts).toEqual({ "mr-magnesium": 24, "mass-magnesium": 4.8, "mr-magnesium-oxide": 40 });
    expect(requestedAttempt.stoichiometricRatio).toBe(0.5);
    expect(requestedAttempt.arithmeticWorkingValue).toBe(4);
    expect((requestedAttempt as { evidencedReasoningNodeIds?: string[] }).evidencedReasoningNodeIds).toEqual(["select-data", "identify-target", "amount-magnesium", "apply-mole-ratio", "amount-magnesium-oxide", "mass-magnesium-oxide", "report-unit", "report-precision"]);
  });

  it("removes a model-supplied ratio that the learner did not evidence", async () => {
    let requestedAttempt: { stoichiometricRatio?: number } = {};
    const currentUserMessage = "Problem: 2Mg + O2 -> 2MgO; 4.80 g Mg reacts with excess oxygen; find mass MgO using Ar(Mg)=24.0 and Mr(MgO)=40.0 to 3 significant figures. My full working is correct and gives 8.0 g. Diagnose it.";
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), corpusDeliveryPolicy, provider: "deepseek", diagnosisUrl: "http://127.0.0.1:4177/diagnose", runPurpose: "AGENT_EVAL", currentUserMessage, fetcher: async (_input, init) => {
      if (init?.method === "POST") {
        requestedAttempt = (JSON.parse(String(init.body)) as { attempt: typeof requestedAttempt }).attempt;
        return Response.json({ ok: true, result: { traceId: "trainer-significant-figures", diagnosis: { failureCode: "SIGNIFICANT_FIGURES_ERROR" } } });
      }
      return Response.json({ ok: true, diagnosis: { traceId: "trainer-significant-figures" } });
    } });

    await tools.execute("run_learner_diagnosis", {
      componentId: "stoichiometric-product-mass",
      componentVersion: "1.0.0",
      problemContext: { prompt: currentUserMessage, reactionEquation: "2Mg + O2 -> 2MgO", givenValues: [{ label: "mass Mg", value: 4.8, unit: "g" }, { label: "Ar(Mg)", value: 24, unit: "1" }, { label: "Mr(MgO)", value: 40, unit: "1" }], targetQuantity: "mass MgO", answerRequirement: "to 3 significant figures" },
      problemContextEvidence: { promptQuote: currentUserMessage, reactionEquationQuote: "2Mg + O2 -> 2MgO", givenValueQuotes: ["4.80 g Mg", "Ar(Mg)=24.0", "Mr(MgO)=40.0"], targetQuantityQuote: "find mass MgO", answerRequirementQuote: "to 3 significant figures" },
      attempt: { attemptId: "a", componentId: "stoichiometric-product-mass", componentVersion: "1.0.0", strategyId: "MOLES_RATIO_MASS", evidencedReasoningNodeIds: [], substitutedFacts: {}, stoichiometricRatio: 2, finalAnswer: { value: 8, unit: "g", significantFigures: 2 } },
    });

    expect(requestedAttempt).not.toHaveProperty("stoichiometricRatio");
  });

  it("maps an explicitly stated arithmetic-working value to Trainer input", async () => {
    let requestedAttempt: { stoichiometricRatio?: number; arithmeticWorkingValue?: number } = {};
    const currentUserMessage = "Problem: 2Mg + O2 -> 2MgO; 4.80 g Mg reacts with excess oxygen; find mass MgO using Ar(Mg)=24.0 and Mr(MgO)=40.0 to 3 significant figures. I used ratio 1, but my arithmetic working says 7.90 g before I report 8.00 g. Diagnose the first issue.";
    const tools = createAgentToolExecutor({ capabilities, corpus: corpus(), corpusDeliveryPolicy, provider: "deepseek", diagnosisUrl: "http://127.0.0.1:4177/diagnose", runPurpose: "AGENT_EVAL", currentUserMessage, fetcher: async (_input, init) => {
      if (init?.method === "POST") {
        requestedAttempt = (JSON.parse(String(init.body)) as { attempt: typeof requestedAttempt }).attempt;
        return Response.json({ ok: true, result: { traceId: "trainer-arithmetic", diagnosis: { failureCode: "ARITHMETIC_ERROR" } } });
      }
      return Response.json({ ok: true, diagnosis: { traceId: "trainer-arithmetic" } });
    } });

    await tools.execute("run_learner_diagnosis", {
      componentId: "stoichiometric-product-mass",
      componentVersion: "1.0.0",
      problemContext: { prompt: currentUserMessage, reactionEquation: "2Mg + O2 -> 2MgO", givenValues: [{ label: "mass Mg", value: 4.8, unit: "g" }, { label: "Ar(Mg)", value: 24, unit: "1" }, { label: "Mr(MgO)", value: 40, unit: "1" }], targetQuantity: "mass MgO", answerRequirement: "to 3 significant figures" },
      problemContextEvidence: { promptQuote: currentUserMessage, reactionEquationQuote: "2Mg + O2 -> 2MgO", givenValueQuotes: ["4.80 g Mg", "Ar(Mg)=24.0", "Mr(MgO)=40.0"], targetQuantityQuote: "find mass MgO", answerRequirementQuote: "to 3 significant figures" },
      attempt: { attemptId: "a", componentId: "stoichiometric-product-mass", componentVersion: "1.0.0", strategyId: "MOLES_RATIO_MASS", evidencedReasoningNodeIds: [], substitutedFacts: {}, stoichiometricRatio: 2, arithmeticWorkingValue: 8, finalAnswer: { value: 8, unit: "g", significantFigures: 3 } },
    });

    expect(requestedAttempt.stoichiometricRatio).toBe(1);
    expect(requestedAttempt.arithmeticWorkingValue).toBe(7.9);
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
