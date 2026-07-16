import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AgentEvalCase } from "../src/agent/agenteval";
import { AGENT_EVAL_DIMENSIONS, AGENT_EVAL_LAYERS, buildAgentEvalSuitePlan, parseAgentEvalDimension, parseAgentEvalLayer, selectAgentEvalBaseline, selectAgentEvalDimension, selectAgentEvalLayer, summarizeAgentEvalCoverage, validateAgentEvalSuite, type AgentEvalBehaviorContract } from "../src/agent/agenteval-suite";

const caseFor = (caseId: string, suiteLayers: AgentEvalCase["suiteLayers"]): AgentEvalCase => ({
  caseId,
  category: "retrieval",
  input: caseId,
  inputOrigin: "USER_INPUT",
  expectedStatus: ["ANSWERED"],
  requiredTools: ["search_learning_resources"],
  forbiddenTools: ["run_learner_diagnosis"],
  allowedCapabilities: [],
  tags: ["AGENT_EVAL_CASE"],
  suiteLayers,
  evaluationDimensions: ["RETRIEVAL"],
});

describe("AgentEval suite layers", () => {
  it("separates the official suite layers from evaluation dimensions", () => {
    const cases = [
      { ...caseFor("smoke-retrieval", ["SMOKE", "CORE_CONTRACT"] as AgentEvalCase["suiteLayers"]), evaluationDimensions: ["RETRIEVAL"] as const },
      { ...caseFor("generalization-retrieval", ["GENERALIZATION"]), evaluationDimensions: ["RETRIEVAL"] as const },
    ];

    expect(AGENT_EVAL_LAYERS).toEqual(["SMOKE", "CORE_CONTRACT", "REFERENCE_PACK", "GENERALIZATION", "ADVERSARIAL", "LEARNING_LOOP"]);
    expect(AGENT_EVAL_DIMENSIONS).toEqual(["CONTEXT", "RETRIEVAL", "INTERPRETATION", "PEDAGOGY", "COMPONENT", "OUTCOME", "CAPABILITY_BOUNDARY"]);
    expect(selectAgentEvalLayer(cases, "SMOKE").map((item) => item.caseId)).toEqual(["smoke-retrieval"]);
    expect(selectAgentEvalDimension(cases, "RETRIEVAL").map((item) => item.caseId)).toEqual(["smoke-retrieval", "generalization-retrieval"]);
    expect(parseAgentEvalDimension("RETRIEVAL")).toBe("RETRIEVAL");
  });

  it("builds the complete suite plan independently of a run selection", () => {
    const cases = [
      { ...caseFor("core-retrieval", ["CORE_CONTRACT"]), evaluationDimensions: ["RETRIEVAL"] as const },
      { ...caseFor("general-context", ["GENERALIZATION"]), evaluationDimensions: ["CONTEXT"] as const },
    ];

    expect(buildAgentEvalSuitePlan(cases)).toMatchObject({
      layerCaseIds: { CORE_CONTRACT: ["core-retrieval"], GENERALIZATION: ["general-context"], LEARNING_LOOP: [] },
      dimensionCaseIds: { RETRIEVAL: ["core-retrieval"], CONTEXT: ["general-context"] },
    });
  });

  it("protects the versioned 1.2.0 behavioral baseline from silent drift", async () => {
    const currentText = await readFile("agent-eval/cases.jsonl", "utf8");
    const current = currentText.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as AgentEvalCase);
    const baselineText = await readFile("agent-eval/baselines/1.2.0-contract.jsonl", "utf8");
    const baseline = baselineText.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as AgentEvalBehaviorContract);

    expect(selectAgentEvalBaseline(current, baseline)).toHaveLength(18);
    const drifted = current.map((testCase) => testCase.caseId === "retrieval-01" ? { ...testCase, requiredTools: [] } : testCase);
    expect(() => selectAgentEvalBaseline(drifted, baseline)).toThrow("AGENT_EVAL_BASELINE_DRIFT: retrieval-01");
  });

  it("rejects duplicate case IDs and cases with no declared layer", () => {
    const duplicate = caseFor("same-id", ["CORE_CONTRACT"]);

    expect(() => validateAgentEvalSuite([duplicate, { ...duplicate }])).toThrow("AGENT_EVAL_CASE_IDS_DUPLICATED: same-id");
    expect(() => validateAgentEvalSuite([{ ...duplicate, caseId: "unlayered", suiteLayers: [] }])).toThrow("AGENT_EVAL_CASE_LAYERS_MISSING: unlayered");
  });

  it("rejects unknown layer names at the live-run boundary", () => {
    expect(parseAgentEvalLayer("GENERALIZATION")).toBe("GENERALIZATION");
    expect(() => parseAgentEvalLayer("FULL")).toThrow("AGENT_EVAL_LAYER_INVALID: FULL");
  });

  it("rejects taxonomy values that bypass TypeScript through JSON", () => {
    const valid = caseFor("valid", ["GENERALIZATION"]);

    expect(() => validateAgentEvalSuite([
      { ...valid, suiteLayers: ["UNKNOWN"] } as unknown as AgentEvalCase,
    ])).toThrow("AGENT_EVAL_CASE_LAYERS_INVALID: valid=UNKNOWN");
    expect(() => validateAgentEvalSuite([
      { ...valid, retrievalVariant: "SEMANTIC" } as unknown as AgentEvalCase,
    ])).toThrow("AGENT_EVAL_RETRIEVAL_VARIANTS_INVALID: valid=SEMANTIC");
    expect(() => validateAgentEvalSuite([
      { ...valid, diagnosisDimensions: ["STYLE"] } as unknown as AgentEvalCase,
    ])).toThrow("AGENT_EVAL_DIAGNOSIS_DIMENSIONS_INVALID: valid=STYLE");
  });

  it("rejects coverage labels that are detached from their contract layer", () => {
    const retrieval = {
      ...caseFor("retrieval-mislabelled", ["GENERALIZATION"]),
      evaluationDimensions: ["CONTEXT" as const],
      retrievalVariant: "CHINESE" as const,
      requiredSourceIds: ["TN-001"],
    };
    const diagnosis = {
      ...caseFor("diagnosis-mislabelled", ["GENERALIZATION"]),
      category: "retrieval",
      diagnosisDimensions: ["WORD_ORDER" as const],
    };

    expect(() => validateAgentEvalSuite([retrieval])).toThrow("AGENT_EVAL_RETRIEVAL_CONTRACT_INVALID: retrieval-mislabelled");
    expect(() => validateAgentEvalSuite([diagnosis])).toThrow("AGENT_EVAL_DIAGNOSIS_CONTRACT_INVALID: diagnosis-mislabelled");
  });

  it("rejects capability resolution labels that would mix supported and boundary evidence", () => {
    const boundaryWithoutBoundaryDimension = {
      ...caseFor("mislabelled-boundary", ["GENERALIZATION"]),
      expectedCapabilityResolution: "NO_MATCH" as const,
    };

    expect(() => validateAgentEvalSuite([boundaryWithoutBoundaryDimension])).toThrow("AGENT_EVAL_CAPABILITY_RESOLUTION_CONTRACT_INVALID: mislabelled-boundary");
  });

  it("counts retrieval generalization variants independently", () => {
    const cases: AgentEvalCase[] = [
      { ...caseFor("english", ["GENERALIZATION"]), retrievalVariant: "ENGLISH_PARAPHRASE" },
      { ...caseFor("chinese", ["GENERALIZATION"]), retrievalVariant: "CHINESE" },
      { ...caseFor("bilingual", ["GENERALIZATION"]), retrievalVariant: "BILINGUAL" },
      { ...caseFor("implicit", ["GENERALIZATION"]), retrievalVariant: "IMPLICIT_CONCEPT" },
      { ...caseFor("neighbor", ["GENERALIZATION"]), retrievalVariant: "NEAR_NEIGHBOR" },
    ];

    expect(summarizeAgentEvalCoverage(cases).retrievalVariants).toEqual({
      ENGLISH_PARAPHRASE: 1,
      CHINESE: 1,
      BILINGUAL: 1,
      IMPLICIT_CONCEPT: 1,
      NEAR_NEIGHBOR: 1,
    });
  });

  it("counts overlapping Diagnosis generalization dimensions", () => {
    const diagnosisCase: AgentEvalCase = {
      ...caseFor("diagnosis-generalization", ["GENERALIZATION"]),
      category: "diagnosis",
      diagnosisDimensions: ["WORD_ORDER", "CORRECT_RESULT"],
    };

    expect(summarizeAgentEvalCoverage([diagnosisCase]).diagnosisDimensions).toMatchObject({
      WORD_ORDER: 1,
      CORRECT_RESULT: 1,
      WRONG_RATIO: 0,
    });
  });

  it("keeps the canonical suite fully layered with six independent smoke sources", async () => {
    const text = await readFile("agent-eval/cases.jsonl", "utf8");
    const cases = text.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as AgentEvalCase);

    expect(() => validateAgentEvalSuite(cases)).not.toThrow();
    expect(selectAgentEvalLayer(cases, "SMOKE").map((item) => item.caseId)).toEqual([
      "retrieval-01",
      "diagnosis-01",
      "diagnosis-02",
      "diagnosis-missing-context-01",
      "gap-01",
      "adversarial-02",
    ]);
    expect(Object.fromEntries(AGENT_EVAL_LAYERS.map((layer) => [layer, selectAgentEvalLayer(cases, layer).length]))).toEqual({
      SMOKE: 6,
      CORE_CONTRACT: 16,
      REFERENCE_PACK: 0,
      GENERALIZATION: 55,
      ADVERSARIAL: 3,
      LEARNING_LOOP: 0,
    });
    expect(selectAgentEvalDimension(cases, "RETRIEVAL")).toHaveLength(45);
    expect(buildAgentEvalSuitePlan(cases).capabilityResolutionCaseIds).toEqual({
      FULL_MATCH: expect.arrayContaining(["retrieval-gen-en-01", "diagnosis-gen-order-01"]),
      PARTIAL_MATCH: [],
      NO_MATCH: expect.arrayContaining(["diagnosis-gen-boundary-reaction-01", "diagnosis-gen-boundary-units-02"]),
    });
    expect(buildAgentEvalSuitePlan(cases).capabilityResolutionCaseIds.FULL_MATCH).toHaveLength(49);
    expect(buildAgentEvalSuitePlan(cases).capabilityResolutionCaseIds.NO_MATCH).toHaveLength(6);
    expect(summarizeAgentEvalCoverage(cases).retrievalVariants).toEqual({
      ENGLISH_PARAPHRASE: 10,
      CHINESE: 10,
      BILINGUAL: 10,
      IMPLICIT_CONCEPT: 5,
      NEAR_NEIGHBOR: 5,
    });
    expect(summarizeAgentEvalCoverage(cases).diagnosisDimensions).toEqual({
      REACTION: 2,
      NUMBERS: 2,
      UNITS: 2,
      WORD_ORDER: 3,
      CORRECT_RESULT: 5,
      WRONG_RATIO: 5,
      ARITHMETIC: 2,
      SIGNIFICANT_FIGURES: 2,
      CAPABILITY_BOUNDARY: 6,
    });
  });
});
