import { describe, expect, it } from "vitest";
import { buildChemistryLearnerInput, CHEMISTRY_CAPABILITIES, executeChemistryCapability } from "@/reference-packs/chemistry/capabilities";
import { getLearnerCapabilityDescriptor } from "@/reference-packs/capability-runtime";
import { learnerCapabilityDescriptorsForCourse } from "@/application/capabilities";

describe("learner-safe Chemistry capability input", () => {
  it("publishes only learner-facing metadata for every existing Capability", () => {
    expect(CHEMISTRY_CAPABILITIES).toHaveLength(10);
    for (const capability of CHEMISTRY_CAPABILITIES) {
      expect(capability.learner).toMatchObject({
        publicKey: capability.key,
        name: capability.name,
      });
      expect(capability.learner.purpose.length).toBeGreaterThan(10);
      expect(capability.learner.example.length).toBeGreaterThan(10);
      expect(capability.learner.fields.length).toBeGreaterThan(1);
      expect(capability.learner.fields.every((field) => field.label && field.help)).toBe(true);
    }
    const weakAcid = CHEMISTRY_CAPABILITIES.find((capability) => capability.key === "chemistry-weak-acid-ka");
    expect(weakAcid?.learner.purpose).toContain("monoprotic weak acid");
    expect(weakAcid?.learner.purpose).toContain("neglecting water autoionization");
    expect(weakAcid?.contract.assumptions).toContain("x equals [H+]");
  });

  it("builds typed Pack input and preserves deterministic execution", () => {
    const input = buildChemistryLearnerInput("chemistry-molar-concentration", {
      amount: "250",
      amountUnit: "mmol",
      volume: "500",
      volumeUnit: "mL",
      learnerAnswer: "0.5",
    });
    expect(input).toEqual({
      amount: { value: 250, unit: "mmol" },
      volume: { value: 500, unit: "mL" },
      learnerAnswer: 0.5,
      tolerance: 0.01,
    });
    expect(executeChemistryCapability("chemistry.molar-concentration.v1", input)).toMatchObject({ status: "CORRECT", expected: 0.5 });
  });

  it("builds every active fixture through its learner-safe field adapter", () => {
    for (const capability of CHEMISTRY_CAPABILITIES) {
      const rawFields = Object.fromEntries(capability.learner.fields.flatMap((field) => {
        const fixtureValue = capability.evaluationFixture.input[field.key];
        if (field.kind === "quantity") {
          const quantity = fixtureValue as { value: number; unit: string };
          return [[field.key, String(quantity.value)], [`${field.key}Unit`, quantity.unit]];
        }
        return [[field.key, String(fixtureValue)]];
      }));
      const input = buildChemistryLearnerInput(capability.learner.publicKey, rawFields);
      expect(executeChemistryCapability(capability.implementationKey, input).status, capability.key).toBe("CORRECT");
    }
  });

  it("does not expose an inactive persisted Capability version as a learner activity", () => {
    expect(getLearnerCapabilityDescriptor("chemistry-caie-9701", "chemistry-molar-concentration", "INACTIVE")).toBeNull();
    expect(getLearnerCapabilityDescriptor("chemistry-caie-9701", "chemistry-molar-concentration", "ACTIVE")).toMatchObject({
      publicKey: "chemistry-molar-concentration",
      name: "Molar concentration",
    });
  });

  it("scopes selectable activities to the active Task course in a multi-course catalog", () => {
    const chemistryCourse = "40000000-0000-4000-8000-000000000001";
    const secondCourse = "40000000-0000-4000-8000-000000000002";
    const bindings = [
      { courseId: chemistryCourse, capabilityKey: "chemistry-molar-concentration", referencePackKey: "chemistry-caie-9701", versionStatus: "ACTIVE" },
      { courseId: secondCourse, capabilityKey: "chemistry-ph-from-hydrogen-ion", referencePackKey: "chemistry-caie-9701", versionStatus: "ACTIVE" },
      { courseId: chemistryCourse, capabilityKey: "chemistry-solution-dilution", referencePackKey: "chemistry-caie-9701", versionStatus: "INACTIVE" },
    ];

    expect(learnerCapabilityDescriptorsForCourse(bindings, chemistryCourse).map((item) => item.publicKey)).toEqual(["chemistry-molar-concentration"]);
    expect(learnerCapabilityDescriptorsForCourse(bindings, secondCourse).map((item) => item.publicKey)).toEqual(["chemistry-ph-from-hydrogen-ion"]);
  });

  it("fails closed for unknown activities, missing fields, invalid units and injected fields", () => {
    const valid = { amount: "1", amountUnit: "mol", volume: "2", volumeUnit: "L", learnerAnswer: "0.5" };
    expect(() => buildChemistryLearnerInput("unknown-capability", valid)).toThrow(/Unknown/);
    expect(() => buildChemistryLearnerInput("chemistry-molar-concentration", { ...valid, volume: "" })).toThrow();
    expect(() => buildChemistryLearnerInput("chemistry-molar-concentration", { ...valid, volumeUnit: "g" })).toThrow();
    expect(() => buildChemistryLearnerInput("chemistry-molar-concentration", { ...valid, implementationKey: "chemistry.ph-from-hydrogen-ion.v1" })).toThrow(/do not match/);
  });
});
