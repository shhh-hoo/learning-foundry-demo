import { buildChemistryLearnerInput, CHEMISTRY_CAPABILITIES, executeChemistryCapability, type LearnerCapabilityDescriptor } from "@/reference-packs/chemistry/capabilities";
import { assertExecutionActive, type ExecutionControl } from "@/application/execution-control";

export type AssetRuntimeAdapter = {
  implementationKey: string;
  runtimeKind: "TRUSTED_DETERMINISTIC_ADAPTER";
  replaySafe: true;
  execute(input: unknown, control?: ExecutionControl): Promise<Record<string, unknown>>;
};

const ASSET_RUNTIME_ADAPTERS = new Map<string, AssetRuntimeAdapter>(CHEMISTRY_CAPABILITIES.map((capability) => [
  capability.implementationKey,
  {
    implementationKey: capability.implementationKey,
    runtimeKind: "TRUSTED_DETERMINISTIC_ADAPTER" as const,
    replaySafe: true as const,
    async execute(input: unknown, control?: ExecutionControl) {
      assertExecutionActive(control);
      const output = executeChemistryCapability(capability.implementationKey, input);
      assertExecutionActive(control);
      return output as unknown as Record<string, unknown>;
    },
  },
]));

export function getAssetRuntimeAdapter(implementationKey: string, runtimeKind: string): AssetRuntimeAdapter | null {
  const adapter = ASSET_RUNTIME_ADAPTERS.get(implementationKey);
  if (!adapter || adapter.runtimeKind !== runtimeKind || !adapter.replaySafe) return null;
  return adapter;
}

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
