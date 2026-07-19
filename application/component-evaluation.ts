import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Actor } from "@/domain/model";
import { ComponentContent, ComponentContract } from "@/domain/component";
import { authorizeEvidenceUnitInstitution, authorizePersistedEvidence, evidenceAlignsToCourse } from "@/domain/evidence";
import { hasVerifiedReviewProvenance, isEligibleReviewDecision } from "@/domain/review";
import { DomainInvariantError, requireRole } from "@/domain/invariants";
import { executePersistedCapabilityFixture } from "@/application/capabilities";
import { getDb } from "@/db/client";
import {
  capabilities,
  capabilityVersions,
  componentEvaluations,
  componentVersions,
  components,
  courses,
  diagnosticObservations,
  evidenceUnits,
  governanceEvents,
  learnerAttempts,
  learningTasks,
  sourceRecords,
  subjects,
  teacherReviews,
} from "@/db/schema";
import { assertExecutionActive, rethrowIfExecutionStopped } from "@/application/execution-control";

export const COMPONENT_EVALUATOR_KEY = "foundry-component-system-gates";
export const COMPONENT_EVALUATOR_VERSION = "1.0.0";

export type ComponentSystemCheck = {
  id: string;
  status: "PASSED" | "BLOCKED" | "NOT_REQUIRED";
  detail: string;
  evidence?: Record<string, unknown>;
};

function check(id: string, passed: boolean, detail: string, evidence?: Record<string, unknown>): ComponentSystemCheck {
  return { id, status: passed ? "PASSED" : "BLOCKED", detail, ...(evidence ? { evidence } : {}) };
}

function notRequired(id: string, detail: string, evidence: Record<string, unknown>): ComponentSystemCheck {
  return { id, status: "NOT_REQUIRED", detail, evidence };
}

function fixtureMatchesExpected(actual: {
  expected: number;
  unit: string;
  status: string;
  failureCode: string | null;
  firstInvalidStep: string | null;
}, expected: {
  expected: number;
  unit: string;
  status: "CORRECT" | "INCORRECT";
  failureCode: string | null;
  firstInvalidStep: string | null;
}): boolean {
  const actualExpected = typeof actual.expected === "number" ? actual.expected : Number.NaN;
  const numericMatch = Number.isFinite(actualExpected)
    && Math.abs(actualExpected - expected.expected) <= Number.EPSILON * 16 * Math.max(1, Math.abs(expected.expected));
  return numericMatch
    && actual.unit === expected.unit
    && actual.status === expected.status
    && actual.failureCode === expected.failureCode
    && actual.firstInvalidStep === expected.firstInvalidStep;
}

export async function runComponentEvaluation(actor: Actor, componentVersionId: string) {
  assertExecutionActive();
  requireRole(actor, ["EXPERT", "ADMIN"]);
  const db = getDb();
  const [row] = await db.select({ component: components, version: componentVersions })
    .from(componentVersions)
    .innerJoin(components, eq(components.id, componentVersions.componentId))
    .where(and(eq(componentVersions.id, componentVersionId), eq(components.institutionId, actor.institutionId)))
    .limit(1);
  if (!row) throw new DomainInvariantError("Component version is outside the active institution", "TENANT_ISOLATION");
  if (row.version.status !== "DRAFT") throw new DomainInvariantError("Only a mutable Draft can be evaluated", "VERSION_IMMUTABLE");

  const [courseBinding] = await db.select({ course: courses, subject: subjects })
    .from(courses)
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .where(and(eq(courses.id, row.component.courseId), eq(courses.institutionId, actor.institutionId)))
    .limit(1);
  const [capabilityBinding] = await db.select({ capability: capabilities, version: capabilityVersions })
    .from(capabilities)
    .innerJoin(capabilityVersions, and(
      eq(capabilityVersions.id, capabilities.activeVersionId),
      eq(capabilityVersions.capabilityId, capabilities.id),
    ))
    .where(eq(capabilities.id, row.component.capabilityId))
    .limit(1);

  const parsedContract = ComponentContract.safeParse(row.version.contract);
  const parsedContent = ComponentContent.safeParse(row.version.content);
  const bindingValid = Boolean(
    courseBinding
    && capabilityBinding
    && capabilityBinding.version.status === "ACTIVE"
    && capabilityBinding.capability.referencePackKey === row.component.referencePackKey
    && courseBinding.subject.referencePackKey === row.component.referencePackKey
    && parsedContract.success
    && parsedContract.data.capabilityId === row.component.capabilityId
    && parsedContract.data.capabilityKey === capabilityBinding.capability.key
    && parsedContract.data.referencePackKey === row.component.referencePackKey,
  );

  const signalRows = row.component.failureCode ? await db.select({
    observation: diagnosticObservations,
    attempt: learnerAttempts,
    task: learningTasks,
    review: teacherReviews,
  }).from(diagnosticObservations)
    .innerJoin(learnerAttempts, eq(learnerAttempts.id, diagnosticObservations.attemptId))
    .innerJoin(learningTasks, eq(learningTasks.id, learnerAttempts.taskId))
    .innerJoin(teacherReviews, eq(teacherReviews.observationId, diagnosticObservations.id))
    .where(and(
      eq(learningTasks.institutionId, actor.institutionId),
      eq(learningTasks.courseId, row.component.courseId),
      eq(learnerAttempts.capabilityId, row.component.capabilityId),
      eq(diagnosticObservations.observationSource, "CAPABILITY"),
      eq(diagnosticObservations.failureCode, row.component.failureCode),
      isNull(diagnosticObservations.supersededById),
    )).orderBy(desc(teacherReviews.createdAt), desc(teacherReviews.id)) : [];
  // The first row per Observation is its current leaf. Historical/superseded Reviews
  // never authorize a current publication decision, even if their old decision was eligible.
  const currentSignalRows = [...signalRows.reduce((current, signal) => {
    if (!current.has(signal.observation.id)) current.set(signal.observation.id, signal);
    return current;
  }, new Map<string, (typeof signalRows)[number]>()).values()];
  const eligibleSignals = currentSignalRows.filter(({ review }) => isEligibleReviewDecision(review.decision) && hasVerifiedReviewProvenance(review, actor.institutionId));
  const distinctAttemptIds = [...new Set(eligibleSignals.map(({ attempt }) => attempt.id))];
  const sourceObservationIds = [...new Set(eligibleSignals.map(({ observation }) => observation.id))];
  const sourceReviewIds = [...new Set(eligibleSignals.map(({ review }) => review.id))];
  const initialObservationId = typeof row.component.sourceSignal.observationId === "string" ? row.component.sourceSignal.observationId : null;
  const initialReviewId = typeof row.component.sourceSignal.reviewId === "string" ? row.component.sourceSignal.reviewId : null;
  const initialLineageValid = Boolean(initialObservationId && initialReviewId && eligibleSignals.some(({ observation, review }) => observation.id === initialObservationId && review.id === initialReviewId));

  let fixtureExecution: Record<string, unknown> = { status: "BLOCKED", reason: "Capability binding is invalid." };
  let fixturePassed = false;
  if (bindingValid && capabilityBinding) {
    try {
      const execution = await executePersistedCapabilityFixture(capabilityBinding.version.id);
      fixturePassed = fixtureMatchesExpected(execution.result, execution.fixture.expected);
      fixtureExecution = {
        status: fixturePassed ? "EXECUTED_PASSED" : "EXECUTED_FAILED",
        capabilityId: execution.capability.id,
        capabilityVersionId: execution.version.id,
        implementationKey: execution.version.implementationKey,
        fixture: execution.fixture,
        expected: execution.fixture.expected,
        result: execution.result,
      };
    } catch (error) {
      rethrowIfExecutionStopped(error);
      fixtureExecution = { status: "FAILED", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const evidenceRefs = parsedContent.success ? parsedContent.data.evidenceRefs : [];
  const evidenceRows = evidenceRefs.length ? await db.select({ evidence: evidenceUnits, source: sourceRecords })
    .from(evidenceUnits)
    .innerJoin(sourceRecords, eq(sourceRecords.id, evidenceUnits.sourceId))
    .where(inArray(evidenceUnits.id, evidenceRefs.map((reference) => reference.evidenceUnitId))) : [];
  const evidenceChecks: Array<Record<string, unknown>> = evidenceRefs.map((reference) => {
    const evidenceRow = evidenceRows.find(({ evidence }) => evidence.id === reference.evidenceUnitId);
    if (!evidenceRow || !courseBinding) return { evidenceUnitId: reference.evidenceUnitId, status: "BLOCKED", detail: "Evidence reference does not resolve in the governed corpus." };
    try {
      authorizeEvidenceUnitInstitution(actor, evidenceRow.evidence.institutionId);
      authorizePersistedEvidence(actor, evidenceRow.source, "LEARNING");
      if (!evidenceAlignsToCourse(evidenceRow.evidence.metadata, row.component.courseId, row.component.referencePackKey)) {
        throw new DomainInvariantError("Evidence is outside the Component course and Reference Pack", "EVIDENCE_ALIGNMENT_DENIED");
      }
      return { evidenceUnitId: reference.evidenceUnitId, sourceId: evidenceRow.source.id, locator: evidenceRow.evidence.locator, attribution: reference.attribution, status: "PASSED", detail: "Evidence exists, is rights-approved, and aligns to the Component course or Reference Pack." };
    } catch (error) {
      return { evidenceUnitId: reference.evidenceUnitId, status: "BLOCKED", detail: error instanceof Error ? error.message : String(error) };
    }
  });
  const evidencePolicy = parsedContract.success ? parsedContract.data.evidencePolicy : null;
  const uniqueEvidence = new Set(evidenceRefs.map((item) => item.evidenceUnitId)).size === evidenceRefs.length;
  const evidencePassed = evidenceRefs.length > 0
    && evidencePolicy === "REQUIRED"
    && evidenceChecks.every((item) => item.status === "PASSED")
    && uniqueEvidence;
  const evidenceNotRequired = evidenceRefs.length === 0 && evidencePolicy === "NOT_REQUIRED_DETERMINISTIC_SCAFFOLD";
  if (evidenceNotRequired) {
    evidenceChecks.push({
      status: "NOT_REQUIRED",
      policy: "NOT_REQUIRED_DETERMINISTIC_SCAFFOLD",
      detail: "This narrow deterministic scaffold makes no source-content claim and declares no Evidence. Rights and citation checks are therefore not required for this version.",
    });
  }

  const systemChecks: ComponentSystemCheck[] = [
    check("structural-contract-schema", parsedContract.success, parsedContract.success ? "The versioned Component contract matches the published schema." : "The Component contract is structurally invalid."),
    check("content-completeness", parsedContent.success, parsedContent.success ? "Teaching support, scaffold, worked example, and learner action are complete." : "Required structured authoring fields are incomplete."),
    check("active-capability-reference-pack-binding", bindingValid, bindingValid ? "The persisted active Capability and course Reference Pack exactly match the Component binding." : "Capability, active version, course, or Reference Pack binding is invalid."),
    check("source-current-human-review-provenance", initialLineageValid, initialLineageValid ? "The source Observation and its authenticated eligible Review remain current and match the Component signal." : "The source Observation/Review lineage is missing, stale, escalated, or unverified."),
    check("repeated-pattern-distinct-attempts", distinctAttemptIds.length >= 2, distinctAttemptIds.length >= 2 ? "At least two distinct Attempts carry the same eligible reviewed capability failure signal." : "Publication requires at least two distinct Attempts with the same eligible reviewed capability failure signal.", { distinctAttemptCount: distinctAttemptIds.length, failureCode: row.component.failureCode }),
    check("deterministic-capability-fixture", fixturePassed, fixturePassed ? "The bound persisted deterministic Capability output exactly matches its versioned expected fixture result." : "The bound deterministic Capability output did not match its versioned expected fixture result."),
    evidenceNotRequired
      ? notRequired("evidence-rights-alignment-citations", "Evidence is explicitly not required for this deterministic scaffold type; no Evidence gate is claimed as passed.", { policy: evidencePolicy })
      : check("evidence-rights-alignment-citations", evidencePassed, evidencePassed ? "All declared Evidence references resolve with rights, scope, and attribution integrity." : "Evidence is required but one or more references are missing, duplicated, unauthorized, or misaligned."),
  ];
  const systemStatus = systemChecks.every((item) => item.status !== "BLOCKED") ? "PASSED" : "BLOCKED";
  const providerChecks = {
    status: "UNAVAILABLE",
    detail: "No automated provider domain, pedagogy, or safety score was run. Authenticated expert rubric is a separate mandatory gate.",
  };
  const evaluationInputHash = createHash("sha256").update(JSON.stringify({
    contentHash: row.version.contentHash,
    capabilityVersionId: capabilityBinding?.version.id ?? null,
    sourceObservationIds: [...sourceObservationIds].sort(),
    sourceReviewIds: [...sourceReviewIds].sort(),
    sourceAttemptIds: [...distinctAttemptIds].sort(),
    evidenceChecks,
  })).digest("hex");
  const evaluationId = randomUUID();
  assertExecutionActive();
  const evaluation = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(componentVersions).where(eq(componentVersions.id, row.version.id)).for("update").limit(1);
    if (!locked || locked.status !== "DRAFT" || locked.contentHash !== row.version.contentHash) {
      throw new DomainInvariantError("Component changed or became immutable during evaluation", "COMPONENT_EVALUATION_CONFLICT");
    }
    const [existing] = await tx.select().from(componentEvaluations).where(and(
      eq(componentEvaluations.componentVersionId, locked.id),
      eq(componentEvaluations.inputHash, evaluationInputHash),
    )).limit(1);
    if (existing) return { record: existing, replayed: true };
    const [record] = await tx.insert(componentEvaluations).values({
      id: evaluationId,
      componentVersionId: locked.id,
      institutionId: actor.institutionId,
      courseId: row.component.courseId,
      evaluatorKey: COMPONENT_EVALUATOR_KEY,
      evaluatorVersion: COMPONENT_EVALUATOR_VERSION,
      contentHash: locked.contentHash,
      inputHash: evaluationInputHash,
      systemStatus,
      systemChecks,
      sourceObservationIds,
      sourceReviewIds,
      sourceAttemptIds: distinctAttemptIds,
      fixtureExecution,
      evidenceChecks,
      providerChecks,
      createdBy: actor.userId,
    }).returning();
    await tx.update(componentVersions).set({
      validation: { kind: "COMPONENT_SYSTEM_EVALUATION", evaluatorKey: COMPONENT_EVALUATOR_KEY, evaluatorVersion: COMPONENT_EVALUATOR_VERSION, systemStatus, systemChecks },
      evalResult: { evaluationId: record.id, systemStatus, providerChecks, humanRubricStatus: "PENDING_EXPERT_REVIEW" },
      sourceObservationIds,
      sourceReviewIds,
    }).where(and(eq(componentVersions.id, locked.id), eq(componentVersions.status, "DRAFT")));
    await tx.insert(governanceEvents).values({
      institutionId: actor.institutionId,
      actorUserId: actor.userId,
      entityType: "COMPONENT_EVALUATION",
      entityId: record.id,
      action: "SYSTEM_GATES_RECORDED",
      payload: { componentId: row.component.id, componentVersionId: locked.id, systemStatus, evaluatorVersion: COMPONENT_EVALUATOR_VERSION, evaluationInputHash, sourceObservationIds, sourceReviewIds, sourceAttemptIds: distinctAttemptIds },
    });
    return { record, replayed: false };
  });
  return { evaluation: evaluation.record, replayed: evaluation.replayed, systemStatus, systemChecks, providerChecks, fixtureExecution, evidenceChecks };
}
