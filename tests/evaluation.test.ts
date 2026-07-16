import { describe, expect, it } from "vitest";
import { massDraft } from "../src/components/stoichiometric-product-mass";
import { generateInvalidStoichiometryDraft, generateValidStoichiometryDraft } from "../src/generation/deterministic-generator";
import { runComponentContractChecks } from "../src/governance/component-contract-checks";
import { standardTrainerCapability } from "../src/runtime/capability";
import { caie9701StandardPack } from "../src/standards/caie-9701";

const clone = <T,>(value: T): T => structuredClone(value);
const report = (component: unknown) => runComponentContractChecks(component, caie9701StandardPack, standardTrainerCapability);
const status = (component: unknown, id: string) => report(component).checks.find((check) => check.id === id)?.status;

describe("Component Contract Checks", () => {
  it("passes a valid stoichiometry component and deterministic generated draft", () => {
    expect(report(massDraft).outcome).toBe("PASSED");
    expect(report(generateValidStoichiometryDraft()).outcome).toBe("PASSED");
  });

  it("rejects the generated wrong mole ratio", () => {
    const result = report(generateInvalidStoichiometryDraft());
    expect(result.outcome).toBe("FAILED");
    expect(result.checks.find((check) => check.id === "target_answer_consistency")?.status).toBe("FAIL");
  });

  it("rejects a wrong target answer", () => {
    const component = { ...clone(massDraft), target: { ...massDraft.target, expectedValue: 9 } };
    expect(status(component, "target_answer_consistency")).toBe("FAIL");
  });

  it("rejects a unit mismatch", () => {
    const component = { ...clone(massDraft), target: { ...massDraft.target, acceptedUnits: ["kg"] } };
    expect(status(component, "unit_consistency")).toBe("FAIL");
  });

  it("rejects a significant-figure mismatch", () => {
    const component = { ...clone(massDraft), target: { ...massDraft.target, significantFigures: 5 } };
    expect(status(component, "significant_figure_consistency")).toBe("FAIL");
  });

  it("rejects a missing strategy node", () => {
    const component = { ...clone(massDraft), reasoningGraph: { ...massDraft.reasoningGraph, acceptedStrategies: [{ ...massDraft.reasoningGraph.acceptedStrategies[0], nodeRequirements: massDraft.reasoningGraph.acceptedStrategies[0].nodeRequirements.slice(1) }] } };
    expect(status(component, "accepted_strategy_completeness")).toBe("FAIL");
  });

  it("validates each accepted strategy independently instead of using their union", () => {
    const midpoint = Math.ceil(massDraft.reasoningGraph.pedagogicalOrder.length / 2);
    const firstHalf = massDraft.reasoningGraph.acceptedStrategies[0].nodeRequirements.slice(0, midpoint);
    const secondHalf = massDraft.reasoningGraph.acceptedStrategies[0].nodeRequirements.slice(midpoint);
    const component = {
      ...clone(massDraft),
      reasoningGraph: {
        ...massDraft.reasoningGraph,
        acceptedStrategies: [
          { id: "FIRST_HALF", label: "First incomplete strategy", nodeRequirements: firstHalf },
          { id: "SECOND_HALF", label: "Second incomplete strategy", nodeRequirements: secondHalf },
        ],
      },
    };
    const check = report(component).checks.find((item) => item.id === "accepted_strategy_completeness");
    expect(check?.status).toBe("FAIL");
    expect(check?.evidence).toEqual([
      expect.stringContaining("Strategy FIRST_HALF: missing nodes"),
      expect.stringContaining("Strategy SECOND_HALF: missing nodes"),
    ]);
  });

  it("does not mistake a unit substring inside Magnesium for an answer-unit token", () => {
    const component = {
      ...clone(massDraft),
      presentation: { ...massDraft.presentation, prompt: "Magnesium reacts with oxygen. Calculate the product mass for sample 3." },
      markScheme: massDraft.markScheme.map((point) => point.reasoningNodeId === "report-unit" ? { ...point, description: "Reports the final mass" } : point),
    };
    const check = report(component).checks.find((item) => item.id === "unit_consistency");
    expect(check?.status).toBe("FAIL");
    expect(check?.evidence[0]).toContain("No accepted answer-unit token (g)");
  });

  it("does not mistake an unrelated number for a significant-figure requirement", () => {
    const component = {
      ...clone(massDraft),
      presentation: { ...massDraft.presentation, prompt: "Magnesium sample 3 reacts with excess oxygen. Calculate the product mass in g." },
    };
    const check = report(component).checks.find((item) => item.id === "significant_figure_consistency");
    expect(check?.status).toBe("FAIL");
    expect(check?.evidence[0]).toContain("No explicit 3 significant figures phrase");
  });

  it("returns a structured schema failure without touching malformed deep fields", () => {
    expect(() => report({ id: "malformed", version: "1.0.0", reasoningGraph: {} })).not.toThrow();
    const result = report({ id: "malformed", version: "1.0.0", reasoningGraph: {} });
    expect(result).toMatchObject({
      componentId: "malformed",
      componentVersion: "1.0.0",
      outcome: "FAILED",
      checks: [{ id: "schema_validity", status: "FAIL" }],
    });
    expect(result.checks).toHaveLength(1);
  });

  it("rejects mark-scheme misalignment and runtime incompatibility", () => {
    const marks = { ...clone(massDraft), markScheme: [{ ...massDraft.markScheme[0], marks: 2 }, ...massDraft.markScheme.slice(1)] };
    expect(status(marks, "mark_scheme_alignment")).toBe("FAIL");
    const unsupported = { ...clone(massDraft), target: { ...massDraft.target, kind: "CONCENTRATION" as const } };
    expect(status(unsupported, "runtime_capability_compatibility")).toBe("FAIL");
  });
});
