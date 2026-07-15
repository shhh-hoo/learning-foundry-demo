export interface StandardPack {
  readonly id: string;
  readonly title: string;
  readonly sourceMetadata: readonly { readonly id: string; readonly label: string; readonly scope: string }[];
  readonly topics: readonly {
    readonly id: string;
    readonly title: string;
    readonly learningObjectives: readonly string[];
    readonly requiredConcepts: readonly string[];
    readonly permittedEquations: readonly string[];
    readonly unitConventions: readonly string[];
    readonly significantFigureConventions: readonly string[];
    readonly markSchemePrinciples: readonly string[];
    readonly reasoningStageExpectations: readonly string[];
    readonly forbiddenAmbiguity: readonly string[];
    readonly approvedComponentPatterns: readonly string[];
    readonly disallowedShortcuts: readonly string[];
  }[];
}

export const caie9701StandardPack: StandardPack = {
  id: "CAIE-9701-CALCULATIONS-v1",
  title: "CAIE 9701 Chemistry Calculation Standard Pack",
  sourceMetadata: [
    { id: "CAIE-9701-SYLLABUS-CONCEPTS", label: "CAIE 9701 syllabus-level concepts", scope: "Concept and objective metadata only; no past-paper text." },
    { id: "LF-AUTHORED-PATTERNS-v1", label: "Learning Foundry authored calculation patterns", scope: "Original prompts and operational constraints." },
  ],
  topics: [
    {
      id: "9701-STOICHIOMETRY",
      title: "Stoichiometry",
      learningObjectives: ["Use relative masses, amount of substance and balanced equations to calculate product mass."],
      requiredConcepts: ["mass-to-moles", "balanced-equation ratio", "moles-to-mass"],
      permittedEquations: ["n = m / M", "n(product) = n(reactant) × coefficient(product) / coefficient(reactant)", "m = nM"],
      unitConventions: ["Mass answers use g unless the prompt explicitly specifies another unit."],
      significantFigureConventions: ["The final answer follows the precision stated in the authored prompt."],
      markSchemePrinciples: ["Credit amount calculation, mole-ratio use, and final mass with unit."],
      reasoningStageExpectations: ["Extract mass and molar masses", "Convert to amount", "Use the balanced ratio", "Convert to product mass", "Report unit and precision"],
      forbiddenAmbiguity: ["Limiting reagent must be explicit", "Relative masses and equation coefficients must be supplied or unambiguous"],
      approvedComponentPatterns: ["Single limiting reagent with another reagent explicitly in excess"],
      disallowedShortcuts: ["Using a mass ratio without an authored derivation path", "Omitting the balanced-equation ratio stage"],
    },
    {
      id: "9701-EQUILIBRIA",
      title: "Equilibria",
      learningObjectives: ["Calculate Kp from equilibrium amounts and total pressure."],
      requiredConcepts: ["total amount", "mole fraction", "partial pressure", "Kp expression"],
      permittedEquations: ["xᵢ = nᵢ / Σn", "pᵢ = xᵢPtotal", "Kp from gaseous partial pressures"],
      unitConventions: ["Pressure units must be consistent through the calculation."],
      significantFigureConventions: ["The final answer follows the precision stated in the authored prompt."],
      markSchemePrinciples: ["Credit partial-pressure route, correct powers, substitution, unit and precision."],
      reasoningStageExpectations: ["Select equilibrium amounts", "Calculate total amount", "Calculate partial pressures", "Construct Kp", "Report unit and precision"],
      forbiddenAmbiguity: ["Physical state and equilibrium composition must be explicit"],
      approvedComponentPatterns: ["Equilibrium amounts plus total pressure for one defined gas reaction"],
      disallowedShortcuts: ["Using concentration in a Kp expression", "Using initial rather than equilibrium amounts"],
    },
  ],
};

