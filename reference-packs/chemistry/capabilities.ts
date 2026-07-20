import { log10, unit } from "mathjs";
import { z } from "zod";

const Answer = z.object({ learnerAnswer: z.number(), tolerance: z.number().positive().max(0.1).default(0.01) });
const ValueUnit = (units: [string, ...string[]]) => z.object({ value: z.number(), unit: z.enum(units) });

export type ChemistryCapabilityDefinition = {
  key: string;
  name: string;
  learner: LearnerCapabilityDescriptor;
  implementationKey: string;
  contract: Record<string, unknown>;
  evaluationFixture: {
    input: Record<string, unknown>;
    expected: Pick<CapabilityExecution, "expected" | "unit" | "status" | "failureCode" | "firstInvalidStep">;
  };
};

export type LearnerCapabilityField = {
  key: string;
  label: string;
  kind: "number" | "quantity";
  help: string;
  min?: number;
  step?: number;
  unitOptions?: string[];
  defaultUnit?: string;
};

export type LearnerCapabilityDescriptor = {
  publicKey: string;
  name: string;
  purpose: string;
  fields: LearnerCapabilityField[];
  example: string;
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

const PositiveValueUnit = (units: [string, ...string[]]) => z.object({ value: z.number().finite().positive(), unit: z.enum(units) });
const NonNegativeValueUnit = (units: [string, ...string[]]) => z.object({ value: z.number().finite().nonnegative(), unit: z.enum(units) });
const PositiveNumber = z.number().finite().positive();

const MassToAmount = Answer.extend({
  mass: PositiveValueUnit(["g", "kg", "mg"]),
  molarMass: PositiveValueUnit(["g/mol", "kg/mol"]),
});

const TitrationConcentration = Answer.extend({
  standardConcentration: PositiveValueUnit(["mol/L", "mmol/L"]),
  standardVolume: PositiveValueUnit(["L", "mL", "cm3"]),
  unknownVolume: PositiveValueUnit(["L", "mL", "cm3"]),
  standardCoefficient: PositiveNumber,
  unknownCoefficient: PositiveNumber,
});

const LimitingReagent = Answer.extend({
  reactantAAmount: NonNegativeValueUnit(["mol", "mmol"]),
  reactantBAmount: NonNegativeValueUnit(["mol", "mmol"]),
  reactantACoefficient: PositiveNumber,
  reactantBCoefficient: PositiveNumber,
  productCoefficient: PositiveNumber,
});

const PercentageYield = Answer.extend({
  actualYield: NonNegativeValueUnit(["g", "kg", "mg"]),
  theoreticalYield: PositiveValueUnit(["g", "kg", "mg"]),
});

const CellPotential = Answer.extend({
  cathodePotential: ValueUnit(["V", "mV"]),
  anodePotential: ValueUnit(["V", "mV"]),
});

const WeakAcidKa = Answer.extend({
  initialConcentration: PositiveValueUnit(["mol/L", "mmol/L"]),
  measuredPh: z.number().finite(),
}).superRefine((input, context) => {
  const concentration = unit(input.initialConcentration.value, input.initialConcentration.unit).toNumber("mol/L");
  const hydrogenIon = 10 ** (-input.measuredPh);
  if (!Number.isFinite(hydrogenIon) || hydrogenIon <= 0 || hydrogenIon >= concentration) {
    context.addIssue({ code: "custom", path: ["measuredPh"], message: "Measured pH must produce 0 < [H+] < the initial acid concentration" });
  }
});

const CAPABILITY_INPUT_SCHEMAS: Record<string, z.ZodType> = {
  "chemistry.molar-concentration.v1": MolarConcentration,
  "chemistry.solution-dilution.v1": Dilution,
  "chemistry.ideal-gas-moles.v1": IdealGas,
  "chemistry.ph-from-hydrogen-ion.v1": HydrogenIonPh,
  "chemistry.amount-from-mass.v1": MassToAmount,
  "chemistry.titration-concentration.v1": TitrationConcentration,
  "chemistry.limiting-reagent-product.v1": LimitingReagent,
  "chemistry.percentage-yield.v1": PercentageYield,
  "chemistry.cell-potential.v1": CellPotential,
  "chemistry.weak-acid-ka.v1": WeakAcidKa,
};

const amountField: LearnerCapabilityField = { key: "amount", label: "Amount of substance", kind: "quantity", help: "Enter the amount given in the problem.", min: 0, step: 0.001, unitOptions: ["mol", "mmol"], defaultUnit: "mol" };
const volumeField: LearnerCapabilityField = { key: "volume", label: "Solution volume", kind: "quantity", help: "Enter the volume used for the concentration.", min: 0, step: 0.001, unitOptions: ["L", "mL", "cm3"], defaultUnit: "mL" };
const learnerAnswerField: LearnerCapabilityField = { key: "learnerAnswer", label: "Your final numerical answer", kind: "number", help: "Enter the number from your working; include units in the working above.", step: 0.0001 };

const BASE_CHEMISTRY_CAPABILITIES: ChemistryCapabilityDefinition[] = [
  {
    key: "chemistry-molar-concentration",
    name: "Molar concentration",
    learner: {
      publicKey: "chemistry-molar-concentration",
      name: "Molar concentration",
      purpose: "Check concentration from amount of substance and solution volume.",
      fields: [amountField, volumeField, learnerAnswerField],
      example: "For 0.25 mol in 500 mL, enter 0.25 mol, 500 mL and your final answer.",
    },
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
    learner: {
      publicKey: "chemistry-solution-dilution",
      name: "Solution dilution",
      purpose: "Check the final concentration after a solution is diluted.",
      fields: [
        { key: "initialConcentration", label: "Initial concentration", kind: "quantity", help: "Enter the concentration before dilution.", min: 0, step: 0.001, unitOptions: ["mol/L", "mmol/L"], defaultUnit: "mol/L" },
        { key: "initialVolume", label: "Initial volume", kind: "quantity", help: "Enter the volume taken before dilution.", min: 0, step: 0.001, unitOptions: ["L", "mL", "cm3"], defaultUnit: "mL" },
        { key: "finalVolume", label: "Final total volume", kind: "quantity", help: "Enter the total volume after dilution.", min: 0, step: 0.001, unitOptions: ["L", "mL", "cm3"], defaultUnit: "mL" },
        learnerAnswerField,
      ],
      example: "For 100 mL of 1.0 mol/L diluted to 500 mL, enter those three quantities and your answer.",
    },
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
    learner: {
      publicKey: "chemistry-ideal-gas-moles",
      name: "Ideal-gas amount",
      purpose: "Check amount of gas from pressure, volume and temperature using the ideal-gas equation.",
      fields: [
        { key: "pressure", label: "Gas pressure", kind: "quantity", help: "Enter the pressure stated in the problem.", min: 0, step: 0.001, unitOptions: ["Pa", "kPa", "bar", "atm"], defaultUnit: "kPa" },
        { key: "volume", label: "Gas volume", kind: "quantity", help: "Enter the gas volume.", min: 0, step: 0.001, unitOptions: ["m3", "L", "mL"], defaultUnit: "L" },
        { key: "temperature", label: "Gas temperature", kind: "quantity", help: "Enter the temperature and select the unit used in the problem.", step: 0.01, unitOptions: ["K", "degC"], defaultUnit: "K" },
        learnerAnswerField,
      ],
      example: "For 101.325 kPa, 24.465 L and 298.15 K, enter each value and your amount in mol.",
    },
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
    learner: {
      publicKey: "chemistry-ph-from-hydrogen-ion",
      name: "pH from hydrogen-ion concentration",
      purpose: "Check pH from a positive hydrogen-ion concentration.",
      fields: [
        { key: "hydrogenIonConcentration", label: "Hydrogen-ion concentration (mol/L)", kind: "number", help: "Enter the positive concentration in mol/L.", min: 0, step: 0.000001 },
        learnerAnswerField,
      ],
      example: "For [H+] = 0.001 mol/L, enter 0.001 and your calculated pH.",
    },
    implementationKey: "chemistry.ph-from-hydrogen-ion.v1",
    contract: { input: "positive [H+] + learnerAnswer", output: "pH using -log10([H+])" },
    evaluationFixture: {
      input: { hydrogenIonConcentration: 0.001, learnerAnswer: 3, tolerance: 0.001 },
      expected: { expected: 3, unit: "pH", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
  {
    key: "chemistry-amount-from-mass",
    name: "Amount from mass and molar mass",
    learner: {
      publicKey: "chemistry-amount-from-mass",
      name: "Amount from mass and molar mass",
      purpose: "Check amount of substance from a sample mass and its molar mass.",
      fields: [
        { key: "mass", label: "Sample mass", kind: "quantity", help: "Enter the mass stated in the problem.", min: 0.000001, step: 0.001, unitOptions: ["g", "kg", "mg"], defaultUnit: "g" },
        { key: "molarMass", label: "Molar mass", kind: "quantity", help: "Enter the molar mass for the substance.", min: 0.000001, step: 0.001, unitOptions: ["g/mol", "kg/mol"], defaultUnit: "g/mol" },
        learnerAnswerField,
      ],
      example: "For 9.8 g of a substance with molar mass 98 g/mol, enter those values and your amount in mol.",
    },
    implementationKey: "chemistry.amount-from-mass.v1",
    contract: { input: "positive mass + positive molar mass + learnerAnswer", output: "amount in mol using n = m / M" },
    evaluationFixture: {
      input: { mass: { value: 9.8, unit: "g" }, molarMass: { value: 98, unit: "g/mol" }, learnerAnswer: 0.1, tolerance: 0.001 },
      expected: { expected: 0.1, unit: "mol", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
  {
    key: "chemistry-titration-concentration",
    name: "Titration unknown concentration",
    learner: {
      publicKey: "chemistry-titration-concentration",
      name: "Titration unknown concentration",
      purpose: "Check an unknown concentration from standard solution data and balanced-equation coefficients.",
      fields: [
        { key: "standardConcentration", label: "Standard concentration", kind: "quantity", help: "Enter the known concentration.", min: 0.000001, step: 0.001, unitOptions: ["mol/L", "mmol/L"], defaultUnit: "mol/L" },
        { key: "standardVolume", label: "Standard solution volume", kind: "quantity", help: "Enter the reacting volume of the standard solution.", min: 0.000001, step: 0.001, unitOptions: ["L", "mL", "cm3"], defaultUnit: "mL" },
        { key: "unknownVolume", label: "Unknown solution volume", kind: "quantity", help: "Enter the volume of the unknown solution.", min: 0.000001, step: 0.001, unitOptions: ["L", "mL", "cm3"], defaultUnit: "mL" },
        { key: "standardCoefficient", label: "Standard species coefficient", kind: "number", help: "Enter its positive coefficient from the balanced equation.", min: 0.000001, step: 1 },
        { key: "unknownCoefficient", label: "Unknown species coefficient", kind: "number", help: "Enter its positive coefficient from the balanced equation.", min: 0.000001, step: 1 },
        learnerAnswerField,
      ],
      example: "For 25.0 mL of 0.100 mol/L standard reacting 1:2 with 20.0 mL unknown, enter coefficients 1 and 2.",
    },
    implementationKey: "chemistry.titration-concentration.v1",
    contract: { input: "standard concentration and volume + unknown volume + positive equation coefficients + learnerAnswer", output: "unknown concentration in mol/L" },
    evaluationFixture: {
      input: { standardConcentration: { value: 0.1, unit: "mol/L" }, standardVolume: { value: 25, unit: "mL" }, unknownVolume: { value: 20, unit: "mL" }, standardCoefficient: 1, unknownCoefficient: 2, learnerAnswer: 0.25, tolerance: 0.001 },
      expected: { expected: 0.25, unit: "mol/L", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
  {
    key: "chemistry-limiting-reagent-product",
    name: "Limiting reagent and product amount",
    learner: {
      publicKey: "chemistry-limiting-reagent-product",
      name: "Limiting reagent and product amount",
      purpose: "Check the maximum product amount from two reactant amounts and their stoichiometric coefficients.",
      fields: [
        { key: "reactantAAmount", label: "Reactant A amount", kind: "quantity", help: "Enter the available amount of reactant A.", min: 0, step: 0.001, unitOptions: ["mol", "mmol"], defaultUnit: "mol" },
        { key: "reactantBAmount", label: "Reactant B amount", kind: "quantity", help: "Enter the available amount of reactant B.", min: 0, step: 0.001, unitOptions: ["mol", "mmol"], defaultUnit: "mol" },
        { key: "reactantACoefficient", label: "Reactant A coefficient", kind: "number", help: "Enter the positive coefficient from the balanced equation.", min: 0.000001, step: 1 },
        { key: "reactantBCoefficient", label: "Reactant B coefficient", kind: "number", help: "Enter the positive coefficient from the balanced equation.", min: 0.000001, step: 1 },
        { key: "productCoefficient", label: "Product coefficient", kind: "number", help: "Enter the positive product coefficient from the balanced equation.", min: 0.000001, step: 1 },
        learnerAnswerField,
      ],
      example: "For 0.40 mol A and 0.15 mol B in 2A + B → 2P, enter coefficients 2, 1 and 2.",
    },
    implementationKey: "chemistry.limiting-reagent-product.v1",
    contract: { input: "two non-negative reactant amounts + positive reactant/product coefficients + learnerAnswer", output: "maximum product amount in mol" },
    evaluationFixture: {
      input: { reactantAAmount: { value: 0.4, unit: "mol" }, reactantBAmount: { value: 0.15, unit: "mol" }, reactantACoefficient: 2, reactantBCoefficient: 1, productCoefficient: 2, learnerAnswer: 0.3, tolerance: 0.001 },
      expected: { expected: 0.3, unit: "mol", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
  {
    key: "chemistry-percentage-yield",
    name: "Percentage yield",
    learner: {
      publicKey: "chemistry-percentage-yield",
      name: "Percentage yield",
      purpose: "Check the reported percentage from actual and theoretical product masses; values above 100% remain valid measurements for Teacher Review.",
      fields: [
        { key: "actualYield", label: "Actual yield", kind: "quantity", help: "Enter the product mass actually obtained.", min: 0, step: 0.001, unitOptions: ["g", "kg", "mg"], defaultUnit: "g" },
        { key: "theoreticalYield", label: "Theoretical yield", kind: "quantity", help: "Enter the positive maximum product mass predicted.", min: 0.000001, step: 0.001, unitOptions: ["g", "kg", "mg"], defaultUnit: "g" },
        learnerAnswerField,
      ],
      example: "For 8.0 g actual product from a theoretical 10.0 g, enter both masses and your percentage.",
    },
    implementationKey: "chemistry.percentage-yield.v1",
    contract: { input: "non-negative actual yield + positive theoretical yield + learnerAnswer", output: "reported percentage using actual / theoretical × 100; experimental interpretation remains human-reviewed" },
    evaluationFixture: {
      input: { actualYield: { value: 8, unit: "g" }, theoreticalYield: { value: 10, unit: "g" }, learnerAnswer: 80, tolerance: 0.001 },
      expected: { expected: 80, unit: "%", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
  {
    key: "chemistry-cell-potential",
    name: "Electrochemical cell potential",
    learner: {
      publicKey: "chemistry-cell-potential",
      name: "Electrochemical cell potential",
      purpose: "Check cell potential from cathode and anode reduction potentials.",
      fields: [
        { key: "cathodePotential", label: "Cathode reduction potential", kind: "quantity", help: "Enter the signed cathode reduction potential.", step: 0.001, unitOptions: ["V", "mV"], defaultUnit: "V" },
        { key: "anodePotential", label: "Anode reduction potential", kind: "quantity", help: "Enter the signed anode reduction potential.", step: 0.001, unitOptions: ["V", "mV"], defaultUnit: "V" },
        learnerAnswerField,
      ],
      example: "For Ecathode = +0.34 V and Eanode = −0.76 V, enter the signed values and your Ecell.",
    },
    implementationKey: "chemistry.cell-potential.v1",
    contract: { input: "finite signed cathode and anode reduction potentials + learnerAnswer", output: "Ecell in V using Ecathode − Eanode" },
    evaluationFixture: {
      input: { cathodePotential: { value: 0.34, unit: "V" }, anodePotential: { value: -0.76, unit: "V" }, learnerAnswer: 1.1, tolerance: 0.001 },
      expected: { expected: 1.1, unit: "V", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
  {
    key: "chemistry-weak-acid-ka",
    name: "Weak-acid Ka from pH",
    learner: {
      publicKey: "chemistry-weak-acid-ka",
      name: "Weak-acid Ka from pH",
      purpose: "Check Ka for a monoprotic weak acid, taking x = [H+] from measured pH and neglecting water autoionization.",
      fields: [
        { key: "initialConcentration", label: "Initial acid concentration", kind: "quantity", help: "Enter the positive analytical concentration before dissociation.", min: 0.000001, step: 0.0001, unitOptions: ["mol/L", "mmol/L"], defaultUnit: "mol/L" },
        { key: "measuredPh", label: "Measured pH", kind: "number", help: "Enter the measured pH used to calculate [H+].", step: 0.001 },
        learnerAnswerField,
      ],
      example: "For a 0.100 mol/L monoprotic weak acid with pH 3.00, use x = [H+] and neglect water autoionization.",
    },
    implementationKey: "chemistry.weak-acid-ka.v1",
    contract: { assumptions: "monoprotic weak acid; water autoionization neglected; x equals [H+] from measured pH", input: "positive initial concentration + finite pH producing 0 < x < c + learnerAnswer", output: "Ka using x = 10^-pH and Ka = x² / (c − x)" },
    evaluationFixture: {
      input: { initialConcentration: { value: 0.1, unit: "mol/L" }, measuredPh: 3, learnerAnswer: 0.0000101010101010101, tolerance: 0.001 },
      expected: { expected: 0.0000101010101010101, unit: "mol/L", status: "CORRECT", failureCode: null, firstInvalidStep: null },
    },
  },
];

/**
 * These are genuine deterministic callable capabilities. The Registry metadata
 * describes their selection and runtime boundary; it does not turn reference
 * text or teaching-support templates into Component Assets.
 */
export const CHEMISTRY_CAPABILITIES: ChemistryCapabilityDefinition[] = BASE_CHEMISTRY_CAPABILITIES.map((definition) => ({
  ...definition,
  contract: {
    ...definition.contract,
    resolution: {
      contractType: "CALLABLE_LEARNING_CAPABILITY",
      verified: true,
      learningProblem: definition.learner.purpose,
      exactMatchSignals: [definition.key, definition.name, definition.learner.purpose, definition.implementationKey],
      eligibility: {
        learnerLevels: ["*"],
        taskTypes: ["*"],
        curricula: ["*"],
        languages: ["en", "zh", "mixed"],
        accessibility: ["keyboard", "screen-reader", "text"],
        prerequisites: [],
        contraindications: [],
      },
      availability: {
        status: "AVAILABLE",
        institutionIds: [],
        courseIds: [],
        rights: "NOT_REQUIRED",
        dependencies: [{ key: "mathjs", status: "AVAILABLE" }],
        provider: null,
      },
      parameterization: {
        supported: false,
        signals: [],
        recommendation: {},
      },
      composition: {
        supported: false,
        contributes: [],
      },
      adaptation: {
        reviewed: true,
        signals: [definition.key, definition.name, definition.learner.purpose],
      },
      runtime: {
        kind: "TRUSTED_DETERMINISTIC_ADAPTER",
        input: definition.contract.input,
        parameters: definition.learner.fields.map((field) => ({ key: field.key, kind: field.kind })),
        state: { mode: "STATELESS" },
        output: definition.contract.output,
        events: ["ATTEMPT_SUBMITTED", "CAPABILITY_RESULT"],
      },
    },
  },
}));

function assignField(target: Record<string, unknown>, field: LearnerCapabilityField, rawFields: Record<string, string>): void {
  const rawValue = rawFields[field.key]?.trim();
  if (!rawValue) throw new Error(`Missing ${field.key}`);
  const value = z.coerce.number().finite().parse(rawValue);
  if (field.min !== undefined && value < field.min) throw new Error(`Invalid ${field.key}`);
  if (field.kind === "number") {
    target[field.key] = value;
    return;
  }
  const unitValue = rawFields[`${field.key}Unit`];
  if (!field.unitOptions?.includes(unitValue)) throw new Error(`Invalid ${field.key} unit`);
  target[field.key] = {
    value,
    unit: unitValue,
  };
}

export function buildChemistryLearnerInput(publicKey: string, rawFields: Record<string, string>): Record<string, unknown> {
  const definition = CHEMISTRY_CAPABILITIES.find((item) => item.learner.publicKey === publicKey);
  if (!definition) throw new Error("Unknown Chemistry learner capability");
  const allowed = new Set(definition.learner.fields.flatMap((field) => field.kind === "quantity" ? [field.key, `${field.key}Unit`] : [field.key]));
  if (Object.keys(rawFields).some((key) => !allowed.has(key)) || [...allowed].some((key) => !(key in rawFields))) {
    throw new Error("Learner capability fields do not match the selected activity");
  }
  const input: Record<string, unknown> = { tolerance: 0.01 };
  for (const field of definition.learner.fields) assignField(input, field, rawFields);
  const schema = CAPABILITY_INPUT_SCHEMAS[definition.implementationKey];
  if (!schema) throw new Error("Chemistry learner capability has no input adapter");
  return schema.parse(input) as Record<string, unknown>;
}

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
  if (implementationKey === "chemistry.amount-from-mass.v1") {
    const input = MassToAmount.parse(rawInput);
    const mass = unit(input.mass.value, input.mass.unit).toNumber("g");
    const molarMass = unit(input.molarMass.value, input.molarMass.unit).toNumber("g/mol");
    return judged(mass / molarMass, "mol", input.learnerAnswer, input.tolerance, "n = m / M");
  }
  if (implementationKey === "chemistry.titration-concentration.v1") {
    const input = TitrationConcentration.parse(rawInput);
    const standardConcentration = unit(input.standardConcentration.value, input.standardConcentration.unit).toNumber("mol/L");
    const standardVolume = unit(input.standardVolume.value, input.standardVolume.unit).toNumber("L");
    const unknownVolume = unit(input.unknownVolume.value, input.unknownVolume.unit).toNumber("L");
    const expected = standardConcentration * standardVolume * input.unknownCoefficient / (input.standardCoefficient * unknownVolume);
    return judged(expected, "mol/L", input.learnerAnswer, input.tolerance, "cunknown = cstandard × Vstandard × νunknown / (νstandard × Vunknown)");
  }
  if (implementationKey === "chemistry.limiting-reagent-product.v1") {
    const input = LimitingReagent.parse(rawInput);
    const reactantA = unit(input.reactantAAmount.value, input.reactantAAmount.unit).toNumber("mol");
    const reactantB = unit(input.reactantBAmount.value, input.reactantBAmount.unit).toNumber("mol");
    const expected = Math.min(reactantA / input.reactantACoefficient, reactantB / input.reactantBCoefficient) * input.productCoefficient;
    return judged(expected, "mol", input.learnerAnswer, input.tolerance, "nproduct = min(nA / νA, nB / νB) × νproduct");
  }
  if (implementationKey === "chemistry.percentage-yield.v1") {
    const input = PercentageYield.parse(rawInput);
    const actual = unit(input.actualYield.value, input.actualYield.unit).toNumber("g");
    const theoretical = unit(input.theoreticalYield.value, input.theoreticalYield.unit).toNumber("g");
    return judged(actual / theoretical * 100, "%", input.learnerAnswer, input.tolerance, "percentage yield = actual / theoretical × 100");
  }
  if (implementationKey === "chemistry.cell-potential.v1") {
    const input = CellPotential.parse(rawInput);
    const cathode = unit(input.cathodePotential.value, input.cathodePotential.unit).toNumber("V");
    const anode = unit(input.anodePotential.value, input.anodePotential.unit).toNumber("V");
    return judged(cathode - anode, "V", input.learnerAnswer, input.tolerance, "Ecell = Ecathode − Eanode");
  }
  if (implementationKey === "chemistry.weak-acid-ka.v1") {
    const input = WeakAcidKa.parse(rawInput);
    const concentration = unit(input.initialConcentration.value, input.initialConcentration.unit).toNumber("mol/L");
    const hydrogenIon = 10 ** (-input.measuredPh);
    const expected = hydrogenIon ** 2 / (concentration - hydrogenIon);
    return judged(expected, "mol/L", input.learnerAnswer, input.tolerance, "x = 10^-pH; Ka = x² / (c − x)");
  }
  throw new Error(`No Chemistry capability adapter is registered for ${implementationKey}`);
}
