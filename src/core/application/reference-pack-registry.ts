import type {
  ReferencePackManifest,
  ReferencePackRegistration,
} from "../domain/reference-pack";

function assertManifest(manifest: ReferencePackManifest): void {
  if (!manifest.id.trim() || !manifest.title.trim() || !/^\d+\.\d+\.\d+$/u.test(manifest.version)) {
    throw new Error("INVALID_REFERENCE_PACK_MANIFEST: Pack identity, title and semantic version are required.");
  }
  if (manifest.domains.length === 0 || manifest.ownership.length === 0) {
    throw new Error("INVALID_REFERENCE_PACK_MANIFEST: Domains and truthful ownership entries are required.");
  }
  const assetIds = new Set<string>();
  for (const asset of manifest.ownership) {
    if (assetIds.has(asset.id)) throw new Error(`DUPLICATE_REFERENCE_PACK_ASSET: ${asset.id}`);
    assetIds.add(asset.id);
    if (!asset.id.trim() || !asset.removalTarget.trim()) {
      throw new Error("INVALID_REFERENCE_PACK_ASSET: Identity and removal target are required.");
    }
    if (asset.status !== "NOT_EXTRACTED" && asset.legacyPaths.length === 0) {
      throw new Error(`INVALID_REFERENCE_PACK_ASSET: ${asset.id} must identify its current implementation.`);
    }
  }
}

export function createReferencePackRegistry(registrations: readonly ReferencePackRegistration[]) {
  const manifests = new Map<string, ReferencePackManifest>();
  const capabilities = new Map<string, ReferencePackRegistration["capabilities"]>();
  const components = new Map<string, ReferencePackRegistration["components"]>();
  const capabilityOwners = new Map<string, string>();
  const componentOwners = new Map<string, string>();
  for (const registration of registrations) {
    assertManifest(registration.manifest);
    if (manifests.has(registration.manifest.id)) {
      throw new Error(`DUPLICATE_REFERENCE_PACK: ${registration.manifest.id}`);
    }
    for (const capability of registration.capabilities) {
      const key = `${capability.profile.identity.id}@${capability.profile.identity.version}`;
      const owner = capabilityOwners.get(key);
      if (owner) throw new Error(`DUPLICATE_CAPABILITY_REGISTRATION: ${key} is owned by ${owner}.`);
      capabilityOwners.set(key, registration.manifest.id);
    }
    for (const component of registration.components) {
      const key = `${component.profile.identity.id}@${component.profile.identity.version}`;
      const owner = componentOwners.get(key);
      if (owner) throw new Error(`DUPLICATE_COMPONENT_REGISTRATION: ${key} is owned by ${owner}.`);
      componentOwners.set(key, registration.manifest.id);
    }
    manifests.set(registration.manifest.id, structuredClone(registration.manifest));
    capabilities.set(registration.manifest.id, structuredClone(registration.capabilities));
    components.set(registration.manifest.id, structuredClone(registration.components));
  }

  return {
    getManifest(packId: string): ReferencePackManifest | null {
      const manifest = manifests.get(packId);
      return manifest ? structuredClone(manifest) : null;
    },
    listManifests(): readonly ReferencePackManifest[] {
      return [...manifests.values()].map((manifest) => structuredClone(manifest));
    },
    listCapabilities(packId: string) {
      return structuredClone(capabilities.get(packId) ?? []);
    },
    listComponents(packId: string) {
      return structuredClone(components.get(packId) ?? []);
    },
  };
}
