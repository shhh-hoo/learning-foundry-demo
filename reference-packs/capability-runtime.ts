import { executeChemistryCapability } from "@/reference-packs/chemistry/capabilities";

export function executeReferencePackCapability(implementationKey: string, input: unknown) {
  if (implementationKey.startsWith("chemistry.")) return executeChemistryCapability(implementationKey, input);
  throw new Error(`No Reference Pack capability adapter is registered for ${implementationKey}`);
}
