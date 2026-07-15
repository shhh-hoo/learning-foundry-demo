export const demoEventTypes = [
  "LEARNER_ATTEMPT_SUBMITTED",
  "CAPABILITY_SELECTED",
  "LEARNER_DIAGNOSIS_COMPLETED",
  "EVIDENCE_PERSISTED",
  "RETRY_SCHEDULED",
  "PATTERN_THRESHOLD_REACHED",
  "CANDIDATE_CREATED",
  "CANDIDATE_EVALUATED",
  "COMPONENT_APPROVED",
  "COMPONENT_PUBLISHED",
  "REGISTRY_COMPONENT_ACCEPTED",
  "RUNTIME_COMPONENT_SELECTED",
  "RUNTIME_DIAGNOSIS_COMPLETED",
] as const;

export type DemoEventType = (typeof demoEventTypes)[number];
export type DemoActor =
  | "LEARNER"
  | "TEACHER"
  | "SUBJECT_EXPERT"
  | "FOUNDRY"
  | "TRAINER";

export interface DemoEventBase<T extends DemoEventType = DemoEventType> {
  readonly protocolVersion: "1.0.0";
  readonly eventId: string;
  readonly sessionId: string;
  readonly type: T;
  readonly occurredAt: string;
  readonly actor: DemoActor;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type DemoEvent = DemoEventBase;

interface EventIdentity {
  readonly eventId?: string;
  readonly sessionId?: string;
  readonly occurredAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createDemoEvent<T extends DemoEventType>(
  type: T,
  actor: DemoActor,
  payload: Readonly<Record<string, unknown>> = {},
  identity: EventIdentity = {},
): DemoEventBase<T> {
  return {
    protocolVersion: "1.0.0",
    eventId:
      identity.eventId ??
      `event-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    sessionId: identity.sessionId ?? "learning-foundry-local-demo",
    type,
    occurredAt: identity.occurredAt ?? new Date().toISOString(),
    actor,
    payload,
  };
}

export function isDemoEvent(value: unknown): value is DemoEvent {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  return (
    value.protocolVersion === "1.0.0" &&
    typeof value.eventId === "string" &&
    value.eventId.length > 0 &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    typeof value.type === "string" &&
    (demoEventTypes as readonly string[]).includes(value.type) &&
    typeof value.occurredAt === "string" &&
    Number.isFinite(Date.parse(value.occurredAt)) &&
    typeof value.actor === "string" &&
    (["LEARNER", "TEACHER", "SUBJECT_EXPERT", "FOUNDRY", "TRAINER"] as readonly string[]).includes(value.actor)
  );
}

export function acceptDemoMessage(
  data: unknown,
  origin: string,
  expectedOrigin: string,
  sourceMatches: boolean,
): DemoEvent | null {
  if (!sourceMatches || origin !== expectedOrigin || !isRecord(data)) return null;
  if (data.source !== "learning-foundry-product" || !isDemoEvent(data.event)) return null;
  return data.event;
}

export function dispatchProductEvent(event: DemoEvent): void {
  window.dispatchEvent(
    new CustomEvent<DemoEvent>("learning-foundry-demo-event", { detail: event }),
  );
  const params = new URLSearchParams(window.location.search);
  if (params.get("embedded") !== "1" || window.parent === window) return;
  const allowedParentOrigin = window.location.origin;
  window.parent.postMessage(
    { source: "learning-foundry-product", event },
    allowedParentOrigin,
  );
}
