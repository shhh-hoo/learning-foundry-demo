import { describe, expect, it } from "vitest";
import { CHEMISTRY_CAPABILITIES, executeChemistryCapability } from "@/reference-packs/chemistry/capabilities";

describe("Chemistry Reference Pack deterministic capabilities", () => {
  it("registers multiple useful adapters outside Core", () => {
    expect(CHEMISTRY_CAPABILITIES.map((item) => item.implementationKey)).toEqual([
      "chemistry.molar-concentration.v1",
      "chemistry.solution-dilution.v1",
      "chemistry.ideal-gas-moles.v1",
      "chemistry.ph-from-hydrogen-ion.v1",
      "chemistry.amount-from-mass.v1",
      "chemistry.titration-concentration.v1",
      "chemistry.limiting-reagent-product.v1",
      "chemistry.percentage-yield.v1",
      "chemistry.cell-potential.v1",
      "chemistry.weak-acid-ka.v1",
    ]);
    expect(CHEMISTRY_CAPABILITIES.every((item) => typeof item.evaluationFixture.input === "object" && typeof item.evaluationFixture.expected.expected === "number")).toBe(true);
  });

  it("executes the versioned deterministic fixture for every active Pack capability", () => {
    for (const capability of CHEMISTRY_CAPABILITIES) {
      const result = executeChemistryCapability(capability.implementationKey, capability.evaluationFixture.input);
      expect(result.expected, capability.key).toBeCloseTo(capability.evaluationFixture.expected.expected, 12);
      expect(result, capability.key).toMatchObject({
        unit: capability.evaluationFixture.expected.unit,
        status: capability.evaluationFixture.expected.status,
        failureCode: capability.evaluationFixture.expected.failureCode,
        firstInvalidStep: capability.evaluationFixture.expected.firstInvalidStep,
      });
    }
  });

  it("executes unit-aware molar concentration", () => {
    const result = executeChemistryCapability("chemistry.molar-concentration.v1", { amount: { value: 250, unit: "mmol" }, volume: { value: 500, unit: "mL" }, learnerAnswer: 0.5 });
    expect(result).toMatchObject({ expected: 0.5, unit: "mol/L", status: "CORRECT", failureCode: null });
  });

  it("executes dilution, ideal-gas and pH calculations", () => {
    expect(executeChemistryCapability("chemistry.solution-dilution.v1", { initialConcentration: { value: 1, unit: "mol/L" }, initialVolume: { value: 25, unit: "mL" }, finalVolume: { value: 100, unit: "mL" }, learnerAnswer: 0.25 }).status).toBe("CORRECT");
    expect(executeChemistryCapability("chemistry.ideal-gas-moles.v1", { pressure: { value: 101.325, unit: "kPa" }, volume: { value: 24.465, unit: "L" }, temperature: { value: 298.15, unit: "K" }, learnerAnswer: 1, tolerance: 0.01 }).status).toBe("CORRECT");
    expect(executeChemistryCapability("chemistry.ph-from-hydrogen-ion.v1", { hydrogenIonConcentration: 0.001, learnerAnswer: 3 }).status).toBe("CORRECT");
  });

  it("executes the six broader activities with representative unit conversions", () => {
    const amountFromMass = executeChemistryCapability("chemistry.amount-from-mass.v1", {
      mass: { value: 9800, unit: "mg" }, molarMass: { value: 98, unit: "g/mol" }, learnerAnswer: 0.1,
    });
    expect(amountFromMass.expected).toBeCloseTo(0.1, 12);
    expect(amountFromMass).toMatchObject({ unit: "mol", status: "CORRECT" });

    expect(executeChemistryCapability("chemistry.titration-concentration.v1", {
      standardConcentration: { value: 100, unit: "mmol/L" }, standardVolume: { value: 25, unit: "cm3" }, unknownVolume: { value: 0.02, unit: "L" }, standardCoefficient: 1, unknownCoefficient: 2, learnerAnswer: 0.25,
    })).toMatchObject({ expected: 0.25, unit: "mol/L", status: "CORRECT" });

    expect(executeChemistryCapability("chemistry.limiting-reagent-product.v1", {
      reactantAAmount: { value: 400, unit: "mmol" }, reactantBAmount: { value: 0.15, unit: "mol" }, reactantACoefficient: 2, reactantBCoefficient: 1, productCoefficient: 2, learnerAnswer: 0.3,
    })).toMatchObject({ expected: 0.3, unit: "mol", status: "CORRECT" });

    expect(executeChemistryCapability("chemistry.percentage-yield.v1", {
      actualYield: { value: 0.008, unit: "kg" }, theoreticalYield: { value: 10, unit: "g" }, learnerAnswer: 80,
    })).toMatchObject({ expected: 80, unit: "%", status: "CORRECT" });

    const aboveHundredPercent = executeChemistryCapability("chemistry.percentage-yield.v1", {
      actualYield: { value: 11, unit: "g" }, theoreticalYield: { value: 10, unit: "g" }, learnerAnswer: 110,
    });
    expect(aboveHundredPercent.expected).toBeCloseTo(110, 12);
    expect(aboveHundredPercent).toMatchObject({ unit: "%", status: "CORRECT" });

    expect(executeChemistryCapability("chemistry.cell-potential.v1", {
      cathodePotential: { value: 340, unit: "mV" }, anodePotential: { value: -0.76, unit: "V" }, learnerAnswer: 1.1,
    })).toMatchObject({ expected: 1.1, unit: "V", status: "CORRECT" });

    const ka = executeChemistryCapability("chemistry.weak-acid-ka.v1", {
      initialConcentration: { value: 100, unit: "mmol/L" }, measuredPh: 3, learnerAnswer: 0.0000101010101010101,
    });
    expect(ka.expected).toBeCloseTo(0.0000101010101010101, 15);
    expect(ka.status).toBe("CORRECT");
  });

  it("rejects invalid physical domains before calculation", () => {
    const invalidInputs: Array<[string, Record<string, unknown>]> = [
      ["chemistry.amount-from-mass.v1", { mass: { value: 9.8, unit: "g" }, molarMass: { value: 0, unit: "g/mol" }, learnerAnswer: 0.1 }],
      ["chemistry.titration-concentration.v1", { standardConcentration: { value: 0.1, unit: "mol/L" }, standardVolume: { value: 25, unit: "mL" }, unknownVolume: { value: 20, unit: "mL" }, standardCoefficient: 0, unknownCoefficient: 2, learnerAnswer: 0.25 }],
      ["chemistry.limiting-reagent-product.v1", { reactantAAmount: { value: 0.4, unit: "mol" }, reactantBAmount: { value: 0.15, unit: "mol" }, reactantACoefficient: 2, reactantBCoefficient: 1, productCoefficient: 0, learnerAnswer: 0.3 }],
      ["chemistry.percentage-yield.v1", { actualYield: { value: 0, unit: "g" }, theoreticalYield: { value: 0, unit: "g" }, learnerAnswer: 0 }],
      ["chemistry.cell-potential.v1", { cathodePotential: { value: Number.POSITIVE_INFINITY, unit: "V" }, anodePotential: { value: 0, unit: "V" }, learnerAnswer: 0 }],
      ["chemistry.weak-acid-ka.v1", { initialConcentration: { value: 0.001, unit: "mol/L" }, measuredPh: 3, learnerAnswer: 0 }],
    ];
    for (const [key, input] of invalidInputs) expect(() => executeChemistryCapability(key, input), key).toThrow();
  });

  it("reports only a final numeric mismatch for incorrect answers across the broader activities", () => {
    for (const capability of CHEMISTRY_CAPABILITIES.slice(4)) {
      const result = executeChemistryCapability(capability.implementationKey, { ...capability.evaluationFixture.input, learnerAnswer: capability.evaluationFixture.expected.expected + 1 });
      expect(result, capability.key).toMatchObject({
        status: "INCORRECT",
        failureCode: "NUMERIC_MISMATCH",
        firstInvalidStep: "FINAL_NUMERIC_COMPARISON",
      });
    }
  });

  it("reports a deterministic numeric mismatch without inventing a Diagnosis", () => {
    const result = executeChemistryCapability("chemistry.ph-from-hydrogen-ion.v1", { hydrogenIonConcentration: 0.001, learnerAnswer: 7 });
    expect(result).toMatchObject({ status: "INCORRECT", failureCode: "NUMERIC_MISMATCH", firstInvalidStep: "FINAL_NUMERIC_COMPARISON" });
  });
});
