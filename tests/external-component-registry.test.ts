import { describe, expect, it } from "vitest";
import registryValue from "../config/external-learning-components/registry.json";
import { canLaunchExternalComponent, externalLearningComponentSchema, parseExternalComponentRegistry } from "../src/external-components/registry";

const registry = parseExternalComponentRegistry(registryValue);

describe("external learning component registry", () => {
  it("loads a versioned, identity-unique registry", () => {
    expect(registry.registryVersion).toBe("1.0.0");
    expect(registry.deploymentScope).toBe("NON_COMMERCIAL_PUBLIC_SHOWCASE");
    expect(new Set(registry.components.map((component) => `${component.id}@${component.version}`)).size).toBe(registry.components.length);
  });

  it("launches only the reviewed non-commercial link-only resources", () => {
    const launchable = registry.components.filter(canLaunchExternalComponent);
    expect(launchable.map((component) => component.id)).toEqual([
      "chemcollective-stoichiometry-solution-preparation",
      "chemcollective-naoh-khp-standardization",
      "chemcollective-stoichiometric-coefficients",
    ]);
    expect(launchable.every((component) => component.status === "APPROVED_LINK_ONLY" && component.integrationMode === "EXTERNAL_LINK")).toBe(true);
  });

  it("keeps PhET, Desmos, GeoGebra and unreviewed H5P content unavailable", () => {
    const restricted = registry.components.filter((component) => ["PhET Interactive Simulations", "Desmos Studio", "GeoGebra", "H5P"].includes(component.provider));
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted.every((component) => !canLaunchExternalComponent(component))).toBe(true);
  });

  it("never treats a catalog component as Learning Outcome evidence", () => {
    expect(registry.components.every((component) => component.evidence.outcomeEligible === false)).toBe(true);
  });

  it("rejects non-HTTPS launch URLs", () => {
    const source = registry.components[0]!;
    expect(() => externalLearningComponentSchema.parse({ ...source, launch: { url: "javascript:alert(1)" } })).toThrow("External component URL must use HTTPS");
  });

  it("requires privacy approval before a component receives an approved launch status", () => {
    const source = registry.components[0]!;
    expect(() => externalLearningComponentSchema.parse({ ...source, privacy: { ...source.privacy, approvalStatus: "REVIEW_REQUIRED" } })).toThrow("Approved launch status requires approved privacy handling");
  });

  it("prevents launch-only components from claiming an Outcome", () => {
    const source = registry.components[0]!;
    expect(() => externalLearningComponentSchema.parse({ ...source, evidence: { ...source.evidence, outcomeEligible: true } })).toThrow();
  });
});
