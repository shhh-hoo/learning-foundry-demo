import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "@/domain/model";
import { resolveRetryAuthority } from "@/application/commands";
import { DomainInvariantError, requireCourseAccess, requireRole } from "@/domain/invariants";
import { getDb } from "@/db/client";
import { componentVersions, components, diagnosticObservations, learnerAttempts, workflowRuns } from "@/db/schema";
import { getWorkflowCheckpointer } from "@/workflows/checkpointer";
import { buildLearnerTaskGraph } from "@/workflows/learner-task";
import { buildExplanationGraph } from "@/workflows/explanation";
import { buildDiagnosisGraph } from "@/workflows/diagnosis";
import { buildTeacherReviewGraph } from "@/workflows/teacher-review";
import { buildRetryOutcomeGraph } from "@/workflows/retry-outcome";
import { buildComponentLifecycleGraph } from "@/workflows/component-lifecycle";
import { traced } from "@/application/telemetry";
import { requireTaskEpisodeScope } from "@/application/task-scope";
import {
  assertExecutionActive,
  operationalFailureStatus,
  runWithExecutionControl,
  type ExecutionControlInput,
} from "@/application/execution-control";
import { claimWorkflowResume, finalizeWorkflowResumeClaim } from "@/application/workflow-resume-lease";
import type { LearnerTaskFaultHooks } from "@/workflows/learner-task";

type WorkflowKind = "LEARNER_TASK" | "EXPLANATION" | "DIAGNOSIS" | "TEACHER_REVIEW" | "RETRY_OUTCOME" | "COMPONENT_LIFECYCLE";

type GraphConfig = { configurable: { thread_id: string }; recursionLimit: number; signal?: AbortSignal };
type InvokableGraph = { invoke(input: unknown, config: GraphConfig): Promise<unknown> };

export type WorkflowServiceTestFaults = LearnerTaskFaultHooks & {
  afterGraphCompletion?: (input: { kind: WorkflowKind; runId: string; threadId: string; result: unknown }) => Promise<void> | void;
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

const RetryWorkflowStart = z.object({
  observationId: z.string().uuid(),
  reviewId: z.string().uuid(),
  activityType: z.literal("RETRY"),
  assignmentIdempotencyKey: z.string().min(8),
  prompt: z.string().min(1),
  scheduledFor: z.string().datetime().optional(),
});

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
  if (input.kind === "RETRY_OUTCOME") {
    const parsed = RetryWorkflowStart.parse(input.state);
    const authority = await resolveRetryAuthority(input.actor, parsed);
    assertWorkflowBinding("Task", input.taskId, authority.taskId);
    assertWorkflowBinding("Episode", input.episodeId, authority.episodeId);
    return {
      state: {
        ...parsed,
        teacherActor: input.actor,
        taskId: authority.taskId,
        episodeId: authority.episodeId,
        learnerId: authority.learnerId,
      },
      taskId: authority.taskId,
      episodeId: authority.episodeId,
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

function graphFor(kind: WorkflowKind, testFaults?: WorkflowServiceTestFaults): InvokableGraph {
  const checkpointer = getWorkflowCheckpointer();
  if (kind === "LEARNER_TASK") return buildLearnerTaskGraph(checkpointer, testFaults) as unknown as InvokableGraph;
  if (kind === "EXPLANATION") return buildExplanationGraph(checkpointer, testFaults?.explanation) as unknown as InvokableGraph;
  if (kind === "DIAGNOSIS") return buildDiagnosisGraph(checkpointer) as unknown as InvokableGraph;
  if (kind === "TEACHER_REVIEW") return buildTeacherReviewGraph(checkpointer) as unknown as InvokableGraph;
  if (kind === "RETRY_OUTCOME") return buildRetryOutcomeGraph(checkpointer) as unknown as InvokableGraph;
  return buildComponentLifecycleGraph(checkpointer) as unknown as InvokableGraph;
}

function interruptType(result: unknown): string | null {
  const interrupts = (result as { __interrupt__?: Array<{ value?: { type?: string } }> }).__interrupt__;
  return interrupts?.[0]?.value?.type ?? null;
}

export async function startWorkflow(input: { kind: WorkflowKind; actor: Actor; state: Record<string, unknown>; taskId?: string; episodeId?: string; threadId?: string } & WorkflowExecutionOptions) {
  return runWithExecutionControl(input.execution, async (control) => {
    const authorized = await authorizeWorkflowStart(input);
    const { state, taskId, episodeId } = authorized;
    const threadId = input.threadId ?? `${input.kind.toLowerCase()}:${randomUUID()}`;
    const runId = randomUUID();
    assertExecutionActive(control);
    await getDb().insert(workflowRuns).values({
      id: runId,
      threadId,
      workflowKind: input.kind,
      institutionId: input.actor.institutionId,
      taskId,
      episodeId,
      actorUserId: input.actor.userId,
      status: "RUNNING",
    });
    const started = performance.now();
    try {
      const eventState = input.kind === "EXPLANATION" ? { ...state, eventIdempotencyKey: (state as z.infer<typeof ExplanationWorkflowStart>).idempotencyKey } : state;
      const graphState = input.kind === "COMPONENT_LIFECYCLE" ? { ...eventState, workflowThreadId: threadId, actor: input.actor } : { ...eventState, actor: input.actor };
      const result = await traced(`foundry.workflow.${input.kind.toLowerCase()}`, { userId: input.actor.userId, institutionId: input.actor.institutionId, taskId: taskId ?? "", "workflow.thread_id": threadId }, () => graphFor(input.kind, input.testFaults).invoke(graphState, { configurable: { thread_id: threadId }, recursionLimit: 50, signal: control.signal }));
      await input.testFaults?.afterGraphCompletion?.({ kind: input.kind, runId, threadId, result });
      assertExecutionActive(control);
      const interrupted = interruptType(result);
      const status = interrupted ? "INTERRUPTED" : "COMPLETED";
      const interruptVersion = interrupted ? 1 : 0;
      await getDb().update(workflowRuns).set({ status, interruptType: interrupted, interruptVersion, metrics: { latencyMs: performance.now() - started }, completedAt: interrupted ? null : new Date(), productLinks: extractProductLinks(result) }).where(eq(workflowRuns.id, runId));
      return { runId, threadId, status, interruptType: interrupted, expectedVersion: interruptVersion, result };
    } catch (error) {
      if (error instanceof WorkflowProcessCrashForTests) throw error;
      await getDb().update(workflowRuns).set({ status: operationalFailureStatus(error), failure: error instanceof Error ? error.message : String(error), metrics: { latencyMs: performance.now() - started }, completedAt: new Date() }).where(eq(workflowRuns.id, runId));
      throw error;
    }
  });
}

function extractProductLinks(result: unknown): Record<string, string> {
  const state = result as Record<string, unknown>;
  const keys = ["taskId", "episodeId", "attemptId", "observationId", "reviewId", "retryId", "outcomeId", "componentId", "componentVersionId", "evaluationId", "decisionId"];
  return Object.fromEntries(keys.flatMap((key) => typeof state?.[key] === "string" ? [[key, state[key] as string]] : []));
}

export async function resumeWorkflow(actor: Actor, threadId: string, payload: Record<string, unknown>, options: WorkflowExecutionOptions = {}) {
  return runWithExecutionControl(options.execution, async (control) => {
  const [run] = await getDb().select().from(workflowRuns).where(and(eq(workflowRuns.threadId, threadId), eq(workflowRuns.institutionId, actor.institutionId))).limit(1);
  if (!run) throw new DomainInvariantError("Workflow is outside the actor's authorized scope", "TENANT_ISOLATION");
  if (run.interruptType === "TEACHER_REVIEW_REQUIRED" || run.interruptType === "RETRY_RESULT_REVIEW_REQUIRED") requireRole(actor, ["TEACHER", "ADMIN"]);
  if (run.interruptType === "LEARNER_RETRY_REQUIRED") requireRole(actor, ["LEARNER", "ADMIN"]);
  if (run.interruptType === "EXPERT_PUBLICATION_REVIEW_REQUIRED") requireRole(actor, ["EXPERT", "ADMIN"]);
  if (Boolean(run.taskId) !== Boolean(run.episodeId)) {
    throw new DomainInvariantError("Task-bound workflow lineage is incomplete", "WORKFLOW_BINDING_INTEGRITY");
  }
  if (run.taskId && run.episodeId) {
    await requireTaskEpisodeScope(actor, {
      taskId: run.taskId,
      episodeId: run.episodeId,
      learnerOriginated: run.interruptType === "LEARNER_RETRY_REQUIRED",
    });
  }
  const expectedVersion = Number(payload.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new DomainInvariantError("Resume requires the current interrupt version", "RESUME_VERSION_REQUIRED");
  const claim = await claimWorkflowResume(run, expectedVersion);
  const kind = run.workflowKind as WorkflowKind;
  const started = performance.now();
  try {
    const { expectedVersion: _expectedVersion, ...resumePayload } = payload;
    void _expectedVersion;
    const result = await graphFor(kind, options.testFaults).invoke(new Command({ resume: { ...resumePayload, actor } }), { configurable: { thread_id: threadId }, recursionLimit: 50, signal: control.signal });
    await options.testFaults?.afterGraphCompletion?.({ kind, runId: run.id, threadId, result });
    assertExecutionActive(control);
    const nextInterrupt = interruptType(result);
    const status = nextInterrupt ? "INTERRUPTED" : "COMPLETED";
    const nextVersion = nextInterrupt ? expectedVersion + 1 : expectedVersion;
    await finalizeWorkflowResumeClaim(claim, { status, interruptType: nextInterrupt, interruptVersion: nextVersion, metrics: { latencyMs: performance.now() - started }, completedAt: nextInterrupt ? null : new Date(), productLinks: { ...run.productLinks, ...extractProductLinks(result) } });
    return { runId: run.id, threadId, status, interruptType: nextInterrupt, expectedVersion: nextVersion, result };
  } catch (error) {
    if (error instanceof WorkflowProcessCrashForTests) throw error;
    if (error instanceof DomainInvariantError && error.code === "WORKFLOW_RESUME_LEASE_LOST") throw error;
    await finalizeWorkflowResumeClaim(claim, { status: operationalFailureStatus(error), failure: error instanceof Error ? error.message : String(error), metrics: { latencyMs: performance.now() - started }, completedAt: new Date() });
    throw error;
  }
  });
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
