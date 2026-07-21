import { performance } from "node:perf_hooks";
import { createHash, randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "@/domain/model";
import { GovernedFollowupAttempt, GovernedFollowupReview, GovernedFollowupStart } from "@/domain/governed-followup";
import { commandRequestHash, decidePublication, type PublicationDependencies } from "@/application/commands";
import {
  createGovernedFollowup,
  executeGovernedFollowup,
  requireCurrentTeacherCourseAuthority,
  reviewGovernedFollowupResult,
  resolveGovernedFollowupAuthority,
  type GovernedFollowupPlanningDependencies,
} from "@/application/governed-followup";
import { DomainInvariantError, requireCourseAccess, requireRole } from "@/domain/invariants";
import { getDb, getSql, withTenantDatabase } from "@/db/client";
import { activityPlanProposals, activityPlans, capabilities, capabilityAvailabilityDecisions, capabilityResolutions, capabilityVersions, componentAssetPreviews, componentEvaluations, componentVersions, components, diagnosticObservations, learnerAttempts, publicationDecisions, runtimeDeliveries, workflowRuns } from "@/db/schema";
import { runComponentEvaluation } from "@/application/component-evaluation";
import { getWorkflowCheckpointer } from "@/workflows/checkpointer";
import { buildLearnerTaskGraph } from "@/workflows/learner-task";
import { buildExplanationGraph } from "@/workflows/explanation";
import { buildDiagnosisGraph } from "@/workflows/diagnosis";
import { buildAssetRuntimeGraph } from "@/workflows/asset-runtime";
import { buildTeacherReviewGraph } from "@/workflows/teacher-review";
import { buildGovernedFollowupGraph } from "@/workflows/governed-followup";
import { buildComponentLifecycleGraph, ExpertPublicationResume } from "@/workflows/component-lifecycle";
import { ComponentHumanRubric, humanRubricPasses } from "@/domain/component";
import { stableAssetRuntimeJson, type NormalizedRuntimeError } from "@/domain/asset-runtime";
import { reconcileStoppedAssetStage, type AssetRuntimeDependencies } from "@/application/asset-runtime";
import { traced } from "@/application/telemetry";
import { requireGovernedFollowupScope, requireTaskEpisodeScope } from "@/application/task-scope";
import {
  assertExecutionActive,
  executionStopStatus,
  operationalFailureStatus,
  runWithExecutionControl,
  type ExecutionControlInput,
} from "@/application/execution-control";
import { claimWorkflowResume, finalizeWorkflowResumeClaim } from "@/application/workflow-resume-lease";
import type { LearnerTaskFaultHooks } from "@/workflows/learner-task";

type WorkflowKind = "LEARNER_TASK" | "EXPLANATION" | "DIAGNOSIS" | "ASSET_RUNTIME" | "TEACHER_REVIEW" | "GOVERNED_FOLLOWUP" | "COMPONENT_LIFECYCLE";

type GraphConfig = { configurable: { thread_id: string }; recursionLimit: number; signal?: AbortSignal };
type GraphStateSnapshot = {
  values: Record<string, unknown>;
  next: string[];
  tasks: Array<{ interrupts: Array<{ value?: { type?: string } }> }>;
};
type InvokableGraph = {
  invoke(input: unknown, config: GraphConfig): Promise<unknown>;
  getState(config: GraphConfig): Promise<GraphStateSnapshot>;
};

export type WorkflowServiceTestFaults = LearnerTaskFaultHooks & {
  afterGraphCompletion?: (input: { kind: WorkflowKind; runId: string; threadId: string; result: unknown }) => Promise<void> | void;
  governedFollowupPlanning?: GovernedFollowupPlanningDependencies;
  componentPublication?: PublicationDependencies;
  assetRuntime?: AssetRuntimeDependencies;
};

/** Test-only sentinel that models process loss: no catch-path operational write may run. */
export class WorkflowProcessCrashForTests extends Error {
  constructor(message = "Injected workflow process crash") {
    super(message);
    this.name = "WorkflowProcessCrashForTests";
  }
}

export type WorkflowExecutionOptions = {
  execution?: ExecutionControlInput;
  /** Injectable fault seam for PostgreSQL/LangGraph recovery tests only. */
  testFaults?: WorkflowServiceTestFaults;
};

const LearnerTaskWorkflowStart = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  courseId: z.string().uuid(),
  message: z.string().min(1),
  requestedAction: z.enum(["EXPLAIN", "ATTEMPT", "LIBRARY", "STUDY_REVIEW"]).optional(),
  capabilityId: z.string().uuid().optional(),
  prompt: z.string().optional(),
  response: z.string().optional(),
  structuredInput: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(8),
  scheduledFor: z.string().datetime().optional(),
}).strict();

const ExplanationWorkflowStart = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  question: z.string().min(1),
  idempotencyKey: z.string().min(8),
}).strict();

const DiagnosisWorkflowStart = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  capabilityId: z.string().uuid().optional(),
  capabilityPublicKey: z.string().max(100).optional(),
  fields: z.record(z.string().max(100), z.string().max(100)).default({}),
  manualEntry: z.boolean().default(false),
  fileAssetId: z.string().uuid().optional(),
  prompt: z.string().min(1),
  response: z.string().min(1),
  structuredInput: z.record(z.string(), z.unknown()).optional(),
  sourceRefs: z.array(z.record(z.string(), z.string())).default([]),
  idempotencyKey: z.string().min(8),
}).strict();

const AssetRuntimeWorkflowStart = z.object({
  taskId: z.string().uuid(),
  episodeId: z.string().uuid(),
  activityPlanProposalId: z.string().uuid(),
  retryOfDeliveryId: z.string().uuid().optional(),
  prompt: z.string().min(1).max(4_000),
  response: z.string().min(1).max(20_000),
  structuredInput: z.record(z.string(), z.unknown()),
  modality: z.enum(["TEXT", "STRUCTURED", "MULTIMODAL"]).default("STRUCTURED"),
  idempotencyKey: z.string().min(8).max(240),
  deadlineMs: z.number().int().positive().max(120_000).default(30_000),
}).strict();

const TeacherReviewWorkflowStart = z.object({ observationId: z.string().uuid() }).strict();
const ComponentLifecycleWorkflowStart = z.object({
  componentId: z.string().uuid(),
  componentVersionId: z.string().uuid(),
}).strict();
const ComponentPublicationPayload = ExpertPublicationResume.omit({ actor: true });

function assertWorkflowBinding(label: string, supplied: string | undefined, persisted: string): void {
  if (supplied && supplied !== persisted) {
    throw new DomainInvariantError(`${label} does not match persisted workflow lineage`, "WORKFLOW_BINDING_MISMATCH");
  }
}

async function authorizeWorkflowStart(input: {
  kind: WorkflowKind;
  actor: Actor;
  state: Record<string, unknown>;
  taskId?: string;
  episodeId?: string;
}) {
  if (input.kind === "LEARNER_TASK") {
    requireRole(input.actor, ["LEARNER", "ADMIN"]);
    const parsed = LearnerTaskWorkflowStart.parse(input.state);
    const scope = await requireTaskEpisodeScope(input.actor, { taskId: parsed.taskId, episodeId: parsed.episodeId, learnerOriginated: true });
    if (parsed.courseId !== scope.task.courseId) throw new DomainInvariantError("Workflow course does not match the Task course", "WORKFLOW_BINDING_MISMATCH");
    assertWorkflowBinding("Task", input.taskId, scope.task.id);
    assertWorkflowBinding("Episode", input.episodeId, scope.episode.id);
    return { state: parsed, taskId: scope.task.id, episodeId: scope.episode.id };
  }
  if (input.kind === "EXPLANATION") {
    requireRole(input.actor, ["LEARNER", "ADMIN"]);
    const parsed = ExplanationWorkflowStart.parse(input.state);
    const scope = await requireTaskEpisodeScope(input.actor, { taskId: parsed.taskId, episodeId: parsed.episodeId, learnerOriginated: true });
    assertWorkflowBinding("Task", input.taskId, scope.task.id);
    assertWorkflowBinding("Episode", input.episodeId, scope.episode.id);
    return { state: parsed, taskId: scope.task.id, episodeId: scope.episode.id };
  }
  if (input.kind === "DIAGNOSIS") {
    requireRole(input.actor, ["LEARNER", "ADMIN"]);
    const parsed = DiagnosisWorkflowStart.parse(input.state);
    const scope = await requireTaskEpisodeScope(input.actor, { taskId: parsed.taskId, episodeId: parsed.episodeId, learnerOriginated: true });
    assertWorkflowBinding("Task", input.taskId, scope.task.id);
    assertWorkflowBinding("Episode", input.episodeId, scope.episode.id);
    return { state: parsed, taskId: scope.task.id, episodeId: scope.episode.id };
  }
  if (input.kind === "ASSET_RUNTIME") {
    requireRole(input.actor, ["LEARNER", "ADMIN"]);
    const parsed = AssetRuntimeWorkflowStart.parse(input.state);
    const scope = await requireTaskEpisodeScope(input.actor, { taskId: parsed.taskId, episodeId: parsed.episodeId, learnerOriginated: true });
    assertWorkflowBinding("Task", input.taskId, scope.task.id);
    assertWorkflowBinding("Episode", input.episodeId, scope.episode.id);
    return { state: parsed, taskId: scope.task.id, episodeId: scope.episode.id };
  }
  if (input.kind === "TEACHER_REVIEW") {
    requireRole(input.actor, ["LEARNER", "ADMIN"]);
    const parsed = TeacherReviewWorkflowStart.parse(input.state);
    const [lineage] = await getDb().select({ observation: diagnosticObservations, attempt: learnerAttempts })
      .from(diagnosticObservations)
      .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
      .where(eq(diagnosticObservations.id, parsed.observationId))
      .limit(1);
    if (!lineage) throw new DomainInvariantError("Teacher Review requires a governed Observation", "OBSERVATION_NOT_FOUND");
    const scope = await requireTaskEpisodeScope(input.actor, {
      taskId: lineage.attempt.taskId,
      episodeId: lineage.attempt.episodeId,
      learnerOriginated: true,
    });
    assertWorkflowBinding("Task", input.taskId, scope.task.id);
    assertWorkflowBinding("Episode", input.episodeId, scope.episode.id);
    return {
      state: {
        observationId: lineage.observation.id,
        taskId: scope.task.id,
        attemptId: lineage.attempt.id,
        summary: lineage.observation.summary,
        failureCode: lineage.observation.failureCode,
      },
      taskId: scope.task.id,
      episodeId: scope.episode.id,
    };
  }
  if (input.kind === "GOVERNED_FOLLOWUP") {
    const parsed = GovernedFollowupStart.parse(input.state);
    const authority = await resolveGovernedFollowupAuthority(input.actor, parsed);
    assertWorkflowBinding("Task", input.taskId, authority.taskId);
    assertWorkflowBinding("Episode", input.episodeId, authority.sourceEpisodeId);
    return {
      state: {
        teacherActor: input.actor,
        assignment: authority.assignment,
        taskId: authority.taskId,
        sourceEpisodeId: authority.sourceEpisodeId,
        learnerId: authority.learnerId,
      },
      taskId: authority.taskId,
      episodeId: authority.sourceEpisodeId,
    };
  }

  requireRole(input.actor, ["EXPERT", "ADMIN"]);
  const parsed = ComponentLifecycleWorkflowStart.parse(input.state);
  const [binding] = await getDb().select({ component: components, version: componentVersions })
    .from(components)
    .innerJoin(componentVersions, and(
      eq(componentVersions.id, parsed.componentVersionId),
      eq(componentVersions.componentId, components.id),
    ))
    .where(eq(components.id, parsed.componentId))
    .limit(1);
  if (!binding) throw new DomainInvariantError("Component version does not belong to the Component in this institution", "COMPONENT_VERSION_LINEAGE");
  if (binding.component.institutionId !== input.actor.institutionId) throw new DomainInvariantError("Component workflow is outside the active institution", "TENANT_ISOLATION");
  requireCourseAccess(input.actor, binding.component.institutionId, binding.component.courseId);
  if (input.taskId || input.episodeId) throw new DomainInvariantError("Component workflow cannot be bound to caller-supplied Task lineage", "WORKFLOW_BINDING_MISMATCH");
  return { state: parsed, taskId: undefined, episodeId: undefined };
}

function graphFor(kind: WorkflowKind, institutionId: string, testFaults?: WorkflowServiceTestFaults): InvokableGraph {
  const checkpointer = getWorkflowCheckpointer(institutionId);
  if (kind === "LEARNER_TASK") return buildLearnerTaskGraph(checkpointer, testFaults) as unknown as InvokableGraph;
  if (kind === "EXPLANATION") return buildExplanationGraph(checkpointer, testFaults?.explanation) as unknown as InvokableGraph;
  if (kind === "DIAGNOSIS") return buildDiagnosisGraph(checkpointer) as unknown as InvokableGraph;
  if (kind === "ASSET_RUNTIME") return buildAssetRuntimeGraph(checkpointer, testFaults?.assetRuntime) as unknown as InvokableGraph;
  if (kind === "TEACHER_REVIEW") return buildTeacherReviewGraph(checkpointer) as unknown as InvokableGraph;
  if (kind === "GOVERNED_FOLLOWUP") return buildGovernedFollowupGraph(checkpointer, testFaults?.governedFollowupPlanning) as unknown as InvokableGraph;
  if (kind === "COMPONENT_LIFECYCLE") return buildComponentLifecycleGraph(checkpointer, testFaults?.componentPublication) as unknown as InvokableGraph;
  throw new DomainInvariantError(`Workflow kind ${String(kind)} is not supported by this application version`, "WORKFLOW_KIND_UNSUPPORTED");
}

const CURRENT_WORKFLOW_KINDS = new Set<WorkflowKind>([
  "LEARNER_TASK",
  "EXPLANATION",
  "DIAGNOSIS",
  "ASSET_RUNTIME",
  "TEACHER_REVIEW",
  "GOVERNED_FOLLOWUP",
  "COMPONENT_LIFECYCLE",
]);

function requireCurrentWorkflowKind(value: string): WorkflowKind {
  if (!CURRENT_WORKFLOW_KINDS.has(value as WorkflowKind)) {
    throw new DomainInvariantError(
      `Persisted workflow kind ${value} requires an explicit compatibility transition before it can resume`,
      "WORKFLOW_KIND_UNSUPPORTED",
    );
  }
  return value as WorkflowKind;
}

function interruptType(result: unknown): string | null {
  const interrupts = (result as { __interrupt__?: Array<{ value?: { type?: string } }> }).__interrupt__;
  return interrupts?.[0]?.value?.type ?? null;
}

function checkpointInterruptType(snapshot: GraphStateSnapshot): string | null {
  return snapshot.tasks.flatMap((task) => task.interrupts)
    .map((entry) => entry.value?.type)
    .find((type): type is string => typeof type === "string") ?? null;
}

function advancedGovernedCheckpoint(
  run: typeof workflowRuns.$inferSelect,
  snapshot: GraphStateSnapshot,
): { result: Record<string, unknown>; nextInterrupt: string | null } | null {
  const currentInterrupt = checkpointInterruptType(snapshot);
  if (currentInterrupt === run.interruptType) return null;

  const checkpoint = snapshot.values;
  const checkpointActivityId = checkpoint.activityId;
  if (typeof run.productLinks.activityId !== "string" || checkpointActivityId !== run.productLinks.activityId) {
    throw new DomainInvariantError("Governed checkpoint does not match the canonical Activity", "WORKFLOW_REPLAY_INTEGRITY");
  }

  if (run.interruptType === "LEARNER_FOLLOWUP_REQUIRED"
    && currentInterrupt === "FOLLOWUP_RESULT_REVIEW_REQUIRED") {
    return { result: checkpoint, nextInterrupt: currentInterrupt };
  }

  const checkpointComplete = currentInterrupt === null && snapshot.next.length === 0;
  const activityStatus = checkpoint.activityStatus;
  if (run.interruptType === "LEARNER_FOLLOWUP_REQUIRED" && checkpointComplete
    && new Set(["FAILED_FINAL", "FAILED_RECOVERABLE", "CANCELLED"]).has(String(activityStatus))) {
    return { result: checkpoint, nextInterrupt: null };
  }
  if (run.interruptType === "FOLLOWUP_RESULT_REVIEW_REQUIRED" && checkpointComplete
    && typeof checkpoint.resultReviewId === "string"
    && new Set(["REVIEWED", "ESCALATED"]).has(String(activityStatus))) {
    return { result: checkpoint, nextInterrupt: null };
  }

  throw new DomainInvariantError("Governed checkpoint progress conflicts with the persisted workflow interrupt", "WORKFLOW_REPLAY_INTEGRITY");
}

function advancedComponentCheckpoint(
  run: typeof workflowRuns.$inferSelect,
  snapshot: GraphStateSnapshot,
): { result: Record<string, unknown>; nextInterrupt: null } | null {
  const currentInterrupt = checkpointInterruptType(snapshot);
  if (currentInterrupt === run.interruptType) return null;
  const checkpoint = snapshot.values;
  const complete = currentInterrupt === null && snapshot.next.length === 0;
  if (!complete || run.interruptType !== "EXPERT_PUBLICATION_REVIEW_REQUIRED"
    || checkpoint.componentId !== run.productLinks.componentId
    || checkpoint.componentVersionId !== run.productLinks.componentVersionId
    || checkpoint.evaluationId !== run.productLinks.evaluationId
    || typeof checkpoint.decisionId !== "string"
    || (checkpoint.decision !== "APPROVE" && checkpoint.decision !== "REJECT")) {
    throw new DomainInvariantError("Component lifecycle checkpoint progress conflicts with its exact persisted interrupt", "WORKFLOW_REPLAY_INTEGRITY");
  }
  if (checkpoint.decision === "APPROVE" && typeof checkpoint.registeredCapabilityVersionId === "string"
    && (typeof checkpoint.registeredCapabilityId !== "string" || typeof checkpoint.capabilityResolutionId !== "string" || typeof checkpoint.activityPlanProposalId !== "string")) {
    throw new DomainInvariantError("Completed ComponentAsset checkpoint lacks exact Registry and READY planning lineage", "WORKFLOW_REPLAY_INTEGRITY");
  }
  return { result: checkpoint, nextInterrupt: null };
}

function governedWorkflowIdentity(actor: Actor, assignment: z.infer<typeof GovernedFollowupStart>) {
  const requestHash = commandRequestHash(actor, "START_GOVERNED_FOLLOWUP_WORKFLOW", assignment);
  const digest = createHash("sha256")
    .update(`${actor.institutionId}:${actor.userId}:${assignment.assignmentIdempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  return {
    requestHash,
    threadId: `${actor.institutionId}:governed_followup:${digest}`,
  };
}

function componentWorkflowIdentity(actor: Actor, state: z.infer<typeof ComponentLifecycleWorkflowStart>) {
  const requestHash = commandRequestHash(actor, "START_COMPONENT_LIFECYCLE_WORKFLOW", state);
  const digest = createHash("sha256")
    .update(`${actor.institutionId}:${state.componentId}:${state.componentVersionId}`)
    .digest("hex")
    .slice(0, 32);
  return { requestHash, threadId: `${actor.institutionId}:component_lifecycle:${digest}` };
}

function governedTerminal(result: unknown): { status: "FAILED" | "CANCELLED"; failure: string; code: string } | null {
  const state = result as Record<string, unknown>;
  if (state.activityStatus === "CANCELLED") {
    return {
      status: "CANCELLED",
      failure: typeof state.failureReason === "string" ? state.failureReason : "Governed follow-up was cancelled",
      code: typeof state.failureCode === "string" ? state.failureCode : "FOLLOWUP_CANCELLED",
    };
  }
  if (state.activityStatus === "FAILED_FINAL" || state.activityStatus === "FAILED_RECOVERABLE") {
    return {
      status: "FAILED",
      failure: typeof state.failureReason === "string" ? state.failureReason : "Governed follow-up ended without an executable path",
      code: typeof state.failureCode === "string" ? state.failureCode : "FOLLOWUP_FAILED",
    };
  }
  return null;
}

function assetRuntimeTerminal(result: unknown): { status: "FAILED" | "CANCELLED" | "TIMED_OUT"; failure: string; code: string } | null {
  const state = result as Record<string, unknown>;
  if (!new Set(["FAILED", "CANCELLED", "TIMED_OUT"]).has(String(state.runtimeStatus))) return null;
  const runtimeStatus = state.runtimeStatus as "FAILED" | "CANCELLED" | "TIMED_OUT";
  return {
    status: runtimeStatus,
    failure: typeof state.failureReason === "string" ? state.failureReason : `Asset Runtime ended in ${runtimeStatus}`,
    code: typeof state.failureCode === "string" ? state.failureCode : `ASSET_RUNTIME_${runtimeStatus}`,
  };
}

function replayedWorkflowRun(run: typeof workflowRuns.$inferSelect) {
  return {
    runId: run.id,
    threadId: run.threadId,
    status: run.status,
    interruptType: run.interruptType,
    expectedVersion: run.interruptVersion,
    failure: run.failure,
    failureCode: run.productLinks.failureCode,
    result: run.productLinks,
    replayed: true,
  };
}

type GovernedResumeInterrupt = "LEARNER_FOLLOWUP_REQUIRED" | "FOLLOWUP_RESULT_REVIEW_REQUIRED";

function governedResumePayload(interrupt: GovernedResumeInterrupt, payload: Record<string, unknown>) {
  return interrupt === "LEARNER_FOLLOWUP_REQUIRED"
    ? GovernedFollowupAttempt.parse(payload)
    : GovernedFollowupReview.parse(payload);
}

function governedResumeReceiptKey(expectedVersion: number, field: string): string {
  return `resumeReplay:${expectedVersion}:${field}`;
}

function governedResumeRequestHash(
  actor: Actor,
  threadId: string,
  expectedVersion: number,
  interrupt: GovernedResumeInterrupt,
  payload: Record<string, unknown>,
): string {
  return commandRequestHash(actor, "RESUME_GOVERNED_FOLLOWUP_WORKFLOW", {
    threadId,
    expectedVersion,
    interrupt,
    payload: governedResumePayload(interrupt, payload),
  });
}

function governedResumeReceipt(
  run: typeof workflowRuns.$inferSelect,
  expectedVersion: number,
): {
  actorUserId: string;
  interrupt: GovernedResumeInterrupt;
  requestHash: string;
  status: "INTERRUPTED" | "COMPLETED";
  nextInterrupt: string | null;
  nextVersion: number;
  result: Record<string, string>;
} | null {
  const links = run.productLinks;
  const prefix = (field: string) => links[governedResumeReceiptKey(expectedVersion, field)];
  const interrupt = prefix("interrupt");
  const status = prefix("status");
  const nextVersion = Number(prefix("nextVersion"));
  if ((interrupt !== "LEARNER_FOLLOWUP_REQUIRED" && interrupt !== "FOLLOWUP_RESULT_REVIEW_REQUIRED")
    || (status !== "INTERRUPTED" && status !== "COMPLETED")
    || !Number.isInteger(nextVersion)) return null;
  let result: Record<string, string>;
  try {
    const parsed = JSON.parse(prefix("result") ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.values(parsed).some((value) => typeof value !== "string")) return null;
    result = parsed as Record<string, string>;
  } catch {
    return null;
  }
  const actorUserId = prefix("actorUserId");
  const requestHash = prefix("requestHash");
  if (!actorUserId || !requestHash) return null;
  return {
    actorUserId,
    interrupt,
    requestHash,
    status,
    nextInterrupt: prefix("nextInterrupt") === "NONE" ? null : prefix("nextInterrupt") ?? null,
    nextVersion,
    result,
  };
}

function governedResumeReceiptLinks(input: {
  actor: Actor;
  threadId: string;
  expectedVersion: number;
  interrupt: GovernedResumeInterrupt;
  resumePayload: Record<string, unknown>;
  status: "INTERRUPTED" | "COMPLETED";
  nextInterrupt: string | null;
  nextVersion: number;
  result: unknown;
}): Record<string, string> {
  const key = (field: string) => governedResumeReceiptKey(input.expectedVersion, field);
  return {
    [key("actorUserId")]: input.actor.userId,
    [key("interrupt")]: input.interrupt,
    [key("requestHash")]: governedResumeRequestHash(
      input.actor,
      input.threadId,
      input.expectedVersion,
      input.interrupt,
      input.resumePayload,
    ),
    [key("status")]: input.status,
    [key("nextInterrupt")]: input.nextInterrupt ?? "NONE",
    [key("nextVersion")]: String(input.nextVersion),
    [key("result")]: JSON.stringify(extractProductLinks(input.result)),
  };
}

async function replayGovernedResumeIfExact(
  actor: Actor,
  run: typeof workflowRuns.$inferSelect,
  threadId: string,
  expectedVersion: number,
  resumePayload: Record<string, unknown>,
) {
  const receipt = governedResumeReceipt(run, expectedVersion);
  if (!receipt) return null;
  if (receipt.actorUserId !== actor.userId) {
    throw new DomainInvariantError("Governed workflow replay belongs to another actor", "WORKFLOW_OWNERSHIP");
  }
  const requestHash = governedResumeRequestHash(actor, threadId, expectedVersion, receipt.interrupt, resumePayload);
  if (requestHash !== receipt.requestHash) {
    throw new DomainInvariantError("Governed workflow replay changed the original resume command", "WORKFLOW_REPLAY_IDEMPOTENCY_MISMATCH");
  }
  if (run.status === "FAILED" || run.status === "CANCELLED") {
    throw new DomainInvariantError("A failed or cancelled governed workflow cannot be revived by replay", "WORKFLOW_NOT_INTERRUPTED");
  }
  const activityId = run.productLinks.activityId;
  const targetEpisodeId = run.productLinks.targetEpisodeId;
  if (!run.taskId || typeof activityId !== "string" || typeof targetEpisodeId !== "string") {
    throw new DomainInvariantError("Governed workflow replay lacks exact Product State lineage", "WORKFLOW_REPLAY_INTEGRITY");
  }
  const learnerReplay = receipt.interrupt === "LEARNER_FOLLOWUP_REQUIRED";
  requireRole(actor, learnerReplay ? ["LEARNER"] : ["TEACHER", "ADMIN"]);
  const scope = await requireGovernedFollowupScope(actor, {
    activityId,
    taskId: run.taskId,
    episodeId: targetEpisodeId,
    learnerOriginated: learnerReplay,
    allowClosedTerminal: true,
  });
  if (new Set(["FAILED_FINAL", "CANCELLED"]).has(scope.activity.status)) {
    throw new DomainInvariantError("A failed or cancelled governed activity cannot be revived by replay", "WORKFLOW_NOT_INTERRUPTED");
  }
  if (learnerReplay) {
    if (scope.activity.learnerId !== actor.userId || !scope.activity.runtimeDeliveryId
      || !scope.activity.resultAttemptId || !scope.activity.resultObservationId
      || receipt.result.activityId !== scope.activity.id
      || receipt.result.runtimeDeliveryId !== scope.activity.runtimeDeliveryId
      || receipt.result.resultAttemptId !== scope.activity.resultAttemptId
      || receipt.result.resultObservationId !== scope.activity.resultObservationId) {
      throw new DomainInvariantError("Learner workflow replay does not match persisted result lineage", "WORKFLOW_REPLAY_INTEGRITY");
    }
  } else {
    await requireCurrentTeacherCourseAuthority(actor, scope.activity.courseId!);
    if (!scope.activity.resultReviewId || receipt.result.activityId !== scope.activity.id
      || receipt.result.resultReviewId !== scope.activity.resultReviewId) {
      throw new DomainInvariantError("Teacher workflow replay does not match a persisted result Review", "WORKFLOW_REPLAY_INTEGRITY");
    }
  }
  return {
    runId: run.id,
    threadId: run.threadId,
    status: receipt.status,
    interruptType: receipt.nextInterrupt,
    expectedVersion: receipt.nextVersion,
    result: receipt.result,
    replayed: true,
  };
}

function componentResumeReceiptKey(expectedVersion: number, field: string): string {
  return `componentResumeReplay:${expectedVersion}:${field}`;
}

function componentResumeRequestHash(actor: Actor, threadId: string, expectedVersion: number, payload: Record<string, unknown>): string {
  return commandRequestHash(actor, "RESUME_COMPONENT_LIFECYCLE_WORKFLOW", {
    threadId,
    expectedVersion,
    payload: ComponentPublicationPayload.parse(payload),
  });
}

function componentResumeReceipt(run: typeof workflowRuns.$inferSelect, expectedVersion: number): { actorUserId: string; requestHash: string; result: Record<string, string> } | null {
  const value = (field: string) => run.productLinks[componentResumeReceiptKey(expectedVersion, field)];
  const actorUserId = value("actorUserId");
  const requestHash = value("requestHash");
  if (!actorUserId || !requestHash || value("status") !== "COMPLETED") return null;
  try {
    const parsed = JSON.parse(value("result") ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((item) => typeof item !== "string")) return null;
    return { actorUserId, requestHash, result: parsed as Record<string, string> };
  } catch {
    return null;
  }
}

function componentResumeReceiptLinks(input: { actor: Actor; threadId: string; expectedVersion: number; resumePayload: Record<string, unknown>; result: unknown }): Record<string, string> {
  const key = (field: string) => componentResumeReceiptKey(input.expectedVersion, field);
  return {
    [key("actorUserId")]: input.actor.userId,
    [key("requestHash")]: componentResumeRequestHash(input.actor, input.threadId, input.expectedVersion, input.resumePayload),
    [key("status")]: "COMPLETED",
    [key("result")]: JSON.stringify(extractProductLinks(input.result)),
  };
}

async function requireCanonicalComponentPublication(actor: Actor, run: typeof workflowRuns.$inferSelect, result: Record<string, string>): Promise<void> {
  const componentId = run.productLinks.componentId;
  const componentVersionId = run.productLinks.componentVersionId;
  const evaluationId = run.productLinks.evaluationId;
  if (!componentId || !componentVersionId || !evaluationId || !result.decisionId || (result.decision !== "APPROVE" && result.decision !== "REJECT")) {
    throw new DomainInvariantError("Component lifecycle receipt lacks exact decision lineage", "WORKFLOW_REPLAY_INTEGRITY");
  }
  const [binding] = await getDb().select({ component: components, version: componentVersions, evaluation: componentEvaluations, decision: publicationDecisions })
    .from(components)
    .innerJoin(componentVersions, and(eq(componentVersions.id, componentVersionId), eq(componentVersions.componentId, components.id)))
    .innerJoin(componentEvaluations, and(eq(componentEvaluations.id, evaluationId), eq(componentEvaluations.componentVersionId, componentVersions.id)))
    .innerJoin(publicationDecisions, and(eq(publicationDecisions.id, result.decisionId), eq(publicationDecisions.componentVersionId, componentVersions.id), eq(publicationDecisions.evaluationId, componentEvaluations.id)))
    .where(eq(components.id, componentId)).limit(1);
  if (!binding || binding.component.institutionId !== actor.institutionId || binding.decision.action !== result.decision || binding.decision.expertId !== actor.userId) {
    throw new DomainInvariantError("Component lifecycle receipt conflicts with canonical confirmation", "WORKFLOW_REPLAY_INTEGRITY");
  }
  requireCourseAccess(actor, binding.component.institutionId, binding.component.courseId);
  if (result.decision === "REJECT") {
    if (binding.version.status !== "REJECTED") throw new DomainInvariantError("Rejected Component lifecycle receipt is not terminal in Product State", "WORKFLOW_REPLAY_INTEGRITY");
    return;
  }
  if (binding.version.status !== "PUBLISHED" || binding.component.activeVersionId !== binding.version.id || binding.component.status !== "PUBLISHED") {
    throw new DomainInvariantError("Approved Component lifecycle receipt is not published in Product State", "WORKFLOW_REPLAY_INTEGRITY");
  }
  if (binding.component.assetType !== "WEB_COMPONENT_ASSET") return;
  if (!result.registeredCapabilityId || !result.registeredCapabilityVersionId || !result.capabilityResolutionId || !result.activityPlanProposalId
    || binding.component.registeredCapabilityId !== result.registeredCapabilityId || binding.component.registeredCapabilityVersionId !== result.registeredCapabilityVersionId) {
    throw new DomainInvariantError("Approved ComponentAsset receipt lacks exact Registry and planning lineage", "WORKFLOW_REPLAY_INTEGRITY");
  }
  const [registration] = await getDb().select({ capability: capabilities, version: capabilityVersions, availability: capabilityAvailabilityDecisions, resolution: capabilityResolutions, plan: activityPlanProposals })
    .from(capabilities)
    .innerJoin(capabilityVersions, and(eq(capabilityVersions.id, result.registeredCapabilityVersionId), eq(capabilityVersions.capabilityId, capabilities.id)))
    .innerJoin(capabilityAvailabilityDecisions, and(eq(capabilityAvailabilityDecisions.capabilityVersionId, capabilityVersions.id), eq(capabilityAvailabilityDecisions.confirmationDecisionId, binding.decision.id)))
    .innerJoin(capabilityResolutions, and(eq(capabilityResolutions.id, result.capabilityResolutionId), eq(capabilityResolutions.selectedCapabilityId, capabilities.id), eq(capabilityResolutions.selectedCapabilityVersionId, capabilityVersions.id)))
    .innerJoin(activityPlanProposals, and(eq(activityPlanProposals.id, result.activityPlanProposalId), eq(activityPlanProposals.capabilityResolutionId, capabilityResolutions.id), eq(activityPlanProposals.selectedCapabilityVersionId, capabilityVersions.id)))
    .where(eq(capabilities.id, result.registeredCapabilityId)).limit(1);
  if (!registration || registration.capability.activeVersionId !== registration.version.id || registration.availability.availabilityStatus !== "AVAILABLE"
    || registration.resolution.decision !== "EXISTING" || registration.plan.state !== "READY") {
    throw new DomainInvariantError("Approved ComponentAsset receipt does not match active exact Registry availability and READY planning", "WORKFLOW_REPLAY_INTEGRITY");
  }
}

async function replayComponentResumeIfExact(actor: Actor, run: typeof workflowRuns.$inferSelect, threadId: string, expectedVersion: number, resumePayload: Record<string, unknown>) {
  const receipt = componentResumeReceipt(run, expectedVersion);
  if (!receipt) return null;
  if (run.status === "FAILED" || run.status === "CANCELLED") throw new DomainInvariantError("A failed or cancelled Component lifecycle cannot be revived by replay", "WORKFLOW_NOT_INTERRUPTED");
  if (receipt.actorUserId !== actor.userId) throw new DomainInvariantError("Component lifecycle replay belongs to another confirming actor", "WORKFLOW_OWNERSHIP");
  if (componentResumeRequestHash(actor, threadId, expectedVersion, resumePayload) !== receipt.requestHash) {
    throw new DomainInvariantError("Component lifecycle replay changed the exact resume payload, thread or interrupt version", "WORKFLOW_REPLAY_IDEMPOTENCY_MISMATCH");
  }
  requireRole(actor, ["EXPERT", "ADMIN"]);
  await requireCanonicalComponentPublication(actor, run, receipt.result);
  return { runId: run.id, threadId: run.threadId, status: "COMPLETED" as const, interruptType: null, expectedVersion, result: receipt.result, replayed: true };
}

function assertReconciledLink(label: string, checkpointValue: unknown, canonicalValue: string): void {
  if (checkpointValue !== undefined && checkpointValue !== canonicalValue) {
    throw new DomainInvariantError(`${label} checkpoint conflicts with canonical Product State`, "WORKFLOW_REPLAY_INTEGRITY");
  }
}

async function reconcileGovernedStart(
  state: Record<string, unknown>,
  result: unknown,
  planningDependencies?: GovernedFollowupPlanningDependencies,
): Promise<unknown> {
  const governed = state as {
    teacherActor: Actor;
    assignment: z.infer<typeof GovernedFollowupStart>;
  };
  const activity = await createGovernedFollowup(governed.teacherActor, governed.assignment, planningDependencies);
  const checkpoint = result as Record<string, unknown>;
  assertReconciledLink("Governed follow-up Activity", checkpoint.activityId, activity.id);
  assertReconciledLink("Governed follow-up target Episode", checkpoint.targetEpisodeId, activity.targetEpisodeId!);
  return {
    ...checkpoint,
    activityId: activity.id,
    targetEpisodeId: activity.targetEpisodeId,
    activityPlanProposalId: activity.activityPlanProposalId ?? undefined,
    activityStatus: activity.status,
  };
}

async function reconcileGovernedResume(
  actor: Actor,
  run: typeof workflowRuns.$inferSelect,
  resumePayload: Record<string, unknown>,
  result: unknown,
): Promise<unknown> {
  const activityId = typeof run.productLinks.activityId === "string" ? run.productLinks.activityId : undefined;
  if (!activityId) throw new DomainInvariantError("Governed workflow lacks its Activity link", "WORKFLOW_REPLAY_INTEGRITY");
  const checkpoint = result as Record<string, unknown>;
  if (run.interruptType === "LEARNER_FOLLOWUP_REQUIRED") {
    const attempt = GovernedFollowupAttempt.parse(resumePayload);
    const canonical = await executeGovernedFollowup(actor, { activityId, ...attempt });
    assertReconciledLink("Governed follow-up Activity", checkpoint.activityId, canonical.activity.id);
    if (canonical.status === "WAITING_FOR_REVIEW") {
      assertReconciledLink("Governed follow-up RuntimeDelivery", checkpoint.runtimeDeliveryId, canonical.delivery.id);
      assertReconciledLink("Governed follow-up result Attempt", checkpoint.resultAttemptId, canonical.attempt.id);
      assertReconciledLink("Governed follow-up result Diagnosis", checkpoint.resultObservationId, canonical.observation.id);
      return {
        ...checkpoint,
        activityStatus: canonical.status,
        activityPlanId: canonical.delivery.activityPlanId,
        runtimeDeliveryId: canonical.delivery.id,
        resultAttemptId: canonical.attempt.id,
        resultObservationId: canonical.observation.id,
      };
    }
    if (interruptType(result)) {
      throw new DomainInvariantError("Terminal governed runtime conflicts with a persisted teacher interrupt", "WORKFLOW_REPLAY_INTEGRITY");
    }
    return { ...checkpoint, activityStatus: canonical.status };
  }
  if (run.interruptType === "FOLLOWUP_RESULT_REVIEW_REQUIRED") {
    const review = GovernedFollowupReview.parse(resumePayload);
    const canonical = await reviewGovernedFollowupResult(actor, { activityId, ...review });
    assertReconciledLink("Governed follow-up result Review", checkpoint.resultReviewId, canonical.reviewId);
    return { ...checkpoint, activityStatus: canonical.activity.status, resultReviewId: canonical.reviewId };
  }
  return result;
}

async function reconcileComponentStart(actor: Actor, state: Record<string, unknown>, result: unknown): Promise<unknown> {
  const parsed = ComponentLifecycleWorkflowStart.parse(state);
  const canonical = await runComponentEvaluation(actor, parsed.componentVersionId);
  const checkpoint = result as Record<string, unknown>;
  assertReconciledLink("Component lifecycle evaluation", checkpoint.evaluationId, canonical.evaluation.id);
  if (checkpoint.componentId !== parsed.componentId || checkpoint.componentVersionId !== parsed.componentVersionId) {
    throw new DomainInvariantError("Component lifecycle checkpoint changed its exact ComponentAssetVersion binding", "WORKFLOW_REPLAY_INTEGRITY");
  }
  return {
    ...checkpoint,
    componentId: parsed.componentId,
    componentVersionId: parsed.componentVersionId,
    evaluationId: canonical.evaluation.id,
    systemStatus: canonical.systemStatus,
    systemChecks: canonical.systemChecks,
    providerChecks: canonical.providerChecks,
  };
}

async function reconcileAssetRuntimeStart(actor: Actor, state: Record<string, unknown>, result: unknown): Promise<unknown> {
  const request = AssetRuntimeWorkflowStart.parse(state);
  const checkpoint = result as Record<string, unknown>;
  const [canonical] = await getDb().select({
    delivery: runtimeDeliveries,
    plan: activityPlans,
    attempt: learnerAttempts,
  }).from(runtimeDeliveries)
    .innerJoin(activityPlans, eq(activityPlans.id, runtimeDeliveries.activityPlanId))
    .innerJoin(learnerAttempts, eq(learnerAttempts.runtimeDeliveryId, runtimeDeliveries.id))
    .where(and(
      eq(runtimeDeliveries.institutionId, actor.institutionId),
      eq(runtimeDeliveries.taskId, request.taskId),
      eq(runtimeDeliveries.episodeId, request.episodeId),
      eq(runtimeDeliveries.idempotencyKey, request.idempotencyKey),
    )).limit(1);
  if (!canonical) {
    throw new DomainInvariantError("Asset Runtime checkpoint conflicts with exact persisted Product State (MISSING_DELIVERY)", "WORKFLOW_REPLAY_INTEGRITY");
  }
  const attemptInput = canonical?.attempt.structuredInput as Record<string, unknown> | null;
  const mismatches = [
    checkpoint.activityPlanId !== undefined && canonical.delivery.activityPlanId !== checkpoint.activityPlanId ? "CHECKPOINT_PLAN" : null,
    checkpoint.runtimeDeliveryId !== undefined && canonical.delivery.id !== checkpoint.runtimeDeliveryId ? "CHECKPOINT_DELIVERY" : null,
    checkpoint.attemptId !== undefined && canonical.attempt.id !== checkpoint.attemptId ? "CHECKPOINT_ATTEMPT" : null,
    checkpoint.runtimeStatus !== undefined && canonical.delivery.status !== checkpoint.runtimeStatus ? "CHECKPOINT_STATUS" : null,
    !new Set(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]).has(canonical.delivery.status) ? "NON_TERMINAL_DELIVERY" : null,
    canonical.plan.activityPlanProposalId !== request.activityPlanProposalId ? "PLAN_PROPOSAL" : null,
    canonical.delivery.idempotencyKey !== request.idempotencyKey ? "IDEMPOTENCY_KEY" : null,
    canonical.delivery.retryOfDeliveryId !== (request.retryOfDeliveryId ?? null) ? "RETRY_LINEAGE" : null,
    canonical.delivery.deadlineMs !== request.deadlineMs ? "DEADLINE" : null,
    canonical.attempt.prompt !== request.prompt ? "PROMPT" : null,
    canonical.attempt.response !== request.response ? "RESPONSE" : null,
    canonical.attempt.modality !== request.modality ? "MODALITY" : null,
    stableAssetRuntimeJson(attemptInput?.assetRuntimeInput) !== stableAssetRuntimeJson(request.structuredInput) ? "STRUCTURED_INPUT" : null,
  ].filter((item): item is string => Boolean(item));
  if (mismatches.length) {
    throw new DomainInvariantError(`Asset Runtime checkpoint conflicts with exact persisted Product State (${mismatches.join(",")})`, "WORKFLOW_REPLAY_INTEGRITY");
  }
  const normalizedError = canonical.delivery.normalizedError as NormalizedRuntimeError | null;
  if (canonical.delivery.status !== "SUCCEEDED" && (!normalizedError?.code || !normalizedError.message)) {
    throw new DomainInvariantError("Terminal Asset Runtime failure lacks normalized durable evidence", "WORKFLOW_REPLAY_INTEGRITY");
  }
  return {
    ...checkpoint,
    activityPlanId: canonical.plan.id,
    runtimeDeliveryId: canonical.delivery.id,
    attemptId: canonical.attempt.id,
    runtimeStatus: canonical.delivery.status,
    failureCode: normalizedError?.code,
    failureReason: normalizedError?.message,
  };
}

async function reconcileComponentResume(
  actor: Actor,
  run: typeof workflowRuns.$inferSelect,
  resumePayload: Record<string, unknown>,
  result: unknown,
  dependencies?: PublicationDependencies,
): Promise<unknown> {
  const payload = ComponentPublicationPayload.parse(resumePayload);
  const componentVersionId = run.productLinks.componentVersionId;
  const evaluationId = run.productLinks.evaluationId;
  if (!componentVersionId || !evaluationId) throw new DomainInvariantError("Component lifecycle lacks its exact evaluated version links", "WORKFLOW_REPLAY_INTEGRITY");
  const canonical = await decidePublication(actor, {
    componentVersionId,
    evaluationId,
    workflowThreadId: run.threadId,
    action: payload.action,
    rationale: payload.rationale,
    rubric: payload.rubric,
    idempotencyKey: payload.idempotencyKey,
  }, dependencies);
  const checkpoint = result as Record<string, unknown>;
  assertReconciledLink("Component publication decision", checkpoint.decisionId, canonical.decisionId);
  if (checkpoint.decision !== undefined && checkpoint.decision !== canonical.action) {
    throw new DomainInvariantError("Component publication checkpoint changed the human decision", "WORKFLOW_REPLAY_INTEGRITY");
  }
  if (canonical.registeredCapabilityId) assertReconciledLink("Registered Capability", checkpoint.registeredCapabilityId, canonical.registeredCapabilityId);
  if (canonical.registeredCapabilityVersionId) assertReconciledLink("Registered CapabilityVersion", checkpoint.registeredCapabilityVersionId, canonical.registeredCapabilityVersionId);
  if (canonical.capabilityResolutionId) assertReconciledLink("Re-resolved Capability", checkpoint.capabilityResolutionId, canonical.capabilityResolutionId);
  if (canonical.activityPlanProposalId) assertReconciledLink("READY ActivityPlanProposal", checkpoint.activityPlanProposalId, canonical.activityPlanProposalId);
  return {
    ...checkpoint,
    componentId: canonical.componentId,
    componentVersionId: canonical.componentVersionId,
    evaluationId,
    decisionId: canonical.decisionId,
    decision: canonical.action,
    registeredCapabilityId: canonical.registeredCapabilityId ?? undefined,
    registeredCapabilityVersionId: canonical.registeredCapabilityVersionId ?? undefined,
    capabilityResolutionId: canonical.capabilityResolutionId ?? undefined,
    activityPlanProposalId: canonical.activityPlanProposalId ?? undefined,
  };
}

async function startWorkflowInTenant(input: { kind: WorkflowKind; actor: Actor; state: Record<string, unknown>; taskId?: string; episodeId?: string; threadId?: string } & WorkflowExecutionOptions) {
  return runWithExecutionControl(input.execution, async (control) => {
    const authorized = await authorizeWorkflowStart(input);
    const { state, taskId, episodeId } = authorized;
    const expectedThreadPrefix = `${input.actor.institutionId}:`;
    if (input.threadId && !input.threadId.startsWith(expectedThreadPrefix)) {
      throw new DomainInvariantError("Workflow thread IDs require the active institution prefix", "CHECKPOINT_TENANT_PREFIX_REQUIRED");
    }
    const governedIdentity = input.kind === "GOVERNED_FOLLOWUP"
      ? governedWorkflowIdentity(input.actor, (state as { assignment: z.infer<typeof GovernedFollowupStart> }).assignment)
      : null;
    const componentIdentity = input.kind === "COMPONENT_LIFECYCLE"
      ? componentWorkflowIdentity(input.actor, state as z.infer<typeof ComponentLifecycleWorkflowStart>)
      : null;
    const stableIdentity = governedIdentity ?? componentIdentity;
    if (stableIdentity && input.threadId && input.threadId !== stableIdentity.threadId) {
      throw new DomainInvariantError(`${input.kind === "COMPONENT_LIFECYCLE" ? "Component lifecycle" : "Governed follow-up"} thread identity is derived from exact canonical lineage`, "WORKFLOW_IDEMPOTENCY_MISMATCH");
    }
    const threadId = stableIdentity?.threadId ?? input.threadId ?? `${expectedThreadPrefix}${input.kind.toLowerCase()}:${randomUUID()}`;
    if (stableIdentity) {
      await getSql()`SELECT pg_advisory_xact_lock(hashtextextended(${threadId},0))`;
    }
    const [existingRun] = stableIdentity
      ? await getDb().select().from(workflowRuns).where(eq(workflowRuns.threadId, threadId)).limit(1)
      : [];
    if (existingRun) {
      if (existingRun.workflowKind !== input.kind || existingRun.institutionId !== input.actor.institutionId
        || existingRun.actorUserId !== input.actor.userId || existingRun.taskId !== (taskId ?? null)
        || existingRun.episodeId !== (episodeId ?? null)
        || existingRun.productLinks.startRequestHash !== stableIdentity!.requestHash) {
        throw new DomainInvariantError("Workflow replay conflicts with persisted actor, tenant or exact start payload", "WORKFLOW_IDEMPOTENCY_MISMATCH");
      }
      if (existingRun.status !== "RUNNING") return replayedWorkflowRun(existingRun);
    }
    const runId = existingRun?.id ?? randomUUID();
    const initialProductLinks: Record<string, string> = governedIdentity ? {
      startRequestHash: governedIdentity.requestHash,
      assignmentIdempotencyKey: (state as { assignment: z.infer<typeof GovernedFollowupStart> }).assignment.assignmentIdempotencyKey,
    } : componentIdentity ? {
      startRequestHash: componentIdentity.requestHash,
      componentId: (state as z.infer<typeof ComponentLifecycleWorkflowStart>).componentId,
      componentVersionId: (state as z.infer<typeof ComponentLifecycleWorkflowStart>).componentVersionId,
    } : {};
    assertExecutionActive(control);
    if (!existingRun) {
      await getDb().insert(workflowRuns).values({
        id: runId,
        threadId,
        workflowKind: input.kind,
        institutionId: input.actor.institutionId,
        taskId,
        episodeId,
        actorUserId: input.actor.userId,
        status: "RUNNING",
        productLinks: initialProductLinks,
      });
    }
    const started = performance.now();
    try {
      const eventState = input.kind === "EXPLANATION" ? { ...state, eventIdempotencyKey: (state as z.infer<typeof ExplanationWorkflowStart>).idempotencyKey } : state;
      const graphState = input.kind === "COMPONENT_LIFECYCLE" ? { ...eventState, workflowThreadId: threadId, actor: input.actor } : { ...eventState, actor: input.actor };
      let result: unknown;
      try {
        result = await traced(`foundry.workflow.${input.kind.toLowerCase()}`, { userId: input.actor.userId, institutionId: input.actor.institutionId, taskId: taskId ?? "", "workflow.thread_id": threadId }, () => graphFor(input.kind, input.actor.institutionId, input.testFaults).invoke(graphState, { configurable: { thread_id: threadId }, recursionLimit: 50, signal: control.signal }));
      } catch (error) {
        const stopped = executionStopStatus(error, control);
        if (input.kind !== "ASSET_RUNTIME" || stopped === null) throw error;
        const canonical = await reconcileStoppedAssetStage(input.actor, AssetRuntimeWorkflowStart.parse(state), stopped);
        result = {
          activityPlanId: canonical.delivery.activityPlanId,
          runtimeDeliveryId: canonical.delivery.id,
          attemptId: canonical.attempt.id,
          runtimeStatus: canonical.delivery.status,
        };
      }
      if (input.kind === "GOVERNED_FOLLOWUP") {
        result = await reconcileGovernedStart(state, result, input.testFaults?.governedFollowupPlanning);
      } else if (input.kind === "COMPONENT_LIFECYCLE") {
        result = await reconcileComponentStart(input.actor, state, result);
      } else if (input.kind === "ASSET_RUNTIME") {
        result = await reconcileAssetRuntimeStart(input.actor, state, result);
      }
      await input.testFaults?.afterGraphCompletion?.({ kind: input.kind, runId, threadId, result });
      const interrupted = interruptType(result);
      const terminal = input.kind === "GOVERNED_FOLLOWUP"
        ? governedTerminal(result)
        : input.kind === "ASSET_RUNTIME" ? assetRuntimeTerminal(result) : null;
      if (!terminal) assertExecutionActive(control);
      const status = interrupted ? "INTERRUPTED" : terminal?.status ?? "COMPLETED";
      const interruptVersion = interrupted ? 1 : 0;
      const productLinks = { ...initialProductLinks, ...existingRun?.productLinks, ...extractProductLinks(result) };
      await getDb().update(workflowRuns).set({
        status,
        interruptType: interrupted,
        interruptVersion,
        failure: terminal?.failure ?? null,
        metrics: { latencyMs: performance.now() - started },
        completedAt: interrupted ? null : new Date(),
        productLinks,
      }).where(eq(workflowRuns.id, runId));
      return { runId, threadId, status, interruptType: interrupted, expectedVersion: interruptVersion, failureCode: terminal?.code, failure: terminal?.failure, result };
    } catch (error) {
      if (error instanceof WorkflowProcessCrashForTests) throw error;
      await getDb().update(workflowRuns).set({ status: operationalFailureStatus(error), failure: error instanceof Error ? error.message : String(error), metrics: { latencyMs: performance.now() - started }, completedAt: new Date() }).where(eq(workflowRuns.id, runId));
      throw error;
    }
  }, {
    acceptStoppedResult: (result) => result.status === "FAILED" || result.status === "CANCELLED" || result.status === "TIMED_OUT",
  });
}

export async function startWorkflow(input: { kind: WorkflowKind; actor: Actor; state: Record<string, unknown>; taskId?: string; episodeId?: string; threadId?: string } & WorkflowExecutionOptions) {
  if (input.kind === "GOVERNED_FOLLOWUP" || input.kind === "COMPONENT_LIFECYCLE") {
    return withTenantDatabase(input.actor, () => startWorkflowInTenant(input));
  }
  return startWorkflowInTenant(input);
}

function extractProductLinks(result: unknown): Record<string, string> {
  const state = result as Record<string, unknown>;
  const keys = ["taskId", "episodeId", "sourceEpisodeId", "targetEpisodeId", "activityId", "activityStatus", "failureCode", "failureReason", "activityPlanProposalId", "activityPlanId", "runtimeDeliveryId", "attemptId", "resultAttemptId", "observationId", "resultObservationId", "capabilityResolutionId", "selectedCapabilityVersionId", "reviewId", "resultReviewId", "componentId", "componentVersionId", "evaluationId", "decisionId", "decision", "registeredCapabilityId", "registeredCapabilityVersionId"];
  return Object.fromEntries(keys.flatMap((key) => typeof state?.[key] === "string" ? [[key, state[key] as string]] : []));
}

async function resumeWorkflowInTenant(actor: Actor, threadId: string, payload: Record<string, unknown>, options: WorkflowExecutionOptions = {}) {
  return runWithExecutionControl(options.execution, async (control) => {
  if (!threadId.startsWith(`${actor.institutionId}:`)) {
    throw new DomainInvariantError("Checkpoint thread scope does not match the active institution", "TENANT_ISOLATION");
  }
  const [run] = await getDb().select().from(workflowRuns).where(and(eq(workflowRuns.threadId, threadId), eq(workflowRuns.institutionId, actor.institutionId))).limit(1);
  if (!run) throw new DomainInvariantError("Workflow is outside the actor's authorized scope", "TENANT_ISOLATION");
  const kind = requireCurrentWorkflowKind(run.workflowKind);
  if (Boolean(run.taskId) !== Boolean(run.episodeId)) {
    throw new DomainInvariantError("Task-bound workflow lineage is incomplete", "WORKFLOW_BINDING_INTEGRITY");
  }
  const expectedVersion = Number(payload.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new DomainInvariantError("Resume requires the current interrupt version", "RESUME_VERSION_REQUIRED");
  const { expectedVersion: _expectedVersion, ...resumePayload } = payload;
  void _expectedVersion;
  if (kind === "GOVERNED_FOLLOWUP") {
    const replay = await replayGovernedResumeIfExact(actor, run, threadId, expectedVersion, resumePayload);
    if (replay) return replay;
  } else if (kind === "COMPONENT_LIFECYCLE") {
    const replay = await replayComponentResumeIfExact(actor, run, threadId, expectedVersion, resumePayload);
    if (replay) return replay;
  }
  if (run.interruptType === "TEACHER_REVIEW_REQUIRED" || run.interruptType === "FOLLOWUP_RESULT_REVIEW_REQUIRED") requireRole(actor, ["TEACHER", "ADMIN"]);
  if (run.interruptType === "LEARNER_FOLLOWUP_REQUIRED") requireRole(actor, ["LEARNER"]);
  if (run.interruptType === "EXPERT_PUBLICATION_REVIEW_REQUIRED") requireRole(actor, ["EXPERT", "ADMIN"]);
  if (kind === "COMPONENT_LIFECYCLE") {
    const componentId = run.productLinks.componentId;
    const componentVersionId = run.productLinks.componentVersionId;
    const evaluationId = run.productLinks.evaluationId;
    if (!componentId || !componentVersionId || !evaluationId) throw new DomainInvariantError("Component lifecycle lacks exact ComponentAssetVersion links", "WORKFLOW_REPLAY_INTEGRITY");
    const [binding] = await getDb().select({ component: components, version: componentVersions, evaluation: componentEvaluations }).from(components)
      .innerJoin(componentVersions, and(eq(componentVersions.id, componentVersionId), eq(componentVersions.componentId, components.id)))
      .innerJoin(componentEvaluations, and(eq(componentEvaluations.id, evaluationId), eq(componentEvaluations.componentVersionId, componentVersions.id)))
      .where(eq(components.id, componentId)).limit(1);
    if (!binding || binding.component.institutionId !== actor.institutionId) throw new DomainInvariantError("Component lifecycle is outside the active institution", "TENANT_ISOLATION");
    requireCourseAccess(actor, binding.component.institutionId, binding.component.courseId);
    const publication = ComponentPublicationPayload.parse(resumePayload);
    if (publication.action === "APPROVE") {
      if (binding.evaluation.systemStatus !== "PASSED") throw new DomainInvariantError("System evaluation gates block publication", "COMPONENT_SYSTEM_GATES_BLOCKED");
      if (!humanRubricPasses(ComponentHumanRubric.parse(publication.rubric))) {
        throw new DomainInvariantError("APPROVE requires PASS attestations for domain correctness, pedagogy, safety, and reuse readiness", "HUMAN_RUBRIC_BLOCKED");
      }
      if (binding.component.assetType === "WEB_COMPONENT_ASSET") {
        const [preview] = await getDb().select({ id: componentAssetPreviews.id }).from(componentAssetPreviews).where(and(
          eq(componentAssetPreviews.componentVersionId, binding.version.id),
          eq(componentAssetPreviews.componentEvaluationId, binding.evaluation.id),
          eq(componentAssetPreviews.contentHash, binding.version.contentHash),
          eq(componentAssetPreviews.status, "SUCCEEDED"),
        )).limit(1);
        if (!preview) throw new DomainInvariantError("Authorized confirmation requires a successful exact-version learner preview", "COMPONENT_PREVIEW_REQUIRED");
      }
    }
  }
  if (run.taskId && run.episodeId) {
    const followupEpisodeId = (run.interruptType === "LEARNER_FOLLOWUP_REQUIRED" || run.interruptType === "FOLLOWUP_RESULT_REVIEW_REQUIRED")
      && typeof run.productLinks.targetEpisodeId === "string" ? run.productLinks.targetEpisodeId : run.episodeId;
    if (run.workflowKind === "GOVERNED_FOLLOWUP" && typeof run.productLinks.activityId === "string") {
      await requireGovernedFollowupScope(actor, {
        activityId: run.productLinks.activityId,
        taskId: run.taskId,
        episodeId: followupEpisodeId,
        learnerOriginated: run.interruptType === "LEARNER_FOLLOWUP_REQUIRED",
        requireActiveRuntime: run.interruptType === "LEARNER_FOLLOWUP_REQUIRED",
      });
    } else {
      await requireTaskEpisodeScope(actor, {
        taskId: run.taskId,
        episodeId: followupEpisodeId,
        learnerOriginated: run.interruptType === "LEARNER_FOLLOWUP_REQUIRED",
      });
    }
  }
  const claim = await claimWorkflowResume(run, expectedVersion);
  const started = performance.now();
  try {
    const graph = graphFor(kind, actor.institutionId, options.testFaults);
    const graphConfig = { configurable: { thread_id: threadId }, recursionLimit: 50, signal: control.signal };
    const snapshot = (kind === "GOVERNED_FOLLOWUP" || kind === "COMPONENT_LIFECYCLE") ? await graph.getState(graphConfig) : null;
    const advanced = kind === "GOVERNED_FOLLOWUP"
      ? advancedGovernedCheckpoint(run, snapshot!)
      : kind === "COMPONENT_LIFECYCLE" ? advancedComponentCheckpoint(run, snapshot!) : null;
    let result = advanced?.result
      ?? await graph.invoke(new Command({ resume: { ...resumePayload, actor } }), graphConfig);
    if (kind === "GOVERNED_FOLLOWUP") {
      result = await reconcileGovernedResume(actor, run, resumePayload, result);
    } else if (kind === "COMPONENT_LIFECYCLE") {
      result = await reconcileComponentResume(actor, run, resumePayload, result, options.testFaults?.componentPublication);
    }
    if (!advanced) {
      await options.testFaults?.afterGraphCompletion?.({ kind, runId: run.id, threadId, result });
    }
    const nextInterrupt = advanced ? advanced.nextInterrupt : interruptType(result);
    const terminal = kind === "GOVERNED_FOLLOWUP" ? governedTerminal(result) : null;
    if (!terminal) assertExecutionActive(control);
    const status = nextInterrupt ? "INTERRUPTED" : terminal?.status ?? "COMPLETED";
    const nextVersion = nextInterrupt ? expectedVersion + 1 : expectedVersion;
    const replayReceipt = kind === "GOVERNED_FOLLOWUP"
      && (run.interruptType === "LEARNER_FOLLOWUP_REQUIRED" || run.interruptType === "FOLLOWUP_RESULT_REVIEW_REQUIRED")
      && (status === "INTERRUPTED" || status === "COMPLETED")
      ? governedResumeReceiptLinks({
        actor,
        threadId,
        expectedVersion,
        interrupt: run.interruptType,
        resumePayload,
        status,
        nextInterrupt,
        nextVersion,
        result,
      })
      : kind === "COMPONENT_LIFECYCLE" && status === "COMPLETED"
        ? componentResumeReceiptLinks({ actor, threadId, expectedVersion, resumePayload, result })
        : {};
    await finalizeWorkflowResumeClaim(claim, {
      status,
      interruptType: nextInterrupt,
      interruptVersion: nextVersion,
      failure: terminal?.failure ?? null,
      metrics: { latencyMs: performance.now() - started },
      completedAt: nextInterrupt ? null : new Date(),
      productLinks: { ...run.productLinks, ...extractProductLinks(result), ...replayReceipt },
    });
    return { runId: run.id, threadId, status, interruptType: nextInterrupt, expectedVersion: nextVersion, failureCode: terminal?.code, failure: terminal?.failure, result };
  } catch (error) {
    if (error instanceof WorkflowProcessCrashForTests) throw error;
    if (error instanceof DomainInvariantError && error.code === "WORKFLOW_RESUME_LEASE_LOST") throw error;
    await finalizeWorkflowResumeClaim(claim, { status: operationalFailureStatus(error), failure: error instanceof Error ? error.message : String(error), metrics: { latencyMs: performance.now() - started }, completedAt: new Date() });
    throw error;
  }
  }, {
    acceptStoppedResult: (result) => result.status === "FAILED" || result.status === "CANCELLED",
  });
}

export async function resumeWorkflow(actor: Actor, threadId: string, payload: Record<string, unknown>, options: WorkflowExecutionOptions = {}) {
  const [run] = await getDb().select({ workflowKind: workflowRuns.workflowKind }).from(workflowRuns)
    .where(and(eq(workflowRuns.threadId, threadId), eq(workflowRuns.institutionId, actor.institutionId))).limit(1);
  if (run?.workflowKind === "GOVERNED_FOLLOWUP" || run?.workflowKind === "COMPONENT_LIFECYCLE") {
    return withTenantDatabase(actor, () => resumeWorkflowInTenant(actor, threadId, payload, options));
  }
  return resumeWorkflowInTenant(actor, threadId, payload, options);
}

export async function startDiagnosisWithTeacherReview(actor: Actor, state: Record<string, unknown> & { taskId: string; episodeId: string }, options: WorkflowExecutionOptions = {}) {
  return runWithExecutionControl(options.execution, async () => {
  const diagnosis = await startWorkflow({ kind: "DIAGNOSIS", actor, state, taskId: state.taskId, episodeId: state.episodeId, ...options });
  const result = diagnosis.result as { observationId?: string; attemptId?: string; diagnosisStatus?: string };
  if (!result.observationId || !result.attemptId) throw new Error("Diagnosis workflow did not create governed lineage");
  const teacherReview = await startWorkflow({
    kind: "TEACHER_REVIEW",
    actor,
    state: { observationId: result.observationId },
    taskId: state.taskId,
    episodeId: state.episodeId,
    ...options,
  });
  return { diagnosis, teacherReview };
  });
}

export async function getAttemptForObservation(observationId: string) {
  return (await getDb().select({ attempt: learnerAttempts }).from(diagnosticObservations).innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId)).where(eq(diagnosticObservations.id, observationId)).limit(1))[0]?.attempt ?? null;
}
