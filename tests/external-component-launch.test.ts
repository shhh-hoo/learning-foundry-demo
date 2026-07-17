import { describe, expect, it } from "vitest";
import registryValue from "../config/external-learning-components/registry.json";
import { createExternalComponentLaunchRecord, createExternalComponentLaunchRepository, EXTERNAL_COMPONENT_LAUNCH_KEY } from "../src/external-components/launch-repository";
import { parseExternalComponentRegistry } from "../src/external-components/registry";

const registry = parseExternalComponentRegistry(registryValue);

describe("external component launch evidence", () => {
  it("records an explicit user launch without creating Outcome evidence", () => {
    const component = registry.components.find((item) => item.id === "chemcollective-stoichiometry-solution-preparation")!;
    const record = createExternalComponentLaunchRecord(component, {
      createId: () => "external-launch-test",
      now: () => new Date("2026-07-17T13:15:00.000Z"),
    });

    expect(record).toEqual({
      schemaVersion: "1.0.0",
      launchId: "external-launch-test",
      componentId: component.id,
      componentVersion: component.version,
      provider: "ChemCollective",
      integrationMode: "EXTERNAL_LINK",
      launchedAt: "2026-07-17T13:15:00.000Z",
      origin: "USER_ACTION",
      evidenceClass: "SHOWCASE_EXTERNAL_LAUNCH",
      outcomeEligible: false,
    });
  });

  it("appends launch records to the local showcase repository", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const repository = createExternalComponentLaunchRepository(storage);
    const component = registry.components[0]!;
    repository.append(createExternalComponentLaunchRecord(component, { createId: () => "launch-1", now: () => new Date("2026-07-17T13:16:00.000Z") }));
    repository.append(createExternalComponentLaunchRecord(component, { createId: () => "launch-2", now: () => new Date("2026-07-17T13:17:00.000Z") }));

    expect(repository.list().map((record) => record.launchId)).toEqual(["launch-1", "launch-2"]);
    expect(JSON.parse(values.get(EXTERNAL_COMPONENT_LAUNCH_KEY)!)).toHaveLength(2);
  });

  it("fails closed to an empty history when local JSON is malformed", () => {
    const storage = { getItem: () => "not-json", setItem: () => undefined };
    expect(createExternalComponentLaunchRepository(storage).list()).toEqual([]);
  });
});
