import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AgentEvalCase } from "../src/agent/agenteval";
import { parseAgentEvalLayer, selectAgentEvalLayer, summarizeAgentEvalCoverage, validateAgentEvalSuite } from "../src/agent/agenteval-suite";

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
});

describe("AgentEval suite layers", () => {
  it("selects cases through the public suite-layer contract", () => {
    const cases = [
      caseFor("smoke-retrieval", ["SMOKE", "RETRIEVAL"]),
      caseFor("generalization-retrieval", ["GENERALIZATION", "RETRIEVAL"]),
    ];

    expect(selectAgentEvalLayer(cases, "SMOKE").map((item) => item.caseId)).toEqual(["smoke-retrieval"]);
    expect(selectAgentEvalLayer(cases, "RETRIEVAL").map((item) => item.caseId)).toEqual(["smoke-retrieval", "generalization-retrieval"]);
  });

  it("rejects duplicate case IDs and cases with no declared layer", () => {
    const duplicate = caseFor("same-id", ["CONTRACT"]);

    expect(() => validateAgentEvalSuite([duplicate, { ...duplicate }])).toThrow("AGENT_EVAL_CASE_IDS_DUPLICATED: same-id");
    expect(() => validateAgentEvalSuite([{ ...duplicate, caseId: "unlayered", suiteLayers: [] }])).toThrow("AGENT_EVAL_CASE_LAYERS_MISSING: unlayered");
  });

  it("rejects unknown layer names at the live-run boundary", () => {
    expect(parseAgentEvalLayer("GENERALIZATION")).toBe("GENERALIZATION");
    expect(() => parseAgentEvalLayer("FULL")).toThrow("AGENT_EVAL_LAYER_INVALID: FULL");
  });

  it("rejects taxonomy values that bypass TypeScript through JSON", () => {
    const valid = caseFor("valid", ["GENERALIZATION", "RETRIEVAL"]);

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
      retrievalVariant: "CHINESE" as const,
      requiredSourceIds: ["TN-001"],
    };
    const diagnosis = {
      ...caseFor("diagnosis-mislabelled", ["GENERALIZATION", "RETRIEVAL"]),
      category: "retrieval",
      diagnosisDimensions: ["WORD_ORDER" as const],
    };

    expect(() => validateAgentEvalSuite([retrieval])).toThrow("AGENT_EVAL_RETRIEVAL_CONTRACT_INVALID: retrieval-mislabelled");
    expect(() => validateAgentEvalSuite([diagnosis])).toThrow("AGENT_EVAL_DIAGNOSIS_CONTRACT_INVALID: diagnosis-mislabelled");
  });

  it("counts retrieval generalization variants independently", () => {
    const cases: AgentEvalCase[] = [
      { ...caseFor("english", ["GENERALIZATION", "RETRIEVAL"]), retrievalVariant: "ENGLISH_PARAPHRASE" },
      { ...caseFor("chinese", ["GENERALIZATION", "RETRIEVAL"]), retrievalVariant: "CHINESE" },
      { ...caseFor("bilingual", ["GENERALIZATION", "RETRIEVAL"]), retrievalVariant: "BILINGUAL" },
      { ...caseFor("implicit", ["GENERALIZATION", "RETRIEVAL"]), retrievalVariant: "IMPLICIT_CONCEPT" },
      { ...caseFor("neighbor", ["GENERALIZATION", "RETRIEVAL"]), retrievalVariant: "NEAR_NEIGHBOR" },
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
