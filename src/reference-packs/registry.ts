import type { PublishedDiagnosticLearningComponent } from "../contracts/diagnostic-component";
import { parsePublishedComponent } from "../contracts/published-component";
import { createReferencePackRegistry } from "../core/application/reference-pack-registry";
import {
  chemistryCaie9701CapabilityRegistryVersion,
  chemistryCaie9701ReferencePack,
} from "./chemistry-caie-9701";
import type { LegacyAgentCapabilityRecord } from "./chemistry-caie-9701/adapters/legacy-capability-adapter";

const packId = chemistryCaie9701ReferencePack.manifest.id;

export const referencePackRegistry = createReferencePackRegistry([
  chemistryCaie9701ReferencePack,
]);

export const registeredPublishedDiagnosticComponents: readonly PublishedDiagnosticLearningComponent[] =
  referencePackRegistry.listComponents(packId).map(({ implementation }) => parsePublishedComponent(implementation));

export const registeredAgentCapabilities: {
  readonly version: string;
  readonly capabilities: readonly LegacyAgentCapabilityRecord[];
} = {
  version: chemistryCaie9701CapabilityRegistryVersion,
  capabilities: referencePackRegistry.listCapabilities(packId).map(({ implementation }) =>
    implementation as LegacyAgentCapabilityRecord,
  ),
};

