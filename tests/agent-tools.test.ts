import { describe, expect, it } from "vitest";
import { createAgentToolExecutor } from "../src/agent/tool-executor";

const TEST_FIXTURE = "TEST_FIXTURE" as const;
const capabilities = [
  { id: "mass", version: "1.0.0", purpose: "Mass", requiredInput: "attempt", outputContract: "trace", limitations: [], readiness: "READY", runtimeEndpoint: "http://127.0.0.1:4177/diagnose", visibility: "AGENT" as const },
  { id: "kp", version: "1.0.0", purpose: "Legacy", requiredInput: "attempt", outputContract: "trace", limitations: [], readiness: "LEGACY", runtimeEndpoint: "http://127.0.0.1:4177/diagnose", visibility: "ENGINEERING_ONLY" as const },
];
const resources = [{ sourceId: "source-1", origin: "CURATED_LOCAL_RESOURCE" as const, title: "Equation coefficients", excerpt: "Coefficients define mole ratios.", syllabusCode: "9701", topic: "Stoichiometry", keywords: ["coefficients"] }];

describe("agent tools", () => {
  it("searches real local resource metadata and keeps legacy Kp out of the agent list", async () => {
    expect(TEST_FIXTURE).toBe("TEST_FIXTURE");
    const tools = createAgentToolExecutor({ capabilities, resources, diagnosisUrl: "http://127.0.0.1:4177/diagnose", createId: () => "test" });
    await expect(tools.execute("search_learning_resources", { query: "coefficients" })).resolves.toMatchObject({ claimRefs: ["source-1"] });
    const listed = await tools.execute("list_capabilities", {});
    expect(listed.data).toEqual([expect.objectContaining({ id: "mass" })]);
    await expect(tools.execute("get_capability", { id: "kp" })).rejects.toThrow("CAPABILITY_NOT_AVAILABLE");
  });

  it("calls the Trainer endpoint and preserves its diagnosis trace id", async () => {
    let requested = "";
    const tools = createAgentToolExecutor({ capabilities, resources, diagnosisUrl: "http://127.0.0.1:4177/diagnose", createId: () => "test", fetcher: async (input) => {
      requested = String(input);
      return Response.json({ ok: true, result: { traceId: "trainer-trace-real", diagnosis: { failureCode: "WRONG_STOICHIOMETRIC_RATIO" } } });
    } });
    const result = await tools.execute("run_learner_diagnosis", { componentId: "mass", problemContext: { prompt: "A complete original chemistry problem prompt.", reactionEquation: "2Mg + O2 -> 2MgO", givenValues: [{ label: "mass Mg", value: 4.8, unit: "g" }], targetQuantity: "mass MgO", answerRequirement: "3 significant figures" }, attempt: { attemptId: "a", componentId: "mass", componentVersion: "1.0.0", strategyId: "s", evidencedReasoningNodeIds: [], substitutedFacts: {}, stoichiometricRatio: 0.5, finalAnswer: { value: 4, unit: "g", significantFigures: 3 } } });
    expect(requested).toBe("http://127.0.0.1:4177/diagnose");
    expect(result.claimRefs).toEqual(["trainer-trace-real"]);
  });

  it("rejects unknown tools and invalid local arguments before execution", async () => {
    const tools = createAgentToolExecutor({ capabilities, resources, diagnosisUrl: "http://127.0.0.1:4177/diagnose" });
    await expect(tools.execute("unknown", {})).rejects.toThrow("UNKNOWN_AGENT_TOOL");
    await expect(tools.execute("search_learning_resources", { query: "" })).rejects.toThrow();
    await expect(tools.execute("run_learner_diagnosis", { componentId: "mass", problemContext: { prompt: "working only", reactionEquation: "", givenValues: [], targetQuantity: "" }, attempt: {} })).rejects.toThrow();
  });
});
