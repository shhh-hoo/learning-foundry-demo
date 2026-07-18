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
  "PROMOTED_ARTIFACT",
  "CURRICULUM_CONTINUITY",
]);

export const WorkflowKind = z.enum([
  "LEARNER_TASK",
  "EXPLANATION",
  "DIAGNOSIS",
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
  candidateItems: ContextItem[];
  selectedItems: ContextItem[];
  excludedItems: Array<ContextItem & { reason: string }>;
  tokenBudget: number;
  modalityBudget: Record<string, number>;
  selectedTokenCount: number;
  modalityUsage: Record<string, number>;
  tokenizer: "o200k_base";
  selectionPolicy: "LIFECYCLE_AND_BUDGET_ENFORCED";
  tokenBudgetStatus: "ENFORCED";
  modalityBudgetStatus: "ENFORCED";
  compilerVersion: string;
};

export type ContextItem = {
  id: string;
  taskId: string;
  episodeId?: string;
  kind: "EVENT" | "EVIDENCE" | "ATTEMPT" | "OBSERVATION" | "REVIEW" | "OUTCOME";
  content: string;
  modality?: "TEXT" | "TABLE" | "FIGURE" | "IMAGE";
  tokenCount?: number;
  stale?: boolean;
  superseded?: boolean;
  carryoverRelation?: z.infer<typeof ContextRelation>;
};
