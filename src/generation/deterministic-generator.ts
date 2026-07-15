import type { DiagnosticLearningComponent } from "../contracts/diagnostic-component";
import { massDraft } from "../components/stoichiometric-product-mass";

function clone<T>(value: T): T { return structuredClone(value); }

function generatedBase(id: string): DiagnosticLearningComponent {
  const component = clone(massDraft);
  return {
    ...component,
    id,
    status: "DRAFT",
    presentation: { ...component.presentation, title: id.includes("invalid") ? "Generated stoichiometry draft — ratio defect" : "Generated stoichiometry draft — valid" },
    provenance: { origin: "AI_GENERATED", generatorId: "deterministic-demo-generator", promptVersion: "stoichiometry-template-v1", generatedAt: "2026-07-15T08:30:00.000Z" },
    review: undefined,
    publication: undefined,
  };
}

export function generateValidStoichiometryDraft(): DiagnosticLearningComponent {
  return generatedBase("generated-stoichiometric-product-mass-valid");
}

export function generateInvalidStoichiometryDraft(): DiagnosticLearningComponent {
  const component = generatedBase("generated-stoichiometric-product-mass-invalid");
  return {
    ...component,
    authoredFacts: component.authoredFacts.map((fact) => fact.id === "coefficient-magnesium-oxide" ? { ...fact, value: 1 } : fact),
  };
}

