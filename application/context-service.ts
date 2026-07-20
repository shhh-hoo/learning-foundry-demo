import { and, desc, eq, inArray } from "drizzle-orm";
import {
  compileContext,
  DEFAULT_CONTEXT_MODALITY_BUDGET,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  stableContextJson,
} from "@/domain/context";
import type {
  Actor,
  CompiledContext,
  ContextConsumer,
  ContextItem,
  ContextProvenanceReference,
} from "@/domain/model";
import { getDb, withTenantDatabase } from "@/db/client";
import {
  contextCarryoverRelations,
  contextCompilations,
  contextItems,
  conversationEvents,
  courseEnrollments,
  evidenceDerivatives,
  evidenceUnits,
  institutionMemberships,
  learnerAttempts,
  learnerProfiles,
  learnerStrategyVersions,
  sourceAssetVersions,
  sourceRecords,
  teacherAssignments,
  teacherCapabilityConstraints,
  teacherInterventions,
} from "@/db/schema";
import { DomainInvariantError, requireRole } from "@/domain/invariants";
import { requireTaskEpisodeScope } from "@/application/task-scope";

type ContextConversationEvent = Pick<
  typeof conversationEvents.$inferSelect,
  "id" | "taskId" | "episodeId" | "content" | "supersedesEventId"
> & Partial<Pick<typeof conversationEvents.$inferSelect, "sourceRefs" | "evidenceRefs">>;

type ContextAttempt = Pick<
  typeof learnerAttempts.$inferSelect,
  "id" | "taskId" | "episodeId" | "response" | "fileAssetId" | "sourceRefs"
>;

type CanonicalContextRecord = typeof contextItems.$inferSelect;
type CarryoverRecord = typeof contextCarryoverRelations.$inferSelect;
type TeacherConstraintSource = {
  constraint: typeof teacherCapabilityConstraints.$inferSelect;
  assignment: typeof teacherAssignments.$inferSelect | null;
  intervention: typeof teacherInterventions.$inferSelect | null;
};

export type CompileAuthorizedContextInput = {
  taskId: string;
  episodeId: string;
  consumer: ContextConsumer;
  tokenBudget?: number;
  modalityBudget?: Record<string, number>;
};

function provenance(type: ContextProvenanceReference["type"], id: string, detail: Omit<ContextProvenanceReference, "type" | "id"> = {}): ContextProvenanceReference {
  return { type, id, ...detail };
}

function eventReferences(event: ContextConversationEvent): ContextProvenanceReference[] {
  return [
    provenance("CONVERSATION_EVENT", event.id),
    ...(event.sourceRefs ?? []).flatMap((reference) => reference.sourceId
      ? [provenance("SOURCE_RECORD", reference.sourceId, { version: reference.sourceVersion })]
      : []),
    ...(event.evidenceRefs ?? []).flatMap((reference) => reference.evidenceUnitId
      ? [provenance("EVIDENCE_UNIT", reference.evidenceUnitId)]
      : []),
  ];
}

export function contextItemsFromConversationEvents(events: ContextConversationEvent[]): ContextItem[] {
  const supersededEventIds = new Set(events.flatMap((event) => event.supersedesEventId ? [event.supersedesEventId] : []));
  return events.map((event) => ({
    id: `conversation-event:${event.id}`,
    taskId: event.taskId,
    episodeId: event.episodeId,
    kind: "CONVERSATION_EVENT",
    scope: "TASK",
    state: supersededEventIds.has(event.id) ? "SUPERSEDED" : "ACTIVE",
    content: event.content,
    modality: "TEXT",
    priority: 20,
    superseded: supersededEventIds.has(event.id),
    inclusionReason: "LEGACY_COMPATIBILITY",
    payload: { sourceRefs: event.sourceRefs ?? [], evidenceRefs: event.evidenceRefs ?? [] },
    provenanceRefs: eventReferences(event),
  }));
}

function contextItemsFromAttempts(attempts: ContextAttempt[]): ContextItem[] {
  return attempts.map((attempt) => ({
    id: `learner-attempt:${attempt.id}`,
    taskId: attempt.taskId,
    episodeId: attempt.episodeId,
    kind: "LEARNER_ATTEMPT",
    scope: "TASK",
    state: "ACTIVE",
    content: attempt.response,
    modality: attempt.fileAssetId ? "IMAGE" : "TEXT",
    priority: 25,
    inclusionReason: "LEGACY_COMPATIBILITY",
    payload: { sourceRefs: attempt.sourceRefs, fileAssetId: attempt.fileAssetId },
    provenanceRefs: [
      provenance("LEARNER_ATTEMPT", attempt.id),
      ...attempt.sourceRefs.flatMap((reference) => reference.sourceId
        ? [provenance("SOURCE_RECORD", reference.sourceId, { version: reference.sourceVersion })]
        : []),
    ],
  }));
}

function isTeacherConstraint(kind: string): boolean {
  return new Set([
    "TEACHER_CONSTRAINT",
    "TEACHER_CORRECTION",
    "CAPABILITY_REQUIREMENT",
    "CAPABILITY_EXCLUSION",
    "TEACHER_ASSIGNMENT",
    "GOVERNED_FOLLOWUP",
  ]).has(kind);
}

function statusForStrategy(status: string, invalidatedAt: Date | null): ContextItem["state"] {
  if (invalidatedAt) return "INVALIDATED";
  if (status === "STALE" || status === "SUPERSEDED" || status === "INVALIDATED") return status;
  return "ACTIVE";
}

function jsonRecords(value: unknown[]): Array<Record<string, unknown>> {
  return value as Array<Record<string, unknown>>;
}

async function compileAndPersist(actor: Actor, input: CompileAuthorizedContextInput): Promise<CompiledContext> {
  requireRole(actor, ["LEARNER", "TEACHER", "ADMIN"]);
  const learnerOriginated = actor.roles.includes("LEARNER") && !actor.roles.some((role) => role === "TEACHER" || role === "ADMIN");
  const scope = await requireTaskEpisodeScope(actor, {
    taskId: input.taskId,
    episodeId: input.episodeId,
    learnerOriginated,
  });
  const db = getDb();
  const now = new Date();

  const [profile] = await db.select().from(learnerProfiles)
    .where(eq(learnerProfiles.id, scope.task.learnerProfileId))
    .limit(1);
  if (!profile
    || profile.institutionId !== scope.task.institutionId
    || profile.learnerId !== scope.task.learnerId) {
    throw new DomainInvariantError("Learning Task learner profile lineage is missing or inconsistent", "CONTEXT_PROFILE_LINEAGE");
  }

  const [directItems, carryovers, strategies, events, attempts, teacherConstraintSources] = await Promise.all([
    db.select().from(contextItems).where(eq(contextItems.taskId, input.taskId)),
    db.select().from(contextCarryoverRelations).where(eq(contextCarryoverRelations.targetTaskId, input.taskId)),
    db.select().from(learnerStrategyVersions).where(eq(learnerStrategyVersions.learnerProfileId, profile.id)),
    db.select().from(conversationEvents).where(eq(conversationEvents.taskId, input.taskId)).orderBy(desc(conversationEvents.createdAt), desc(conversationEvents.id)).limit(30),
    db.select().from(learnerAttempts).where(eq(learnerAttempts.taskId, input.taskId)).orderBy(desc(learnerAttempts.createdAt), desc(learnerAttempts.id)).limit(10),
    db.select({
      constraint: teacherCapabilityConstraints,
      assignment: teacherAssignments,
      intervention: teacherInterventions,
    }).from(teacherCapabilityConstraints)
      .leftJoin(teacherAssignments, eq(teacherAssignments.id, teacherCapabilityConstraints.sourceAssignmentId))
      .leftJoin(teacherInterventions, eq(teacherInterventions.id, teacherCapabilityConstraints.sourceInterventionId))
      .where(and(
        eq(teacherCapabilityConstraints.taskId, input.taskId),
        eq(teacherCapabilityConstraints.episodeId, input.episodeId),
      )),
  ]);

  const activeStrategies = strategies.filter((strategy) => strategy.status === "ACTIVE"
    && !strategy.invalidatedAt
    && strategy.effectiveFrom <= now
    && (!strategy.effectiveUntil || strategy.effectiveUntil > now));
  const strategiesByKind = new Map<string, typeof activeStrategies>();
  for (const strategy of activeStrategies) strategiesByKind.set(strategy.kind, [...(strategiesByKind.get(strategy.kind) ?? []), strategy]);
  const conflictingKind = [...strategiesByKind.entries()].find(([, versions]) => versions.length > 1);
  if (conflictingKind) {
    throw new DomainInvariantError(`Multiple current learner strategy versions exist for ${conflictingKind[0]}`, "CONTEXT_STRATEGY_VERSION_CONFLICT");
  }

  const carryoverItemIds = [...new Set(carryovers.map((relation) => relation.sourceContextItemId))];
  const carriedItems = carryoverItemIds.length
    ? await db.select().from(contextItems).where(inArray(contextItems.id, carryoverItemIds))
    : [];
  const carriedById = new Map(carriedItems.map((item) => [item.id, item]));
  if (carriedItems.length !== carryoverItemIds.length) {
    throw new DomainInvariantError("A Context carryover source item is missing or unauthorized", "CONTEXT_CARRYOVER_LINEAGE");
  }

  const canonicalItems = [...directItems, ...carriedItems];
  const legacySourceIds = [...new Set([
    ...events.flatMap((event) => event.sourceRefs.flatMap((reference) => reference.sourceId ? [reference.sourceId] : [])),
    ...attempts.flatMap((attempt) => attempt.sourceRefs.flatMap((reference) => reference.sourceId ? [reference.sourceId] : [])),
  ])];
  const legacyEvidenceIds = [...new Set(events.flatMap((event) => event.evidenceRefs
    .flatMap((reference) => reference.evidenceUnitId ? [reference.evidenceUnitId] : [])))];
  const evidenceIds = [...new Set(canonicalItems.flatMap((item) => item.evidenceUnitId ? [item.evidenceUnitId] : [])
    .concat(legacyEvidenceIds))];
  const derivativeIds = [...new Set(canonicalItems.flatMap((item) => item.evidenceDerivativeId ? [item.evidenceDerivativeId] : []))];
  const [evidenceRows, derivativeRows] = await Promise.all([
    evidenceIds.length ? db.select().from(evidenceUnits).where(inArray(evidenceUnits.id, evidenceIds)) : [],
    derivativeIds.length ? db.select().from(evidenceDerivatives).where(inArray(evidenceDerivatives.id, derivativeIds)) : [],
  ]);
  const evidenceById = new Map(evidenceRows.map((item) => [item.id, item]));
  const derivativeById = new Map(derivativeRows.map((item) => [item.id, item]));
  const sourceIds = [...new Set(canonicalItems.flatMap((item) => item.sourceRecordId ? [item.sourceRecordId] : [])
    .concat(evidenceRows.map((item) => item.sourceId), legacySourceIds))];
  const sourceRows = sourceIds.length ? await db.select().from(sourceRecords).where(inArray(sourceRecords.id, sourceIds)) : [];
  const versionIds = [...new Set(canonicalItems.flatMap((item) => item.sourceAssetVersionId ? [item.sourceAssetVersionId] : [])
    .concat(evidenceRows.map((item) => item.sourceAssetVersionId))
    .concat(derivativeRows.map((item) => item.sourceAssetVersionId))
    .concat(sourceRows.map((item) => item.sourceAssetVersionId)))];
  const versionRows = versionIds.length ? await db.select().from(sourceAssetVersions).where(inArray(sourceAssetVersions.id, versionIds)) : [];
  const sourceById = new Map(sourceRows.map((item) => [item.id, item]));
  const versionById = new Map(versionRows.map((item) => [item.id, item]));
  if (sourceRows.length !== sourceIds.length || versionRows.length !== versionIds.length
    || evidenceRows.length !== evidenceIds.length || derivativeRows.length !== derivativeIds.length) {
    throw new DomainInvariantError("Context Evidence/Source lineage is missing or unauthorized", "CONTEXT_EVIDENCE_LINEAGE");
  }

  const authorityActorIds = [...new Set([
    ...canonicalItems.flatMap((item) => isTeacherConstraint(item.kind) && item.actorUserId ? [item.actorUserId] : []),
    ...carryovers.flatMap((relation) => relation.actorUserId ? [relation.actorUserId] : []),
    ...teacherConstraintSources.map(({ constraint }) => constraint.teacherId),
  ])];
  const [authorityMemberships, authorityEnrollments] = authorityActorIds.length
    ? await Promise.all([
      db.select().from(institutionMemberships).where(and(
        eq(institutionMemberships.institutionId, scope.task.institutionId),
        inArray(institutionMemberships.userId, authorityActorIds),
      )),
      db.select().from(courseEnrollments).where(and(
        eq(courseEnrollments.institutionId, scope.task.institutionId),
        eq(courseEnrollments.courseId, scope.task.courseId),
        inArray(courseEnrollments.userId, authorityActorIds),
      )),
    ])
    : [[], []];
  const authorityRoles = new Map<string, Set<string>>();
  for (const membership of authorityMemberships) {
    authorityRoles.set(membership.userId, new Set([...(authorityRoles.get(membership.userId) ?? []), membership.role]));
  }
  const authorityCourseRoles = new Map<string, Set<string>>();
  for (const enrollment of authorityEnrollments) {
    authorityCourseRoles.set(enrollment.userId, new Set([...(authorityCourseRoles.get(enrollment.userId) ?? []), enrollment.role]));
  }
  const hasTeacherAuthority = (userId: string): boolean => {
    const institutionRoles = authorityRoles.get(userId) ?? new Set<string>();
    const courseRoles = authorityCourseRoles.get(userId) ?? new Set<string>();
    return institutionRoles.has("ADMIN") || (institutionRoles.has("TEACHER") && courseRoles.has("TEACHER"));
  };
  const hasCap05TeacherCourseAuthority = (userId: string): boolean => {
    const institutionRoles = authorityRoles.get(userId) ?? new Set<string>();
    const courseRoles = authorityCourseRoles.get(userId) ?? new Set<string>();
    return institutionRoles.has("TEACHER") && courseRoles.has("TEACHER");
  };

  function sourceExclusion(source: typeof sourceRecords.$inferSelect, version: typeof sourceAssetVersions.$inferSelect): ContextItem["exclusionReason"] {
    if (!source.active || source.sourceAssetVersionId !== version.id
      || (version.effectiveFrom && version.effectiveFrom > now)
      || (version.effectiveUntil && version.effectiveUntil <= now)) return "SOURCE_INACTIVE";
    if (source.rightsAuthorizationStatus !== "APPROVED" || !source.allowedPurposes.includes("LEARNING")
      || version.rightsStatus !== "APPROVED") return "SOURCE_RIGHTS_UNAVAILABLE";
    return undefined;
  }

  function authorizeCompatibilityCandidate(
    candidate: ContextItem,
    sourceRefs: Array<Record<string, string>>,
    evidenceRefs: Array<Record<string, string>>,
  ): ContextItem {
    let exclusionReason = candidate.exclusionReason;
    const references = [...(candidate.provenanceRefs ?? [])];
    for (const sourceRef of sourceRefs) {
      const source = sourceRef.sourceId ? sourceById.get(sourceRef.sourceId) : undefined;
      const version = source ? versionById.get(source.sourceAssetVersionId) : undefined;
      if (!source || !version) {
        throw new DomainInvariantError("Compatibility Context references missing Source lineage", "CONTEXT_EVIDENCE_LINEAGE");
      }
      if (sourceRef.sourceVersion && sourceRef.sourceVersion !== source.version) {
        throw new DomainInvariantError("Compatibility Context Source version conflicts with its exact reference", "CONTEXT_SOURCE_VERSION_CONFLICT");
      }
      exclusionReason = sourceExclusion(source, version) ?? exclusionReason;
      references.push(
        provenance("SOURCE_RECORD", source.id, { version: source.version, contentHash: source.contentHash }),
        provenance("SOURCE_ASSET_VERSION", version.id, { version: version.versionKey, contentHash: version.contentHash }),
      );
    }
    for (const evidenceRef of evidenceRefs) {
      const evidence = evidenceRef.evidenceUnitId ? evidenceById.get(evidenceRef.evidenceUnitId) : undefined;
      const source = evidence ? sourceById.get(evidence.sourceId) : undefined;
      const version = evidence ? versionById.get(evidence.sourceAssetVersionId) : undefined;
      if (!evidence || !source || !version || source.sourceAssetId !== version.sourceAssetId) {
        throw new DomainInvariantError("Compatibility Context references inconsistent Evidence lineage", "CONTEXT_EVIDENCE_LINEAGE");
      }
      exclusionReason = sourceExclusion(source, version) ?? exclusionReason;
      references.push(
        provenance("EVIDENCE_UNIT", evidence.id, { contentHash: evidence.contentHash }),
        provenance("SOURCE_RECORD", source.id, { version: source.version, contentHash: source.contentHash }),
        provenance("SOURCE_ASSET_VERSION", version.id, { version: version.versionKey, contentHash: version.contentHash }),
      );
    }
    return { ...candidate, exclusionReason, provenanceRefs: references };
  }

  for (const relation of carryovers) {
    const item = carriedById.get(relation.sourceContextItemId);
    if (!item || item.taskId !== relation.sourceTaskId || relation.targetTaskId !== input.taskId
      || item.institutionId !== scope.task.institutionId || item.learnerProfileId !== profile.id) {
      throw new DomainInvariantError("Context carryover Task/profile lineage is inconsistent", "CONTEXT_CARRYOVER_LINEAGE");
    }
    if (relation.actorUserId) {
      const roles = authorityRoles.get(relation.actorUserId) ?? new Set<string>();
      const actorAuthorized = (relation.actorUserId === scope.task.learnerId && roles.has("LEARNER"))
        || hasTeacherAuthority(relation.actorUserId);
      if (!actorAuthorized) throw new DomainInvariantError("Context carryover actor authority is invalid", "CONTEXT_CARRYOVER_AUTHORITY");
    } else if (!relation.policyKey || !relation.policyVersion) {
      throw new DomainInvariantError("Context carryover lacks actor or policy authority", "CONTEXT_CARRYOVER_AUTHORITY");
    }
  }

  function canonicalCandidate(item: CanonicalContextRecord, relation?: CarryoverRecord): ContextItem {
    if (item.institutionId !== scope.task.institutionId || item.learnerProfileId !== profile.id
      || (!relation && item.courseId !== scope.task.courseId)) {
      throw new DomainInvariantError("ContextItem identity scope is inconsistent with the active Task", "CONTEXT_ITEM_LINEAGE");
    }
    if (item.scope === "EPISODE" && !item.episodeId) {
      throw new DomainInvariantError("Episode-scoped ContextItem lacks an Episode", "CONTEXT_ITEM_LINEAGE");
    }
    const contextState = item.invalidatedAt ? "INVALIDATED" : item.state as ContextItem["state"];
    const currentTeacherConstraint = isTeacherConstraint(item.kind)
      && (contextState === "ACTIVE" || contextState === "PROMOTED")
      && item.validFrom <= now
      && (!item.validUntil || item.validUntil > now);
    if (currentTeacherConstraint) {
      if (!item.actorUserId || !hasTeacherAuthority(item.actorUserId)) {
        throw new DomainInvariantError("Teacher Context constraint lacks current teacher authority", "CONTEXT_TEACHER_AUTHORITY");
      }
    }

    const evidence = item.evidenceUnitId ? evidenceById.get(item.evidenceUnitId) : undefined;
    const derivative = item.evidenceDerivativeId ? derivativeById.get(item.evidenceDerivativeId) : undefined;
    const sourceId = item.sourceRecordId ?? evidence?.sourceId;
    const source = sourceId ? sourceById.get(sourceId) : undefined;
    const exactVersionIds = [...new Set([
      item.sourceAssetVersionId,
      evidence?.sourceAssetVersionId,
      derivative?.sourceAssetVersionId,
    ].filter((candidate): candidate is string => Boolean(candidate)))];
    if (exactVersionIds.length > 1) {
      throw new DomainInvariantError("ContextItem source versions conflict", "CONTEXT_SOURCE_VERSION_CONFLICT");
    }
    const versionId = exactVersionIds[0] ?? source?.sourceAssetVersionId;
    const version = versionId ? versionById.get(versionId) : undefined;
    if ((item.evidenceUnitId && !evidence) || (item.evidenceDerivativeId && !derivative)
      || (sourceId && !source) || (versionId && !version)) {
      throw new DomainInvariantError("ContextItem references missing Evidence/Source lineage", "CONTEXT_EVIDENCE_LINEAGE");
    }
    if (evidence && source && evidence.sourceId !== source.id) {
      throw new DomainInvariantError("ContextItem Evidence and SourceRecord disagree", "CONTEXT_EVIDENCE_LINEAGE");
    }
    if (derivative && evidence && derivative.evidenceUnitId !== evidence.id) {
      throw new DomainInvariantError("ContextItem Evidence and derivative disagree", "CONTEXT_EVIDENCE_LINEAGE");
    }
    if (source && version && source.sourceAssetId !== version.sourceAssetId) {
      throw new DomainInvariantError("ContextItem SourceRecord and source version disagree", "CONTEXT_SOURCE_VERSION_CONFLICT");
    }

    let exclusionReason: ContextItem["exclusionReason"];
    if (relation && !actor.courseIds.includes(item.courseId)) exclusionReason = "WRONG_SCOPE";
    if (source && version) exclusionReason = sourceExclusion(source, version);
    else if (source && versionId && source.sourceAssetVersionId !== versionId) exclusionReason = "SOURCE_INACTIVE";
    else if (version) exclusionReason = version.rightsStatus === "APPROVED" ? "SOURCE_INACTIVE" : "SOURCE_RIGHTS_UNAVAILABLE";
    if (derivative && derivative.state !== "ACTIVE") exclusionReason = "SOURCE_INACTIVE";

    const provenanceRefs: ContextProvenanceReference[] = [provenance("CONTEXT_ITEM", item.id, { version: item.ruleVersion })];
    if (item.actorUserId) provenanceRefs.push(provenance("ACTOR", item.actorUserId));
    if (source) provenanceRefs.push(provenance("SOURCE_RECORD", source.id, { version: source.version, contentHash: source.contentHash }));
    if (version) provenanceRefs.push(provenance("SOURCE_ASSET_VERSION", version.id, { version: version.versionKey, contentHash: version.contentHash }));
    if (evidence) provenanceRefs.push(provenance("EVIDENCE_UNIT", evidence.id, { contentHash: evidence.contentHash }));
    if (derivative) provenanceRefs.push(provenance("EVIDENCE_DERIVATIVE", derivative.id, { contentHash: derivative.contentHash }));
    if (relation) provenanceRefs.push(provenance("CONTEXT_CARRYOVER_RELATION", relation.id, { version: relation.policyVersion ?? undefined }));

    return {
      id: `context-item:${item.id}`,
      institutionId: item.institutionId,
      courseId: item.courseId,
      learnerProfileId: item.learnerProfileId,
      taskId: item.taskId,
      episodeId: item.episodeId ?? undefined,
      kind: item.kind,
      scope: item.scope as ContextItem["scope"],
      state: contextState,
      content: stableContextJson(item.payload),
      payload: item.payload,
      modality: typeof item.payload.modality === "string" ? item.payload.modality : "TEXT",
      required: currentTeacherConstraint,
      priority: isTeacherConstraint(item.kind) ? 90 : relation ? 55 : 60,
      validFrom: item.validFrom.toISOString(),
      validUntil: item.validUntil?.toISOString(),
      inclusionReason: relation ? "EXPLICIT_CARRYOVER" : item.scope === "EPISODE" ? "ACTIVE_EPISODE_SCOPE" : "ACTIVE_TASK_SCOPE",
      exclusionReason,
      provenanceRefs,
      carryoverRelation: relation?.relationType as ContextItem["carryoverRelation"],
      carryover: relation ? {
        relationId: relation.id,
        relationType: relation.relationType as NonNullable<ContextItem["carryover"]>["relationType"],
        sourceTaskId: relation.sourceTaskId,
        targetTaskId: relation.targetTaskId,
        actorUserId: relation.actorUserId ?? undefined,
        policyKey: relation.policyKey ?? undefined,
        policyVersion: relation.policyVersion ?? undefined,
        reason: relation.reason,
      } : undefined,
    };
  }

  const carryoverByItemId = new Map(carryovers.map((relation) => [relation.sourceContextItemId, relation]));
  const supersededConstraintIds = new Set(teacherConstraintSources.flatMap(({ constraint }) => constraint.supersedesConstraintId ? [constraint.supersedesConstraintId] : []));
  const teacherConstraintCandidates = teacherConstraintSources.map((source: TeacherConstraintSource): ContextItem => {
    const { constraint, assignment, intervention } = source;
    const exactSource = assignment ?? intervention;
    if (!exactSource || Boolean(assignment) === Boolean(intervention)
      || constraint.institutionId !== scope.task.institutionId
      || constraint.courseId !== scope.task.courseId
      || constraint.taskId !== scope.task.id
      || constraint.episodeId !== scope.episode.id
      || exactSource.institutionId !== constraint.institutionId
      || exactSource.courseId !== constraint.courseId
      || exactSource.taskId !== constraint.taskId
      || exactSource.teacherId !== constraint.teacherId
      || (intervention && intervention.episodeId !== constraint.episodeId)) {
      throw new DomainInvariantError("Teacher Capability constraint source lineage is inconsistent", "CONTEXT_TEACHER_CONSTRAINT_LINEAGE");
    }
    if (!hasCap05TeacherCourseAuthority(constraint.teacherId)) {
      throw new DomainInvariantError("Teacher Capability constraint lacks current course authority", "CONTEXT_TEACHER_AUTHORITY");
    }
    const superseded = supersededConstraintIds.has(constraint.id);
    const payload = constraint.effect === "REQUIRE"
      ? { requiredCapabilityKey: constraint.capabilityKeySnapshot, capabilityId: constraint.capabilityId, reason: constraint.reason }
      : { excludedCapabilityKey: constraint.capabilityKeySnapshot, capabilityId: constraint.capabilityId, reason: constraint.reason };
    return {
      id: `teacher-capability-constraint:${constraint.id}`,
      institutionId: constraint.institutionId,
      courseId: constraint.courseId,
      learnerProfileId: profile.id,
      taskId: constraint.taskId,
      episodeId: scope.episode.id,
      kind: constraint.effect === "REQUIRE" ? "CAPABILITY_REQUIREMENT" : "CAPABILITY_EXCLUSION",
      scope: "EPISODE",
      state: superseded ? "SUPERSEDED" : "ACTIVE",
      content: stableContextJson(payload),
      payload,
      modality: "TEXT",
      required: !superseded,
      priority: 95,
      superseded,
      inclusionReason: "ACTIVE_EPISODE_SCOPE",
      exclusionReason: superseded ? "SUPERSEDED_FACT" : undefined,
      provenanceRefs: [
        provenance("CAPABILITY_CONSTRAINT", constraint.id),
        provenance(assignment ? "TEACHER_ASSIGNMENT" : "TEACHER_INTERVENTION", exactSource.id),
        provenance("ACTOR", constraint.teacherId),
      ],
    };
  });
  const authoritativeCandidates: ContextItem[] = [
    {
      id: `learning-task:${scope.task.id}`,
      institutionId: scope.task.institutionId,
      courseId: scope.task.courseId,
      learnerProfileId: profile.id,
      taskId: scope.task.id,
      kind: "TASK_GOAL",
      scope: "TASK",
      state: "ACTIVE",
      content: stableContextJson({ title: scope.task.title, goal: scope.task.goal, status: scope.task.status }),
      required: true,
      priority: 100,
      provenanceRefs: [provenance("LEARNING_TASK", scope.task.id)],
      inclusionReason: "ACTIVE_TASK_SCOPE",
    },
    {
      id: `learning-episode:${scope.episode.id}`,
      institutionId: scope.task.institutionId,
      courseId: scope.task.courseId,
      learnerProfileId: profile.id,
      taskId: scope.task.id,
      episodeId: scope.episode.id,
      kind: "ACTIVE_EPISODE",
      scope: "EPISODE",
      state: "ACTIVE",
      content: stableContextJson({ sequence: scope.episode.sequence, status: scope.episode.status }),
      required: true,
      priority: 99,
      provenanceRefs: [provenance("LEARNING_EPISODE", scope.episode.id)],
      inclusionReason: "ACTIVE_EPISODE_SCOPE",
    },
    {
      id: `learner-profile:${profile.id}`,
      institutionId: profile.institutionId,
      courseId: scope.task.courseId,
      learnerProfileId: profile.id,
      taskId: scope.task.id,
      kind: "LEARNER_PROFILE",
      scope: "PROFILE",
      state: "ACTIVE",
      content: stableContextJson({ learnerProfileId: profile.id, learnerId: profile.learnerId }),
      required: true,
      priority: 98,
      provenanceRefs: [provenance("LEARNER_PROFILE", profile.id)],
      inclusionReason: "CURRENT_LEARNER_PROFILE",
    },
    ...strategies.map((strategy) => ({
      id: `learner-strategy-version:${strategy.id}`,
      institutionId: strategy.institutionId,
      courseId: scope.task.courseId,
      learnerProfileId: strategy.learnerProfileId,
      taskId: scope.task.id,
      kind: "LEARNER_STRATEGY",
      scope: "PROFILE" as const,
      state: statusForStrategy(strategy.status, strategy.invalidatedAt),
      content: stableContextJson({ kind: strategy.kind, strategy: strategy.strategy }),
      payload: strategy.strategy,
      priority: 70,
      validFrom: strategy.effectiveFrom.toISOString(),
      validUntil: strategy.effectiveUntil?.toISOString(),
      inclusionReason: "CURRENT_LEARNER_STRATEGY" as const,
      provenanceRefs: [
        provenance("LEARNER_STRATEGY_VERSION", strategy.id, { version: strategy.ruleVersion }),
        provenance("ACTOR", strategy.actorUserId),
        ...(strategy.sourceRecordId ? [provenance("SOURCE_RECORD", strategy.sourceRecordId)] : []),
      ],
    })),
    ...teacherConstraintCandidates,
    ...directItems.map((item) => canonicalCandidate(item)),
    ...carriedItems.map((item) => canonicalCandidate(item, carryoverByItemId.get(item.id))),
  ];

  const representedRecords = new Set(authoritativeCandidates.flatMap((item) => item.provenanceRefs ?? [])
    .filter((reference) => reference.type === "CONVERSATION_EVENT" || reference.type === "LEARNER_ATTEMPT")
    .map((reference) => `${reference.type}:${reference.id}`));
  const compatibilityCandidates = [
    ...events.map((event) => authorizeCompatibilityCandidate(
      contextItemsFromConversationEvents([event])[0]!,
      event.sourceRefs,
      event.evidenceRefs,
    )).filter((item) => !(item.provenanceRefs ?? []).some((reference) => representedRecords.has(`${reference.type}:${reference.id}`))),
    ...attempts.map((attempt) => authorizeCompatibilityCandidate(
      contextItemsFromAttempts([attempt])[0]!,
      attempt.sourceRefs,
      [],
    )).filter((item) => !(item.provenanceRefs ?? []).some((reference) => representedRecords.has(`${reference.type}:${reference.id}`))),
  ];

  const compiled = compileContext({
    activeTaskId: input.taskId,
    activeEpisodeId: input.episodeId,
    consumer: input.consumer,
    candidates: [...authoritativeCandidates, ...compatibilityCandidates],
    tokenBudget: input.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET,
    modalityBudget: input.modalityBudget ?? DEFAULT_CONTEXT_MODALITY_BUDGET,
    effectiveAt: now,
  });

  await db.insert(contextCompilations).values({
    id: compiled.id,
    taskId: compiled.activeTaskId,
    episodeId: compiled.activeEpisodeId,
    consumer: compiled.consumer,
    compilerVersion: compiled.compilerVersion,
    contextPolicyVersion: compiled.contextPolicyVersion,
    inputHash: compiled.inputHash,
    snapshotHash: compiled.snapshotHash,
    tokenBudget: compiled.tokenBudget,
    modalityBudget: compiled.modalityBudget,
    tokenizer: compiled.tokenizer,
    selectedTokenCount: compiled.selectedTokenCount,
    modalityUsage: compiled.modalityUsage,
    candidateItems: jsonRecords(compiled.candidateItems),
    selectedItems: jsonRecords(compiled.selectedItems),
    excludedItems: jsonRecords(compiled.excludedItems),
    provenanceRefs: jsonRecords(compiled.provenanceRefs),
    referencedPriorTaskIds: compiled.referencedPriorTaskIds,
  }).onConflictDoNothing({ target: contextCompilations.id });

  const [persisted] = await db.select({
    inputHash: contextCompilations.inputHash,
    snapshotHash: contextCompilations.snapshotHash,
  }).from(contextCompilations).where(eq(contextCompilations.id, compiled.id)).limit(1);
  if (!persisted || persisted.inputHash !== compiled.inputHash || persisted.snapshotHash !== compiled.snapshotHash) {
    throw new DomainInvariantError("Compiled Context replay identity conflicts with persisted state", "CONTEXT_REPLAY_CONFLICT");
  }
  return compiled;
}

/**
 * The single authorized Context boundary for Evidence Retrieval, Diagnosis,
 * Capability Resolution and Runtime orchestration.
 */
export function compileAuthorizedContext(actor: Actor, input: CompileAuthorizedContextInput): Promise<CompiledContext> {
  return withTenantDatabase(actor, () => compileAndPersist(actor, input));
}

/** Existing call-site compatibility; no caller-supplied cross-Task items remain. */
export function compileAndPersistContext(actor: Actor, input: {
  taskId: string;
  episodeId: string;
  tokenBudget?: number;
  modalityBudget?: Record<string, number>;
}): Promise<CompiledContext> {
  return compileAuthorizedContext(actor, { ...input, consumer: "EVIDENCE_RETRIEVAL" });
}
