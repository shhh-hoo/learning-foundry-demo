import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { courses, learningEpisodes, learningTasks, retryAttempts } from "@/db/schema";
import type { Actor } from "@/domain/model";
import { DomainInvariantError, requireCourseAccess } from "@/domain/invariants";

export type TaskEpisodeScope = {
  task: typeof learningTasks.$inferSelect;
  episode: typeof learningEpisodes.$inferSelect;
  course: typeof courses.$inferSelect;
};

/**
 * Authoritative task-bound scope check. A Task id and Episode id are validated as
 * one relationship, rather than as two independently valid foreign keys.
 */
export async function requireTaskEpisodeScope(
  actor: Actor,
  input: { taskId: string; episodeId: string; learnerOriginated?: boolean },
): Promise<TaskEpisodeScope> {
  const [scope] = await getDb().select({
    task: learningTasks,
    episode: learningEpisodes,
    course: courses,
  }).from(learningTasks)
    .innerJoin(learningEpisodes, and(
      eq(learningEpisodes.id, input.episodeId),
      eq(learningEpisodes.taskId, learningTasks.id),
    ))
    .innerJoin(courses, eq(courses.id, learningTasks.courseId))
    .where(eq(learningTasks.id, input.taskId))
    .limit(1);

  if (!scope) {
    throw new DomainInvariantError("Episode does not belong to the Learning Task", "TASK_EPISODE_LINEAGE");
  }
  if (!scope.course.active) {
    throw new DomainInvariantError("The Task course is inactive", "COURSE_INACTIVE");
  }
  requireCourseAccess(actor, scope.task.institutionId, scope.task.courseId);
  if (
    input.learnerOriginated
    && scope.task.learnerId !== actor.userId
    && !actor.roles.includes("ADMIN")
  ) {
    throw new DomainInvariantError("Learner action does not belong to the Task learner", "WORKFLOW_OWNERSHIP");
  }
  return scope;
}

/** Generic learner writes are valid only in the currently writable GENERAL Episode. */
export async function requireWritableGeneralEpisode(
  actor: Actor,
  input: { taskId: string; episodeId: string; learnerOriginated?: boolean },
): Promise<TaskEpisodeScope> {
  const scope = await requireTaskEpisodeScope(actor, input);
  if (scope.task.status !== "OPEN") {
    throw new DomainInvariantError("The Learning Task is not open for learner writes", "TASK_NOT_WRITABLE");
  }
  if (scope.episode.status !== "ACTIVE" || scope.episode.purpose !== "GENERAL") {
    throw new DomainInvariantError("Generic learner writes require an ACTIVE GENERAL Episode", "EPISODE_NOT_WRITABLE");
  }
  return scope;
}

export type GovernedFollowupScope = TaskEpisodeScope & {
  activity: typeof retryAttempts.$inferSelect;
};

/**
 * Exact scope guard for a governed Retry / Transfer / Retention. Generic Task
 * access is insufficient because the successor Episode and its purpose are part
 * of the formal follow-up authority.
 */
export async function requireGovernedFollowupScope(
  actor: Actor,
  input: {
    activityId: string;
    taskId: string;
    episodeId: string;
    learnerOriginated?: boolean;
    requireActiveRuntime?: boolean;
    allowClosedTerminal?: boolean;
  },
): Promise<GovernedFollowupScope> {
  const scope = await requireTaskEpisodeScope(actor, input);
  const [activity] = await getDb().select().from(retryAttempts).where(and(
    eq(retryAttempts.id, input.activityId),
    eq(retryAttempts.taskId, scope.task.id),
    eq(retryAttempts.targetEpisodeId, scope.episode.id),
  )).limit(1);

  if (!activity || !activity.institutionId || !activity.courseId || !activity.sourceEpisodeId
    || !activity.targetEpisodeId || !activity.learnerId || !activity.idempotencyKey) {
    throw new DomainInvariantError("Governed follow-up Product State is missing exact scope", "FOLLOWUP_LINEAGE_INVALID");
  }
  if (activity.institutionId !== actor.institutionId
    || activity.institutionId !== scope.task.institutionId
    || activity.courseId !== scope.task.courseId
    || activity.learnerId !== scope.task.learnerId
    || activity.targetEpisodeId !== scope.episode.id
    || scope.episode.predecessorEpisodeId !== activity.sourceEpisodeId
    || scope.episode.purpose !== activity.activityType) {
    throw new DomainInvariantError("Governed follow-up Task, Episode, learner or purpose lineage is inconsistent", "FOLLOWUP_LINEAGE_INVALID");
  }
  const terminal = new Set(["REVIEWED", "ESCALATED", "CANCELLED", "FAILED_FINAL"]).has(activity.status);
  if (scope.task.status !== "OPEN" && !(input.allowClosedTerminal && terminal)) {
    throw new DomainInvariantError("Governed follow-up requires an open Learning Task", "FOLLOWUP_TASK_INELIGIBLE");
  }
  if (input.requireActiveRuntime && (scope.episode.status !== "ACTIVE"
    || !new Set(["ASSIGNED", "IN_PROGRESS", "FAILED_RECOVERABLE"]).has(activity.status))) {
    throw new DomainInvariantError("Governed follow-up runtime requires its exact ACTIVE successor Episode", "FOLLOWUP_RUNTIME_SCOPE_INACTIVE");
  }
  return { ...scope, activity };
}
