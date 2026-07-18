import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { getCheckpointSql, getDb, getSql } from "@/db/client";
import {
  componentVersions,
  components,
  capabilityVersions,
  conversationEvents,
  contextCompilations,
  capabilities,
  courses,
  diagnosticObservations,
  evidenceUnits,
  evalRuns,
  fileAssets,
  learnerAttempts,
  learningEpisodes,
  learningOutcomes,
  learningTasks,
  libraryItems,
  modelRuns,
  publicationDecisions,
  retryAttempts,
  retrievalRuns,
  scheduleItems,
  sourceRecords,
  subjects,
  teacherReviews,
  workflowRuns,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import { authorizeEvidenceUnitInstitution, authorizePersistedEvidence, evidenceAlignsToCourse } from "@/domain/evidence";
import { requireCourseAccess, requireRole } from "@/domain/invariants";

export const STALE_RESUMING_TIMEOUT_MS = 5 * 60 * 1_000;

export async function getStaleResumingRuns(actor: Actor, now = new Date()) {
  requireRole(actor, ["ENGINEER", "ADMIN"]);
  const authorizedTasks = await getDb().select({ id: learningTasks.id }).from(learningTasks).where(and(
    eq(learningTasks.institutionId, actor.institutionId),
    inArray(learningTasks.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
  ));
  if (!authorizedTasks.length) return [];
  return getDb().select().from(workflowRuns).where(and(
    eq(workflowRuns.institutionId, actor.institutionId),
    eq(workflowRuns.status, "RESUMING"),
    inArray(workflowRuns.taskId, authorizedTasks.map((task) => task.id)),
    lte(workflowRuns.resumeClaimedAt, new Date(now.getTime() - STALE_RESUMING_TIMEOUT_MS)),
  )).orderBy(workflowRuns.resumeClaimedAt);
}

export async function getLearnerWorkspace(actor: Actor) {
  requireRole(actor, ["LEARNER", "ADMIN"]);
  const db = getDb();
  const tasks = await db.select().from(learningTasks).where(and(
    eq(learningTasks.institutionId, actor.institutionId),
    eq(learningTasks.learnerId, actor.userId),
  )).orderBy(desc(learningTasks.updatedAt));
  const taskIds = tasks.map((task) => task.id);
  const events = taskIds.length ? await db.select().from(conversationEvents).where(inArray(conversationEvents.taskId, taskIds)).orderBy(conversationEvents.createdAt) : [];
  const episodes = taskIds.length ? await db.select().from(learningEpisodes).where(inArray(learningEpisodes.taskId, taskIds)) : [];
  const outcomes = taskIds.length ? await db.select().from(learningOutcomes).where(inArray(learningOutcomes.taskId, taskIds)).orderBy(desc(learningOutcomes.createdAt)) : [];
  const libraryRows = await db.select({ item: libraryItems }).from(libraryItems)
    .innerJoin(courses, eq(courses.id, libraryItems.courseId))
    .where(and(
      eq(libraryItems.learnerId, actor.userId),
      eq(courses.institutionId, actor.institutionId),
      inArray(courses.id, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
    )).orderBy(desc(libraryItems.createdAt));
  const scheduleRows = await db.select({ item: scheduleItems }).from(scheduleItems)
    .innerJoin(learningTasks, eq(learningTasks.id, scheduleItems.taskId))
    .where(and(
      eq(scheduleItems.learnerId, actor.userId),
      eq(learningTasks.institutionId, actor.institutionId),
      inArray(learningTasks.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
    )).orderBy(scheduleItems.dueAt);
  const pendingWorkflows = taskIds.length ? await db.select().from(workflowRuns).where(and(
    eq(workflowRuns.institutionId, actor.institutionId),
    eq(workflowRuns.status, "INTERRUPTED"),
    eq(workflowRuns.interruptType, "LEARNER_RETRY_REQUIRED"),
    inArray(workflowRuns.taskId, taskIds),
  )).orderBy(desc(workflowRuns.startedAt)) : [];
  const availableCourses = await db.select().from(courses).where(and(
    eq(courses.institutionId, actor.institutionId),
    inArray(courses.id, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
  ));
  const assets = taskIds.length ? await db.select().from(fileAssets).where(and(
    eq(fileAssets.institutionId, actor.institutionId),
    inArray(fileAssets.taskId, taskIds),
  )).orderBy(desc(fileAssets.createdAt)) : [];
  const capabilityRows = await db.selectDistinct({ capability: capabilities, version: capabilityVersions }).from(capabilities)
    .innerJoin(capabilityVersions, eq(capabilityVersions.id, capabilities.activeVersionId))
    .innerJoin(subjects, eq(subjects.referencePackKey, capabilities.referencePackKey))
    .innerJoin(courses, eq(courses.subjectId, subjects.id))
    .where(and(
      eq(subjects.institutionId, actor.institutionId),
      inArray(courses.id, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
    ));
  return { tasks, events, episodes, outcomes, library: libraryRows.map((row) => row.item), schedule: scheduleRows.map((row) => row.item), pendingWorkflows, courses: availableCourses, assets, capabilities: capabilityRows.map((row) => ({ ...row.capability, contract: row.version.contract })) };
}

export async function getAuthorizedEvidenceCatalog(actor: Actor, taskId: string) {
  requireRole(actor, ["LEARNER", "ADMIN"]);
  const db = getDb();
  const [scope] = await db.select({ task: learningTasks, course: courses, subject: subjects })
    .from(learningTasks)
    .innerJoin(courses, eq(courses.id, learningTasks.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .where(eq(learningTasks.id, taskId))
    .limit(1);
  if (!scope) return [];
  requireCourseAccess(actor, scope.task.institutionId, scope.task.courseId);
  if (actor.roles.includes("LEARNER") && scope.task.learnerId !== actor.userId) return [];
  const rows = await db.select({ evidence: evidenceUnits, source: sourceRecords }).from(evidenceUnits)
    .innerJoin(sourceRecords, eq(sourceRecords.id, evidenceUnits.sourceId))
    .where(eq(sourceRecords.active, true))
    .orderBy(evidenceUnits.createdAt);
  return rows.filter((row) => {
    try {
      authorizePersistedEvidence(actor, row.source, "LEARNING");
      authorizeEvidenceUnitInstitution(actor, row.evidence.institutionId);
      return row.source.courseId === scope.course.id || evidenceAlignsToCourse(row.evidence.metadata, scope.course.id, scope.subject.referencePackKey);
    } catch {
      return false;
    }
  });
}

export async function getTaskDetail(actor: Actor, taskId: string) {
  const db = getDb();
  const [task] = await db.select().from(learningTasks).where(eq(learningTasks.id, taskId)).limit(1);
  if (!task) return null;
  requireCourseAccess(actor, task.institutionId, task.courseId);
  if (actor.roles.includes("LEARNER") && task.learnerId !== actor.userId) return null;
  const episodes = await db.select().from(learningEpisodes).where(eq(learningEpisodes.taskId, taskId)).orderBy(learningEpisodes.sequence);
  const events = await db.select().from(conversationEvents).where(eq(conversationEvents.taskId, taskId)).orderBy(conversationEvents.createdAt);
  const attempts = await db.select().from(learnerAttempts).where(eq(learnerAttempts.taskId, taskId)).orderBy(desc(learnerAttempts.createdAt));
  const observations = attempts.length ? await db.select().from(diagnosticObservations).where(inArray(diagnosticObservations.attemptId, attempts.map((item) => item.id))) : [];
  const reviews = observations.length ? await db.select().from(teacherReviews).where(inArray(teacherReviews.observationId, observations.map((item) => item.id))) : [];
  const retries = attempts.length ? await db.select().from(retryAttempts).where(inArray(retryAttempts.originalAttemptId, attempts.map((item) => item.id))) : [];
  const outcomes = await db.select().from(learningOutcomes).where(eq(learningOutcomes.taskId, taskId));
  const contexts = await db.select().from(contextCompilations).where(eq(contextCompilations.taskId, taskId)).orderBy(desc(contextCompilations.createdAt)).limit(10);
  const assets = await db.select().from(fileAssets).where(and(eq(fileAssets.taskId, taskId), eq(fileAssets.institutionId, actor.institutionId))).orderBy(desc(fileAssets.createdAt));
  const sources = assets.some((asset) => asset.sourceId) ? await db.select().from(sourceRecords).where(inArray(sourceRecords.id, assets.flatMap((asset) => asset.sourceId ? [asset.sourceId] : []))) : [];
  return { task, episodes, events, attempts, observations, reviews, retries, outcomes, contexts, assets, sources };
}

export async function getTeacherWorkspace(actor: Actor) {
  requireRole(actor, ["TEACHER", "ADMIN"]);
  const sql = getSql();
  const authorizedTasks = await getDb().select({ id: learningTasks.id }).from(learningTasks).where(and(
    eq(learningTasks.institutionId, actor.institutionId),
    inArray(learningTasks.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
  ));
  const authorizedTaskIds = authorizedTasks.map((task) => task.id);
  const queue = await sql<Array<Record<string, unknown>>>`
    SELECT o.id AS observation_id, o.status, o.failure_code, o.summary, o.first_invalid_step,
           a.id AS attempt_id, a.prompt, a.response, a.source_refs, a.capability_id, a.file_asset_id, o.capability_version_id, o.observation_source, o.structured_result,
           f.original_name AS file_name, f.media_type AS file_media_type, f.ingestion_status AS file_ingestion_status,
           f.interpretation_status AS file_interpretation_status, f.extraction_text AS file_extraction_text, f.interpretation AS file_interpretation,
           t.id AS task_id, t.title AS task_title,
           (SELECT e.id FROM foundry_product.learning_episodes e WHERE e.task_id = t.id ORDER BY e.sequence DESC LIMIT 1) AS episode_id,
           u.name AS learner_name,
           (SELECT count(*)::int FROM foundry_product.teacher_reviews r WHERE r.observation_id = o.id) AS review_count,
           (SELECT r.id FROM foundry_product.teacher_reviews r WHERE r.observation_id = o.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS review_id,
           (SELECT r.decision FROM foundry_product.teacher_reviews r WHERE r.observation_id = o.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS review_decision,
           (SELECT w.thread_id FROM foundry_operational.workflow_runs w WHERE w.workflow_kind = 'TEACHER_REVIEW' AND w.product_links->>'observationId' = o.id::text AND w.status = 'INTERRUPTED' ORDER BY w.created_at DESC LIMIT 1) AS waiting_thread_id,
           (SELECT w.interrupt_version FROM foundry_operational.workflow_runs w WHERE w.workflow_kind = 'TEACHER_REVIEW' AND w.product_links->>'observationId' = o.id::text AND w.status = 'INTERRUPTED' ORDER BY w.created_at DESC LIMIT 1) AS waiting_interrupt_version
    FROM foundry_product.diagnostic_observations o
    JOIN foundry_product.learner_attempts a ON a.id = o.attempt_id
    JOIN foundry_product.learning_tasks t ON t.id = a.task_id
    JOIN foundry_product.users u ON u.id = a.learner_id
    LEFT JOIN foundry_product.file_assets f ON f.id = a.file_asset_id
    WHERE t.institution_id = ${actor.institutionId}
      AND t.course_id = ANY(${actor.courseIds}::uuid[])
    ORDER BY (SELECT count(*) FROM foundry_product.teacher_reviews r WHERE r.observation_id = o.id), o.created_at DESC
  `;
  const patterns = await sql<Array<Record<string, unknown>>>`
    SELECT o.failure_code AS pattern, count(*)::int AS count,
           count(DISTINCT a.learner_id)::int AS learners
    FROM foundry_product.diagnostic_observations o
    JOIN foundry_product.learner_attempts a ON a.id = o.attempt_id
    JOIN foundry_product.learning_tasks t ON t.id = a.task_id
    WHERE t.institution_id = ${actor.institutionId}
      AND t.course_id = ANY(${actor.courseIds}::uuid[])
      AND o.observation_source = 'CAPABILITY'
      AND o.failure_code IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM foundry_product.teacher_reviews r
        WHERE r.observation_id = o.id
      )
    GROUP BY o.failure_code
    ORDER BY count(*) DESC
  `;
  const retries = await getDb().select({ retry: retryAttempts }).from(retryAttempts)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, retryAttempts.originalAttemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .where(and(eq(learningTasks.institutionId, actor.institutionId), inArray(learningTasks.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"])))
    .orderBy(desc(retryAttempts.createdAt));
  const pendingWorkflows = authorizedTaskIds.length ? await getDb().select().from(workflowRuns).where(and(
    eq(workflowRuns.institutionId, actor.institutionId),
    eq(workflowRuns.status, "INTERRUPTED"),
    inArray(workflowRuns.taskId, authorizedTaskIds),
  )).orderBy(desc(workflowRuns.startedAt)) : [];
  const sourceReviews = await getDb().select({ source: sourceRecords, asset: fileAssets, task: learningTasks })
    .from(sourceRecords)
    .innerJoin(fileAssets, eq(fileAssets.sourceId, sourceRecords.id))
    .innerJoin(learningTasks, eq(learningTasks.id, fileAssets.taskId))
    .where(and(
      eq(sourceRecords.institutionId, actor.institutionId),
      eq(fileAssets.purpose, "LEARNING_MATERIAL"),
      inArray(fileAssets.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
    )).orderBy(desc(fileAssets.createdAt));
  return { queue, patterns, retries, pendingWorkflows, sourceReviews };
}

export async function getFoundryWorkspace(actor: Actor) {
  requireRole(actor, ["EXPERT", "ADMIN"]);
  const db = getDb();
  const candidateRows = await db.select({ component: components, version: componentVersions })
    .from(components)
    .leftJoin(componentVersions, eq(componentVersions.componentId, components.id))
    .where(eq(components.institutionId, actor.institutionId))
    .orderBy(desc(componentVersions.createdAt));
  const decisions = await db.select({ decision: publicationDecisions }).from(publicationDecisions)
    .innerJoin(componentVersions, eq(componentVersions.id, publicationDecisions.componentVersionId))
    .innerJoin(components, eq(components.id, componentVersions.componentId))
    .where(eq(components.institutionId, actor.institutionId))
    .orderBy(desc(publicationDecisions.createdAt));
  const reviewedPatterns = await getSql()<Array<Record<string, unknown>>>`
    SELECT o.failure_code AS pattern, count(*)::int AS count, max(r.created_at) AS last_reviewed_at,
           (array_agg(o.id ORDER BY r.created_at DESC, o.id DESC))[1]::text AS observation_id
    FROM foundry_product.diagnostic_observations o
    JOIN LATERAL (
      SELECT reviewed.created_at
      FROM foundry_product.teacher_reviews reviewed
      WHERE reviewed.observation_id = o.id
      ORDER BY reviewed.created_at DESC, reviewed.id DESC
      LIMIT 1
    ) r ON true
    JOIN foundry_product.learner_attempts a ON a.id = o.attempt_id
    JOIN foundry_product.learning_tasks t ON t.id = a.task_id
    WHERE t.institution_id = ${actor.institutionId}
      AND t.course_id = ANY(${actor.courseIds}::uuid[])
      AND o.observation_source = 'CAPABILITY'
      AND o.failure_code IS NOT NULL
    GROUP BY o.failure_code
    ORDER BY count(*) DESC
  `;
  const candidateSources = await getSql()<Array<Record<string, unknown>>>`
    SELECT o.id AS observation_id, o.observation_source, o.summary,
           t.id AS task_id, t.title AS task_title, current_review.decision AS review_decision
    FROM foundry_product.diagnostic_observations o
    JOIN foundry_product.learner_attempts a ON a.id = o.attempt_id
    JOIN foundry_product.learning_tasks t ON t.id = a.task_id
    JOIN LATERAL (
      SELECT r.decision
      FROM foundry_product.teacher_reviews r
      WHERE r.observation_id = o.id
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1
    ) current_review ON true
    WHERE t.institution_id = ${actor.institutionId}
      AND t.course_id = ANY(${actor.courseIds}::uuid[])
      AND current_review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')
    ORDER BY o.created_at DESC
  `;
  const pendingWorkflows = await db.select().from(workflowRuns).where(and(eq(workflowRuns.institutionId, actor.institutionId), eq(workflowRuns.workflowKind, "COMPONENT_LIFECYCLE"), eq(workflowRuns.status, "INTERRUPTED"))).orderBy(desc(workflowRuns.startedAt));
  return { candidates: candidateRows, decisions, reviewedPatterns, candidateSources, pendingWorkflows };
}

export async function getEngineeringWorkspace(actor: Actor) {
  requireRole(actor, ["ENGINEER", "ADMIN"]);
  const db = getDb();
  const authorizedTasks = await db.select({ id: learningTasks.id }).from(learningTasks).where(and(
    eq(learningTasks.institutionId, actor.institutionId),
    inArray(learningTasks.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
  ));
  const taskIds = authorizedTasks.map((task) => task.id);
  const runs = await db.select().from(workflowRuns).where(and(eq(workflowRuns.institutionId, actor.institutionId), taskIds.length ? inArray(workflowRuns.taskId, taskIds) : eq(workflowRuns.taskId, "00000000-0000-0000-0000-000000000000"))).orderBy(desc(workflowRuns.startedAt)).limit(50);
  const evaluations = await db.select().from(evalRuns).where(eq(evalRuns.institutionId, actor.institutionId)).orderBy(desc(evalRuns.createdAt)).limit(20);
  const retrieval = taskIds.length ? await db.select().from(retrievalRuns).where(and(eq(retrievalRuns.institutionId, actor.institutionId), inArray(retrievalRuns.taskId, taskIds))).orderBy(desc(retrievalRuns.createdAt)).limit(50) : [];
  const models = await db.select().from(modelRuns).where(eq(modelRuns.institutionId, actor.institutionId)).orderBy(desc(modelRuns.createdAt)).limit(50);
  const staleResumingRuns = await getStaleResumingRuns(actor);
  let checkpointCounts: Array<Record<string, unknown>> = [];
  try {
    checkpointCounts = await getCheckpointSql()<Array<Record<string, unknown>>>`
      SELECT 'checkpoints' AS table_name, count(*)::int AS count FROM langgraph_checkpoint.checkpoints
      UNION ALL SELECT 'checkpoint_writes', count(*)::int FROM langgraph_checkpoint.checkpoint_writes
      UNION ALL SELECT 'checkpoint_blobs', count(*)::int FROM langgraph_checkpoint.checkpoint_blobs
    `;
  } catch {
    checkpointCounts = [{ table_name: "checkpoint_schema", count: 0, status: "NOT_INITIALIZED" }];
  }
  return {
    runs,
    evaluations,
    retrieval,
    models,
    staleResumingRuns,
    checkpointCounts,
    serviceStatus: {
      model: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY ? "CONFIGURED_NOT_VERIFIED" : "UNAVAILABLE",
      embeddingRetrieval: process.env.OPENAI_API_KEY ? "CONFIGURED_NOT_VERIFIED" : "UNAVAILABLE",
      reranker: process.env.COHERE_API_KEY ? "CONFIGURED_NOT_VERIFIED" : "UNAVAILABLE",
      multimodalInterpretation: process.env.OPENAI_API_KEY ? "CONFIGURED_NOT_VERIFIED" : "UNAVAILABLE",
      externalTelemetry: process.env.LANGSMITH_TRACING === "true" ? "CONFIGURED_NOT_VERIFIED" : "UNAVAILABLE",
      deterministicChemistryCapabilities: "AVAILABLE",
      productEval: "UNAVAILABLE",
      pedagogyEval: "UNAVAILABLE",
      learningEffectivenessEval: "UNAVAILABLE",
      automatedResumeCrashRecovery: "NOT_IMPLEMENTED",
      managedDatabaseTenantPolicy: "NOT_CONFIGURED",
      publicPreview: "BLOCKED",
    },
  };
}
