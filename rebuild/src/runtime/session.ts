export type RuntimeSessionState =
  | "LOADING"
  | "READY"
  | "INITIALIZING"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED";

export type RuntimeSessionSignal =
  | "COMPONENT_READY"
  | "INIT_SENT"
  | "COMPONENT_INITIALIZED"
  | "PAUSE"
  | "RESUME"
  | "RESET"
  | "COMPLETE"
  | "ERROR";

const transitions: Readonly<Record<RuntimeSessionState, Partial<Record<RuntimeSessionSignal, RuntimeSessionState>>>> = {
  LOADING: { COMPONENT_READY: "READY", ERROR: "FAILED" },
  READY: { INIT_SENT: "INITIALIZING", ERROR: "FAILED" },
  INITIALIZING: { COMPONENT_INITIALIZED: "RUNNING", ERROR: "FAILED" },
  RUNNING: { PAUSE: "PAUSED", RESET: "INITIALIZING", COMPLETE: "COMPLETED", ERROR: "FAILED" },
  PAUSED: { RESUME: "RUNNING", RESET: "INITIALIZING", ERROR: "FAILED" },
  COMPLETED: {},
  FAILED: {},
};

export function transitionRuntimeSession(state: RuntimeSessionState, signal: RuntimeSessionSignal): RuntimeSessionState {
  const next = transitions[state][signal];
  if (!next) throw new Error(`Invalid runtime transition: ${state} -> ${signal}`);
  return next;
}
