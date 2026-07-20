import { and, eq, isNull } from "drizzle-orm";
import { getDb, withTenantDatabase } from "@/db/client";
import {
  capabilities,
  capabilityResolutions,
  capabilityVersions,
  diagnosticObservations,
  learnerAttempts,
  subjects,
} from "@/db/schema";
import { compileAuthorizedContext } from "@/application/context-service";
import { assertExecutionActive } from "@/application/execution-control";
import { requireTaskEpisodeScope } from "@/application/task-scope";
import {
  capabilityResolutionHash,
  capabilityResolutionId,
  resolveCapabilityCandidates,
  stableCapabilityResolutionJson,
  type CapabilityResolutionDecision,
  type CapabilityResolutionNeed,
  type RegistryCapabilityVersion,
} from "@/domain/capability-resolution";
import { DomainInvariantError } from "@/domain/invariants";
import type { Actor, CompiledContext, ContextItem } from "@/domain/model";

type AvailabilityState = "AVAILABLE" | "UNAVAILABLE" | "BLOCKED" | "NOT_REQUIRED";

function strings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
}

function firstString(value: unknown): string | undefined {
  return strings(value)[0];
}

function availabilityRecord(value: unknown): Record<string, AvailabilityState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set<AvailabilityState>(["AVAILABLE", "UNAVAILABLE", "BLOCKED", "NOT_REQUIRED"]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, state]) => (
    typeof state === "string" && allowed.has(state as AvailabilityState) ? [[key, state as AvailabilityState]] : []
  )));
}

function selectedPayloads(context: CompiledContext): Array<{ item: ContextItem; payload: Record<string, unknown> }> {
  return context.selectedItems.map((item) => ({ item, payload: item.payload ?? {} }));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function mergeAvailability(payloads: Array<Record<string, unknown>>, key: string): Record<string, AvailabilityState> {
  return Object.assign({}, ...payloads.map((payload) => availabilityRecord(payload[key])));
}

function buildNeed(input: {
  actor: Actor;
  taskGoal: string;
  courseId: string;
  referencePackKey: string;
  context: CompiledContext;
  observation: typeof diagnosticObservations.$inferSelect;
  attempt: typeof learnerAttempts.$inferSelect;
}): CapabilityResolutionNeed {
  const selected = selectedPayloads(input.context);
  const payloads = selected.map(({ payload }) => payload);
  const requirementItems = selected.filter(({ item }) => item.kind === "CAPABILITY_REQUIREMENT" || item.kind === "TEACHER_CONSTRAINT");
  const exclusionItems = selected.filter(({ item }) => item.kind === "CAPABILITY_EXCLUSION" || item.kind === "TEACHER_CONSTRAINT");
  const requiredCapabilityKeys = unique(requirementItems.flatMap(({ payload }) => [
    ...strings(payload.capabilityKey),
    ...strings(payload.capabilityKeys),
    ...strings(payload.requiredCapabilityKey),
    ...strings(payload.requiredCapabilityKeys),
  ]));
  const excludedCapabilityKeys = unique(exclusionItems.flatMap(({ payload }) => [
    ...strings(payload.excludedCapabilityKey),
    ...strings(payload.excludedCapabilityKeys),
  ]));
  const languages = unique(payloads.flatMap((payload) => [...strings(payload.language), ...strings(payload.languages)]));
  const accessibility = unique(payloads.flatMap((payload) => [...strings(payload.accessibility), ...strings(payload.accessibilitySupports)]));
  const prerequisiteEvidence = unique(payloads.flatMap((payload) => [...strings(payload.prerequisite), ...strings(payload.prerequisites), ...strings(payload.prerequisiteEvidence)]));
  const contraindications = unique(payloads.flatMap((payload) => [...strings(payload.contraindication), ...strings(payload.contraindications)]));
  const contextSignals = payloads.flatMap((payload) => [
    ...strings(payload.concept),
    ...strings(payload.concepts),
    ...strings(payload.learningProblem),
    ...strings(payload.learningProblems),
    ...strings(payload.capabilitySignals),
  ]);
  const structuredSignals = Object.values(input.observation.structuredResult).flatMap(strings);
  const generationAllowed = payloads.some((payload) => payload.generationAllowed === true)
    && !payloads.some((payload) => payload.generationAllowed === false);
  return {
    institutionId: input.actor.institutionId,
    courseId: input.courseId,
    referencePackKey: input.referencePackKey,
    taskGoal: input.taskGoal,
    taskType: firstString(payloads.flatMap((payload) => strings(payload.taskType))),
    curriculum: firstString(payloads.flatMap((payload) => [...strings(payload.curriculum), ...strings(payload.curriculumKey)])),
    learnerLevel: firstString(payloads.flatMap((payload) => [...strings(payload.learnerLevel), ...strings(payload.level)])),
    languages,
    accessibility,
    prerequisiteEvidence,
    contraindications,
    signals: unique([
      input.observation.summary,
      input.observation.failureCode ?? "",
      input.observation.firstInvalidStep ?? "",
      ...structuredSignals,
      ...contextSignals,
    ]),
    compositionRequiredTags: unique(payloads.flatMap((payload) => strings(payload.compositionRequiredTags))),
    requiredCapabilityKeys,
    excludedCapabilityKeys,
    currentCapabilityId: input.attempt.capabilityId ?? undefined,
    generationAllowed,
    rightsAvailability: mergeAvailability(payloads, "rightsAvailability"),
    dependencyAvailability: mergeAvailability(payloads, "dependencyAvailability"),
    providerAvailability: mergeAvailability(payloads, "providerAvailability"),
  };
}

function persistedCandidates(decision: CapabilityResolutionDecision): Array<Record<string, unknown>> {
  return decision.candidates.map((candidate) => {
    const { parsedContract, ...persisted } = candidate;
    void parsedContract;
    return persisted as unknown as Record<string, unknown>;
  });
}

async function resolveInTenant(actor: Actor, input: {
  taskId: string;
  episodeId: string;
  diagnosticObservationId: string;
}) {
  assertExecutionActive();
  const learnerOriginated = actor.roles.includes("LEARNER") && !actor.roles.some((role) => role === "TEACHER" || role === "ADMIN");
  const scope = await requireTaskEpisodeScope(actor, {
    taskId: input.taskId,
    episodeId: input.episodeId,
    learnerOriginated,
  });
  const context = await compileAuthorizedContext(actor, {
    taskId: scope.task.id,
    episodeId: scope.episode.id,
    consumer: "CAPABILITY_RESOLUTION",
  });
  assertExecutionActive();

  const [diagnosis] = await getDb().select({
    observation: diagnosticObservations,
    attempt: learnerAttempts,
  }).from(diagnosticObservations)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .where(and(
      eq(diagnosticObservations.id, input.diagnosticObservationId),
      eq(learnerAttempts.taskId, scope.task.id),
      eq(learnerAttempts.episodeId, scope.episode.id),
    ))
    .limit(1);
  if (!diagnosis) {
    throw new DomainInvariantError("Capability Resolution requires a Diagnosis Proposal in the exact Task/Episode", "DIAGNOSIS_SCOPE_DENIED");
  }
  if (diagnosis.observation.supersededById) {
    throw new DomainInvariantError("Capability Resolution requires the current non-superseded Diagnosis Proposal", "DIAGNOSIS_NOT_CURRENT");
  }
  const currentObservations = await getDb().select({ id: diagnosticObservations.id }).from(diagnosticObservations)
    .where(and(
      eq(diagnosticObservations.attemptId, diagnosis.attempt.id),
      isNull(diagnosticObservations.supersededById),
    ));
  if (currentObservations.length !== 1 || currentObservations[0]?.id !== diagnosis.observation.id) {
    throw new DomainInvariantError("Capability Resolution found ambiguous current Diagnosis Proposals", "DIAGNOSIS_CURRENT_CONFLICT");
  }

  const [subject] = await getDb().select({ subject: subjects }).from(subjects)
    .where(eq(subjects.id, scope.course.subjectId))
    .limit(1);
  if (!subject || subject.subject.institutionId !== scope.task.institutionId) {
    throw new DomainInvariantError("Task course has no authorized Subject/Reference Pack", "CAPABILITY_REFERENCE_PACK_MISSING");
  }

  const registryRows = await getDb().select({ capability: capabilities, version: capabilityVersions })
    .from(capabilities)
    .innerJoin(capabilityVersions, eq(capabilityVersions.capabilityId, capabilities.id));
  const registry: RegistryCapabilityVersion[] = registryRows.map(({ capability, version }) => ({
    capabilityId: capability.id,
    capabilityKey: capability.key,
    capabilityName: capability.name,
    referencePackKey: capability.referencePackKey,
    activeVersionId: capability.activeVersionId,
    versionId: version.id,
    version: version.version,
    versionStatus: version.status,
    contentHash: version.contentHash,
    contract: version.contract,
  }));
  const need = buildNeed({
    actor,
    taskGoal: scope.task.goal,
    courseId: scope.course.id,
    referencePackKey: subject.subject.referencePackKey,
    context,
    observation: diagnosis.observation,
    attempt: diagnosis.attempt,
  });
  const resolved = resolveCapabilityCandidates({ need, registry });
  const inputHash = capabilityResolutionHash({
    policyVersion: resolved.policyVersion,
    resolverInputHash: resolved.inputHash,
    context: { id: context.id, snapshotHash: context.snapshotHash, compilerVersion: context.compilerVersion },
    diagnosis: diagnosis.observation,
  });
  const resolutionId = capabilityResolutionId(inputHash);
  const candidateSet = persistedCandidates(resolved);
  const row = {
    id: resolutionId,
    institutionId: actor.institutionId,
    courseId: scope.course.id,
    taskId: scope.task.id,
    episodeId: scope.episode.id,
    contextCompilationId: context.id,
    diagnosticObservationId: diagnosis.observation.id,
    policyVersion: resolved.policyVersion,
    inputHash,
    decision: resolved.decision,
    candidateSet,
    selectedCapabilityId: resolved.selectedCapabilityId,
    selectedCapabilityVersionId: resolved.selectedCapabilityVersionId,
    selectionRationale: resolved.selectionRationale,
    parameterizationRecommendation: resolved.parameterizationRecommendation,
    compositionRecommendation: resolved.compositionRecommendation,
    gapSignal: resolved.gapSignal,
    noMatch: resolved.noMatch,
    teacherEscalation: resolved.teacherEscalation,
    createdBy: actor.userId,
  };
  const inserted = await getDb().insert(capabilityResolutions).values(row).onConflictDoNothing().returning({ id: capabilityResolutions.id });
  const [persisted] = await getDb().select().from(capabilityResolutions)
    .where(and(eq(capabilityResolutions.institutionId, actor.institutionId), eq(capabilityResolutions.inputHash, inputHash)))
    .limit(1);
  if (!persisted || persisted.id !== resolutionId
    || persisted.contextCompilationId !== context.id
    || persisted.diagnosticObservationId !== diagnosis.observation.id
    || stableCapabilityResolutionJson(persisted.candidateSet) !== stableCapabilityResolutionJson(candidateSet)
    || persisted.selectedCapabilityVersionId !== resolved.selectedCapabilityVersionId
    || persisted.decision !== resolved.decision) {
    throw new DomainInvariantError("Capability Resolution replay conflicts with persisted Product State", "CAPABILITY_RESOLUTION_REPLAY_CONFLICT");
  }
  return {
    ...persisted,
    candidates: candidateSet,
    replayed: inserted.length === 0,
  };
}

/**
 * Resolves a current Diagnosis Proposal against the canonical Registry without
 * executing or simulating any Component Asset.
 */
export function resolveCapabilityForDiagnosis(actor: Actor, input: {
  taskId: string;
  episodeId: string;
  diagnosticObservationId: string;
}) {
  return withTenantDatabase(actor, () => resolveInTenant(actor, input));
}
