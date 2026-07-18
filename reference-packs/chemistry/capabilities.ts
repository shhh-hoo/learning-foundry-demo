import { log10, unit } from "mathjs";
import { z } from "zod";

const Answer = z.object({ learnerAnswer: z.number(), tolerance: z.number().positive().max(0.1).default(0.01) });
const ValueUnit = (units: [string, ...string[]]) => z.object({ value: z.number(), unit: z.enum(units) });

export type ChemistryCapabilityDefinition = {
  key: string;
  name: string;
  implementationKey: string;
  contract: Record<string, unknown>;
  evaluationFixture: {
    input: Record<string, unknown>;
    expected: Pick<CapabilityExecution, "expected" | "unit" | "status" | "failureCode" | "firstInvalidStep">;
  };
};

export type CapabilityExecution = {
  expected: number;
  unit: string;
  learnerAnswer: number;
  absoluteError: number;
  relativeError: number;
  status: "CORRECT" | "INCORRECT";
  failureCode: string | null;
  firstInvalidStep: string | null;
  summary: string;
  calculation: string;
};

function judged(expected: number, unitLabel: string, learnerAnswer: number, tolerance: number, calculation: string): CapabilityExecution {
  const absoluteError = Math.abs(learnerAnswer - expected);
  const scale = Math.max(Math.abs(expected), 1e-12);
  const relativeError = absoluteError / scale;
  const correct = relativeError <= tolerance;
  return {
    expected,
    unit: unitLabel,
    learnerAnswer,
    absoluteError,
    relativeError,
    status: correct ? "CORRECT" : "INCORRECT",
    failureCode: correct ? null : "NUMERIC_MISMATCH",
    firstInvalidStep: correct ? null : "FINAL_NUMERIC_COMPARISON",
    summary: correct ? "The deterministic calculation agrees with the learner answer within the declared tolerance." : "The learner answer does not agree with the deterministic calculation within the declared tolerance.",
    calculation,
  };
}

const MolarConcentration = Answer.extend({
  amount: ValueUnit(["mol", "mmol"]),
  volume: ValueUnit(["L", "mL", "cm3"]),
});

const Dilution = Answer.extend({
  initialConcentration: ValueUnit(["mol/L", "mmol/L"]),
  initialVolume: ValueUnit(["L", "mL", "cm3"]),
  finalVolume: ValueUnit(["L", "mL", "cm3"]),
});

const IdealGas = Answer.extend({
  pressure: ValueUnit(["Pa", "kPa", "bar", "atm"]),
  volume: ValueUnit(["m3", "L", "mL"]),
  temperature: ValueUnit(["K", "degC"]),
});

const HydrogenIonPh = Answer.extend({
  hydrogenIonConcentration: z.number().positive(),
});

export const CHEMISTRY_CAPABILITIES: ChemistryCapabilityDefinition[] = [
  {
    key: "chemistry-molar-concentration",
    name: "Molar concentration",
    implementationKey: "chemistry.molar-concentration.v1",
    contract: { input: "amount + volume + learnerAnswer", output: "mol/L with deterministic tolerance comparison" },
    evaluationFixture: {
      input: { amount: { value: 1, unit: "mol" }, volume: { value: 2, unit: "L" }, learnerAnswer: 0.5, tolerance: 0.001 },
      expected: { expected: 0.5, unit: "mol/L", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
  {
    key: "chemistry-solution-dilution",
    name: "Solution dilution",
    implementationKey: "chemistry.solution-dilution.v1",
    contract: { input: "initial concentration and volumes + learnerAnswer", output: "final mol/L with deterministic tolerance comparison" },
    evaluationFixture: {
      input: { initialConcentration: { value: 1, unit: "mol/L" }, initialVolume: { value: 100, unit: "mL" }, finalVolume: { value: 500, unit: "mL" }, learnerAnswer: 0.2, tolerance: 0.001 },
      expected: { expected: 0.2, unit: "mol/L", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
  {
    key: "chemistry-ideal-gas-moles",
    name: "Ideal-gas amount",
    implementationKey: "chemistry.ideal-gas-moles.v1",
    contract: { input: "pressure + volume + temperature + learnerAnswer", output: "amount in mol using n=PV/RT" },
    evaluationFixture: {
      input: { pressure: { value: 101.325, unit: "kPa" }, volume: { value: 24.465, unit: "L" }, temperature: { value: 298.15, unit: "K" }, learnerAnswer: 1, tolerance: 0.001 },
      expected: { expected: 0.9999834992692898, unit: "mol", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
  {
    key: "chemistry-ph-from-hydrogen-ion",
    name: "pH from hydrogen-ion concentration",
    implementationKey: "chemistry.ph-from-hydrogen-ion.v1",
    contract: { input: "positive [H+] + learnerAnswer", output: "pH using -log10([H+])" },
    evaluationFixture: {
      input: { hydrogenIonConcentration: 0.001, learnerAnswer: 3, tolerance: 0.001 },
      expected: { expected: 3, unit: "pH", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
];

export function executeChemistryCapability(implementationKey: string, rawInput: unknown): CapabilityExecution {
  if (implementationKey === "chemistry.molar-concentration.v1") {
    const input = MolarConcentration.parse(rawInput);
    const amount = unit(input.amount.value, input.amount.unit).toNumber("mol");
    const volume = unit(input.volume.value, input.volume.unit).toNumber("L");
    const expected = amount / volume;
    return judged(expected, "mol/L", input.learnerAnswer, input.tolerance, "c = n / V");
  }
  if (implementationKey === "chemistry.solution-dilution.v1") {
    const input = Dilution.parse(rawInput);
    const concentration = unit(input.initialConcentration.value, input.initialConcentration.unit).toNumber("mol/L");
    const initialVolume = unit(input.initialVolume.value, input.initialVolume.unit).toNumber("L");
    const finalVolume = unit(input.finalVolume.value, input.finalVolume.unit).toNumber("L");
    const expected = concentration * initialVolume / finalVolume;
    return judged(expected, "mol/L", input.learnerAnswer, input.tolerance, "c2 = c1 × V1 / V2");
  }
  if (implementationKey === "chemistry.ideal-gas-moles.v1") {
    const input = IdealGas.parse(rawInput);
    const pressure = unit(input.pressure.value, input.pressure.unit).toNumber("Pa");
    const volume = unit(input.volume.value, input.volume.unit).toNumber("m3");
    const temperature = unit(input.temperature.value, input.temperature.unit).toNumber("K");
    const expected = pressure * volume / (8.31446261815324 * temperature);
    return judged(expected, "mol", input.learnerAnswer, input.tolerance, "n = PV / RT");
  }
  if (implementationKey === "chemistry.ph-from-hydrogen-ion.v1") {
    const input = HydrogenIonPh.parse(rawInput);
    const expected = -log10(input.hydrogenIonConcentration);
    return judged(expected, "pH", input.learnerAnswer, input.tolerance, "pH = -log10([H+])");
  }
  throw new Error(`No Chemistry capability adapter is registered for ${implementationKey}`);
}
