import { buildChemistryLearnerInput, CHEMISTRY_CAPABILITIES, executeChemistryCapability, type LearnerCapabilityDescriptor } from "@/reference-packs/chemistry/capabilities";
import { assertExecutionActive, type ExecutionControl } from "@/application/execution-control";
import { syntheticCredentialsAllowed } from "@/application/auth-contract";
import {
  executeHashBoundWebComponentAsset,
  WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
  WEB_COMPONENT_ASSET_RUNTIME_KIND,
} from "@/domain/web-component-asset";

export type AssetRuntimeAdapter = {
  implementationKey: string;
  runtimeKind: "TRUSTED_DETERMINISTIC_ADAPTER" | "TRUSTED_WEB_COMPONENT";
  replaySafe: true;
  execute(input: unknown, control?: ExecutionControl, exactVersionContract?: Record<string, unknown>): Promise<Record<string, unknown>>;
};

async function waitForSyntheticRuntimeBoundary(control?: ExecutionControl): Promise<void> {
  if (!syntheticCredentialsAllowed()) return;
  const delayMs = Number(process.env.SYNTHETIC_ASSET_RUNTIME_DELAY_MS ?? 0);
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5_000) {
    throw new Error("SYNTHETIC_ASSET_RUNTIME_DELAY_MS must be an integer from 0 to 5000");
  }
  if (delayMs === 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    const stopped = () => { clearTimeout(timer); resolve(); };
    if (control?.signal.aborted) stopped();
    else control?.signal.addEventListener("abort", stopped, { once: true });
  });
  assertExecutionActive(control);
}

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

ASSET_RUNTIME_ADAPTERS.set(WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY, {
  implementationKey: WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
  runtimeKind: WEB_COMPONENT_ASSET_RUNTIME_KIND,
  replaySafe: true,
  async execute(input: unknown, control?: ExecutionControl, exactVersionContract?: Record<string, unknown>) {
    assertExecutionActive(control);
    await waitForSyntheticRuntimeBoundary(control);
    const componentAsset = exactVersionContract?.componentAsset;
    if (!componentAsset || typeof componentAsset !== "object" || Array.isArray(componentAsset)) {
      throw new Error("Registered Web ComponentAsset contract is missing its exact immutable package");
    }
    const asset = componentAsset as Record<string, unknown>;
    if (typeof asset.versionId !== "string" || typeof asset.contentHash !== "string" || !asset.contract || !asset.package) {
      throw new Error("Registered Web ComponentAsset contract is missing its exact hash-bound runtime fields");
    }
    const execution = executeHashBoundWebComponentAsset({
      componentVersionId: asset.versionId,
      contentHash: asset.contentHash,
      contract: asset.contract,
      componentPackage: asset.package,
      learnerInput: input,
      previewOnly: false,
    });
    assertExecutionActive(control);
    return execution.runtimeOutput;
  },
});

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
