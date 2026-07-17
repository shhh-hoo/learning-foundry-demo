import { describe, expect, it } from "vitest";
import { chemistryCaie9701ReferencePack } from "../src/reference-packs/chemistry-caie-9701";
import { createReferencePackRegistry } from "../src/core/application/reference-pack-registry";
import { publishedComponents } from "../src/components/published";
import {
  referencePackRegistry,
  registeredAgentCapabilities,
  registeredPublishedDiagnosticComponents,
} from "../src/reference-packs/registry";
import capabilityRegistrySnapshot from "../config/capabilities/registry.json";
import type { ReferencePackRegistration } from "../src/core/domain/reference-pack";

describe("Reference Pack registration", () => {
  it("registers the truthful Chemistry Pack manifest without claiming physical extraction", () => {
    const registry = createReferencePackRegistry([chemistryCaie9701ReferencePack]);

    expect(registry.getManifest("chemistry-caie-9701")).toMatchObject({
      id: "chemistry-caie-9701",
      version: "1.0.0",
      registrationStatus: "REGISTERED",
    });
    expect(new Set(registry.getManifest("chemistry-caie-9701")?.ownership.map((item) => item.status))).toEqual(
      new Set(["CURRENT_LEGACY", "REGISTERED", "NOT_EXTRACTED"]),
    );
  });

  it("exposes current Component and Capability implementations through the registered Pack", () => {
    const registry = createReferencePackRegistry([chemistryCaie9701ReferencePack]);

    expect(registry.listComponents("chemistry-caie-9701").map(({ profile }) => profile.identity)).toEqual([
      { id: "kp-from-equilibrium-moles", version: "1.0.0" },
      { id: "stoichiometric-product-mass", version: "1.0.0" },
    ]);
    expect(registry.listComponents("chemistry-caie-9701").map(({ profile }) => profile.contentHash)).toEqual([
      "lfh1-a007587f",
      "lfh1-65c2876d",
    ]);
    expect(registry.listComponents("chemistry-caie-9701").map(({ implementation }) => implementation)).toEqual(
      publishedComponents,
    );
    expect(registry.listCapabilities("chemistry-caie-9701").map(({ profile }) => profile.identity)).toEqual([
      { id: "stoichiometric-product-mass", version: "1.0.0" },
      { id: "kp-from-equilibrium-moles", version: "1.0.0" },
    ]);
  });

  it("drives the current export and capability entrypoints from the registered Pack", () => {
    expect(referencePackRegistry.listManifests().map((manifest) => manifest.id)).toEqual(["chemistry-caie-9701"]);
    expect(registeredPublishedDiagnosticComponents).toEqual(publishedComponents);
    expect(JSON.stringify(registeredPublishedDiagnosticComponents)).toBe(JSON.stringify(publishedComponents));
    expect(registeredAgentCapabilities).toEqual(capabilityRegistrySnapshot);
    expect(registeredAgentCapabilities).toMatchObject({
      version: "1.0.0",
      capabilities: [
        { id: "stoichiometric-product-mass", visibility: "AGENT" },
        { id: "kp-from-equilibrium-moles", visibility: "ENGINEERING_ONLY" },
      ],
    });
  });

  it("fails closed when two Packs claim the same Capability or Component version", () => {
    const anotherManifest = {
      ...chemistryCaie9701ReferencePack.manifest,
      id: "another-reference-pack",
      title: "Another Reference Pack",
    } as const;
    const capabilityConflict: ReferencePackRegistration = {
      manifest: anotherManifest,
      capabilities: chemistryCaie9701ReferencePack.capabilities,
      components: [],
    };
    const componentConflict: ReferencePackRegistration = {
      manifest: anotherManifest,
      capabilities: [],
      components: chemistryCaie9701ReferencePack.components,
    };

    expect(() => createReferencePackRegistry([chemistryCaie9701ReferencePack, capabilityConflict]))
      .toThrow("DUPLICATE_CAPABILITY_REGISTRATION");
    expect(() => createReferencePackRegistry([chemistryCaie9701ReferencePack, componentConflict]))
      .toThrow("DUPLICATE_COMPONENT_REGISTRATION");
  });
});
