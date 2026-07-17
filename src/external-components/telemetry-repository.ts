import { externalLaunchTelemetryEventSchema } from "./schemas";
import type {
  ExternalLaunchTelemetryEvent,
  ExternalLaunchTelemetryRepository,
} from "./types";

export const EXTERNAL_LAUNCH_TELEMETRY_STORAGE_KEY = "learning-foundry.external-launch-telemetry.v1";

export class CorruptExternalLaunchTelemetryError extends Error {
  constructor(message: string) {
    super(`Corrupt launch telemetry: ${message}`);
    this.name = "CorruptExternalLaunchTelemetryError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameRequestIdentity(left: ExternalLaunchTelemetryEvent, right: ExternalLaunchTelemetryEvent): boolean {
  return left.requestId === right.requestId
    && left.componentId === right.componentId
    && left.componentVersion === right.componentVersion
    && left.providerResourceId === right.providerResourceId
    && left.deploymentScope === right.deploymentScope;
}

function validateHistory(events: readonly ExternalLaunchTelemetryEvent[]): void {
  const eventIds = new Set<string>();
  const byRequest = new Map<string, ExternalLaunchTelemetryEvent[]>();
  for (const event of events) {
    if (eventIds.has(event.eventId)) throw new CorruptExternalLaunchTelemetryError(`duplicate event id ${event.eventId}`);
    eventIds.add(event.eventId);
    const history = byRequest.get(event.requestId) ?? [];
    if (history.length > 0 && !sameRequestIdentity(history[0]!, event)) {
      throw new CorruptExternalLaunchTelemetryError(`request ${event.requestId} changes resource identity`);
    }
    if (event.type === "LAUNCH_REQUESTED") {
      if (history.length !== 0) throw new CorruptExternalLaunchTelemetryError(`request ${event.requestId} has more than one request event`);
    } else if (history.length !== 1 || history[0]?.type !== "LAUNCH_REQUESTED") {
      throw new CorruptExternalLaunchTelemetryError(`request ${event.requestId} has an invalid terminal event order`);
    }
    byRequest.set(event.requestId, [...history, event]);
  }
}

export class BrowserExternalLaunchTelemetryRepository implements ExternalLaunchTelemetryRepository {
  constructor(
    private readonly storage: Storage,
    private readonly storageKey = EXTERNAL_LAUNCH_TELEMETRY_STORAGE_KEY,
  ) {}

  async list(): Promise<readonly ExternalLaunchTelemetryEvent[]> {
    const stored = this.storage.getItem(this.storageKey);
    if (stored === null) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(stored);
    } catch {
      throw new CorruptExternalLaunchTelemetryError("history is not valid JSON");
    }
    const parsed = externalLaunchTelemetryEventSchema.array().safeParse(raw);
    if (!parsed.success) {
      throw new CorruptExternalLaunchTelemetryError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    }
    const events = parsed.data as ExternalLaunchTelemetryEvent[];
    validateHistory(events);
    return clone(events);
  }

  async append(value: ExternalLaunchTelemetryEvent): Promise<void> {
    const parsed = externalLaunchTelemetryEventSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Invalid external launch telemetry event: ${parsed.error.message}`);
    const event = parsed.data as ExternalLaunchTelemetryEvent;
    const current = await this.list();
    const next = [...current, event];
    validateHistory(next);
    this.storage.setItem(this.storageKey, JSON.stringify(next));
  }
}
