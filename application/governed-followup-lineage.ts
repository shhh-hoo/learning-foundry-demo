import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  diagnosticObservations,
  learnerAttempts,
  learningEpisodes,
  retryAttempts,
  teacherReviews,
} from "@/db/schema";
import { DomainInvariantError } from "@/domain/invariants";
import { requireEligibleReviewDecision, requireVerifiedReviewProvenance } from "@/domain/review";

type Observation = typeof diagnosticObservations.$inferSelect;
type Attempt = typeof learnerAttempts.$inferSelect;

/**
 * Allows CAP-02–04 to consume a prior-Episode Diagnosis only through the one
 * canonical governed follow-up relation. A normal same-Episode chain remains
 * unchanged and returns null.
 */
export async function requireEpisodeDiagnosisLineage(input: {
  taskId: string;
  episodeId: string;
  observation: Observation;
  attempt: Attempt;
}) {
  if (input.attempt.taskId === input.taskId && input.attempt.episodeId === input.episodeId) return null;
  const [lineage] = await getDb().select({
    activity: retryAttempts,
    review: teacherReviews,
    sourceEpisode: learningEpisodes,
  }).from(retryAttempts)
    .innerJoin(teacherReviews, and(
      eq(teacherReviews.id, retryAttempts.teacherReviewId),
      eq(teacherReviews.observationId, retryAttempts.reviewedObservationId),
    ))
    .innerJoin(learningEpisodes, eq(learningEpisodes.id, retryAttempts.sourceEpisodeId))
    .where(and(
      eq(retryAttempts.taskId, input.taskId),
      eq(retryAttempts.targetEpisodeId, input.episodeId),
      eq(retryAttempts.originalAttemptId, input.attempt.id),
      eq(retryAttempts.reviewedObservationId, input.observation.id),
    )).limit(1);
  // Drizzle cannot alias the same Episode table in this compact query; load the
  // target separately and still validate every edge below.
  const [targetEpisode] = await getDb().select().from(learningEpisodes)
    .where(and(eq(learningEpisodes.id, input.episodeId), eq(learningEpisodes.taskId, input.taskId))).limit(1);
  if (!lineage || !targetEpisode || !lineage.activity.idempotencyKey || !lineage.activity.institutionId
    || lineage.activity.sourceEpisodeId !== input.attempt.episodeId
    || lineage.activity.activityType !== targetEpisode.purpose
    || targetEpisode.predecessorEpisodeId !== lineage.activity.sourceEpisodeId
    || lineage.sourceEpisode.taskId !== input.taskId
    || lineage.activity.status === "CANCELLED" || lineage.activity.status === "FAILED_FINAL") {
    throw new DomainInvariantError("Cross-Episode Diagnosis requires the exact active governed follow-up lineage", "FOLLOWUP_DIAGNOSIS_LINEAGE_DENIED");
  }
  const source = lineage.activity.sourceLineage as Record<string, unknown>;
  if (source.learnerAttemptId !== input.attempt.id
    || source.diagnosticObservationId !== input.observation.id
    || source.teacherReviewId !== lineage.review.id
    || source.sourceEpisodeId !== input.attempt.episodeId) {
    throw new DomainInvariantError("Governed follow-up source snapshot does not match canonical Product State", "FOLLOWUP_SOURCE_SNAPSHOT_MISMATCH");
  }
  requireVerifiedReviewProvenance(lineage.review, lineage.activity.institutionId);
  requireEligibleReviewDecision(lineage.review.decision, "Retry / Transfer / Retention orchestration");
  return lineage.activity;
}
