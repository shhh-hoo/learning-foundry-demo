import { createInitialExperienceState } from "./orchestration";
import type { ExperienceState, FoundryCandidateHandoff } from "./types";

export const SESSION_KEY = "learning-foundry:experience:v4-persisted-evidence";
export const HANDOFF_KEY = "learning-foundry:foundry-handoff:v4-persisted-evidence";

export interface ExperienceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export function createExperienceRepository(storage: ExperienceStorage) {
  return {
    load(): ExperienceState {
      const value = storage.getItem(SESSION_KEY);
      if (!value) return createInitialExperienceState();
      try {
        return JSON.parse(value) as ExperienceState;
      } catch {
        return createInitialExperienceState();
      }
    },
    save(state: ExperienceState): void {
      storage.setItem(SESSION_KEY, JSON.stringify({ ...state, agentTraces: [], diagnoses: [] }));
    },
    reset(): void {
      storage.removeItem(SESSION_KEY);
      storage.removeItem(HANDOFF_KEY);
    },
    loadHandoff(): FoundryCandidateHandoff | null {
      const value = storage.getItem(HANDOFF_KEY);
      if (!value) return null;
      try {
        return JSON.parse(value) as FoundryCandidateHandoff;
      } catch {
        return null;
      }
    },
    saveHandoff(handoff: FoundryCandidateHandoff): void {
      storage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
    },
    clearHandoff(): void {
      storage.removeItem(HANDOFF_KEY);
    },
  };
}
