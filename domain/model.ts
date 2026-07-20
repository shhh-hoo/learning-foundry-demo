import { z } from "zod";

export const Role = z.enum(["LEARNER", "TEACHER", "EXPERT", "ENGINEER", "ADMIN"]);
export type Role = z.infer<typeof Role>;

export const TaskStatus = z.enum(["OPEN", "CLOSED"]);
export const EvidenceModality = z.enum([
  "TEXT",
  "TABLE",
  "FIGURE",
  "DIAGRAM",
  "QUESTION",
  "MARK_SCHEME",
  "RUBRIC",
  "EXAMPLE",
  "STUDENT_WORK",
  "AUDIO",
  "VIDEO_SEGMENT",
  "INTERACTIVE_RESOURCE",
]);
export const ActivityType = z.literal("RETRY");
export const StudyReviewActivityType = z.literal("STUDY_REVIEW");
export const ReviewDecision = z.enum(["ACCEPT", "CORRECT", "SUPPLEMENT", "ESCALATE"]);
export const PublicationAction = z.enum(["APPROVE", "REJECT", "ROLLBACK"]);

export const SourceReference = z.object({
  sourceId: z.string().uuid(),
  sourceVersion: z.string().min(1),
  locator: z.string().min(1),
});

export const InternalEvidenceReference = z.object({
  evidenceUnitId: z.string().uuid(),
  kind: z.enum(["RETRIEVAL", "ATTEMPT", "DIAGNOSIS", "REVIEW", "OUTCOME"]),
});

export const ContextRelation = z.enum([
  "EXPLICIT_REFERENCE",
  "LINKED_RETRY",
  "LINKED_TRANSFER",
  "LINKED_RETENTION",
  "PROMOTED_ARTIFACT",
  "TEACHER_ASSIGNMENT",
  "CURRICULUM_CONTINUITY",
]);

export const WorkflowKind = z.enum([
  "LEARNER_TASK",
  "EXPLANATION",
  "DIAGNOSIS",
  "ASSET_RUNTIME",
  "TEACHER_REVIEW",
  "RETRY_OUTCOME",
  "COMPONENT_LIFECYCLE",
]);

export const ActorSchema = z.object({
  userId: z.string().uuid(),
  institutionId: z.string().uuid(),
  roles: z.array(Role),
  courseIds: z.array(z.string().uuid()),
  authMethod: z.string().min(1),
  sessionId: z.string().min(1),
});

export type Actor = z.infer<typeof ActorSchema>;

export type Citation = z.infer<typeof SourceReference> & {
  evidenceUnitId: string;
  label: string;
};

export type CompiledContext = {
  id: string;
  activeTaskId: string;
  activeEpisodeId: string;
  consumer: ContextConsumer;
  candidateItems: ContextItem[];
  selectedItems: Array<ContextItem & { inclusionReason: ContextInclusionReason }>;
  excludedItems: Array<ContextItem & { reason: ContextExclusionReason; truncated: boolean }>;
  tokenBudget: number;
  modalityBudget: Record<string, number>;
  selectedTokenCount: number;
  modalityUsage: Record<string, number>;
  provenanceRefs: ContextProvenanceReference[];
  referencedPriorTaskIds: string[];
  inputHash: string;
  snapshotHash: string;
  tokenizer: "o200k_base";
  selectionPolicy: "AUTHORIZED_LIFECYCLE_CARRYOVER_AND_BUDGET_ENFORCED";
  contextPolicyVersion: string;
  tokenBudgetStatus: "ENFORCED";
  modalityBudgetStatus: "ENFORCED";
  compilerVersion: string;
};

export type ContextConsumer = "EVIDENCE_RETRIEVAL" | "DIAGNOSIS" | "CAPABILITY_RESOLUTION" | "RUNTIME_ORCHESTRATION";

export type ContextInclusionReason =
  | "ACTIVE_TASK_SCOPE"
  | "ACTIVE_EPISODE_SCOPE"
  | "CURRENT_LEARNER_PROFILE"
  | "CURRENT_LEARNER_STRATEGY"
  | "EXPLICIT_CARRYOVER"
  | "LEGACY_COMPATIBILITY";

export type ContextExclusionReason =
  | "WRONG_SCOPE"
  | "WRONG_EPISODE"
  | "STALE_TASK_ITEM"
  | "SUPERSEDED_FACT"
  | "INVALIDATED_ITEM"
  | "NOT_YET_EFFECTIVE"
  | "EXPIRED_ITEM"
  | "UNRELATED_PRIOR_TASK_ENTITY"
  | "UNJUSTIFIED_ENTITY_CARRYOVER"
  | "CONFLICTED_BY_NEW_EVIDENCE"
  | "SOURCE_INACTIVE"
  | "SOURCE_RIGHTS_UNAVAILABLE"
  | "OUTSIDE_MODALITY_BUDGET"
  | "OUTSIDE_TOKEN_BUDGET";

export type ContextProvenanceReference = {
  type:
    | "LEARNING_TASK"
    | "LEARNING_EPISODE"
    | "LEARNER_PROFILE"
    | "LEARNER_STRATEGY_VERSION"
    | "CONTEXT_ITEM"
    | "CONTEXT_CARRYOVER_RELATION"
    | "CONVERSATION_EVENT"
    | "LEARNER_ATTEMPT"
    | "SOURCE_RECORD"
    | "SOURCE_ASSET_VERSION"
    | "EVIDENCE_UNIT"
    | "EVIDENCE_DERIVATIVE"
    | "ACTOR";
  id: string;
  version?: string;
  contentHash?: string;
};

export type ContextItem = {
  id: string;
  taskId: string;
  episodeId?: string;
  institutionId?: string;
  courseId?: string;
  learnerProfileId?: string;
  kind: string;
  scope?: "PROFILE" | "WORKSPACE" | "TASK" | "EPISODE";
  state?: "ACTIVE" | "STALE" | "SUPERSEDED" | "PROMOTED" | "INVALIDATED";
  content: string;
  payload?: Record<string, unknown>;
  modality?: string;
  tokenCount?: number;
  required?: boolean;
  priority?: number;
  validFrom?: string;
  validUntil?: string;
  provenanceRefs?: ContextProvenanceReference[];
  inclusionReason?: ContextInclusionReason;
  exclusionReason?: ContextExclusionReason;
  stale?: boolean;
  superseded?: boolean;
  carryoverRelation?: z.infer<typeof ContextRelation>;
  carryover?: {
    relationId: string;
    relationType: z.infer<typeof ContextRelation>;
    sourceTaskId: string;
    targetTaskId: string;
    actorUserId?: string;
    policyKey?: string;
    policyVersion?: string;
    reason: string;
  };
};
