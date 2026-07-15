import { describe, expect, it } from "vitest";
import { createInitialExperienceState, diagnoseStoichiometryConversation, setScheduleItemStatus } from "../src/experience/orchestration";
import { createExperienceRepository } from "../src/experience/repository";

describe("experience session persistence", () => {
  it("restores evidence and a completed retry, while reset returns the initial session", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    };
    const repository = createExperienceRepository(storage);
    const diagnosed = diagnoseStoichiometryConversation(createInitialExperienceState(), "2026-07-15T09:00:00.000Z");
    const completed = setScheduleItemStatus(diagnosed, "retry-stoichiometry-001", "COMPLETED");

    repository.save(completed);
    expect(repository.load()).toMatchObject({
      evidence: [{ failureCode: "WRONG_STOICHIOMETRIC_RATIO" }],
      schedule: [{ status: "COMPLETED" }],
    });

    repository.reset();
    expect(repository.load()).toEqual(createInitialExperienceState());
  });
});
