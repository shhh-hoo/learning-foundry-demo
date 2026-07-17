import { z } from "zod";
import type {
  ContextSelectionDecision,
  EvidenceSufficiencyAssessment,
  GovernedWorkflowTrace,
  ToolBudgetConsumption,
} from "./control-plane/observability";
import type { ExecutionPlanV1 } from "./control-plane/execution-plan";
export type {
  ContextSelectionDecision,
  EvidenceRequirement,
  ExecutionDirective,
  ExecutionIntent,
  ExecutionMode,
  ExecutionPlanV1,
  GovernedWorkflowIdentity,
  TerminalCondition,
  ToolId,
} from "./control-plane/execution-plan";

export const inputOriginSchema = z.enum(["USER_INPUT", "PRESET_INPUT"]);
export type InputOrigin = z.infer<typeof inputOriginSchema>;
export const runPurposeSchema = z.enum(["PRODUCT", "AGENT_EVAL"]);
export type RunPurpose = z.infer<typeof runPurposeSchema>;
export const agentRouteSchema = z.enum(["COURSE_EXPLANATION", "SOLVE_WITH_CHECKS", "LEARNER_DIAGNOSIS_COMPLETE", "LEARNER_DIAGNOSIS_INCOMPLETE", "CAPABILITY_GAP"]);
export type AgentRoute = z.infer<typeof agentRouteSchema>;

export interface AgentObligations {
  readonly retrievalRequired: boolean;
  readonly capabilityInspectionRequired: boolean;
  readonly diagnosisRequired: boolean;
}

export type AgentExecutionPlan = ExecutionPlanV1;

export const agentResponseEnvelopeSchema = z.object({
  status: z.enum(["ANSWERED", "NEEDS_MORE_EVIDENCE", "CAPABILITY_GAP"]),
  learnerMessage: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  diagnosisTraceId: z.string().min(1).optional(),
  proposedLibraryArtifact: z.object({ title: z.string().min(1), content: z.string().min(1) }).optional(),
  proposedFollowUp: z.object({ title: z.string().min(1), reason: z.string().min(1), delayDays: z.number().int().min(1).max(30) }).optional(),
  capabilityGapId: z.string().min(1).optional(),
});
export type AgentResponseEnvelope = z.input<typeof agentResponseEnvelopeSchema>;

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly promptCacheHitTokens?: number;
  readonly promptCacheMissTokens?: number;
}

export interface AgentToolCallRecord {
  readonly name: string;
  readonly arguments: unknown;
  readonly resultRef: string;
  readonly status: "SUCCEEDED" | "FAILED";
}

export interface AgentTrace {
  readonly traceId: string;
  readonly conversationId: string;
  readonly inputOrigin: InputOrigin;
  readonly runPurpose: RunPurpose;
  readonly initialRoute?: AgentRoute;
  readonly route?: AgentRoute;
  readonly obligations?: AgentObligations;
  readonly executionPlan?: ExecutionPlanV1;
  readonly contextSelection?: ContextSelectionDecision;
  readonly budgetConsumption?: readonly ToolBudgetConsumption[];
  readonly evidenceAssessments?: readonly EvidenceSufficiencyAssessment[];
  readonly stopReason?: string;
  readonly governedWorkflow?: GovernedWorkflowTrace;
  readonly provider: string;
  readonly model: string;
  readonly thinkingMode: "enabled" | "disabled";
  readonly promptVersion: string;
  readonly capabilityRegistryVersion: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly toolCalls: readonly AgentToolCallRecord[];
  readonly finalResponse: AgentResponseEnvelope;
  readonly tokenUsage?: TokenUsage;
  readonly latencyMs: number;
}

export interface AgentConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly context?: {
    readonly taskId?: string;
    readonly episodeId?: string;
    readonly lifecycle?: "ACTIVE" | "STALE" | "SUPERSEDED";
  };
}

export interface AgentRunRequest {
  readonly conversationId: string;
  readonly inputOrigin: InputOrigin;
  readonly runPurpose: RunPurpose;
  readonly evalCaseId?: string;
  readonly activeTaskId?: string;
  readonly activeEpisodeId?: string;
  readonly messages: readonly AgentConversationMessage[];
}
