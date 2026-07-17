import type { ExternalComponentLaunchRecord, ExternalLearningComponent } from "./types";

export const EXTERNAL_COMPONENT_LAUNCH_KEY = "learning-foundry:external-component-launches:v1";

export interface ExternalComponentLaunchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createExternalComponentLaunchRecord(
  component: ExternalLearningComponent,
  options: { readonly now?: () => Date; readonly createId?: () => string } = {},
): ExternalComponentLaunchRecord {
  return {
    schemaVersion: "1.0.0",
    launchId: options.createId?.() ?? `external-launch-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`,
    componentId: component.id,
    componentVersion: component.version,
    provider: component.provider,
    integrationMode: component.integrationMode,
    launchedAt: (options.now?.() ?? new Date()).toISOString(),
    origin: "USER_ACTION",
    evidenceClass: "SHOWCASE_EXTERNAL_LAUNCH",
    outcomeEligible: false,
  };
}

export function createExternalComponentLaunchRepository(storage: ExternalComponentLaunchStorage) {
  return {
    list(): readonly ExternalComponentLaunchRecord[] {
      const value = storage.getItem(EXTERNAL_COMPONENT_LAUNCH_KEY);
      if (!value) return [];
      try {
        const records = JSON.parse(value) as unknown;
        return Array.isArray(records) ? records as readonly ExternalComponentLaunchRecord[] : [];
      } catch {
        return [];
      }
    },
    append(record: ExternalComponentLaunchRecord): void {
      const records = this.list();
      storage.setItem(EXTERNAL_COMPONENT_LAUNCH_KEY, JSON.stringify([...records, record]));
    },
  };
}
