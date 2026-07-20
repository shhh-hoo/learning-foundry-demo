import { performance } from "node:perf_hooks";
import { createHash, randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "@/domain/model";
import { GovernedFollowupAttempt, GovernedFollowupReview, GovernedFollowupStart } from "@/domain/governed-followup";
import { commandRequestHash } from "@/application/commands";
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
import { componentVersions, components, diagnosticObservations, learnerAttempts, workflowRuns } from "@/db/schema";
import { getWorkflowCheckpointer } from "@/workflows/checkpointer";
import { buildLearnerTaskGraph } from "@/workflows/learner-task";
import { buildExplanationGraph } from "@/workflows/explanation";
import { buildDiagnosisGraph } from "@/workflows/diagnosis";
import { buildAssetRuntimeGraph } from "@/workflows/asset-runtime";
import { buildTeacherReviewGraph } from "@/workflows/teacher-review";
import { buildGovernedFollowupGraph } from "@/workflows/governed-followup";
import { buildComponentLifecycleGraph } from "@/workflows/component-lifecycle";
import { traced } from "@/application/telemetry";
import { requireGovernedFollowupScope, requireTaskEpisodeScope } from "@/application/task-scope";
import {
  assertExecutionActive,
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
  if (kind === "ASSET_RUNTIME") return buildAssetRuntimeGraph(checkpointer) as unknown as InvokableGraph;
  if (kind === "TEACHER_REVIEW") return buildTeacherReviewGraph(checkpointer) as unknown as InvokableGraph;
  if (kind === "GOVERNED_FOLLOWUP") return buildGovernedFollowupGraph(checkpointer, testFaults?.governedFollowupPlanning) as unknown as InvokableGraph;
  if (kind === "COMPONENT_LIFECYCLE") return buildComponentLifecycleGraph(checkpointer) as unknown as InvokableGraph;
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

function replayedWorkflowRun(run: typeof workflowRuns.$inferSelect) {
  return {
    runId: run.id,
    threadId: run.threadId,
    status: run.status,
    interruptType: run.interruptType,
    expectedVersion: run.interruptVersion,
    failure: run.failure,
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
    if (governedIdentity && input.threadId && input.threadId !== governedIdentity.threadId) {
      throw new DomainInvariantError("Governed follow-up thread identity is derived from its assignment key", "WORKFLOW_IDEMPOTENCY_MISMATCH");
    }
    const threadId = governedIdentity?.threadId ?? input.threadId ?? `${expectedThreadPrefix}${input.kind.toLowerCase()}:${randomUUID()}`;
    if (governedIdentity) {
      await getSql()`SELECT pg_advisory_xact_lock(hashtextextended(${threadId},0))`;
    }
    const [existingRun] = governedIdentity
      ? await getDb().select().from(workflowRuns).where(eq(workflowRuns.threadId, threadId)).limit(1)
      : [];
    if (existingRun) {
      if (existingRun.workflowKind !== input.kind || existingRun.institutionId !== input.actor.institutionId
        || existingRun.actorUserId !== input.actor.userId || existingRun.taskId !== taskId
        || existingRun.episodeId !== episodeId
        || existingRun.productLinks.startRequestHash !== governedIdentity!.requestHash) {
        throw new DomainInvariantError("Governed follow-up workflow replay conflicts with persisted authority", "WORKFLOW_IDEMPOTENCY_MISMATCH");
      }
      if (existingRun.status !== "RUNNING") return replayedWorkflowRun(existingRun);
    }
    const runId = existingRun?.id ?? randomUUID();
    const initialProductLinks: Record<string, string> = governedIdentity ? {
      startRequestHash: governedIdentity.requestHash,
      assignmentIdempotencyKey: (state as { assignment: z.infer<typeof GovernedFollowupStart> }).assignment.assignmentIdempotencyKey,
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
      let result = await traced(`foundry.workflow.${input.kind.toLowerCase()}`, { userId: input.actor.userId, institutionId: input.actor.institutionId, taskId: taskId ?? "", "workflow.thread_id": threadId }, () => graphFor(input.kind, input.actor.institutionId, input.testFaults).invoke(graphState, { configurable: { thread_id: threadId }, recursionLimit: 50, signal: control.signal }));
      if (input.kind === "GOVERNED_FOLLOWUP") {
        result = await reconcileGovernedStart(state, result, input.testFaults?.governedFollowupPlanning);
      }
      await input.testFaults?.afterGraphCompletion?.({ kind: input.kind, runId, threadId, result });
      const interrupted = interruptType(result);
      const terminal = input.kind === "GOVERNED_FOLLOWUP" ? governedTerminal(result) : null;
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
    acceptStoppedResult: (result) => result.status === "FAILED" || result.status === "CANCELLED",
  });
}

export async function startWorkflow(input: { kind: WorkflowKind; actor: Actor; state: Record<string, unknown>; taskId?: string; episodeId?: string; threadId?: string } & WorkflowExecutionOptions) {
  if (input.kind === "GOVERNED_FOLLOWUP") {
    return withTenantDatabase(input.actor, () => startWorkflowInTenant(input));
  }
  return startWorkflowInTenant(input);
}

function extractProductLinks(result: unknown): Record<string, string> {
  const state = result as Record<string, unknown>;
  const keys = ["taskId", "episodeId", "sourceEpisodeId", "targetEpisodeId", "activityId", "activityStatus", "failureCode", "failureReason", "activityPlanProposalId", "activityPlanId", "runtimeDeliveryId", "attemptId", "resultAttemptId", "observationId", "resultObservationId", "capabilityResolutionId", "selectedCapabilityVersionId", "reviewId", "resultReviewId", "componentId", "componentVersionId", "evaluationId", "decisionId"];
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
  }
  if (run.interruptType === "TEACHER_REVIEW_REQUIRED" || run.interruptType === "FOLLOWUP_RESULT_REVIEW_REQUIRED") requireRole(actor, ["TEACHER", "ADMIN"]);
  if (run.interruptType === "LEARNER_FOLLOWUP_REQUIRED") requireRole(actor, ["LEARNER"]);
  if (run.interruptType === "EXPERT_PUBLICATION_REVIEW_REQUIRED") requireRole(actor, ["EXPERT", "ADMIN"]);
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
    const advanced = kind === "GOVERNED_FOLLOWUP"
      ? advancedGovernedCheckpoint(run, await graph.getState(graphConfig))
      : null;
    let result = advanced?.result
      ?? await graph.invoke(new Command({ resume: { ...resumePayload, actor } }), graphConfig);
    if (kind === "GOVERNED_FOLLOWUP") {
      result = await reconcileGovernedResume(actor, run, resumePayload, result);
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
  if (run?.workflowKind === "GOVERNED_FOLLOWUP") {
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
