import { buildChemistryLearnerInput, CHEMISTRY_CAPABILITIES, executeChemistryCapability, type LearnerCapabilityDescriptor } from "@/reference-packs/chemistry/capabilities";

export function executeReferencePackCapability(implementationKey: string, input: unknown) {
  if (implementationKey.startsWith("chemistry.")) return executeChemistryCapability(implementationKey, input);
  throw new Error(`No Reference Pack capability adapter is registered for ${implementationKey}`);
}

export function getLearnerCapabilityDescriptor(referencePackKey: string, capabilityKey: string, versionStatus: string): LearnerCapabilityDescriptor | null {
  if (versionStatus !== "ACTIVE" || referencePackKey !== "chemistry-caie-9701") return null;
  return CHEMISTRY_CAPABILITIES.find((item) => item.key === capabilityKey)?.learner ?? null;
}

export function buildLearnerCapabilityInput(referencePackKey: string, publicKey: string, rawFields: Record<string, string>): Record<string, unknown> {
  if (referencePackKey === "chemistry-caie-9701") return buildChemistryLearnerInput(publicKey, rawFields);
  throw new Error("No learner input adapter is registered for this Reference Pack");
}
