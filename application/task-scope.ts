import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { courses, learningEpisodes, learningTasks } from "@/db/schema";
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
