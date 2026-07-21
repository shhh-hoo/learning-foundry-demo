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
  unique,
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

/** Immutable external subject bindings used only by the authentication boundary. */
export const authIdentities = product.table(
  "auth_identities",
  {
    id: id(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    active: boolean("active").default(true).notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("auth_identities_issuer_subject_uq").on(table.issuer, table.subject)],
);

/** Server-authoritative sessions. The signed browser token is only a reference to this record. */
export const authSessions = product.table("auth_sessions", {
  id: uuid("id").primaryKey(),
  identityId: uuid("identity_id").notNull().references(() => authIdentities.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  version: integer("version").default(1).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  index("auth_sessions_user_idx").on(table.userId, table.expiresAt),
  check("auth_session_version_ck", sql`${table.version} > 0`),
]);

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

/** Class A: one stable learner identity inside an institution. */
export const learnerProfiles = product.table(
  "learner_profiles",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("learner_profiles_institution_learner_uq").on(table.institutionId, table.learnerId)],
);

/** Class B: immutable, temporal assessment/context strategies for a LearnerProfile. */
export const learnerStrategyVersions = product.table(
  "learner_strategy_versions",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    learnerProfileId: uuid("learner_profile_id").notNull().references(() => learnerProfiles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").default("ACTIVE").notNull(),
    strategy: jsonb("strategy").$type<Record<string, unknown>>().notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
    ruleVersion: text("rule_version").notNull(),
    confidence: real("confidence"),
    reviewStatus: text("review_status").default("UNREVIEWED").notNull(),
    sourceRecordId: uuid("source_record_id").references((): AnyPgColumn => sourceRecords.id),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidationReason: text("invalidation_reason"),
    supersedesVersionId: uuid("supersedes_version_id").references((): AnyPgColumn => learnerStrategyVersions.id),
    createdAt: createdAt(),
  },
  (table) => [
    index("learner_strategy_profile_kind_idx").on(table.learnerProfileId, table.kind, table.effectiveFrom),
    check("learner_strategy_status_ck", sql`${table.status} IN ('ACTIVE','STALE','SUPERSEDED','INVALIDATED')`),
    check("learner_strategy_confidence_ck", sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`),
    check("learner_strategy_interval_ck", sql`${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom}`),
    check("learner_strategy_provenance_ck", sql`jsonb_typeof(${table.provenance}) = 'object' AND ${table.provenance} <> '{}'::jsonb`),
    check("learner_strategy_predecessor_ck", sql`${table.supersedesVersionId} IS NULL OR ${table.supersedesVersionId} <> ${table.id}`),
  ],
);

export const learningTasks = product.table("learning_tasks", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  learnerId: uuid("learner_id").notNull().references(() => users.id),
  // DEFAULT NULL keeps the legacy insert shape optional; the DB trigger fills it before NOT NULL is checked.
  learnerProfileId: uuid("learner_profile_id").notNull().default(sql`NULL`).references(() => learnerProfiles.id),
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
  purpose: text("purpose").default("GENERAL").notNull(),
  predecessorEpisodeId: uuid("predecessor_episode_id").references((): AnyPgColumn => learningEpisodes.id),
  waitingReason: text("waiting_reason"),
  recoveryState: jsonb("recovery_state").$type<Record<string, unknown>>().default({}).notNull(),
  startedAt: createdAt(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("episodes_task_sequence_uq").on(table.taskId, table.sequence),
  uniqueIndex("episodes_predecessor_uq").on(table.predecessorEpisodeId).where(sql`${table.predecessorEpisodeId} IS NOT NULL`),
  check("episode_purpose_ck", sql`${table.purpose} IN ('GENERAL','RETRY','TRANSFER','RETENTION')`),
  check("episode_predecessor_ck", sql`${table.predecessorEpisodeId} IS NULL OR ${table.predecessorEpisodeId} <> ${table.id}`),
  check("episode_recovery_json_ck", sql`jsonb_typeof(${table.recoveryState})='object'`),
]);

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

/** Class A: stable source identity, separate from immutable versions and derivatives. */
export const sourceAssets = product.table(
  "source_assets",
  {
    id: id(),
    institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => courses.id),
    stableKey: text("stable_key").notNull(),
    sourceType: text("source_type").notNull(),
    originalLanguage: text("original_language"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [unique("source_assets_scope_key_uq").on(table.institutionId, table.stableKey).nullsNotDistinct()],
);

/** Class A: immutable bytes/hash/storage and rights/provenance snapshot. */
export const sourceAssetVersions = product.table(
  "source_asset_versions",
  {
    id: id(),
    sourceAssetId: uuid("source_asset_id").notNull().references(() => sourceAssets.id, { onDelete: "cascade" }),
    institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
    versionKey: text("version_key").notNull(),
    contentHash: text("content_hash").notNull(),
    storageKey: text("storage_key"),
    stableLocator: text("stable_locator"),
    mediaType: text("media_type"),
    byteSize: integer("byte_size"),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
    rightsBasis: text("rights_basis").notNull(),
    rightsStatus: text("rights_status").notNull(),
    accessScope: text("access_scope").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    supersedesVersionId: uuid("supersedes_version_id").references((): AnyPgColumn => sourceAssetVersions.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("source_asset_versions_asset_version_uq").on(table.sourceAssetId, table.versionKey),
    check("source_asset_version_locator_ck", sql`${table.storageKey} IS NOT NULL OR ${table.stableLocator} IS NOT NULL`),
    check("source_asset_version_size_ck", sql`${table.byteSize} IS NULL OR ${table.byteSize} > 0`),
    check("source_asset_version_interval_ck", sql`${table.effectiveUntil} IS NULL OR ${table.effectiveFrom} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom}`),
    check("source_asset_version_provenance_ck", sql`jsonb_typeof(${table.provenance}) = 'object' AND ${table.provenance} <> '{}'::jsonb`),
    check("source_asset_version_predecessor_ck", sql`${table.supersedesVersionId} IS NULL OR ${table.supersedesVersionId} <> ${table.id}`),
  ],
);

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
  // DEFAULT NULL keeps the legacy insert shape optional; the DB trigger fills it before NOT NULL is checked.
  sourceAssetId: uuid("source_asset_id").notNull().default(sql`NULL`).references(() => sourceAssets.id),
  sourceAssetVersionId: uuid("source_asset_version_id").notNull().default(sql`NULL`).references(() => sourceAssetVersions.id),
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
  sourceAssetId: uuid("source_asset_id").notNull().default(sql`NULL`).references(() => sourceAssets.id),
  sourceAssetVersionId: uuid("source_asset_version_id").notNull().default(sql`NULL`).references(() => sourceAssetVersions.id),
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
  sourceAssetVersionId: uuid("source_asset_version_id").notNull().default(sql`NULL`).references(() => sourceAssetVersions.id),
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

/** Class C: retryable processing execution, never canonical source truth. */
export const sourceProcessingAttempts = product.table(
  "source_processing_attempts",
  {
    id: id(),
    institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
    sourceAssetVersionId: uuid("source_asset_version_id").notNull().references(() => sourceAssetVersions.id, { onDelete: "cascade" }),
    fileAssetId: uuid("file_asset_id").references(() => fileAssets.id),
    operation: text("operation").notNull(),
    processor: text("processor").notNull(),
    processorVersion: text("processor_version").notNull(),
    status: text("status").notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    retryOfAttemptId: uuid("retry_of_attempt_id").references((): AnyPgColumn => sourceProcessingAttempts.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    unique("source_processing_attempt_idempotency_uq").on(table.institutionId, table.operation, table.idempotencyKey).nullsNotDistinct(),
    uniqueIndex("source_processing_attempt_active_file_uq").on(table.fileAssetId, table.operation).where(sql`${table.status} = 'STARTED' AND ${table.fileAssetId} IS NOT NULL`),
    index("source_processing_attempt_version_idx").on(table.sourceAssetVersionId, table.startedAt),
    check("source_processing_attempt_status_ck", sql`${table.status} IN ('STARTED','SUCCEEDED','FAILED','CANCELLED')`),
    check("source_processing_attempt_terminal_ck", sql`(${table.status} = 'STARTED' AND ${table.finishedAt} IS NULL) OR (${table.status} <> 'STARTED' AND ${table.finishedAt} IS NOT NULL)`),
    check("source_processing_attempt_failure_ck", sql`${table.status} <> 'SUCCEEDED' OR (${table.failureCode} IS NULL AND ${table.failureMessage} IS NULL)`),
    check("source_processing_attempt_retry_ck", sql`${table.retryOfAttemptId} IS NULL OR ${table.retryOfAttemptId} <> ${table.id}`),
  ],
);

/** Class B: locatable, reviewable derivative tied to one exact source version. */
export const evidenceDerivatives = product.table(
  "evidence_derivatives",
  {
    id: id(),
    institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
    sourceAssetVersionId: uuid("source_asset_version_id").notNull().references(() => sourceAssetVersions.id, { onDelete: "cascade" }),
    evidenceUnitId: uuid("evidence_unit_id").references(() => evidenceUnits.id),
    derivativeType: text("derivative_type").notNull(),
    locator: text("locator").notNull(),
    contentHash: text("content_hash").notNull(),
    processor: text("processor").notNull(),
    processorVersion: text("processor_version").notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
    reviewStatus: text("review_status").default("UNREVIEWED").notNull(),
    state: text("state").default("ACTIVE").notNull(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidationReason: text("invalidation_reason"),
    successorId: uuid("successor_id").references((): AnyPgColumn => evidenceDerivatives.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("evidence_derivative_lineage_uq").on(table.sourceAssetVersionId, table.derivativeType, table.locator, table.contentHash),
    uniqueIndex("evidence_derivative_unit_uq").on(table.evidenceUnitId),
    check("evidence_derivative_state_ck", sql`${table.state} IN ('ACTIVE','STALE','SUPERSEDED','INVALIDATED')`),
    check("evidence_derivative_provenance_ck", sql`jsonb_typeof(${table.provenance}) = 'object' AND ${table.provenance} <> '{}'::jsonb`),
    check("evidence_derivative_successor_ck", sql`${table.successorId} IS NULL OR ${table.successorId} <> ${table.id}`),
  ],
);

export const contextCompilations = product.table("context_compilations", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  consumer: text("consumer").notNull(),
  compilerVersion: text("compiler_version").notNull(),
  contextPolicyVersion: text("context_policy_version").notNull(),
  inputHash: text("input_hash").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  tokenBudget: integer("token_budget").notNull(),
  modalityBudget: jsonb("modality_budget").$type<Record<string, number>>().notNull(),
  tokenizer: text("tokenizer").notNull(),
  selectedTokenCount: integer("selected_token_count").notNull(),
  modalityUsage: jsonb("modality_usage").$type<Record<string, number>>().notNull(),
  candidateItems: jsonb("candidate_items").$type<Array<Record<string, unknown>>>().notNull(),
  selectedItems: jsonb("selected_items").$type<Array<Record<string, unknown>>>().notNull(),
  excludedItems: jsonb("excluded_items").$type<Array<Record<string, unknown>>>().notNull(),
  provenanceRefs: jsonb("provenance_refs").$type<Array<Record<string, unknown>>>().notNull(),
  referencedPriorTaskIds: jsonb("referenced_prior_task_ids").$type<string[]>().notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("context_compilation_replay_uq").on(table.taskId, table.episodeId, table.consumer, table.compilerVersion, table.inputHash),
  check("context_compilation_consumer_ck", sql`${table.consumer} IN ('LEGACY_COMPATIBILITY','EVIDENCE_RETRIEVAL','DIAGNOSIS','CAPABILITY_RESOLUTION','RUNTIME_ORCHESTRATION')`),
  check("context_compilation_hash_ck", sql`length(${table.inputHash}) > 0 AND length(${table.snapshotHash}) > 0`),
]);

/** Class B: persisted Task/Episode-scoped Context assertion, not source truth. */
export const contextItems = product.table(
  "context_items",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    learnerProfileId: uuid("learner_profile_id").notNull().references(() => learnerProfiles.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull().references(() => courses.id),
    taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id").references(() => learningEpisodes.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    scope: text("scope").notNull(),
    state: text("state").default("ACTIVE").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
    ruleVersion: text("rule_version").notNull(),
    confidence: real("confidence"),
    reviewStatus: text("review_status").default("UNREVIEWED").notNull(),
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id),
    sourceAssetVersionId: uuid("source_asset_version_id").references(() => sourceAssetVersions.id),
    evidenceUnitId: uuid("evidence_unit_id").references(() => evidenceUnits.id),
    evidenceDerivativeId: uuid("evidence_derivative_id").references(() => evidenceDerivatives.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    validFrom: timestamp("valid_from", { withTimezone: true }).defaultNow().notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidationReason: text("invalidation_reason"),
    successorId: uuid("successor_id").references((): AnyPgColumn => contextItems.id),
    createdAt: createdAt(),
  },
  (table) => [
    index("context_items_task_episode_idx").on(table.taskId, table.episodeId, table.state),
    check("context_item_scope_ck", sql`${table.scope} IN ('PROFILE','WORKSPACE','TASK','EPISODE')`),
    check("context_item_state_ck", sql`${table.state} IN ('ACTIVE','STALE','SUPERSEDED','PROMOTED','INVALIDATED')`),
    check("context_item_interval_ck", sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`),
    check("context_item_confidence_ck", sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`),
    check("context_item_episode_scope_ck", sql`${table.scope} <> 'EPISODE' OR ${table.episodeId} IS NOT NULL`),
    check("context_item_provenance_ck", sql`jsonb_typeof(${table.provenance}) = 'object' AND ${table.provenance} <> '{}'::jsonb`),
    check("context_item_successor_ck", sql`${table.successorId} IS NULL OR ${table.successorId} <> ${table.id}`),
  ],
);

/** Class A relationship permitting one explicit, typed cross-Task carryover. */
export const contextCarryoverRelations = product.table(
  "context_carryover_relations",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    sourceTaskId: uuid("source_task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
    sourceContextItemId: uuid("source_context_item_id").notNull().references(() => contextItems.id, { onDelete: "cascade" }),
    targetTaskId: uuid("target_task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    policyKey: text("policy_key"),
    policyVersion: text("policy_version"),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("context_carryover_exact_uq").on(table.sourceContextItemId, table.targetTaskId, table.relationType),
    check("context_carryover_type_ck", sql`${table.relationType} IN ('EXPLICIT_REFERENCE','LINKED_RETRY','LINKED_TRANSFER','LINKED_RETENTION','PROMOTED_ARTIFACT','TEACHER_ASSIGNMENT','CURRICULUM_CONTINUITY')`),
    check("context_carryover_cross_task_ck", sql`${table.sourceTaskId} <> ${table.targetTaskId}`),
    check("context_carryover_authority_ck", sql`${table.actorUserId} IS NOT NULL OR (${table.policyKey} IS NOT NULL AND ${table.policyVersion} IS NOT NULL)`),
  ],
);

export const capabilities = product.table("capabilities", {
  id: id(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
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
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
  componentAssetVersionId: uuid("component_asset_version_id").references((): AnyPgColumn => componentVersions.id),
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
  capabilityVersionId: uuid("capability_version_id").references(() => capabilityVersions.id),
  activityPlanId: uuid("activity_plan_id").references((): AnyPgColumn => activityPlans.id),
  runtimeDeliveryId: uuid("runtime_delivery_id").references((): AnyPgColumn => runtimeDeliveries.id),
  fileAssetId: uuid("file_asset_id").references(() => fileAssets.id),
  prompt: text("prompt").notNull(),
  response: text("response").notNull(),
  structuredInput: jsonb("structured_input").$type<Record<string, unknown>>().notNull(),
  sourceRefs: jsonb("source_refs").$type<Array<Record<string, string>>>().default([]).notNull(),
  modality: text("modality"),
  contentHash: text("content_hash"),
  assistanceProvenance: jsonb("assistance_provenance").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (table) => [
  index("attempts_task_idx").on(table.taskId, table.createdAt),
  uniqueIndex("learner_attempt_runtime_delivery_uq").on(table.runtimeDeliveryId).where(sql`${table.runtimeDeliveryId} IS NOT NULL`),
  check("learner_attempt_runtime_lineage_ck", sql`
    (${table.runtimeDeliveryId} IS NULL AND ${table.activityPlanId} IS NULL AND ${table.capabilityVersionId} IS NULL
      AND ${table.modality} IS NULL AND ${table.contentHash} IS NULL AND ${table.assistanceProvenance} IS NULL)
    OR (${table.runtimeDeliveryId} IS NOT NULL AND ${table.activityPlanId} IS NOT NULL AND ${table.capabilityVersionId} IS NOT NULL
      AND length(btrim(${table.modality})) > 0 AND length(${table.contentHash}) > 7
      AND jsonb_typeof(${table.assistanceProvenance}) = 'object' AND ${table.assistanceProvenance} <> '{}'::jsonb)
  `),
]);

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

/** Class B: immutable, explainable capability candidate set and selection assertion. */
export const capabilityResolutions = product.table("capability_resolutions", {
  id: uuid("id").primaryKey(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  contextCompilationId: uuid("context_compilation_id").notNull().references(() => contextCompilations.id),
  diagnosticObservationId: uuid("diagnostic_observation_id").notNull().references(() => diagnosticObservations.id),
  policyVersion: text("policy_version").notNull(),
  inputHash: text("input_hash").notNull(),
  decision: text("decision").notNull(),
  candidateSet: jsonb("candidate_set").$type<Array<Record<string, unknown>>>().notNull(),
  selectedCapabilityId: uuid("selected_capability_id").references(() => capabilities.id),
  selectedCapabilityVersionId: uuid("selected_capability_version_id").references(() => capabilityVersions.id),
  selectionRationale: text("selection_rationale").notNull(),
  parameterizationRecommendation: jsonb("parameterization_recommendation").$type<Record<string, unknown>>(),
  compositionRecommendation: jsonb("composition_recommendation").$type<Record<string, unknown>>(),
  gapSignal: jsonb("gap_signal").$type<Record<string, unknown>>(),
  noMatch: boolean("no_match").notNull(),
  teacherEscalation: boolean("teacher_escalation").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("capability_resolution_replay_uq").on(table.institutionId, table.inputHash),
  index("capability_resolution_task_idx").on(table.taskId, table.episodeId, table.createdAt),
  check("capability_resolution_decision_ck", sql`${table.decision} IN ('EXISTING','PARAMETERIZE','COMPOSE','ADAPT','GENERATE','NO_MATCH')`),
  check("capability_resolution_hash_ck", sql`length(${table.inputHash}) > 7 AND length(${table.policyVersion}) > 0 AND length(btrim(${table.selectionRationale})) > 0`),
  check("capability_resolution_selection_ck", sql`(${table.decision} = 'EXISTING' AND ${table.selectedCapabilityId} IS NOT NULL AND ${table.selectedCapabilityVersionId} IS NOT NULL AND NOT ${table.noMatch}) OR (${table.decision} <> 'EXISTING' AND ${table.selectedCapabilityId} IS NULL AND ${table.selectedCapabilityVersionId} IS NULL)`),
  check("capability_resolution_payload_ck", sql`
    (${table.decision} = 'EXISTING' AND NOT ${table.noMatch} AND NOT ${table.teacherEscalation}
      AND ${table.parameterizationRecommendation} IS NULL AND ${table.compositionRecommendation} IS NULL AND ${table.gapSignal} IS NULL)
    OR (${table.decision} = 'PARAMETERIZE' AND NOT ${table.noMatch} AND ${table.teacherEscalation}
      AND ${table.parameterizationRecommendation} IS NOT NULL AND ${table.compositionRecommendation} IS NULL AND ${table.gapSignal} IS NULL)
    OR (${table.decision} = 'COMPOSE' AND NOT ${table.noMatch} AND ${table.teacherEscalation}
      AND ${table.parameterizationRecommendation} IS NULL AND ${table.compositionRecommendation} IS NOT NULL AND ${table.gapSignal} IS NULL)
    OR (${table.decision} IN ('ADAPT','GENERATE','NO_MATCH') AND ${table.noMatch} AND ${table.teacherEscalation}
      AND ${table.parameterizationRecommendation} IS NULL AND ${table.compositionRecommendation} IS NULL AND ${table.gapSignal} IS NOT NULL)
  `),
]);

/** Class B: immutable proposed activity sequence; not RuntimeDelivery or a human assignment. */
export const activityPlanProposals = product.table("activity_plan_proposals", {
  id: uuid("id").primaryKey(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  contextCompilationId: uuid("context_compilation_id").notNull().references(() => contextCompilations.id),
  diagnosticObservationId: uuid("diagnostic_observation_id").notNull().references(() => diagnosticObservations.id),
  capabilityResolutionId: uuid("capability_resolution_id").notNull().references(() => capabilityResolutions.id),
  policyVersion: text("policy_version").notNull(),
  inputHash: text("input_hash").notNull(),
  state: text("state").notNull(),
  resolutionDecision: text("resolution_decision").notNull(),
  selectedCapabilityId: uuid("selected_capability_id").references(() => capabilities.id),
  selectedCapabilityVersionId: uuid("selected_capability_version_id").references(() => capabilityVersions.id),
  selectedVersionContentHash: text("selected_version_content_hash"),
  rationale: text("rationale").notNull(),
  stages: jsonb("stages").$type<Array<Record<string, unknown>>>().notNull(),
  teacherConstraints: jsonb("teacher_constraints").$type<Array<Record<string, unknown>>>().notNull(),
  teacherIntervention: jsonb("teacher_intervention").$type<Record<string, unknown>>().notNull(),
  retryIntent: jsonb("retry_intent").$type<Record<string, unknown>>().notNull(),
  runtimeHandoff: jsonb("runtime_handoff").$type<Record<string, unknown>>().notNull(),
  blockReasons: jsonb("block_reasons").$type<string[]>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("activity_plan_proposal_resolution_uq").on(table.capabilityResolutionId),
  uniqueIndex("activity_plan_proposal_replay_uq").on(table.institutionId, table.inputHash),
  index("activity_plan_proposal_task_idx").on(table.taskId, table.episodeId, table.createdAt),
  check("activity_plan_proposal_state_ck", sql`${table.state} IN ('READY','BLOCKED','ESCALATED')`),
  check("activity_plan_proposal_decision_ck", sql`${table.resolutionDecision} IN ('EXISTING','PARAMETERIZE','COMPOSE','ADAPT','GENERATE','NO_MATCH')`),
  check("activity_plan_proposal_payload_ck", sql`
    (${table.state} = 'READY' AND ${table.resolutionDecision} = 'EXISTING'
      AND ${table.selectedCapabilityId} IS NOT NULL AND ${table.selectedCapabilityVersionId} IS NOT NULL
      AND ${table.selectedVersionContentHash} IS NOT NULL AND jsonb_array_length(${table.stages}) > 0
      AND (${table.runtimeHandoff}->>'executable')::boolean
      AND jsonb_typeof(${table.runtimeHandoff}->'capabilityVersionId')='string'
      AND ${table.runtimeHandoff}->>'capabilityVersionId'=${table.selectedCapabilityVersionId}::text)
    OR (${table.state} <> 'READY' AND ${table.selectedCapabilityId} IS NULL
      AND ${table.selectedCapabilityVersionId} IS NULL AND ${table.selectedVersionContentHash} IS NULL
      AND jsonb_array_length(${table.stages}) = 0 AND NOT (${table.runtimeHandoff}->>'executable')::boolean
      AND ${table.runtimeHandoff} ? 'capabilityVersionId'
      AND ${table.runtimeHandoff}->'capabilityVersionId'='null'::jsonb)
  `),
  check("activity_plan_proposal_json_ck", sql`
    jsonb_typeof(${table.stages})='array' AND jsonb_typeof(${table.teacherConstraints})='array'
    AND jsonb_typeof(${table.teacherIntervention})='object' AND jsonb_typeof(${table.retryIntent})='object'
    AND jsonb_typeof(${table.runtimeHandoff})='object' AND jsonb_typeof(${table.blockReasons})='array'
    AND jsonb_typeof(${table.runtimeHandoff}->'executable')='boolean'
    AND jsonb_typeof(${table.retryIntent}->'formalRetryCreated')='boolean'
    AND NOT (${table.retryIntent}->>'formalRetryCreated')::boolean
    AND length(${table.inputHash}) > 7 AND length(${table.policyVersion}) > 0 AND length(btrim(${table.rationale})) > 0
  `),
]);

/** Class A: immutable exact stage accepted for one authorized runtime launch. */
export const activityPlans = product.table("activity_plans", {
  id: uuid("id").primaryKey(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  activityPlanProposalId: uuid("activity_plan_proposal_id").notNull().references(() => activityPlanProposals.id),
  contextCompilationId: uuid("context_compilation_id").notNull().references(() => contextCompilations.id),
  diagnosticObservationId: uuid("diagnostic_observation_id").notNull().references(() => diagnosticObservations.id),
  capabilityResolutionId: uuid("capability_resolution_id").notNull().references(() => capabilityResolutions.id),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  capabilityVersionId: uuid("capability_version_id").notNull().references(() => capabilityVersions.id),
  capabilityVersionContentHash: text("capability_version_content_hash").notNull(),
  runtimeContractHash: text("runtime_contract_hash").notNull(),
  implementationKey: text("implementation_key").notNull(),
  runtimeKind: text("runtime_kind").notNull(),
  stageOrder: integer("stage_order").notNull(),
  stageSnapshot: jsonb("stage_snapshot").$type<Record<string, unknown>>().notNull(),
  runtimeContract: jsonb("runtime_contract").$type<Record<string, unknown>>().notNull(),
  evidenceProvenance: jsonb("evidence_provenance").$type<Record<string, unknown>>().notNull(),
  inputHash: text("input_hash").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("activity_plan_proposal_uq").on(table.activityPlanProposalId),
  uniqueIndex("activity_plan_input_hash_uq").on(table.institutionId, table.inputHash),
  index("activity_plan_task_idx").on(table.taskId, table.episodeId, table.createdAt),
  check("activity_plan_exact_stage_ck", sql`${table.stageOrder} = 1 AND length(${table.capabilityVersionContentHash}) > 7 AND length(${table.runtimeContractHash}) > 7 AND length(${table.inputHash}) > 7`),
  check("activity_plan_runtime_json_ck", sql`jsonb_typeof(${table.stageSnapshot})='object' AND jsonb_typeof(${table.runtimeContract})='object' AND jsonb_typeof(${table.evidenceProvenance})='object'`),
]);

/** Class A: one bounded execution fact for one immutable ActivityPlan stage. */
export const runtimeDeliveries = product.table("runtime_deliveries", {
  id: uuid("id").primaryKey(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => users.id),
  activityPlanId: uuid("activity_plan_id").notNull().references(() => activityPlans.id),
  retryOfDeliveryId: uuid("retry_of_delivery_id").references((): AnyPgColumn => runtimeDeliveries.id),
  attemptNumber: integer("attempt_number").default(1).notNull(),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  capabilityVersionId: uuid("capability_version_id").notNull().references(() => capabilityVersions.id),
  capabilityVersionContentHash: text("capability_version_content_hash").notNull(),
  runtimeContractHash: text("runtime_contract_hash").notNull(),
  implementationKey: text("implementation_key").notNull(),
  runtimeKind: text("runtime_kind").notNull(),
  requestHash: text("request_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(),
  deadlineMs: integer("deadline_ms").notNull(),
  normalizedOutput: jsonb("normalized_output").$type<Record<string, unknown>>(),
  normalizedError: jsonb("normalized_error").$type<Record<string, unknown>>(),
  outputHash: text("output_hash"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("runtime_delivery_plan_attempt_uq").on(table.activityPlanId, table.attemptNumber),
  uniqueIndex("runtime_delivery_retry_of_uq").on(table.retryOfDeliveryId).where(sql`${table.retryOfDeliveryId} IS NOT NULL`),
  uniqueIndex("runtime_delivery_replay_uq").on(table.institutionId, table.idempotencyKey),
  index("runtime_delivery_task_idx").on(table.taskId, table.episodeId, table.startedAt),
  check("runtime_delivery_status_ck", sql`${table.status} IN ('PENDING','RUNNING','SUCCEEDED','FAILED','TIMED_OUT','CANCELLED')`),
  check("runtime_delivery_deadline_ck", sql`${table.deadlineMs} > 0 AND ${table.deadlineMs} <= 120000`),
  check("runtime_delivery_retry_ck", sql`(${table.attemptNumber}=1 AND ${table.retryOfDeliveryId} IS NULL) OR (${table.attemptNumber}=2 AND ${table.retryOfDeliveryId} IS NOT NULL)`),
  check("runtime_delivery_terminal_ck", sql`
    (${table.status} IN ('PENDING','RUNNING') AND ${table.finishedAt} IS NULL AND ${table.normalizedOutput} IS NULL AND ${table.normalizedError} IS NULL AND ${table.outputHash} IS NULL)
    OR (${table.status}='SUCCEEDED' AND ${table.finishedAt} IS NOT NULL AND ${table.normalizedOutput} IS NOT NULL AND ${table.normalizedError} IS NULL AND ${table.outputHash} IS NOT NULL)
    OR (${table.status} IN ('FAILED','TIMED_OUT','CANCELLED') AND ${table.finishedAt} IS NOT NULL AND ${table.normalizedOutput} IS NULL AND ${table.normalizedError} IS NOT NULL AND ${table.outputHash} IS NULL)
  `),
]);

/** Class A: append-only, delivery-local ordered runtime and learner interaction fact. */
export const learningEvents = product.table("learning_events", {
  id: uuid("id").primaryKey(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  activityPlanId: uuid("activity_plan_id").notNull().references(() => activityPlans.id),
  runtimeDeliveryId: uuid("runtime_delivery_id").notNull().references(() => runtimeDeliveries.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  eventKey: text("event_key").notNull(),
  eventType: text("event_type").notNull(),
  actorType: text("actor_type").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<Array<Record<string, string>>>().notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("learning_event_delivery_sequence_uq").on(table.runtimeDeliveryId, table.sequence),
  uniqueIndex("learning_event_delivery_key_uq").on(table.runtimeDeliveryId, table.eventKey),
  index("learning_event_task_idx").on(table.taskId, table.episodeId, table.createdAt),
  check("learning_event_sequence_ck", sql`${table.sequence} BETWEEN 1 AND 5`),
  check("learning_event_actor_ck", sql`
    (${table.actorType}='SYSTEM' AND ${table.actorUserId} IS NULL)
    OR (${table.actorType}='LEARNER' AND ${table.actorUserId} IS NOT NULL)
  `),
  check("learning_event_json_ck", sql`jsonb_typeof(${table.payload})='object' AND jsonb_typeof(${table.evidenceRefs})='array' AND length(btrim(${table.eventKey}))>0 AND length(btrim(${table.eventType}))>0`),
]);

/** Class A: authenticated teacher assignment that creates one existing LearningTask. */
export const teacherAssignments = product.table("teacher_assignments", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  learnerId: uuid("learner_id").notNull().references(() => users.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull().references(() => users.id),
  status: text("status").default("ASSIGNED").notNull(),
  instructions: text("instructions").notNull(),
  completionRule: text("completion_rule").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  actorProvenance: jsonb("actor_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("teacher_assignment_task_uq").on(table.taskId),
  uniqueIndex("teacher_assignment_actor_key_uq").on(table.institutionId, table.teacherId, table.idempotencyKey),
  index("teacher_assignment_course_idx").on(table.institutionId, table.courseId, table.createdAt),
  check("teacher_assignment_status_ck", sql`${table.status} = 'ASSIGNED'`),
  check("teacher_assignment_payload_ck", sql`length(btrim(${table.instructions})) > 0 AND length(btrim(${table.completionRule})) > 0`),
  check("teacher_assignment_provenance_ck", sql`length(${table.actorProvenance}->>'userId') > 0 AND length(${table.actorProvenance}->>'institutionId') > 0 AND length(${table.actorProvenance}->>'authMethod') > 0 AND length(${table.actorProvenance}->>'sessionId') > 0 AND length(${table.actorProvenance}->>'authenticatedAt') > 0 AND jsonb_typeof(${table.actorProvenance}->'roles')='array' AND ${table.actorProvenance}->'roles' @> '["TEACHER"]'::jsonb AND (${table.actorProvenance}->>'authMethod') NOT LIKE 'migrated-%'`),
]);

/** Class A: append-only authenticated teacher action over exact completed runtime lineage. */
export const teacherInterventions = product.table("teacher_interventions", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  runtimeDeliveryId: uuid("runtime_delivery_id").notNull().references(() => runtimeDeliveries.id),
  learnerAttemptId: uuid("learner_attempt_id").notNull().references(() => learnerAttempts.id),
  activityPlanId: uuid("activity_plan_id").notNull().references(() => activityPlans.id),
  diagnosticObservationId: uuid("diagnostic_observation_id").notNull().references(() => diagnosticObservations.id),
  contextCompilationId: uuid("context_compilation_id").notNull().references(() => contextCompilations.id),
  capabilityResolutionId: uuid("capability_resolution_id").notNull().references(() => capabilityResolutions.id),
  capabilityVersionId: uuid("capability_version_id").notNull().references(() => capabilityVersions.id),
  constraintCapabilityId: uuid("constraint_capability_id").notNull().references(() => capabilities.id),
  constraintCapabilityKeySnapshot: text("constraint_capability_key_snapshot").notNull(),
  teacherId: uuid("teacher_id").notNull().references(() => users.id),
  actionType: text("action_type").notNull(),
  reason: text("reason").notNull(),
  status: text("status").default("RECORDED").notNull(),
  targetLineage: jsonb("target_lineage").$type<Record<string, unknown>>().notNull(),
  actorProvenance: jsonb("actor_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("teacher_intervention_task_idx").on(table.taskId, table.episodeId, table.createdAt),
  uniqueIndex("teacher_intervention_actor_key_uq").on(table.institutionId, table.teacherId, table.idempotencyKey),
  check("teacher_intervention_action_ck", sql`${table.actionType} IN ('REQUIRE_CAPABILITY','EXCLUDE_CAPABILITY')`),
  check("teacher_intervention_status_ck", sql`${table.status} = 'RECORDED'`),
  check("teacher_intervention_payload_ck", sql`length(btrim(${table.reason})) > 0 AND length(btrim(${table.constraintCapabilityKeySnapshot})) > 0 AND jsonb_typeof(${table.targetLineage})='object' AND ${table.targetLineage}<>'{}'::jsonb`),
  check("teacher_intervention_provenance_ck", sql`length(${table.actorProvenance}->>'userId') > 0 AND length(${table.actorProvenance}->>'institutionId') > 0 AND length(${table.actorProvenance}->>'authMethod') > 0 AND length(${table.actorProvenance}->>'sessionId') > 0 AND length(${table.actorProvenance}->>'authenticatedAt') > 0 AND jsonb_typeof(${table.actorProvenance}->'roles')='array' AND ${table.actorProvenance}->'roles' @> '["TEACHER"]'::jsonb AND (${table.actorProvenance}->>'authMethod') NOT LIKE 'migrated-%'`),
]);

/** Class A: append-only CapabilityRequirement or CapabilityExclusion. */
export const teacherCapabilityConstraints = product.table("teacher_capability_constraints", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  taskId: uuid("task_id").notNull().references(() => learningTasks.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => learningEpisodes.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull().references(() => users.id),
  effect: text("effect").notNull(),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  capabilityKeySnapshot: text("capability_key_snapshot").notNull(),
  reason: text("reason").notNull(),
  sourceAssignmentId: uuid("source_assignment_id").references(() => teacherAssignments.id),
  sourceInterventionId: uuid("source_intervention_id").references(() => teacherInterventions.id),
  supersedesConstraintId: uuid("supersedes_constraint_id").references((): AnyPgColumn => teacherCapabilityConstraints.id),
  createdAt: createdAt(),
}, (table) => [
  index("teacher_constraint_task_idx").on(table.taskId, table.episodeId, table.createdAt),
  uniqueIndex("teacher_constraint_one_successor_uq").on(table.supersedesConstraintId).where(sql`${table.supersedesConstraintId} IS NOT NULL`),
  uniqueIndex("teacher_constraint_assignment_uq").on(table.sourceAssignmentId, table.effect, table.capabilityId).where(sql`${table.sourceAssignmentId} IS NOT NULL`),
  uniqueIndex("teacher_constraint_intervention_uq").on(table.sourceInterventionId).where(sql`${table.sourceInterventionId} IS NOT NULL`),
  check("teacher_constraint_effect_ck", sql`${table.effect} IN ('REQUIRE','EXCLUDE')`),
  check("teacher_constraint_source_ck", sql`(${table.sourceAssignmentId} IS NOT NULL) <> (${table.sourceInterventionId} IS NOT NULL)`),
  check("teacher_constraint_payload_ck", sql`length(btrim(${table.capabilityKeySnapshot})) > 0 AND length(btrim(${table.reason})) > 0 AND (${table.supersedesConstraintId} IS NULL OR ${table.supersedesConstraintId} <> ${table.id})`),
]);

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

/**
 * Class A governed follow-up execution envelope. The physical table name is a
 * retained legacy mapping; activityType preserves Retry/Transfer/Retention as
 * distinct canonical records while all execution reuses the same orchestration.
 */
export const retryAttempts = product.table("retry_attempts", {
  id: id(),
  originalAttemptId: uuid("original_attempt_id").notNull().references(() => learnerAttempts.id),
  reviewedObservationId: uuid("reviewed_observation_id").notNull().references(() => diagnosticObservations.id),
  teacherReviewId: uuid("teacher_review_id").notNull().references(() => teacherReviews.id),
  activityType: text("activity_type").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").default("ASSIGNED").notNull(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => courses.id),
  taskId: uuid("task_id").references(() => learningTasks.id, { onDelete: "cascade" }),
  sourceEpisodeId: uuid("source_episode_id").references(() => learningEpisodes.id),
  targetEpisodeId: uuid("target_episode_id").references(() => learningEpisodes.id),
  learnerId: uuid("learner_id").references(() => users.id),
  contextItemId: uuid("context_item_id").references(() => contextItems.id),
  activityPlanProposalId: uuid("activity_plan_proposal_id").references(() => activityPlanProposals.id),
  activityPlanId: uuid("activity_plan_id").references(() => activityPlans.id),
  runtimeDeliveryId: uuid("runtime_delivery_id").references(() => runtimeDeliveries.id),
  resultAttemptId: uuid("result_attempt_id").references(() => learnerAttempts.id),
  resultObservationId: uuid("result_observation_id").references(() => diagnosticObservations.id),
  resultReviewId: uuid("result_review_id").references(() => teacherReviews.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  sourceLineage: jsonb("source_lineage").$type<Record<string, unknown>>(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  actorProvenance: jsonb("actor_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>(),
  idempotencyKey: text("idempotency_key"),
  assignmentRequestHash: text("assignment_request_hash"),
  latestTransitionEventId: uuid("latest_transition_event_id").references((): AnyPgColumn => governanceEvents.id),
  cancellationState: jsonb("cancellation_state").$type<Record<string, unknown>>(),
  failureState: jsonb("failure_state").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("governed_followup_target_episode_uq").on(table.targetEpisodeId).where(sql`${table.targetEpisodeId} IS NOT NULL`),
  uniqueIndex("governed_followup_plan_proposal_uq").on(table.activityPlanProposalId).where(sql`${table.activityPlanProposalId} IS NOT NULL`),
  uniqueIndex("governed_followup_plan_uq").on(table.activityPlanId).where(sql`${table.activityPlanId} IS NOT NULL`),
  uniqueIndex("governed_followup_delivery_uq").on(table.runtimeDeliveryId).where(sql`${table.runtimeDeliveryId} IS NOT NULL`),
  uniqueIndex("governed_followup_actor_key_uq").on(table.institutionId, table.actorUserId, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`),
  check("retry_activity_ck", sql`${table.activityType} IN ('RETRY','TRANSFER','RETENTION')`),
  check("retry_status_ck", sql`${table.status} IN ('ASSIGNED','IN_PROGRESS','WAITING_FOR_REVIEW','REVIEWED','ESCALATED','CANCELLED','FAILED_RECOVERABLE','FAILED_FINAL')`),
  check("governed_followup_json_ck", sql`
    (${table.idempotencyKey} IS NULL AND ${table.institutionId} IS NULL AND ${table.courseId} IS NULL
      AND ${table.taskId} IS NULL AND ${table.sourceEpisodeId} IS NULL AND ${table.targetEpisodeId} IS NULL
      AND ${table.learnerId} IS NULL AND ${table.contextItemId} IS NULL
      AND ${table.activityPlanProposalId} IS NULL AND ${table.activityPlanId} IS NULL
      AND ${table.runtimeDeliveryId} IS NULL AND ${table.sourceLineage} IS NULL
      AND ${table.actorUserId} IS NULL AND ${table.actorProvenance} IS NULL
      AND ${table.assignmentRequestHash} IS NULL
      AND ${table.latestTransitionEventId} IS NULL AND ${table.cancellationState} IS NULL
      AND ${table.failureState} IS NULL)
    OR (${table.idempotencyKey} IS NOT NULL AND ${table.institutionId} IS NOT NULL AND ${table.courseId} IS NOT NULL
      AND ${table.taskId} IS NOT NULL AND ${table.sourceEpisodeId} IS NOT NULL AND ${table.targetEpisodeId} IS NOT NULL
      AND ${table.learnerId} IS NOT NULL AND ${table.contextItemId} IS NOT NULL AND ${table.actorUserId} IS NOT NULL
      AND ${table.assignmentRequestHash} IS NOT NULL AND length(btrim(${table.assignmentRequestHash}))>7
      AND ${table.sourceLineage} IS NOT NULL AND jsonb_typeof(${table.sourceLineage})='object' AND ${table.sourceLineage}<>'{}'::jsonb
      AND ${table.actorProvenance} IS NOT NULL AND jsonb_typeof(${table.actorProvenance})='object')
  `),
  check("governed_followup_terminal_fact_ck", sql`
    (${table.status}<>'CANCELLED' OR (${table.cancellationState} IS NOT NULL
      AND jsonb_typeof(${table.cancellationState})='object'
      AND length(btrim(${table.cancellationState}->>'actorUserId'))>0
      AND length(btrim(${table.cancellationState}->>'recordedAt'))>0
      AND length(btrim(${table.cancellationState}->>'reason'))>0
      AND jsonb_typeof(${table.cancellationState}->'externalWorkMayStillFinish')='boolean'))
    AND (${table.status} NOT IN ('FAILED_RECOVERABLE','FAILED_FINAL') OR (${table.failureState} IS NOT NULL
      AND jsonb_typeof(${table.failureState})='object'
      AND length(btrim(${table.failureState}->>'actorUserId'))>0
      AND length(btrim(${table.failureState}->>'recordedAt'))>0
      AND length(btrim(${table.failureState}->>'reason'))>0
      AND jsonb_typeof(${table.failureState}->'externalWorkMayStillFinish')='boolean'))
  `),
  check("governed_followup_result_ck", sql`
    (${table.status} IN ('ASSIGNED','IN_PROGRESS','FAILED_RECOVERABLE','FAILED_FINAL','CANCELLED')
      AND ${table.resultReviewId} IS NULL)
    OR (${table.status}='WAITING_FOR_REVIEW' AND ${table.activityPlanId} IS NOT NULL AND ${table.runtimeDeliveryId} IS NOT NULL
      AND ${table.resultAttemptId} IS NOT NULL AND ${table.resultObservationId} IS NOT NULL AND ${table.resultReviewId} IS NULL)
    OR (${table.status} IN ('REVIEWED','ESCALATED') AND ${table.activityPlanId} IS NOT NULL AND ${table.runtimeDeliveryId} IS NOT NULL
      AND ${table.resultAttemptId} IS NOT NULL AND ${table.resultObservationId} IS NOT NULL AND ${table.resultReviewId} IS NOT NULL)
    OR (${table.idempotencyKey} IS NULL AND ${table.status} IN ('ASSIGNED','REVIEWED','ESCALATED'))
  `),
]);

export const transferActivities = product.table("transfer_activities", {
  id: id(),
  activityId: uuid("retry_id").notNull().references(() => retryAttempts.id, { onDelete: "cascade" }).unique(),
  targetConcept: text("target_concept").notNull(),
  evidenceUnitId: uuid("evidence_unit_id").references(() => evidenceUnits.id),
  contractVersion: text("contract_version").default("LEGACY_UNVERIFIED").notNull(),
  declaration: jsonb("declaration").$type<Record<string, unknown>>().default({}).notNull(),
  changedDimensions: jsonb("changed_dimensions").$type<string[]>().default([]).notNull(),
  createdAt: createdAt(),
}, (table) => [check("transfer_material_difference_ck", sql`
  ${table.contractVersion}='LEGACY_UNVERIFIED' OR (${table.contractVersion}='CAP06_V1'
  AND jsonb_typeof(${table.declaration})='object'
  AND ${table.declaration}->>'evidenceLimit'='TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN'
  AND jsonb_typeof(${table.declaration}->'source')='object'
  AND jsonb_typeof(${table.declaration}->'target')='object'
  AND jsonb_typeof(${table.changedDimensions})='array'
  AND jsonb_array_length(${table.changedDimensions})>0
  AND ${table.changedDimensions}<@'["context","representation","itemFamily","problemStructure"]'::jsonb
  )
`)]);

export const retentionReviews = product.table("retention_reviews", {
  id: id(),
  activityId: uuid("retry_id").notNull().references(() => retryAttempts.id, { onDelete: "cascade" }).unique(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  evidenceUnitId: uuid("evidence_unit_id").references(() => evidenceUnits.id),
  contractVersion: text("contract_version").default("LEGACY_UNVERIFIED").notNull(),
  declaredDelaySeconds: integer("declared_delay_seconds").default(0).notNull(),
  interveningExposure: jsonb("intervening_exposure").$type<Record<string, unknown>>().default({}).notNull(),
  contentEquivalence: jsonb("content_equivalence").$type<Record<string, unknown>>().default({}).notNull(),
  assistancePolicy: jsonb("assistance_policy").$type<Record<string, unknown>>().default({}).notNull(),
  completedInterveningExposure: jsonb("completed_intervening_exposure").$type<Record<string, unknown>>(),
  exposureConfirmedAt: timestamp("exposure_confirmed_at", { withTimezone: true }),
  exposureConfirmedBy: uuid("exposure_confirmed_by").references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [check("retention_contract_ck", sql`
  ${table.contractVersion}='LEGACY_UNVERIFIED' OR (${table.contractVersion}='CAP06_V1'
  AND ${table.declaredDelaySeconds}>0
  AND ${table.dueAt}>=${table.createdAt}+(${table.declaredDelaySeconds} * interval '1 second')
  AND jsonb_typeof(${table.interveningExposure})='object'
  AND jsonb_typeof(${table.contentEquivalence})='object'
  AND jsonb_typeof(${table.assistancePolicy})='object'
  AND ((${table.completedAt} IS NULL AND ${table.completedInterveningExposure} IS NULL
      AND ${table.exposureConfirmedAt} IS NULL AND ${table.exposureConfirmedBy} IS NULL)
    OR (${table.completedAt} IS NOT NULL AND jsonb_typeof(${table.completedInterveningExposure})='object'
      AND ${table.exposureConfirmedAt} IS NOT NULL AND ${table.exposureConfirmedBy} IS NOT NULL))
  )
`)]);

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
  capabilityId: uuid("capability_id").references(() => capabilities.id),
  assetType: text("asset_type").default("TEACHING_SUPPORT").notNull(),
  sourceCapabilityResolutionId: uuid("source_capability_resolution_id").references(() => capabilityResolutions.id),
  sourceActivityPlanProposalId: uuid("source_activity_plan_proposal_id").references(() => activityPlanProposals.id),
  supplyStrategy: text("supply_strategy"),
  adaptedFromCapabilityId: uuid("adapted_from_capability_id").references(() => capabilities.id),
  adaptedFromCapabilityVersionId: uuid("adapted_from_capability_version_id").references(() => capabilityVersions.id),
  adaptedFromContentHash: text("adapted_from_content_hash"),
  adaptedFromComponentVersionId: uuid("adapted_from_component_version_id").references((): AnyPgColumn => componentVersions.id),
  adaptedFromComponentContentHash: text("adapted_from_component_content_hash"),
  registeredCapabilityId: uuid("registered_capability_id").references(() => capabilities.id),
  registeredCapabilityVersionId: uuid("registered_capability_version_id").references(() => capabilityVersions.id),
  referencePackKey: text("reference_pack_key").notNull(),
  failureCode: text("failure_code"),
  key: text("key").notNull(),
  title: text("title").notNull(),
  status: text("status").default("CANDIDATE").notNull(),
  sourceSignal: jsonb("source_signal").$type<Record<string, unknown>>().notNull(),
  activeVersionId: uuid("active_version_id"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("components_institution_key_uq").on(table.institutionId, table.key),
  uniqueIndex("components_source_resolution_uq").on(table.sourceCapabilityResolutionId).where(sql`${table.sourceCapabilityResolutionId} IS NOT NULL`),
]);

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

/** Class B: exact proposed Web ComponentAsset execution; never a learner delivery or Attempt. */
export const componentAssetPreviews = product.table("component_asset_previews", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  componentVersionId: uuid("component_version_id").notNull().references(() => componentVersions.id),
  componentEvaluationId: uuid("component_evaluation_id").notNull().references(() => componentEvaluations.id),
  sourceCapabilityResolutionId: uuid("source_capability_resolution_id").notNull().references(() => capabilityResolutions.id),
  contentHash: text("content_hash").notNull(),
  requestHash: text("request_hash").notNull(),
  learnerInput: jsonb("learner_input").$type<Record<string, unknown>>().notNull(),
  runtimeOutput: jsonb("runtime_output").$type<Record<string, unknown>>().notNull(),
  eventTrace: jsonb("event_trace").$type<Array<Record<string, unknown>>>().notNull(),
  executorVersion: text("executor_version").notNull(),
  executorReceiptHash: text("executor_receipt_hash").notNull(),
  status: text("status").notNull(),
  previewedBy: uuid("previewed_by").notNull().references(() => users.id),
  actorProvenance: jsonb("actor_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("component_asset_preview_actor_key_uq").on(table.institutionId, table.previewedBy, table.idempotencyKey),
  index("component_asset_preview_version_idx").on(table.componentVersionId, table.createdAt),
  check("component_asset_preview_status_ck", sql`${table.status} IN ('SUCCEEDED','FAILED')`),
]);

/** Class A: human-authorized exact-version scoped availability; immutable and separate from Eval. */
export const capabilityAvailabilityDecisions = product.table("capability_availability_decisions", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  capabilityVersionId: uuid("capability_version_id").notNull().references(() => capabilityVersions.id),
  componentVersionId: uuid("component_version_id").notNull().references(() => componentVersions.id),
  confirmationDecisionId: uuid("confirmation_decision_id").notNull().references(() => publicationDecisions.id),
  availabilityStatus: text("availability_status").notNull(),
  availabilityScope: jsonb("availability_scope").$type<Record<string, unknown>>().notNull(),
  confirmedBy: uuid("confirmed_by").notNull().references(() => users.id),
  actorProvenance: jsonb("actor_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>().notNull(),
  rationale: text("rationale").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("capability_availability_confirmation_uq").on(table.confirmationDecisionId),
  uniqueIndex("capability_availability_exact_version_uq").on(table.capabilityVersionId),
  check("capability_availability_status_ck", sql`${table.availabilityStatus} IN ('AVAILABLE','DISABLED')`),
]);

/** Class A: protected learner-to-supply lineage; never embedded in a reusable Registry contract. */
export const capabilitySupplyRelations = product.table("capability_supply_relations", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  sourceCapabilityResolutionId: uuid("source_capability_resolution_id").notNull().references(() => capabilityResolutions.id),
  sourceActivityPlanProposalId: uuid("source_activity_plan_proposal_id").notNull().references(() => activityPlanProposals.id),
  sourceDiagnosticObservationId: uuid("source_diagnostic_observation_id").notNull().references(() => diagnosticObservations.id),
  sourceAttemptId: uuid("source_attempt_id").notNull().references(() => learnerAttempts.id),
  componentId: uuid("component_id").notNull().references(() => components.id),
  componentVersionId: uuid("component_version_id").notNull().references(() => componentVersions.id),
  registeredCapabilityId: uuid("registered_capability_id").notNull().references(() => capabilities.id),
  registeredCapabilityVersionId: uuid("registered_capability_version_id").notNull().references(() => capabilityVersions.id),
  confirmationDecisionId: uuid("confirmation_decision_id").notNull().references(() => publicationDecisions.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("capability_supply_relation_source_uq").on(table.sourceCapabilityResolutionId),
  uniqueIndex("capability_supply_relation_version_uq").on(table.registeredCapabilityVersionId),
  uniqueIndex("capability_supply_relation_confirmation_uq").on(table.confirmationDecisionId),
  index("capability_supply_relation_course_idx").on(table.institutionId, table.courseId, table.createdAt),
]);

/** Class B: evidence-bound suggestion to improve one exact ComponentAssetVersion. */
export const assetOptimizationProposals = product.table("asset_optimization_proposals", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  componentId: uuid("component_id").notNull().references(() => components.id),
  componentVersionId: uuid("component_version_id").notNull().references(() => componentVersions.id),
  componentVersionContentHash: text("component_version_content_hash").notNull(),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  capabilityVersionId: uuid("capability_version_id").notNull().references(() => capabilityVersions.id),
  capabilityVersionContentHash: text("capability_version_content_hash").notNull(),
  capabilitySupplyRelationId: uuid("capability_supply_relation_id").notNull().references(() => capabilitySupplyRelations.id),
  runtimeDeliveryId: uuid("runtime_delivery_id").notNull().references(() => runtimeDeliveries.id),
  learnerAttemptId: uuid("learner_attempt_id").notNull().references(() => learnerAttempts.id),
  learnerAttemptContentHash: text("learner_attempt_content_hash").notNull(),
  proposalType: text("proposal_type").notNull(),
  signalKind: text("signal_kind").notNull(),
  rationale: text("rationale").notNull(),
  proposedChange: jsonb("proposed_change").$type<Record<string, unknown>>().notNull(),
  evidenceSnapshot: jsonb("evidence_snapshot").$type<Record<string, unknown>>().notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<Array<Record<string, string>>>().notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  limitations: jsonb("limitations").$type<string[]>().notNull(),
  ruleKey: text("rule_key").notNull(),
  ruleVersion: text("rule_version").notNull(),
  confidence: real("confidence").notNull(),
  state: text("state").notNull(),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  requesterProvenance: jsonb("requester_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>().notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("asset_optimization_delivery_uq").on(table.runtimeDeliveryId),
  uniqueIndex("asset_optimization_request_hash_uq").on(table.institutionId, table.requestHash),
  index("asset_optimization_course_idx").on(table.institutionId, table.courseId, table.createdAt),
  check("asset_optimization_type_ck", sql`${table.proposalType} = 'ASSET' AND ${table.signalKind} = 'INCORRECT_ATTEMPT'`),
  check("asset_optimization_state_ck", sql`${table.state} = 'PENDING_GOVERNANCE'`),
  check("asset_optimization_confidence_ck", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  check("asset_optimization_json_ck", sql`jsonb_typeof(${table.proposedChange})='object' AND jsonb_typeof(${table.evidenceSnapshot})='object' AND jsonb_typeof(${table.evidenceRefs})='array' AND jsonb_typeof(${table.limitations})='array'`),
  check("asset_optimization_hash_ck", sql`length(${table.componentVersionContentHash})>7 AND length(${table.capabilityVersionContentHash})>7 AND length(${table.learnerAttemptContentHash})>7 AND length(${table.evidenceHash})>7 AND length(${table.requestHash})>7`),
]);

/** Class A: append-only human governance of an Asset Optimization Proposal's next action. */
export const assetOptimizationDecisions = product.table("asset_optimization_decisions", {
  id: id(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id").notNull().references(() => assetOptimizationProposals.id),
  componentId: uuid("component_id").notNull().references(() => components.id),
  componentVersionId: uuid("component_version_id").notNull().references(() => componentVersions.id),
  action: text("action").notNull(),
  rationale: text("rationale").notNull(),
  decidedBy: uuid("decided_by").notNull().references(() => users.id),
  actorProvenance: jsonb("actor_provenance").$type<{ userId: string; institutionId: string; roles: string[]; authMethod: string; sessionId: string; authenticatedAt: string }>().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("asset_optimization_decision_proposal_uq").on(table.proposalId),
  uniqueIndex("asset_optimization_decision_actor_key_uq").on(table.institutionId, table.decidedBy, table.idempotencyKey),
  check("asset_optimization_decision_action_ck", sql`${table.action} IN ('REQUEST_SUCCESSOR','KEEP_CURRENT')`),
  check("asset_optimization_decision_payload_ck", sql`length(btrim(${table.rationale}))>=5 AND length(${table.requestHash})>7`),
]);

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

/** Redacted authentication, authorization and service-activity audit events. */
export const securityEvents = operational.table("security_events", {
  id: id(),
  institutionId: uuid("institution_id").references(() => institutions.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  sessionId: uuid("session_id").references(() => authSessions.id),
  eventClass: text("event_class").notNull(),
  eventCode: text("event_code").notNull(),
  principal: text("principal"),
  purpose: text("purpose"),
  detail: jsonb("detail").$type<Record<string, string | number | boolean | null>>().default({}).notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("security_events_scope_idx").on(table.institutionId, table.createdAt),
  check("security_event_class_ck", sql`${table.eventClass} IN ('AUTHENTICATION','AUTHORIZATION','SERVICE')`),
]);

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
  actorUserId: uuid("actor_user_id").references(() => users.id),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.institutionId, table.commandType, table.key] })]);

export type UserRecord = typeof users.$inferSelect;
export type LearningTaskRecord = typeof learningTasks.$inferSelect;
export type EvidenceUnitRecord = typeof evidenceUnits.$inferSelect;
