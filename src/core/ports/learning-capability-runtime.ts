export type CapabilityRunPurpose = "PRODUCT" | "AGENT_EVAL";

export interface LearningCapabilityExecution {
  readonly capabilityId: string;
  readonly capabilityVersion?: string;
  readonly input: Record<string, unknown>;
  readonly runPurpose: CapabilityRunPurpose;
}

export interface LearningCapabilityExecutionResult {
  readonly traceId: string;
  readonly result: Record<string, unknown>;
}

export interface LearningCapabilityRuntime {
  execute(execution: LearningCapabilityExecution): Promise<LearningCapabilityExecutionResult>;
}

