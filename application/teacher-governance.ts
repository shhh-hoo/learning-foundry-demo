import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, withTenantDatabase } from "@/db/client";
import {
  activityPlans,
  capabilities,
  capabilityResolutions,
  capabilityVersions,
  contextCompilations,
  courseEnrollments,
  courses,
  diagnosticObservations,
  idempotencyKeys,
  institutionMemberships,
  learnerAttempts,
  learnerProfiles,
  learningEpisodes,
  learningTasks,
  runtimeDeliveries,
  subjects,
  teacherAssignments,
  teacherCapabilityConstraints,
  teacherInterventions,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import { DomainInvariantError, requireCourseAccess, requireHumanCommand } from "@/domain/invariants";
import {
  normalizeTeacherAssignment,
  normalizeTeacherIntervention,
  type TeacherAssignmentCommand,
  type TeacherInterventionCommand,
} from "@/domain/teacher-governance";
import { commandRequestHash } from "@/application/commands";

const TERMINAL_DELIVERY_STATES = new Set(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]);

function actorProvenance(actor: Actor) {
  return {
    userId: actor.userId,
    institutionId: actor.institutionId,
    roles: actor.roles,
    authMethod: actor.authMethod,
    sessionId: actor.sessionId,
    authenticatedAt: new Date().toISOString(),
  };
}

function replayResultId(existing: { commandType: string; requestHash: string; resultId: string } | undefined, commandType: string, requestHash: string): string {
  if (!existing) throw new DomainInvariantError("Idempotency reservation disappeared", "IDEMPOTENCY_INTEGRITY");
  if (existing.commandType !== commandType || existing.requestHash !== requestHash) {
    throw new DomainInvariantError("Idempotency key was reused with a different command or request", "IDEMPOTENCY_MISMATCH");
  }
  return existing.resultId;
}

async function existingReplayId(actor: Actor, commandType: string, reservationKey: string, requestHash: string): Promise<string | null> {
  const [existing] = await getDb().select().from(idempotencyKeys).where(and(
    eq(idempotencyKeys.institutionId, actor.institutionId),
    eq(idempotencyKeys.commandType, commandType),
    eq(idempotencyKeys.key, reservationKey),
  )).limit(1);
  return existing ? replayResultId(existing, commandType, requestHash) : null;
}

async function requireCurrentTeacherCourseAuthority(actor: Actor, courseId: string): Promise<void> {
  const [authority] = await getDb().select({ courseId: courseEnrollments.courseId }).from(courseEnrollments)
    .innerJoin(institutionMemberships, and(
      eq(institutionMemberships.institutionId, courseEnrollments.institutionId),
      eq(institutionMemberships.userId, courseEnrollments.userId),
      eq(institutionMemberships.role, "TEACHER"),
    ))
    .where(and(
      eq(courseEnrollments.institutionId, actor.institutionId),
      eq(courseEnrollments.courseId, courseId),
      eq(courseEnrollments.userId, actor.userId),
      eq(courseEnrollments.role, "TEACHER"),
    )).limit(1);
  if (!authority) throw new DomainInvariantError("Current teacher-course authority is required", "TENANT_ISOLATION");
}

async function assignmentReplay(actor: Actor, assignmentId: string) {
  const [assignment] = await getDb().select().from(teacherAssignments).where(and(
    eq(teacherAssignments.id, assignmentId),
    eq(teacherAssignments.institutionId, actor.institutionId),
    eq(teacherAssignments.teacherId, actor.userId),
  )).limit(1);
  if (!assignment) throw new DomainInvariantError("Assignment replay target is missing", "IDEMPOTENCY_INTEGRITY");
  const [episode] = await getDb().select().from(learningEpisodes).where(and(
    eq(learningEpisodes.taskId, assignment.taskId),
    eq(learningEpisodes.sequence, 1),
  )).limit(1);
  if (!episode) throw new DomainInvariantError("Assignment replay Episode is missing", "IDEMPOTENCY_INTEGRITY");
  const constraints = await getDb().select().from(teacherCapabilityConstraints).where(eq(teacherCapabilityConstraints.sourceAssignmentId, assignment.id));
  return { assignment, taskId: assignment.taskId, episodeId: episode.id, constraints, replayed: true as const };
}

async function interventionReplay(actor: Actor, interventionId: string) {
  const [intervention] = await getDb().select().from(teacherInterventions).where(and(
    eq(teacherInterventions.id, interventionId),
    eq(teacherInterventions.institutionId, actor.institutionId),
    eq(teacherInterventions.teacherId, actor.userId),
  )).limit(1);
  const [constraint] = intervention ? await getDb().select().from(teacherCapabilityConstraints).where(eq(teacherCapabilityConstraints.sourceInterventionId, intervention.id)).limit(1) : [];
  if (!intervention || !constraint) throw new DomainInvariantError("Intervention replay target is missing", "IDEMPOTENCY_INTEGRITY");
  return { intervention, constraint, replayed: true as const };
}

async function authorizedRegistryCapabilities(courseId: string, capabilityIds: string[]) {
  if (!capabilityIds.length) return [];
  const rows = await getDb().select({
    capability: capabilities,
    version: capabilityVersions,
    course: courses,
    subject: subjects,
  }).from(courses)
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .innerJoin(capabilities, eq(capabilities.referencePackKey, subjects.referencePackKey))
    .innerJoin(capabilityVersions, eq(capabilityVersions.id, capabilities.activeVersionId))
    .where(and(
      eq(courses.id, courseId),
      inArray(capabilities.id, capabilityIds),
      eq(capabilityVersions.status, "ACTIVE"),
    ));
  if (rows.length !== capabilityIds.length) {
    throw new DomainInvariantError("Every teacher Capability constraint must reference an active course Registry entry", "TEACHER_CAPABILITY_INELIGIBLE");
  }
  return rows;
}

async function createAssignmentInTenant(actor: Actor, rawInput: TeacherAssignmentCommand) {
  requireHumanCommand(actor, ["TEACHER"]);
  const input = normalizeTeacherAssignment(rawInput);
  const commandType = "TEACHER_ASSIGN_TASK";
  const reservationKey = `${actor.userId}:${input.idempotencyKey}`;
  const requestHash = commandRequestHash(actor, commandType, { ...input, idempotencyKey: undefined });
  requireCourseAccess(actor, actor.institutionId, input.courseId);
  await requireCurrentTeacherCourseAuthority(actor, input.courseId);
  const replayId = await existingReplayId(actor, commandType, reservationKey, requestHash);
  if (replayId) return assignmentReplay(actor, replayId);

  const dueAt = input.dueAt ? new Date(input.dueAt) : undefined;
  if (dueAt && dueAt <= new Date()) throw new DomainInvariantError("Assignment due time must be in the future", "ASSIGNMENT_DEADLINE_INVALID");

  const [learner] = await getDb().select({ profile: learnerProfiles }).from(courseEnrollments)
    .innerJoin(institutionMemberships, and(
      eq(institutionMemberships.userId, courseEnrollments.userId),
      eq(institutionMemberships.institutionId, courseEnrollments.institutionId),
      eq(institutionMemberships.role, "LEARNER"),
    ))
    .innerJoin(learnerProfiles, and(
      eq(learnerProfiles.learnerId, courseEnrollments.userId),
      eq(learnerProfiles.institutionId, courseEnrollments.institutionId),
    ))
    .where(and(
      eq(courseEnrollments.institutionId, actor.institutionId),
      eq(courseEnrollments.courseId, input.courseId),
      eq(courseEnrollments.userId, input.learnerId),
      eq(courseEnrollments.role, "LEARNER"),
    )).limit(1);
  if (!learner) throw new DomainInvariantError("Assignment learner is not enrolled in the authorized course", "ASSIGNMENT_LEARNER_DENIED");

  const registry = await authorizedRegistryCapabilities(input.courseId, [...input.requiredCapabilityIds, ...input.excludedCapabilityIds]);
  const registryById = new Map(registry.map(({ capability }) => [capability.id, capability]));
  const assignmentId = randomUUID();
  const taskId = randomUUID();
  const episodeId = randomUUID();
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({
      institutionId: actor.institutionId,
      key: reservationKey,
      commandType,
      requestHash,
      resultId: assignmentId,
    }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existingKey] = await tx.select().from(idempotencyKeys).where(and(
        eq(idempotencyKeys.institutionId, actor.institutionId),
        eq(idempotencyKeys.commandType, commandType),
        eq(idempotencyKeys.key, reservationKey),
      )).limit(1);
      return assignmentReplay(actor, replayResultId(existingKey, commandType, requestHash));
    }

    await tx.insert(learningTasks).values({
      id: taskId,
      institutionId: actor.institutionId,
      courseId: input.courseId,
      learnerId: input.learnerId,
      learnerProfileId: learner.profile.id,
      title: input.title,
      goal: input.goal,
    });
    await tx.insert(learningEpisodes).values({ id: episodeId, taskId, sequence: 1 });
    const provenance = actorProvenance(actor);
    const [assignment] = await tx.insert(teacherAssignments).values({
      id: assignmentId,
      institutionId: actor.institutionId,
      courseId: input.courseId,
      learnerId: input.learnerId,
      taskId,
      teacherId: actor.userId,
      instructions: input.instructions,
      completionRule: input.completionRule,
      dueAt,
      actorProvenance: provenance,
      idempotencyKey: input.idempotencyKey,
    }).returning();
    const constraintValues = [
      ...input.requiredCapabilityIds.map((capabilityId) => ({ effect: "REQUIRE" as const, capabilityId })),
      ...input.excludedCapabilityIds.map((capabilityId) => ({ effect: "EXCLUDE" as const, capabilityId })),
    ].map(({ effect, capabilityId }) => ({
      id: randomUUID(),
      institutionId: actor.institutionId,
      courseId: input.courseId,
      taskId,
      episodeId,
      teacherId: actor.userId,
      effect,
      capabilityId,
      capabilityKeySnapshot: registryById.get(capabilityId)!.key,
      reason: `${effect === "REQUIRE" ? "Required" : "Excluded"} by teacher assignment: ${input.instructions}`,
      sourceAssignmentId: assignmentId,
    }));
    const constraints = constraintValues.length ? await tx.insert(teacherCapabilityConstraints).values(constraintValues).returning() : [];
    return { assignment, taskId, episodeId, constraints, replayed: false };
  });
}

async function createInterventionInTenant(actor: Actor, rawInput: TeacherInterventionCommand) {
  requireHumanCommand(actor, ["TEACHER"]);
  const input = normalizeTeacherIntervention(rawInput);
  const commandType = "TEACHER_INTERVENE_RUNTIME";
  const reservationKey = `${actor.userId}:${input.idempotencyKey}`;
  const requestHash = commandRequestHash(actor, commandType, { ...input, idempotencyKey: undefined });
  const [authorizedTarget] = await getDb().select({
    institutionId: runtimeDeliveries.institutionId,
    courseId: runtimeDeliveries.courseId,
  }).from(runtimeDeliveries).where(eq(runtimeDeliveries.id, input.runtimeDeliveryId)).limit(1);
  if (!authorizedTarget) {
    throw new DomainInvariantError("Teacher intervention target is unavailable", "INTERVENTION_TARGET_DENIED");
  }
  requireCourseAccess(actor, authorizedTarget.institutionId, authorizedTarget.courseId);
  await requireCurrentTeacherCourseAuthority(actor, authorizedTarget.courseId);
  const replayId = await existingReplayId(actor, commandType, reservationKey, requestHash);
  if (replayId) return interventionReplay(actor, replayId);

  const [lineage] = await getDb().select({
    delivery: runtimeDeliveries,
    plan: activityPlans,
    attempt: learnerAttempts,
    diagnosis: diagnosticObservations,
    context: contextCompilations,
    resolution: capabilityResolutions,
    task: learningTasks,
    episode: learningEpisodes,
  }).from(runtimeDeliveries)
    .innerJoin(activityPlans, eq(activityPlans.id, runtimeDeliveries.activityPlanId))
    .innerJoin(learnerAttempts, eq(learnerAttempts.runtimeDeliveryId, runtimeDeliveries.id))
    .innerJoin(diagnosticObservations, eq(diagnosticObservations.id, activityPlans.diagnosticObservationId))
    .innerJoin(contextCompilations, eq(contextCompilations.id, activityPlans.contextCompilationId))
    .innerJoin(capabilityResolutions, eq(capabilityResolutions.id, activityPlans.capabilityResolutionId))
    .innerJoin(learningTasks, eq(learningTasks.id, runtimeDeliveries.taskId))
    .innerJoin(learningEpisodes, eq(learningEpisodes.id, runtimeDeliveries.episodeId))
    .where(eq(runtimeDeliveries.id, input.runtimeDeliveryId)).limit(1);
  if (!lineage) throw new DomainInvariantError("Teacher intervention requires complete RuntimeDelivery lineage", "INTERVENTION_LINEAGE_MISSING");
  if (!TERMINAL_DELIVERY_STATES.has(lineage.delivery.status)) {
    throw new DomainInvariantError("Teacher intervention requires a terminal RuntimeDelivery", "INTERVENTION_DELIVERY_NOT_TERMINAL");
  }
  if (lineage.task.status !== "OPEN" || lineage.episode.status !== "ACTIVE") {
    throw new DomainInvariantError("Teacher intervention target Task/Episode is no longer active", "INTERVENTION_TARGET_TERMINAL");
  }
  if (lineage.diagnosis.supersededById) {
    throw new DomainInvariantError("Teacher intervention requires the current planning Diagnosis Proposal", "INTERVENTION_DIAGNOSIS_STALE");
  }
  const [latestDelivery] = await getDb().select({ id: runtimeDeliveries.id }).from(runtimeDeliveries)
    .where(and(eq(runtimeDeliveries.taskId, lineage.task.id), eq(runtimeDeliveries.episodeId, lineage.episode.id)))
    .orderBy(desc(runtimeDeliveries.startedAt), desc(runtimeDeliveries.id)).limit(1);
  if (latestDelivery?.id !== lineage.delivery.id) {
    throw new DomainInvariantError("Teacher intervention target is not the latest RuntimeDelivery", "INTERVENTION_TARGET_STALE");
  }
  if (lineage.plan.taskId !== lineage.task.id || lineage.plan.episodeId !== lineage.episode.id
    || lineage.attempt.activityPlanId !== lineage.plan.id || lineage.attempt.runtimeDeliveryId !== lineage.delivery.id
    || lineage.context.id !== lineage.plan.contextCompilationId || lineage.resolution.id !== lineage.plan.capabilityResolutionId
    || lineage.resolution.diagnosticObservationId !== lineage.diagnosis.id
    || lineage.plan.capabilityVersionId !== lineage.delivery.capabilityVersionId) {
    throw new DomainInvariantError("Teacher intervention exact runtime lineage is inconsistent", "INTERVENTION_LINEAGE_MISMATCH");
  }

  const [requested] = await authorizedRegistryCapabilities(lineage.task.courseId, [input.capabilityId]);
  if (!requested) throw new DomainInvariantError("Intervention Capability is unavailable", "TEACHER_CAPABILITY_INELIGIBLE");
  const [priorConstraint] = await getDb().select().from(teacherCapabilityConstraints).where(and(
    eq(teacherCapabilityConstraints.taskId, lineage.task.id),
    eq(teacherCapabilityConstraints.capabilityId, requested.capability.id),
  )).orderBy(desc(teacherCapabilityConstraints.createdAt), desc(teacherCapabilityConstraints.id)).limit(1);

  const interventionId = randomUUID();
  const constraintId = randomUUID();
  return getDb().transaction(async (tx) => {
    const reserved = await tx.insert(idempotencyKeys).values({
      institutionId: actor.institutionId,
      key: reservationKey,
      commandType,
      requestHash,
      resultId: interventionId,
    }).onConflictDoNothing().returning();
    if (!reserved.length) {
      const [existingKey] = await tx.select().from(idempotencyKeys).where(and(
        eq(idempotencyKeys.institutionId, actor.institutionId),
        eq(idempotencyKeys.commandType, commandType),
        eq(idempotencyKeys.key, reservationKey),
      )).limit(1);
      return interventionReplay(actor, replayResultId(existingKey, commandType, requestHash));
    }

    const provenance = actorProvenance(actor);
    const targetLineage = {
      taskId: lineage.task.id,
      episodeId: lineage.episode.id,
      activityPlanId: lineage.plan.id,
      activityPlanInputHash: lineage.plan.inputHash,
      runtimeDeliveryId: lineage.delivery.id,
      runtimeStatus: lineage.delivery.status,
      runtimeRequestHash: lineage.delivery.requestHash,
      learnerAttemptId: lineage.attempt.id,
      diagnosticObservationId: lineage.diagnosis.id,
      contextCompilationId: lineage.context.id,
      contextSnapshotHash: lineage.context.snapshotHash,
      capabilityResolutionId: lineage.resolution.id,
      deliveredCapabilityVersionId: lineage.delivery.capabilityVersionId,
      deliveredCapabilityVersionContentHash: lineage.delivery.capabilityVersionContentHash,
      runtimeContractHash: lineage.delivery.runtimeContractHash,
    };
    const [intervention] = await tx.insert(teacherInterventions).values({
      id: interventionId,
      institutionId: actor.institutionId,
      courseId: lineage.task.courseId,
      taskId: lineage.task.id,
      episodeId: lineage.episode.id,
      runtimeDeliveryId: lineage.delivery.id,
      learnerAttemptId: lineage.attempt.id,
      activityPlanId: lineage.plan.id,
      diagnosticObservationId: lineage.diagnosis.id,
      contextCompilationId: lineage.context.id,
      capabilityResolutionId: lineage.resolution.id,
      capabilityVersionId: lineage.delivery.capabilityVersionId,
      constraintCapabilityId: requested.capability.id,
      constraintCapabilityKeySnapshot: requested.capability.key,
      teacherId: actor.userId,
      actionType: input.actionType,
      reason: input.reason,
      targetLineage,
      actorProvenance: provenance,
      idempotencyKey: input.idempotencyKey,
    }).returning();
    const [constraint] = await tx.insert(teacherCapabilityConstraints).values({
      id: constraintId,
      institutionId: actor.institutionId,
      courseId: lineage.task.courseId,
      taskId: lineage.task.id,
      episodeId: lineage.episode.id,
      teacherId: actor.userId,
      effect: input.actionType === "REQUIRE_CAPABILITY" ? "REQUIRE" : "EXCLUDE",
      capabilityId: requested.capability.id,
      capabilityKeySnapshot: requested.capability.key,
      reason: input.reason,
      sourceInterventionId: interventionId,
      supersedesConstraintId: priorConstraint?.id,
    }).returning();
    return { intervention, constraint, replayed: false };
  });
}

export function createTeacherAssignment(actor: Actor, input: TeacherAssignmentCommand) {
  return withTenantDatabase(actor, () => createAssignmentInTenant(actor, input));
}

export function createTeacherIntervention(actor: Actor, input: TeacherInterventionCommand) {
  return withTenantDatabase(actor, () => createInterventionInTenant(actor, input));
}
