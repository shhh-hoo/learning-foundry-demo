import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const product = pgSchema("foundry_product");
export const operational = pgSchema("foundry_operational");

const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const institutions = product.table("institutions", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = product.table("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  active: boolean("active").default(true).notNull(),
  createdAt: createdAt(),
});

export const institutionMemberships = product.table(
  "institution_memberships",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.institutionId, table.role] })],
);

export const subjects = product.table("subjects", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  referencePackKey: text("reference_pack_key").notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("subjects_institution_key_uq").on(table.institutionId, table.key)]);

export const courses = product.table("courses", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("courses_institution_code_uq").on(table.institutionId, table.code)]);

export const courseEnrollments = product.table(
  "course_enrollments",
  {
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.institutionId, table.courseId, table.userId, table.role] })],
);

export const learningTasks = product.table("learning_tasks", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  learnerId: uuid("learner_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  status: text("status").default("OPEN").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("learning_tasks_learner_idx").on(table.learnerId, table.status)]);

export const learningEpisodes = product.table("learning_episodes", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  status: text("status").default("ACTIVE").notNull(),
  startedAt: createdAt(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (table) => [uniqueIndex("episodes_task_sequence_uq").on(table.taskId, table.sequence)]);

export const conversationEvents = product.table("conversation_events", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  actorType: text("actor_type").notNull(),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  sourceRefs: jsonb("source_refs").$type<Array<Record<string, string>>>().default([]).notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<Array<Record<string, string>>>().default([]).notNull(),
  supersedesEventId: uuid("supersedes_event_id"),
  createdAt: createdAt(),
}, (table) => [index("conversation_events_episode_idx").on(table.episodeId, table.createdAt)]);

export const sourceRecords = product.table("source_records", {
  id: id(),
  institutionId: uuid("institution_id").references(() => institutions.id),
  courseId: uuid("course_id").references(() => courses.id),
  sourceKey: text("source_key").notNull(),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull(),
  version: text("version").notNull(),
  authority: text("authority").notNull(),
  rights: text("rights").notNull(),
  rightsAuthorizationStatus: text("rights_authorization_status").notNull(),
  distributionScope: text("distribution_scope").notNull(),
  allowedPurposes: jsonb("allowed_purposes").$type<string[]>().notNull(),
  contentHash: text("content_hash").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("source_records_key_version_uq").on(table.sourceKey, table.version),
  check("source_rights_authorization_ck", sql`${table.rightsAuthorizationStatus} IN ('APPROVED','REVIEW_REQUIRED','DENIED')`),
]);

export const fileAssets = product.table("file_assets", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  taskId: uuid("task_id").references(() => learningTasks.id, { onDelete: "cascade" }),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  sourceId: uuid("source_id").references(() => sourceRecords.id),
  purpose: text("purpose").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mediaType: text("media_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  contentHash: text("content_hash").notNull(),
  ingestionStatus: text("ingestion_status").default("STORED").notNull(),
  extractionText: text("extraction_text"),
  extractionMetadata: jsonb("extraction_metadata").$type<Record<string, unknown>>().default({}).notNull(),
  interpretation: text("interpretation"),
  interpretationStatus: text("interpretation_status").default("NOT_APPLICABLE").notNull(),
  providerModel: text("provider_model"),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("file_assets_scope_idx").on(table.institutionId, table.courseId, table.createdAt),
  index("file_assets_scope_hash_idx").on(table.institutionId, table.ownerUserId, table.purpose, table.contentHash),
  check("file_asset_purpose_ck", sql`${table.purpose} IN ('LEARNING_MATERIAL','LEARNER_ATTEMPT')`),
  check("file_asset_ingestion_status_ck", sql`${table.ingestionStatus} IN ('STORED','EXTRACTED','PROVIDER_UNAVAILABLE','FAILED')`),
  check("file_asset_interpretation_status_ck", sql`${table.interpretationStatus} IN ('NOT_APPLICABLE','AVAILABLE','PROVIDER_UNAVAILABLE','FAILED')`),
  check("file_asset_size_ck", sql`${table.byteSize} > 0`),
]);

export const evidenceUnits = product.table("evidence_units", {
  id: id(),
  sourceId: uuid("source_id").notNull().references(() => sourceRecords.id),
  institutionId: uuid("institution_id").references(() => institutions.id),
  modality: text("modality").notNull(),
  locator: text("locator").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  structuredContent: jsonb("structured_content").$type<Record<string, unknown>>(),
  searchDocument: text("search_document").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  contentHash: text("content_hash").notNull(),
  embedding: real("embedding").array(),
  embeddingModel: text("embedding_model"),
  embeddingDimensions: integer("embedding_dimensions"),
  embeddingStatus: text("embedding_status").default("NOT_REQUESTED").notNull(),
  embeddingFailure: text("embedding_failure"),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("evidence_source_locator_hash_uq").on(table.sourceId, table.locator, table.contentHash),
  index("evidence_source_idx").on(table.sourceId),
]);

export const contextCompilations = product.table("context_compilations", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  compilerVersion: text("compiler_version").notNull(),
  tokenBudget: integer("token_budget").notNull(),
  modalityBudget: jsonb("modality_budget").$type<Record<string, number>>().notNull(),
  tokenizer: text("tokenizer").notNull(),
  selectedTokenCount: integer("selected_token_count").notNull(),
  modalityUsage: jsonb("modality_usage").$type<Record<string, number>>().notNull(),
  selectedItems: jsonb("selected_items").$type<Array<Record<string, unknown>>>().notNull(),
  excludedItems: jsonb("excluded_items").$type<Array<Record<string, unknown>>>().notNull(),
  createdAt: createdAt(),
});

export const capabilities = product.table("capabilities", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  referencePackKey: text("reference_pack_key").notNull(),
  kind: text("kind").notNull(),
  activeVersionId: uuid("active_version_id"),
  createdAt: createdAt(),
});

export const capabilityVersions = product.table("capability_versions", {
  id: id(),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  contract: jsonb("contract").$type<Record<string, unknown>>().notNull(),
  implementationKey: text("implementation_key").notNull(),
  status: text("status").default("ACTIVE").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("capability_versions_uq").on(table.capabilityId, table.version)]);

export const learnerAttempts = product.table("learner_attempts", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => users.id),
  capabilityId: uuid("capability_id").references(() => capabilities.id),
  fileAssetId: uuid("file_asset_id").references(() => fileAssets.id),
  prompt: text("prompt").notNull(),
  response: text("response").notNull(),
  structuredInput: jsonb("structured_input").$type<Record<string, unknown>>().notNull(),
  sourceRefs: jsonb("source_refs").$type<Array<Record<string, string>>>().default([]).notNull(),
  createdAt: createdAt(),
}, (table) => [index("attempts_task_idx").on(table.taskId, table.createdAt)]);

export const diagnosticObservations = product.table("diagnostic_observations", {
  id: id(),
  attemptId: uuid("attempt_id").notNull().references(() => learnerAttempts.id, { onDelete: "cascade" }),
  capabilityVersionId: uuid("capability_version_id").references(() => capabilityVersions.id),
  observationSource: text("observation_source").default("CAPABILITY").notNull(),
  status: text("status").notNull(),
  failureCode: text("failure_code"),
  firstInvalidStep: text("first_invalid_step"),
  summary: text("summary").notNull(),
  structuredResult: jsonb("structured_result").$type<Record<string, unknown>>().notNull(),
  inputLineage: jsonb("input_lineage").$type<Record<string, unknown>>().notNull(),
  outputLineage: jsonb("output_lineage").$type<Record<string, unknown>>().notNull(),
  supersededById: uuid("superseded_by_id"),
  createdAt: createdAt(),
}, (table) => [index("observations_attempt_idx").on(table.attemptId)]);

export const teacherReviews = product.table("teacher_reviews", {
  id: id(),
  observationId: uuid("observation_id").notNull().references(() => diagnosticObservations.id),
  teacherId: uuid("teacher_id").notNull().references(() => users.id),
  decision: text("decision").notNull(),
  correction: text("correction"),
  supplement: text("supplement"),
  teachingSupport: text("teaching_support").notNull(),
  actorProvenance: jsonb("actor_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>().notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("reviews_observation_uq").on(table.observationId),
  check("teacher_review_decision_ck", sql`${table.decision} IN ('ACCEPT','CORRECT','SUPPLEMENT','ESCALATE')`),
  check("teacher_review_payload_ck", sql`(${table.decision} <> 'CORRECT' OR length(btrim(${table.correction})) > 0) AND (${table.decision} <> 'SUPPLEMENT' OR length(btrim(${table.supplement})) > 0)`),
  check("teacher_review_provenance_ck", sql`length(${table.actorProvenance}->>'userId') > 0 AND length(${table.actorProvenance}->>'institutionId') > 0 AND length(${table.actorProvenance}->>'authMethod') > 0 AND length(${table.actorProvenance}->>'sessionId') > 0 AND (${table.actorProvenance}->>'authMethod') NOT LIKE 'migrated-%'`),
]);

export const retryAttempts = product.table("retry_attempts", {
  id: id(),
  originalAttemptId: uuid("original_attempt_id").notNull().references(() => learnerAttempts.id),
  reviewedObservationId: uuid("reviewed_observation_id").notNull().references(() => diagnosticObservations.id),
  teacherReviewId: uuid("teacher_review_id").notNull().references(() => teacherReviews.id),
  activityType: text("activity_type").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").default("ASSIGNED").notNull(),
  resultAttemptId: uuid("result_attempt_id").references(() => learnerAttempts.id),
  resultObservationId: uuid("result_observation_id").references(() => diagnosticObservations.id),
  resultReviewId: uuid("result_review_id").references(() => teacherReviews.id),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  check("retry_activity_ck", sql`${table.activityType} = 'RETRY'`),
  check("retry_status_ck", sql`${table.status} IN ('ASSIGNED','REVIEWED','ESCALATED')`),
]);

export const transferActivities = product.table("transfer_activities", {
  id: id(),
  retryId: uuid("retry_id").notNull().references(() => retryAttempts.id, { onDelete: "cascade" }).unique(),
  targetConcept: text("target_concept").notNull(),
  evidenceUnitId: uuid("evidence_unit_id").notNull().references(() => evidenceUnits.id),
  createdAt: createdAt(),
});

export const retentionReviews = product.table("retention_reviews", {
  id: id(),
  retryId: uuid("retry_id").notNull().references(() => retryAttempts.id, { onDelete: "cascade" }).unique(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  evidenceUnitId: uuid("evidence_unit_id").notNull().references(() => evidenceUnits.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const learningOutcomes = product.table("learning_outcomes", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id),
  retryId: uuid("retry_id").notNull().references(() => retryAttempts.id),
  resultReviewId: uuid("result_review_id").notNull().references(() => teacherReviews.id),
  teacherId: uuid("teacher_id").notNull().references(() => users.id),
  outcomeType: text("outcome_type").notNull(),
  status: text("status").notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<Array<Record<string, string>>>().notNull(),
  narrative: text("narrative").notNull(),
  actorProvenance: jsonb("actor_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>().notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
}, (table) => [check("learning_outcome_type_ck", sql`${table.outcomeType} = 'RETRY'`)]);

export const components = product.table("components", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  referencePackKey: text("reference_pack_key").notNull(),
  failureCode: text("failure_code"),
  key: text("key").notNull(),
  title: text("title").notNull(),
  status: text("status").default("CANDIDATE").notNull(),
  sourceSignal: jsonb("source_signal").$type<Record<string, unknown>>().notNull(),
  activeVersionId: uuid("active_version_id"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("components_institution_key_uq").on(table.institutionId, table.key)]);

export const componentVersions = product.table("component_versions", {
  id: id(),
  componentId: uuid("component_id").notNull().references(() => components.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  successorOfVersionId: uuid("successor_of_version_id").references((): AnyPgColumn => componentVersions.id),
  contract: jsonb("contract").$type<Record<string, unknown>>().notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  sourceObservationIds: uuid("source_observation_ids").array().notNull(),
  sourceReviewIds: uuid("source_review_ids").array().notNull(),
  validation: jsonb("validation").$type<Record<string, unknown>>().notNull(),
  evalResult: jsonb("eval_result").$type<Record<string, unknown>>(),
  status: text("status").default("DRAFT").notNull(),
  contentHash: text("content_hash").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("component_versions_uq").on(table.componentId, table.version),
  check("component_version_status_ck", sql`${table.status} IN ('DRAFT','PUBLISHED','REJECTED')`),
]);

export const componentEvaluations = product.table("component_evaluations", {
  id: id(),
  componentVersionId: uuid("component_version_id").notNull().references(() => componentVersions.id),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  evaluatorKey: text("evaluator_key").notNull(),
  evaluatorVersion: text("evaluator_version").notNull(),
  contentHash: text("content_hash").notNull(),
  inputHash: text("input_hash").notNull(),
  systemStatus: text("system_status").notNull(),
  systemChecks: jsonb("system_checks").$type<Array<Record<string, unknown>>>().notNull(),
  sourceObservationIds: uuid("source_observation_ids").array().notNull(),
  sourceReviewIds: uuid("source_review_ids").array().notNull(),
  sourceAttemptIds: uuid("source_attempt_ids").array().notNull(),
  fixtureExecution: jsonb("fixture_execution").$type<Record<string, unknown>>().notNull(),
  evidenceChecks: jsonb("evidence_checks").$type<Array<Record<string, unknown>>>().notNull(),
  providerChecks: jsonb("provider_checks").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("component_evaluations_version_input_hash_uq").on(table.componentVersionId, table.inputHash),
  index("component_evaluations_scope_idx").on(table.institutionId, table.courseId, table.createdAt),
  check("component_evaluation_status_ck", sql`${table.systemStatus} IN ('PASSED','BLOCKED')`),
]);

export const publicationDecisions = product.table("publication_decisions", {
  id: id(),
  componentVersionId: uuid("component_version_id").notNull().references(() => componentVersions.id),
  evaluationId: uuid("evaluation_id").references(() => componentEvaluations.id),
  previousActiveVersionId: uuid("previous_active_version_id").references(() => componentVersions.id),
  expertId: uuid("expert_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  rationale: text("rationale").notNull(),
  humanRubric: jsonb("human_rubric").$type<Record<string, unknown>>(),
  workflowThreadId: text("workflow_thread_id"),
  actorProvenance: jsonb("actor_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>().notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("publication_terminal_version_uq").on(table.componentVersionId).where(sql`${table.action} IN ('APPROVE','REJECT')`),
  check("publication_action_ck", sql`${table.action} IN ('APPROVE','REJECT','ROLLBACK')`),
  check("publication_provenance_ck", sql`length(${table.actorProvenance}->>'userId') > 0 AND length(${table.actorProvenance}->>'institutionId') > 0 AND length(${table.actorProvenance}->>'authMethod') > 0 AND (${table.actorProvenance}->>'authMethod') NOT LIKE 'migrated-%'`),
]);

export const componentDeliveries = product.table("component_deliveries", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id),
  componentId: uuid("component_id").notNull().references(() => components.id),
  componentVersionId: uuid("component_version_id").notNull().references(() => componentVersions.id),
  observationId: uuid("observation_id").notNull().references(() => diagnosticObservations.id),
  reviewId: uuid("review_id").notNull().references(() => teacherReviews.id),
  deliveredBy: uuid("delivered_by").notNull().references(() => users.id),
  audience: text("audience").notNull(),
  supportSnapshot: jsonb("support_snapshot").$type<Record<string, unknown>>().notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
}, (table) => [
  index("component_deliveries_task_idx").on(table.taskId, table.createdAt),
  index("component_deliveries_component_idx").on(table.componentId, table.componentVersionId, table.createdAt),
  check("component_delivery_audience_ck", sql`${table.audience} IN ('LEARNER','TEACHER')`),
]);

export const libraryItems = product.table("library_items", {
  id: id(),
  learnerId: uuid("learner_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  evidenceUnitId: uuid("evidence_unit_id").notNull().references(() => evidenceUnits.id),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

export const scheduleItems = product.table("schedule_items", {
  id: id(),
  learnerId: uuid("learner_id").notNull().references(() => users.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id),
  activityType: text("activity_type").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: text("status").default("PLANNED").notNull(),
  createdAt: createdAt(),
}, (table) => [
  check("schedule_activity_ck", sql`${table.activityType} = 'STUDY_REVIEW'`),
]);

export const workflowRuns = operational.table("workflow_runs", {
  id: id(),
  threadId: text("thread_id").notNull().unique(),
  workflowKind: text("workflow_kind").notNull(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  taskId: uuid("task_id").references(() => learningTasks.id),
  episodeId: uuid("episode_id").references(() => learningEpisodes.id),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  status: text("status").notNull(),
  interruptType: text("interrupt_type"),
  interruptVersion: integer("interrupt_version").default(0).notNull(),
  resumeClaimedAt: timestamp("resume_claimed_at", { withTimezone: true }),
  resumeClaimToken: text("resume_claim_token"),
  resumeClaimVersion: integer("resume_claim_version").default(0).notNull(),
  resumeLeaseExpiresAt: timestamp("resume_lease_expires_at", { withTimezone: true }),
  productLinks: jsonb("product_links").$type<Record<string, string>>().default({}).notNull(),
  metrics: jsonb("metrics").$type<Record<string, number>>().default({}).notNull(),
  failure: text("failure"),
  startedAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("workflow_runs_institution_idx").on(table.institutionId, table.startedAt),
  index("workflow_runs_resume_lease_idx").on(table.status, table.resumeLeaseExpiresAt),
  check("workflow_resume_claim_version_ck", sql`${table.resumeClaimVersion} >= 0`),
  check("workflow_resume_claim_integrity_ck", sql`(${table.status} = 'RESUMING' AND ${table.resumeClaimedAt} IS NOT NULL AND ${table.resumeClaimToken} IS NOT NULL AND ${table.resumeLeaseExpiresAt} IS NOT NULL) OR (${table.status} <> 'RESUMING' AND ${table.resumeClaimedAt} IS NULL AND ${table.resumeClaimToken} IS NULL AND ${table.resumeLeaseExpiresAt} IS NULL)`),
]);

export const retrievalRuns = operational.table("retrieval_runs", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id),
  query: text("query").notNull(),
  purpose: text("purpose").notNull(),
  selectedEvidenceIds: jsonb("selected_evidence_ids").$type<string[]>().notNull(),
  rankingEvidence: jsonb("ranking_evidence").$type<Array<Record<string, unknown>>>().notNull(),
  retrievalMode: text("retrieval_mode").notNull(),
  embeddingStatus: text("embedding_status").notNull(),
  embeddingModel: text("embedding_model"),
  rerankerStatus: text("reranker_status").notNull(),
  rerankerModel: text("reranker_model"),
  missingSignal: boolean("missing_signal").default(false).notNull(),
  conflictingSignal: boolean("conflicting_signal").default(false).notNull(),
  latencyMs: real("latency_ms").notNull(),
  createdAt: createdAt(),
});

export const modelRuns = operational.table("model_runs", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  taskId: uuid("task_id").references(() => learningTasks.id),
  fileAssetId: uuid("file_asset_id").references(() => fileAssets.id),
  callType: text("call_type").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  latencyMs: real("latency_ms").notNull(),
  evidenceUnitIds: jsonb("evidence_unit_ids").$type<string[]>().default([]).notNull(),
  failureCode: text("failure_code"),
  createdAt: createdAt(),
}, (table) => [index("model_runs_scope_idx").on(table.institutionId, table.createdAt)]);

export const evalRuns = operational.table("eval_runs", {
  id: id(),
  institutionId: uuid("institution_id").references(() => institutions.id),
  dataset: text("dataset").notNull(),
  datasetVersion: text("dataset_version").notNull(),
  status: text("status").notNull(),
  passed: integer("passed").notNull(),
  failed: integer("failed").notNull(),
  results: jsonb("results").$type<Array<Record<string, unknown>>>().notNull(),
  createdAt: createdAt(),
});

export const governanceEvents = product.table("governance_events", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  previousEventId: uuid("previous_event_id"),
  createdAt: createdAt(),
}, (table) => [index("governance_entity_idx").on(table.entityType, table.entityId, table.createdAt)]);

export const idempotencyKeys = product.table("idempotency_keys", {
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  key: text("key").notNull(),
  commandType: text("command_type").notNull(),
  requestHash: text("request_hash").notNull(),
  resultId: uuid("result_id").notNull(),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.institutionId, table.commandType, table.key] })]);

export type UserRecord = typeof users.$inferSelect;
export type LearningTaskRecord = typeof learningTasks.$inferSelect;
export type EvidenceUnitRecord = typeof evidenceUnits.$inferSelect;
