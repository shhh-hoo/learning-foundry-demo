import { describe, expect, it } from "vitest";
import { kpDraft } from "../src/components/kp-from-equilibrium-moles";
import { massDraft } from "../src/components/stoichiometric-product-mass";
import { publishedComponents } from "../src/components/published";
import { diagnosticLearningComponentSchema, publishedDiagnosticLearningComponentSchema } from "../src/contracts/published-component";
import { contentHashMatches } from "../src/governance/content-hash";
import { evaluateComponent } from "../src/governance/evaluation";
import { standardTrainerCapability } from "../src/runtime/capability";
import { caie9701StandardPack } from "../src/standards/caie-9701";

const clone = <T,>(value: T): T => structuredClone(value);

describe("canonical component contract", () => {
  it("accepts valid migrated Kp and expert-authored mass components", () => {
    expect(diagnosticLearningComponentSchema.safeParse(kpDraft).success).toBe(true);
    expect(diagnosticLearningComponentSchema.safeParse(massDraft).success).toBe(true);
  });

  it("rejects a malformed graph", () => {
    const malformed = { ...clone(massDraft), reasoningGraph: { ...massDraft.reasoningGraph, pedagogicalOrder: [...massDraft.reasoningGraph.pedagogicalOrder, "missing-node"] } };
    const report = evaluateComponent(malformed, caie9701StandardPack, standardTrainerCapability);
    expect(report.checks.find((check) => check.id === "reasoning_graph_integrity")?.status).toBe("FAIL");
  });

  it("rejects an unresolved fact reference", () => {
    const expression = massDraft.formulaDefinitions[0].expression;
    if (expression.kind !== "BINARY" || expression.left.kind !== "VARIABLE" || expression.left.reference.source !== "AUTHORED_FACT") throw new Error("Unexpected test fixture.");
    const malformed = { ...clone(massDraft), formulaDefinitions: [
      { ...massDraft.formulaDefinitions[0], expression: { ...expression, left: { ...expression.left, reference: { ...expression.left.reference, factId: "missing-fact" } } } },
      ...massDraft.formulaDefinitions.slice(1),
    ] };
    const report = evaluateComponent(malformed, caie9701StandardPack, standardTrainerCapability);
    expect(report.checks.find((check) => check.id === "formula_reference_integrity")?.status).toBe("FAIL");
  });

  it("separates schema validity from unsupported runtime target", () => {
    const unsupported = { ...clone(massDraft), target: { ...massDraft.target, kind: "PH" as const } };
    const report = evaluateComponent(unsupported, caie9701StandardPack, standardTrainerCapability);
    expect(report.checks.find((check) => check.id === "schema_validity")?.status).toBe("PASS");
    expect(report.checks.find((check) => check.id === "runtime_capability_compatibility")?.status).toBe("FAIL");
  });

  it("requires provenance and publication hash", () => {
    const missingProvenance = clone(massDraft) as unknown as Record<string, unknown>;
    delete missingProvenance.provenance;
    expect(diagnosticLearningComponentSchema.safeParse(missingProvenance).success).toBe(false);
    const missingHash = { ...clone(publishedComponents[1]), publication: { ...publishedComponents[1].publication, contentHash: "" } };
    expect(publishedDiagnosticLearningComponentSchema.safeParse(missingHash).success).toBe(false);
  });

  it("enforces origin-specific provenance and simplified migration metadata", () => {
    const ai = clone(massDraft) as unknown as Record<string, unknown>;
    ai.provenance = { origin: "AI_GENERATED", generatorId: "demo-only" };
    expect(diagnosticLearningComponentSchema.safeParse(ai).success).toBe(false);

    const migrated = { ...clone(kpDraft), migration: undefined };
    expect(diagnosticLearningComponentSchema.safeParse(migrated).success).toBe(false);
    expect(kpDraft.migration).toMatchObject({
      fidelity: "SIMPLIFIED",
      sourceContractVersion: "2.0.0-draft.2",
    });
    expect(kpDraft.migration?.omittedCapabilities).toContain("recognition gating");
  });

  it("rejects a mutated immutable snapshot hash", () => {
    const mutated = { ...clone(publishedComponents[1]), presentation: { ...publishedComponents[1].presentation, prompt: `${publishedComponents[1].presentation.prompt} changed` } };
    expect(contentHashMatches(publishedComponents[1])).toBe(true);
    expect(contentHashMatches(mutated)).toBe(false);
  });
});
