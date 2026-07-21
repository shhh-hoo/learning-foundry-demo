import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb, getSql, getTenantCheckpointSql } from "@/db/client";
import {
  activityPlanProposals,
  activityPlans,
  runtimeDeliveries,
  componentVersions,
  components,
  componentDeliveries,
  componentEvaluations,
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
  transferActivities,
  retentionReviews,
  workflowRuns,
  componentAssetPreviews,
  capabilityAvailabilityDecisions,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import { authorizeEvidenceUnitInstitution, authorizePersistedEvidence, evidenceAlignsToCourse } from "@/domain/evidence";
import { requireCourseAccess, requireRole } from "@/domain/invariants";
import { learnerCapabilityDescriptorsForCourse } from "@/application/capabilities";

export async function getRecoverableResumingRuns(actor: Actor, now = new Date()) {
  requireRole(actor, ["ENGINEER", "ADMIN"]);
  const authorizedTasks = await getDb().select({ id: learningTasks.id }).from(learningTasks).where(and(
    eq(learningTasks.institutionId, actor.institutionId),
    inArray(learningTasks.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
  ));
  const authorizedComponents = await getDb().select({ id: components.id }).from(components).where(and(
    eq(components.institutionId, actor.institutionId),
    inArray(components.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
  ));
  const taskIds = new Set(authorizedTasks.map((task) => task.id));
  const componentIds = new Set(authorizedComponents.map((component) => component.id));
  const rows = await getDb().select().from(workflowRuns).where(and(
    eq(workflowRuns.institutionId, actor.institutionId),
    eq(workflowRuns.status, "RESUMING"),
    lte(workflowRuns.resumeLeaseExpiresAt, now),
  )).orderBy(workflowRuns.resumeLeaseExpiresAt);
  return rows
    .filter((run) => run.taskId ? taskIds.has(run.taskId) : Boolean(run.productLinks.componentId && componentIds.has(run.productLinks.componentId)))
    .map((run) => ({ ...run, recoveryStatus: "RECLAIMABLE" as const }));
}

/** Compatibility name for existing Engineering consumers. Returned claims are recoverable, not permanently stuck. */
export const getStaleResumingRuns = getRecoverableResumingRuns;

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
    eq(workflowRuns.interruptType, "LEARNER_FOLLOWUP_REQUIRED"),
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
  return { tasks, events, episodes, outcomes, library: libraryRows.map((row) => row.item), schedule: scheduleRows.map((row) => row.item), pendingWorkflows, courses: availableCourses, assets };
}

export async function getLearnerCapabilitiesForCourse(actor: Actor, courseId: string) {
  requireRole(actor, ["LEARNER", "ADMIN"]);
  const rows = await getDb().selectDistinct({
    courseId: courses.id,
    capabilityKey: capabilities.key,
    capabilityVersionId: capabilityVersions.id,
    referencePackKey: capabilities.referencePackKey,
    versionStatus: capabilityVersions.status,
  }).from(courses)
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .innerJoin(capabilities, eq(capabilities.referencePackKey, subjects.referencePackKey))
    .innerJoin(capabilityVersions, eq(capabilityVersions.id, capabilities.activeVersionId))
    .where(and(
      eq(courses.id, courseId),
      eq(courses.institutionId, actor.institutionId),
      inArray(courses.id, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
      eq(capabilityVersions.status, "ACTIVE"),
    ));
  return learnerCapabilityDescriptorsForCourse(rows, courseId).map((descriptor) => ({
    ...descriptor,
    capabilityVersionId: rows.find((row) => row.capabilityKey === descriptor.publicKey)?.capabilityVersionId ?? "",
  }));
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
  const followupContracts = retries.length ? await db.select({
    activityId: retryAttempts.id,
    activityType: retryAttempts.activityType,
    transferContractVersion: transferActivities.contractVersion,
    transferDeclaration: transferActivities.declaration,
    transferChangedDimensions: transferActivities.changedDimensions,
    retentionContractVersion: retentionReviews.contractVersion,
    retentionDueAt: retentionReviews.dueAt,
    retentionDeclaredDelaySeconds: retentionReviews.declaredDelaySeconds,
    retentionInterveningExposure: retentionReviews.interveningExposure,
    retentionContentEquivalence: retentionReviews.contentEquivalence,
    retentionAssistancePolicy: retentionReviews.assistancePolicy,
  }).from(retryAttempts)
    .leftJoin(transferActivities, eq(transferActivities.activityId, retryAttempts.id))
    .leftJoin(retentionReviews, eq(retentionReviews.activityId, retryAttempts.id))
    .where(inArray(retryAttempts.id, retries.map((retry) => retry.id))) : [];
  const followupPlans = retries.length ? await db.select({
    activityId: retryAttempts.id,
    capabilityKey: capabilities.key,
    capabilityId: capabilities.id,
    capabilityVersionId: activityPlanProposals.selectedCapabilityVersionId,
  }).from(retryAttempts)
    .innerJoin(activityPlanProposals, eq(activityPlanProposals.id, retryAttempts.activityPlanProposalId))
    .innerJoin(capabilities, eq(capabilities.id, activityPlanProposals.selectedCapabilityId))
    .where(inArray(retryAttempts.id, retries.map((retry) => retry.id))) : [];
  const outcomes = await db.select().from(learningOutcomes).where(eq(learningOutcomes.taskId, taskId));
  const contexts = await db.select().from(contextCompilations).where(eq(contextCompilations.taskId, taskId)).orderBy(desc(contextCompilations.createdAt)).limit(10);
  const assets = await db.select().from(fileAssets).where(and(eq(fileAssets.taskId, taskId), eq(fileAssets.institutionId, actor.institutionId))).orderBy(desc(fileAssets.createdAt));
  const sources = assets.some((asset) => asset.sourceId) ? await db.select().from(sourceRecords).where(inArray(sourceRecords.id, assets.flatMap((asset) => asset.sourceId ? [asset.sourceId] : []))) : [];
  const componentSupport = await db.select({ delivery: componentDeliveries, component: components, version: componentVersions })
    .from(componentDeliveries)
    .innerJoin(components, eq(components.id, componentDeliveries.componentId))
    .innerJoin(componentVersions, eq(componentVersions.id, componentDeliveries.componentVersionId))
    .where(and(eq(componentDeliveries.taskId, taskId), eq(componentDeliveries.institutionId, actor.institutionId)))
    .orderBy(desc(componentDeliveries.createdAt));
  const webComponentActivities = await db.select({
    proposal: activityPlanProposals,
    capability: capabilities,
    capabilityVersion: capabilityVersions,
    component: components,
    componentVersion: componentVersions,
    activityPlan: activityPlans,
    delivery: runtimeDeliveries,
  }).from(activityPlanProposals)
    .innerJoin(capabilityVersions, eq(capabilityVersions.id, activityPlanProposals.selectedCapabilityVersionId))
    .innerJoin(capabilities, eq(capabilities.id, capabilityVersions.capabilityId))
    .innerJoin(components, eq(components.registeredCapabilityVersionId, capabilityVersions.id))
    .innerJoin(componentVersions, eq(componentVersions.id, capabilityVersions.componentAssetVersionId))
    .leftJoin(activityPlans, eq(activityPlans.activityPlanProposalId, activityPlanProposals.id))
    .leftJoin(runtimeDeliveries, eq(runtimeDeliveries.activityPlanId, activityPlans.id))
    .where(and(eq(activityPlanProposals.taskId, taskId), eq(activityPlanProposals.state, "READY"), eq(components.institutionId, actor.institutionId), eq(components.assetType, "WEB_COMPONENT_ASSET")))
    .orderBy(desc(activityPlanProposals.createdAt), desc(runtimeDeliveries.attemptNumber));
  return { task, episodes, events, attempts, observations, reviews, retries, followupContracts, followupPlans, outcomes, contexts, assets, sources, componentSupport, webComponentActivities };
}

export async function getTeacherWorkspace(actor: Actor) {
  requireRole(actor, ["TEACHER", "ADMIN"]);
  const db = getDb();
  const sql = getSql();
  const authorizedTasks = await getDb().select({ id: learningTasks.id }).from(learningTasks).where(and(
    eq(learningTasks.institutionId, actor.institutionId),
    inArray(learningTasks.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
  ));
  const authorizedTaskIds = authorizedTasks.map((task) => task.id);
  const queue = await sql<Array<Record<string, unknown>>>`
    SELECT o.id AS observation_id, o.status, o.failure_code, o.summary, o.first_invalid_step,
           a.id AS attempt_id, a.prompt, a.response, a.source_refs, a.capability_id, a.file_asset_id, a.modality,
           o.capability_version_id, o.observation_source, o.structured_result,
           capability.key AS capability_key, version.implementation_key,
           f.original_name AS file_name, f.media_type AS file_media_type, f.ingestion_status AS file_ingestion_status,
           f.interpretation_status AS file_interpretation_status, f.extraction_text AS file_extraction_text, f.interpretation AS file_interpretation,
           t.id AS task_id, t.course_id, t.title AS task_title,
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
    LEFT JOIN foundry_product.capability_versions version ON version.id = o.capability_version_id
    LEFT JOIN foundry_product.capabilities capability ON capability.id = version.capability_id
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
      AND o.superseded_by_id IS NULL
      AND EXISTS (
        SELECT 1 FROM foundry_product.teacher_reviews r
        WHERE r.observation_id = o.id
          AND r.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')
          AND r.actor_provenance->>'userId' = r.teacher_id::text
          AND r.actor_provenance->>'institutionId' = t.institution_id::text
          AND length(COALESCE(r.actor_provenance->>'sessionId', '')) > 0
          AND COALESCE(r.actor_provenance->>'authMethod', '') NOT LIKE 'migrated-%'
      )
    GROUP BY o.failure_code
    ORDER BY count(*) DESC
  `;
  const retries = await getDb().select({
    retry: retryAttempts,
    task: learningTasks,
    transfer: transferActivities,
    retention: retentionReviews,
    resultReview: teacherReviews,
  }).from(retryAttempts)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, retryAttempts.originalAttemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .leftJoin(transferActivities, eq(transferActivities.activityId, retryAttempts.id))
    .leftJoin(retentionReviews, eq(retentionReviews.activityId, retryAttempts.id))
    .leftJoin(teacherReviews, eq(teacherReviews.id, retryAttempts.resultReviewId))
    .where(and(eq(learningTasks.institutionId, actor.institutionId), inArray(learningTasks.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"])))
    .orderBy(desc(retryAttempts.createdAt));
  const pendingWorkflows = authorizedTaskIds.length ? await getDb().select().from(workflowRuns).where(and(
    eq(workflowRuns.institutionId, actor.institutionId),
    eq(workflowRuns.status, "INTERRUPTED"),
    eq(workflowRuns.interruptType, "FOLLOWUP_RESULT_REVIEW_REQUIRED"),
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
  const componentSupport = await getSql()<Array<Record<string, unknown>>>`
    SELECT o.id AS observation_id, c.id AS component_id, c.title AS component_title,
           v.id AS component_version_id, v.version AS component_version, v.content,
           d.id AS delivery_id, d.created_at AS delivered_at
    FROM foundry_product.diagnostic_observations o
    JOIN foundry_product.learner_attempts a ON a.id = o.attempt_id
    JOIN foundry_product.learning_tasks t ON t.id = a.task_id
    JOIN LATERAL (
      SELECT r.* FROM foundry_product.teacher_reviews r
      WHERE r.observation_id = o.id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    ) current_review ON true
    JOIN foundry_product.components c ON c.institution_id = t.institution_id
      AND c.course_id = t.course_id AND c.capability_id = a.capability_id
      AND c.failure_code = o.failure_code AND c.status = 'PUBLISHED'
    JOIN foundry_product.component_versions v ON v.id = c.active_version_id
      AND v.component_id = c.id AND v.status = 'PUBLISHED'
    LEFT JOIN LATERAL (
      SELECT delivered.id, delivered.created_at
      FROM foundry_product.component_deliveries delivered
      WHERE delivered.observation_id = o.id AND delivered.component_version_id = v.id
      ORDER BY delivered.created_at DESC LIMIT 1
    ) d ON true
    WHERE t.institution_id = ${actor.institutionId}
      AND t.course_id = ANY(${actor.courseIds}::uuid[])
      AND o.observation_source = 'CAPABILITY' AND o.failure_code IS NOT NULL
      AND o.superseded_by_id IS NULL
      AND current_review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')
      AND current_review.actor_provenance->>'userId' = current_review.teacher_id::text
      AND current_review.actor_provenance->>'institutionId' = t.institution_id::text
  `;
  const deliveries = await db.select({ delivery: componentDeliveries, component: components, version: componentVersions })
    .from(componentDeliveries)
    .innerJoin(components, eq(components.id, componentDeliveries.componentId))
    .innerJoin(componentVersions, eq(componentVersions.id, componentDeliveries.componentVersionId))
    .where(and(
      eq(componentDeliveries.institutionId, actor.institutionId),
      inArray(componentDeliveries.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
    )).orderBy(desc(componentDeliveries.createdAt));
  const teacherCommandEnabled = actor.roles.includes("TEACHER");
  const assignmentCourses = teacherCommandEnabled ? await sql<Array<Record<string, unknown>>>`
    SELECT course.id, course.code, course.name
    FROM foundry_product.courses course
    JOIN foundry_product.course_enrollments enrollment ON enrollment.institution_id=course.institution_id
      AND enrollment.course_id=course.id AND enrollment.user_id=${actor.userId} AND enrollment.role='TEACHER'
    JOIN foundry_product.institution_memberships membership ON membership.institution_id=course.institution_id
      AND membership.user_id=${actor.userId} AND membership.role='TEACHER'
    WHERE course.institution_id=${actor.institutionId} AND course.active
      AND course.id=ANY(${actor.courseIds}::uuid[])
    ORDER BY course.code
  ` : [];
  const assignmentLearners = teacherCommandEnabled ? await sql<Array<Record<string, unknown>>>`
    SELECT enrollment.course_id, learner.id, learner.name
    FROM foundry_product.course_enrollments enrollment
    JOIN foundry_product.courses course ON course.id=enrollment.course_id AND course.institution_id=enrollment.institution_id AND course.active
    JOIN foundry_product.course_enrollments teacher_enrollment ON teacher_enrollment.institution_id=enrollment.institution_id
      AND teacher_enrollment.course_id=enrollment.course_id AND teacher_enrollment.user_id=${actor.userId} AND teacher_enrollment.role='TEACHER'
    JOIN foundry_product.institution_memberships teacher_membership ON teacher_membership.institution_id=enrollment.institution_id
      AND teacher_membership.user_id=${actor.userId} AND teacher_membership.role='TEACHER'
    JOIN foundry_product.institution_memberships membership ON membership.institution_id=enrollment.institution_id
      AND membership.user_id=enrollment.user_id AND membership.role='LEARNER'
    JOIN foundry_product.learner_profiles profile ON profile.institution_id=enrollment.institution_id AND profile.learner_id=enrollment.user_id
    JOIN foundry_product.users learner ON learner.id=enrollment.user_id
    WHERE enrollment.institution_id=${actor.institutionId} AND enrollment.role='LEARNER'
      AND enrollment.course_id=ANY(${actor.courseIds}::uuid[])
    ORDER BY enrollment.course_id, learner.name
  ` : [];
  const assignmentCapabilities = teacherCommandEnabled ? await sql<Array<Record<string, unknown>>>`
    SELECT course.id AS course_id, capability.id, capability.key, capability.name
    FROM foundry_product.courses course
    JOIN foundry_product.course_enrollments teacher_enrollment ON teacher_enrollment.institution_id=course.institution_id
      AND teacher_enrollment.course_id=course.id AND teacher_enrollment.user_id=${actor.userId} AND teacher_enrollment.role='TEACHER'
    JOIN foundry_product.institution_memberships teacher_membership ON teacher_membership.institution_id=course.institution_id
      AND teacher_membership.user_id=${actor.userId} AND teacher_membership.role='TEACHER'
    JOIN foundry_product.subjects subject ON subject.id=course.subject_id
    JOIN foundry_product.capabilities capability ON capability.reference_pack_key=subject.reference_pack_key
    JOIN foundry_product.capability_versions version ON version.id=capability.active_version_id AND version.status='ACTIVE'
    WHERE course.institution_id=${actor.institutionId} AND course.active AND course.id=ANY(${actor.courseIds}::uuid[])
    ORDER BY course.id, capability.name
  ` : [];
  const assignments = teacherCommandEnabled ? await sql<Array<Record<string, unknown>>>`
    SELECT assignment.id, assignment.course_id, assignment.learner_id, assignment.task_id,
      assignment.status, assignment.instructions, assignment.completion_rule, assignment.due_at,
      assignment.actor_provenance, assignment.created_at, task.title, task.goal, learner.name AS learner_name
    FROM foundry_product.teacher_assignments assignment
    JOIN foundry_product.learning_tasks task ON task.id=assignment.task_id
    JOIN foundry_product.users learner ON learner.id=assignment.learner_id
    WHERE assignment.institution_id=${actor.institutionId} AND assignment.teacher_id=${actor.userId}
      AND assignment.course_id=ANY(${actor.courseIds}::uuid[])
    ORDER BY assignment.created_at DESC, assignment.id DESC LIMIT 20
  ` : [];
  const runtimeInspections = await sql<Array<Record<string, unknown>>>`
    SELECT delivery.id AS runtime_delivery_id, delivery.status AS runtime_status, delivery.started_at, delivery.finished_at,
      delivery.request_hash, delivery.output_hash, delivery.normalized_output, delivery.normalized_error,
      task.id AS task_id, task.course_id, task.title AS task_title, task.goal AS task_goal, task.status AS task_status,
      episode.id AS episode_id, episode.status AS episode_status, learner.id AS learner_id, learner.name AS learner_name,
      attempt.id AS attempt_id, attempt.prompt, attempt.response, attempt.structured_input, attempt.source_refs,
      attempt.assistance_provenance, attempt.content_hash AS attempt_content_hash,
      plan.id AS activity_plan_id, plan.input_hash AS activity_plan_input_hash, plan.evidence_provenance,
      diagnosis.id AS diagnosis_id, diagnosis.status AS diagnosis_status, diagnosis.summary AS diagnosis_summary,
      diagnosis.structured_result AS diagnosis_result, diagnosis.input_lineage AS diagnosis_input_lineage,
      diagnosis.output_lineage AS diagnosis_output_lineage, diagnosis.superseded_by_id,
      context.id AS context_compilation_id, context.snapshot_hash AS context_snapshot_hash,
      resolution.id AS capability_resolution_id, resolution.decision AS resolution_decision, resolution.selection_rationale,
      capability.id AS capability_id, capability.key AS capability_key, capability.name AS capability_name,
      version.id AS capability_version_id, version.version AS capability_version, version.content_hash AS capability_version_content_hash,
      delivery.runtime_contract_hash,
      NOT EXISTS (SELECT 1 FROM foundry_product.runtime_deliveries newer WHERE newer.task_id=delivery.task_id AND newer.episode_id=delivery.episode_id AND (newer.started_at,newer.id)>(delivery.started_at,delivery.id)) AS is_latest_delivery,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', event.id, 'sequence', event.sequence, 'eventKey', event.event_key, 'eventType', event.event_type,
        'actorType', event.actor_type, 'actorUserId', event.actor_user_id, 'payload', event.payload,
        'evidenceRefs', event.evidence_refs, 'createdAt', event.created_at
      ) ORDER BY event.sequence) FROM foundry_product.learning_events event WHERE event.runtime_delivery_id=delivery.id),'[]'::jsonb) AS learning_events,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', intervention.id, 'actionType', intervention.action_type, 'reason', intervention.reason,
        'constraintCapabilityId', intervention.constraint_capability_id, 'constraintCapabilityKey', intervention.constraint_capability_key_snapshot,
        'actorProvenance', intervention.actor_provenance, 'targetLineage', intervention.target_lineage, 'createdAt', intervention.created_at
      ) ORDER BY intervention.created_at, intervention.id) FROM foundry_product.teacher_interventions intervention WHERE intervention.runtime_delivery_id=delivery.id),'[]'::jsonb) AS interventions
    FROM foundry_product.runtime_deliveries delivery
    JOIN foundry_product.activity_plans plan ON plan.id=delivery.activity_plan_id
    JOIN foundry_product.learner_attempts attempt ON attempt.runtime_delivery_id=delivery.id AND attempt.activity_plan_id=plan.id
    JOIN foundry_product.diagnostic_observations diagnosis ON diagnosis.id=plan.diagnostic_observation_id
    JOIN foundry_product.context_compilations context ON context.id=plan.context_compilation_id
    JOIN foundry_product.capability_resolutions resolution ON resolution.id=plan.capability_resolution_id
    JOIN foundry_product.capabilities capability ON capability.id=delivery.capability_id
    JOIN foundry_product.capability_versions version ON version.id=delivery.capability_version_id
    JOIN foundry_product.learning_tasks task ON task.id=delivery.task_id
    JOIN foundry_product.learning_episodes episode ON episode.id=delivery.episode_id
    JOIN foundry_product.users learner ON learner.id=delivery.learner_id
    WHERE delivery.institution_id=${actor.institutionId} AND delivery.course_id=ANY(${actor.courseIds}::uuid[])
      AND delivery.status IN ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED')
    ORDER BY delivery.started_at DESC, delivery.id DESC LIMIT 30
  `;
  return {
    queue, patterns, retries, pendingWorkflows, sourceReviews, componentSupport, deliveries,
    teacherCommandEnabled, assignmentCourses, assignmentLearners, assignmentCapabilities, assignments, runtimeInspections,
  };
}

export async function getFoundryWorkspace(actor: Actor) {
  requireRole(actor, ["EXPERT", "ADMIN"]);
  const db = getDb();
  const candidateBaseRows = await db.select({ component: components, version: componentVersions, capability: capabilities })
    .from(components)
    .leftJoin(componentVersions, eq(componentVersions.componentId, components.id))
    .leftJoin(capabilities, eq(capabilities.id, components.capabilityId))
    .where(and(
      eq(components.institutionId, actor.institutionId),
      inArray(components.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
    ))
    .orderBy(desc(componentVersions.createdAt));
  const versionIds = candidateBaseRows.flatMap(({ version }) => version ? [version.id] : []);
  const evaluationRows = versionIds.length ? await db.select().from(componentEvaluations)
    .where(inArray(componentEvaluations.componentVersionId, versionIds))
    .orderBy(desc(componentEvaluations.createdAt)) : [];
  const latestEvaluationByVersion = new Map<string, typeof componentEvaluations.$inferSelect>();
  for (const evaluation of evaluationRows) if (!latestEvaluationByVersion.has(evaluation.componentVersionId)) latestEvaluationByVersion.set(evaluation.componentVersionId, evaluation);
  const candidateRows = candidateBaseRows.map((row) => ({ ...row, evaluation: row.version ? latestEvaluationByVersion.get(row.version.id) ?? null : null }));
  const decisions = await db.select({ decision: publicationDecisions }).from(publicationDecisions)
    .innerJoin(componentVersions, eq(componentVersions.id, publicationDecisions.componentVersionId))
    .innerJoin(components, eq(components.id, componentVersions.componentId))
    .where(and(
      eq(components.institutionId, actor.institutionId),
      inArray(components.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
    ))
    .orderBy(desc(publicationDecisions.createdAt));
  const reviewedPatterns = await getSql()<Array<Record<string, unknown>>>`
    SELECT o.failure_code AS pattern, a.capability_id, t.course_id, s.reference_pack_key,
           count(DISTINCT a.id)::int AS count, max(r.created_at) AS last_reviewed_at,
           (array_agg(o.id ORDER BY r.created_at DESC, o.id DESC))[1]::text AS observation_id
    FROM foundry_product.diagnostic_observations o
    JOIN LATERAL (
      SELECT reviewed.id, reviewed.created_at, reviewed.decision, reviewed.teacher_id, reviewed.actor_provenance
      FROM foundry_product.teacher_reviews reviewed
      WHERE reviewed.observation_id = o.id
      ORDER BY reviewed.created_at DESC, reviewed.id DESC
      LIMIT 1
    ) r ON true
    JOIN foundry_product.learner_attempts a ON a.id = o.attempt_id
    JOIN foundry_product.learning_tasks t ON t.id = a.task_id
    JOIN foundry_product.capabilities cap ON cap.id = a.capability_id
      AND cap.active_version_id = o.capability_version_id
    JOIN foundry_product.courses course_scope ON course_scope.id = t.course_id
    JOIN foundry_product.subjects s ON s.id = course_scope.subject_id
      AND s.reference_pack_key = cap.reference_pack_key
    WHERE t.institution_id = ${actor.institutionId}
      AND t.course_id = ANY(${actor.courseIds}::uuid[])
      AND o.observation_source = 'CAPABILITY'
      AND o.failure_code IS NOT NULL
      AND o.superseded_by_id IS NULL
      AND r.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')
      AND r.actor_provenance->>'userId' = r.teacher_id::text
      AND r.actor_provenance->>'institutionId' = t.institution_id::text
      AND COALESCE(r.actor_provenance->>'authMethod', '') NOT LIKE 'migrated-%'
    GROUP BY o.failure_code, a.capability_id, t.course_id, s.reference_pack_key
    ORDER BY count(*) DESC
  `;
  const candidateSources = await getSql()<Array<Record<string, unknown>>>`
    SELECT o.id AS observation_id, o.observation_source, o.summary, o.failure_code,
           t.id AS task_id, t.title AS task_title, t.course_id,
           current_review.id AS review_id, current_review.decision AS review_decision,
           cap.id AS capability_id, cap.key AS capability_key, cap.name AS capability_name,
           subject.reference_pack_key,
           (
             SELECT count(DISTINCT matching_attempt.id)::int
             FROM foundry_product.diagnostic_observations matching
             JOIN foundry_product.learner_attempts matching_attempt ON matching_attempt.id = matching.attempt_id
             JOIN foundry_product.learning_tasks matching_task ON matching_task.id = matching_attempt.task_id
             JOIN foundry_product.capabilities matching_capability ON matching_capability.id = matching_attempt.capability_id
               AND matching_capability.active_version_id = matching.capability_version_id
             JOIN foundry_product.courses matching_course ON matching_course.id = matching_task.course_id
             JOIN foundry_product.subjects matching_subject ON matching_subject.id = matching_course.subject_id
               AND matching_subject.reference_pack_key = matching_capability.reference_pack_key
             JOIN LATERAL (
               SELECT matching_review.* FROM foundry_product.teacher_reviews matching_review
               WHERE matching_review.observation_id = matching.id
               ORDER BY matching_review.created_at DESC, matching_review.id DESC LIMIT 1
             ) matching_review ON true
             WHERE matching_task.institution_id = t.institution_id
               AND matching_task.course_id = t.course_id
               AND matching_attempt.capability_id = a.capability_id
               AND matching.observation_source = 'CAPABILITY'
               AND matching.failure_code = o.failure_code
               AND matching.superseded_by_id IS NULL
               AND matching_review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')
               AND matching_review.actor_provenance->>'userId' = matching_review.teacher_id::text
               AND matching_review.actor_provenance->>'institutionId' = t.institution_id::text
           ) AS repeated_attempt_count
    FROM foundry_product.diagnostic_observations o
    JOIN foundry_product.learner_attempts a ON a.id = o.attempt_id
    JOIN foundry_product.learning_tasks t ON t.id = a.task_id
    JOIN LATERAL (
      SELECT r.*
      FROM foundry_product.teacher_reviews r
      WHERE r.observation_id = o.id
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1
    ) current_review ON true
    JOIN foundry_product.capabilities cap ON cap.id = a.capability_id
      AND cap.active_version_id = o.capability_version_id
    JOIN foundry_product.courses course_scope ON course_scope.id = t.course_id
    JOIN foundry_product.subjects subject ON subject.id = course_scope.subject_id
      AND subject.reference_pack_key = cap.reference_pack_key
    WHERE t.institution_id = ${actor.institutionId}
      AND t.course_id = ANY(${actor.courseIds}::uuid[])
      AND o.observation_source = 'CAPABILITY'
      AND o.failure_code IS NOT NULL
      AND o.superseded_by_id IS NULL
      AND current_review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')
      AND current_review.actor_provenance->>'userId' = current_review.teacher_id::text
      AND current_review.actor_provenance->>'institutionId' = t.institution_id::text
      AND COALESCE(current_review.actor_provenance->>'authMethod', '') NOT LIKE 'migrated-%'
    ORDER BY o.created_at DESC
  `;
  const authorizedComponentIds = [...new Set(candidateRows.map(({ component }) => component.id))];
  const pendingWorkflows = authorizedComponentIds.length ? await db.select().from(workflowRuns).where(and(
    eq(workflowRuns.institutionId, actor.institutionId),
    eq(workflowRuns.workflowKind, "COMPONENT_LIFECYCLE"),
    eq(workflowRuns.status, "INTERRUPTED"),
    inArray(sql<string>`${workflowRuns.productLinks}->>'componentId'`, authorizedComponentIds),
  )).orderBy(desc(workflowRuns.startedAt)) : [];
  const evidenceOptions = await db.select({ evidence: evidenceUnits, source: sourceRecords })
    .from(evidenceUnits)
    .innerJoin(sourceRecords, eq(sourceRecords.id, evidenceUnits.sourceId))
    .where(and(
      eq(sourceRecords.active, true),
      eq(sourceRecords.rightsAuthorizationStatus, "APPROVED"),
      inArray(sourceRecords.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
    )).orderBy(evidenceUnits.createdAt);
  const gapSignals = await getSql()<Array<Record<string, unknown>>>`
    SELECT resolution.id AS capability_resolution_id, resolution.decision, resolution.gap_signal,
      resolution.selection_rationale, resolution.candidate_set, plan.id AS activity_plan_proposal_id,
      plan.state AS plan_state, plan.block_reasons, task.id AS task_id, task.title AS task_title,
      task.goal AS task_goal, task.course_id, observation.summary AS diagnosis_summary,
      observation.failure_code, subject.reference_pack_key
    FROM foundry_product.capability_resolutions resolution
    JOIN foundry_product.activity_plan_proposals plan ON plan.capability_resolution_id=resolution.id
    JOIN foundry_product.learning_tasks task ON task.id=resolution.task_id
    JOIN foundry_product.diagnostic_observations observation ON observation.id=resolution.diagnostic_observation_id
    JOIN foundry_product.courses course_scope ON course_scope.id=resolution.course_id
    JOIN foundry_product.subjects subject ON subject.id=course_scope.subject_id
    WHERE resolution.institution_id=${actor.institutionId}
      AND resolution.course_id=ANY(${actor.courseIds}::uuid[])
      AND resolution.decision='ADAPT'
      AND resolution.no_match AND resolution.teacher_escalation
      AND plan.state='BLOCKED'
      AND NOT EXISTS (SELECT 1 FROM foundry_product.capability_resolutions newer WHERE newer.task_id=resolution.task_id AND newer.episode_id=resolution.episode_id AND (newer.created_at,newer.id)>(resolution.created_at,resolution.id))
      AND NOT EXISTS (SELECT 1 FROM foundry_product.components component WHERE component.source_capability_resolution_id=resolution.id)
    ORDER BY resolution.created_at DESC, resolution.id DESC
  `;
  const previews = versionIds.length ? await db.select().from(componentAssetPreviews).where(inArray(componentAssetPreviews.componentVersionId, versionIds)).orderBy(desc(componentAssetPreviews.createdAt)) : [];
  const availability = await db.select().from(capabilityAvailabilityDecisions).where(and(eq(capabilityAvailabilityDecisions.institutionId, actor.institutionId), inArray(capabilityAvailabilityDecisions.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]))).orderBy(desc(capabilityAvailabilityDecisions.createdAt));
  const readyRegistrations = await getSql()<Array<{ component_id: string; capability_version_id: string; capability_resolution_id: string; activity_plan_proposal_id: string }>>`
    SELECT component.id AS component_id, version.id AS capability_version_id, resolution.id AS capability_resolution_id, plan.id AS activity_plan_proposal_id
    FROM foundry_product.components component
    JOIN foundry_product.capabilities capability ON capability.id=component.registered_capability_id AND capability.active_version_id=component.registered_capability_version_id
    JOIN foundry_product.capability_versions version ON version.id=component.registered_capability_version_id AND version.capability_id=capability.id AND version.component_asset_version_id=component.active_version_id AND version.status='ACTIVE'
    JOIN foundry_product.capability_availability_decisions availability ON availability.capability_id=capability.id AND availability.capability_version_id=version.id AND availability.component_version_id=component.active_version_id AND availability.availability_status='AVAILABLE'
    JOIN foundry_product.capability_resolutions source ON source.id=component.source_capability_resolution_id
    JOIN foundry_product.capability_resolutions resolution ON resolution.task_id=source.task_id AND resolution.episode_id=source.episode_id AND resolution.selected_capability_id=capability.id AND resolution.selected_capability_version_id=version.id AND resolution.decision='EXISTING'
    JOIN foundry_product.activity_plan_proposals plan ON plan.capability_resolution_id=resolution.id AND plan.selected_capability_version_id=version.id AND plan.state='READY'
    WHERE component.institution_id=${actor.institutionId} AND component.course_id=ANY(${actor.courseIds}::uuid[]) AND component.status='PUBLISHED'
      AND NOT EXISTS (SELECT 1 FROM foundry_product.capability_resolutions newer WHERE newer.task_id=source.task_id AND newer.episode_id=source.episode_id AND (newer.created_at,newer.id)>(resolution.created_at,resolution.id))
      AND NOT EXISTS (SELECT 1 FROM foundry_product.activity_plan_proposals newer WHERE newer.task_id=plan.task_id AND newer.episode_id=plan.episode_id AND (newer.created_at,newer.id)>(plan.created_at,plan.id))
  `;
  return { candidates: candidateRows, decisions, reviewedPatterns, candidateSources, pendingWorkflows, evidenceOptions, gapSignals, previews, availability, readyRegistrations };
}

export async function getEngineeringWorkspace(actor: Actor) {
  requireRole(actor, ["ENGINEER", "ADMIN"]);
  const db = getDb();
  const authorizedTasks = await db.select({ id: learningTasks.id }).from(learningTasks).where(and(
    eq(learningTasks.institutionId, actor.institutionId),
    inArray(learningTasks.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
  ));
  const taskIds = authorizedTasks.map((task) => task.id);
  const authorizedComponents = await db.select({ id: components.id }).from(components).where(and(
    eq(components.institutionId, actor.institutionId),
    inArray(components.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"]),
  ));
  const taskRunScope = taskIds.length ? inArray(workflowRuns.taskId, taskIds) : sql`false`;
  const componentRunScope = authorizedComponents.length ? and(
    eq(workflowRuns.workflowKind, "COMPONENT_LIFECYCLE"),
    inArray(sql<string>`${workflowRuns.productLinks}->>'componentId'`, authorizedComponents.map(({ id }) => id)),
  ) : sql`false`;
  const runs = await db.select().from(workflowRuns).where(and(
    eq(workflowRuns.institutionId, actor.institutionId),
    or(taskRunScope, componentRunScope),
  )).orderBy(desc(workflowRuns.startedAt)).limit(50);
  const evaluations = await db.select().from(evalRuns).where(eq(evalRuns.institutionId, actor.institutionId)).orderBy(desc(evalRuns.createdAt)).limit(20);
  const retrieval = taskIds.length ? await db.select().from(retrievalRuns).where(and(eq(retrievalRuns.institutionId, actor.institutionId), inArray(retrievalRuns.taskId, taskIds))).orderBy(desc(retrievalRuns.createdAt)).limit(50) : [];
  const models = await db.select().from(modelRuns).where(eq(modelRuns.institutionId, actor.institutionId)).orderBy(desc(modelRuns.createdAt)).limit(50);
  const staleResumingRuns = await getStaleResumingRuns(actor);
  const componentEvaluationRecords = await db.select({ evaluation: componentEvaluations, component: components, version: componentVersions })
    .from(componentEvaluations)
    .innerJoin(componentVersions, eq(componentVersions.id, componentEvaluations.componentVersionId))
    .innerJoin(components, eq(components.id, componentVersions.componentId))
    .where(and(eq(componentEvaluations.institutionId, actor.institutionId), inArray(componentEvaluations.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"])))
    .orderBy(desc(componentEvaluations.createdAt)).limit(50);
  const componentDecisionRecords = await db.select({ decision: publicationDecisions, component: components, version: componentVersions })
    .from(publicationDecisions)
    .innerJoin(componentVersions, eq(componentVersions.id, publicationDecisions.componentVersionId))
    .innerJoin(components, eq(components.id, componentVersions.componentId))
    .where(and(eq(components.institutionId, actor.institutionId), inArray(components.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"])))
    .orderBy(desc(publicationDecisions.createdAt)).limit(50);
  const componentDeliveryRecords = await db.select({ delivery: componentDeliveries, component: components, version: componentVersions })
    .from(componentDeliveries)
    .innerJoin(components, eq(components.id, componentDeliveries.componentId))
    .innerJoin(componentVersions, eq(componentVersions.id, componentDeliveries.componentVersionId))
    .where(and(eq(componentDeliveries.institutionId, actor.institutionId), inArray(componentDeliveries.courseId, actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"])))
    .orderBy(desc(componentDeliveries.createdAt)).limit(50);
  let checkpointCounts: Array<Record<string, unknown>> = [];
  try {
    checkpointCounts = await getTenantCheckpointSql(actor.institutionId)<Array<Record<string, unknown>>>`
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
    componentEvaluationRecords,
    componentDecisionRecords,
    componentDeliveryRecords,
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
      automatedResumeCrashRecovery: "LEASED_RECLAIM_AVAILABLE",
      managedDatabaseTenantPolicy: "NOT_CONFIGURED",
      publicPreview: "BLOCKED",
    },
  };
}
