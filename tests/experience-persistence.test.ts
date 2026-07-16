import { describe, expect, it } from "vitest";
import { createExperienceRepository } from "../src/experience/repository";

describe("real product-state persistence", () => {
  it("starts empty and round-trips confirmed records without importing old sessions", () => {
    const values = new Map<string, string>();
    const repository = createExperienceRepository({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) });
    const initial = repository.load();
    expect(initial.agentTraces).toEqual([]); expect(initial.diagnoses).toEqual([]); expect(initial.library).toEqual([]);
    repository.save({ ...initial, agentConfigured: true, gatewayModel: "configured-model", agentTraces: [{ traceId: "cache-only" } as never], diagnoses: [{ traceId: "cache-only" } as never] });
    expect(repository.load()).toMatchObject({ agentConfigured: true, gatewayModel: "configured-model" });
    expect(repository.load().agentTraces).toEqual([]); expect(repository.load().diagnoses).toEqual([]);
    repository.reset(); expect(repository.load().agentTraces).toEqual([]);
  });
});
