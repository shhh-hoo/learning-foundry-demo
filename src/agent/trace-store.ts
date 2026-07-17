import type {
  AgentObligations,
  AgentResponseEnvelope,
  AgentRoute,
  AgentRunRequest,
  InputOrigin,
  RunPurpose,
  TokenUsage,
} from "./types";

export type AgentRunStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface VersionedHash {
  readonly version: string;
  readonly contentHash: string;
}

export interface ObservableAgentToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface ObservableAgentMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly ObservableAgentToolCall[];
}

export interface AgentRunStart {
  readonly traceId: string;
  readonly request: AgentRunRequest;
  readonly initialRoute?: AgentRoute;
  readonly obligations?: AgentObligations;
  readonly provider: string;
  readonly model: string;
  readonly thinkingMode: "enabled" | "disabled";
  readonly prompt: VersionedHash;
  readonly capabilityRegistry: VersionedHash;
  readonly toolDefinitions: VersionedHash;
  readonly startedAt: string;
}

export interface PersistedToolExecution {
  readonly name: string;
  readonly arguments: unknown;
  readonly resultRef: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface PersistedAgentRun extends AgentRunStart {
  readonly schemaVersion: "1.0.0";
  readonly status: AgentRunStatus;
  readonly observableModelMessages: readonly ObservableAgentMessage[];
  readonly toolExecutions: readonly PersistedToolExecution[];
  readonly tokenUsage?: TokenUsage;
  readonly finalResponse?: AgentResponseEnvelope;
  readonly route?: AgentRoute;
  readonly completedAt?: string;
  readonly updatedAt: string;
  readonly terminalError?: { readonly code: string; readonly message: string };
}

export interface AgentRunQuery {
  readonly conversationId?: string;
  readonly status?: AgentRunStatus;
  readonly inputOrigin?: InputOrigin;
  readonly runPurpose?: RunPurpose;
  readonly startedFrom?: string;
  readonly startedTo?: string;
}

export interface AgentTraceStore {
  start(input: AgentRunStart): Promise<void>;
  get(traceId: string): Promise<PersistedAgentRun | null>;
  appendModelResponse(traceId: string, message: ObservableAgentMessage, usage?: TokenUsage): Promise<void>;
  appendToolExecution(traceId: string, execution: PersistedToolExecution): Promise<void>;
  complete(traceId: string, finalResponse: AgentResponseEnvelope, completedAt: string, route?: AgentRoute): Promise<void>;
  fail(traceId: string, terminalError: { readonly code: string; readonly message: string }, completedAt: string): Promise<void>;
  query(query?: AgentRunQuery): Promise<readonly PersistedAgentRun[]>;
  clear(): Promise<void>;
}
