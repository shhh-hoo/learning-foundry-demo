import { describe, expect, it } from "vitest";
import { massDraft } from "../src/components/stoichiometric-product-mass";
import { generateInvalidStoichiometryDraft, generateValidStoichiometryDraft } from "../src/generation/deterministic-generator";
import { evaluateComponent } from "../src/governance/evaluation";
import { standardTrainerCapability } from "../src/runtime/capability";
import { caie9701StandardPack } from "../src/standards/caie-9701";

const clone = <T,>(value: T): T => structuredClone(value);
const report = (component: typeof massDraft) => evaluateComponent(component, caie9701StandardPack, standardTrainerCapability);
const status = (component: typeof massDraft, id: string) => report(component).checks.find((check) => check.id === id)?.status;

describe("Foundry component evaluation", () => {
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

  it("rejects mark-scheme misalignment and runtime incompatibility", () => {
    const marks = { ...clone(massDraft), markScheme: [{ ...massDraft.markScheme[0], marks: 2 }, ...massDraft.markScheme.slice(1)] };
    expect(status(marks, "mark_scheme_alignment")).toBe("FAIL");
    const unsupported = { ...clone(massDraft), target: { ...massDraft.target, kind: "CONCENTRATION" as const } };
    expect(status(unsupported, "runtime_capability_compatibility")).toBe("FAIL");
  });
});
