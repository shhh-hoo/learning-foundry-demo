import { describe, expect, it } from "vitest";
import { CHEMISTRY_CAPABILITIES, executeChemistryCapability } from "@/reference-packs/chemistry/capabilities";

describe("Chemistry Reference Pack deterministic capabilities", () => {
  it("registers multiple useful adapters outside Core", () => {
    expect(CHEMISTRY_CAPABILITIES.map((item) => item.implementationKey)).toEqual([
      "chemistry.molar-concentration.v1",
      "chemistry.solution-dilution.v1",
      "chemistry.ideal-gas-moles.v1",
      "chemistry.ph-from-hydrogen-ion.v1",
    ]);
    expect(CHEMISTRY_CAPABILITIES.every((item) => typeof item.evaluationFixture.input === "object" && typeof item.evaluationFixture.expected.expected === "number")).toBe(true);
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

  it("reports a deterministic numeric mismatch without inventing a Diagnosis", () => {
    const result = executeChemistryCapability("chemistry.ph-from-hydrogen-ion.v1", { hydrogenIonConcentration: 0.001, learnerAnswer: 7 });
    expect(result).toMatchObject({ status: "INCORRECT", failureCode: "NUMERIC_MISMATCH", firstInvalidStep: "FINAL_NUMERIC_COMPARISON" });
  });
});
