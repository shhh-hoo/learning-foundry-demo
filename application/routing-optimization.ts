import { and, eq, sql } from "drizzle-orm";
import { assertExecutionActive } from "@/application/execution-control";
import { commandRequestHash } from "@/application/commands";
import { getDb, getSql, withTenantDatabase } from "@/db/client";
import {
  idempotencyKeys,
  routingOptimizationDecisions,
  routingOptimizationProposals,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import { DomainInvariantError, requireCourseAccess, requireRole } from "@/domain/invariants";
import {
  ROUTING_OPTIMIZATION_LIMITATIONS,
  ROUTING_OPTIMIZATION_RATIONALE,
  ROUTING_OPTIMIZATION_RULE,
  RoutingOptimizationDecisionAction,
  deriveTeacherOverrideRoutingChange,
  routingOptimizationId,
} from "@/domain/routing-optimization";

type RoutingLineage = {
  intervention_id: string;
  institution_id: string;
  course_id: string;
  task_id: string;
  episode_id: string;
  context_compilation_id: string;
  context_consumer: string;
  compiler_version: string;
  context_policy_version: string;
  context_input_hash: string;
  context_snapshot_hash: string;
  selected_items_hash: string;
  excluded_items_hash: string;
  diagnostic_observation_id: string;
  diagnosis_attempt_id: string;
  diagnosis_status: string;
  failure_code: string | null;
  diagnosis_summary: string;
  structured_result_hash: string;
  diagnosis_input_lineage_hash: string;
  diagnosis_output_lineage_hash: string;
  diagnosis_superseded_by_id: string | null;
  capability_resolution_id: string;
  policy_version: string;
  resolution_input_hash: string;
  resolution_decision: string;
  candidate_set: Array<Record<string, unknown>>;
  candidate_set_hash: string;
  selected_capability_id: string;
  selected_capability_version_id: string;
  selection_rationale: string;
  no_match: boolean;
  selected_capability_key: string;
  selected_capability_name: string;
  selected_capability_version: string;
  selected_capability_version_content_hash: string;
  active_version_id: string | null;
  capability_version_status: string;
  activity_plan_id: string;
  activity_plan_input_hash: string;
  runtime_delivery_id: string;
  runtime_status: string;
  runtime_request_hash: string;
  runtime_output_hash: string | null;
  learner_attempt_id: string;
  learner_attempt_content_hash: string | null;
  learner_attempt_modality: string | null;
  action_type: string;
  intervention_reason: string;
  constraint_capability_id: string;
  teacher_id: string;
  target_lineage_hash: string;
  task_status: string;
  episode_status: string;
  constraint_superseded: boolean;
  teacher_review_ids: string[];
  learning_outcome_ids: string[];
};

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

function assertOptimizationRole(actor: Actor) {
  requireRole(actor, ["TEACHER", "EXPERT", "ADMIN"]);
}

async function loadRoutingLineage(actor: Actor, teacherInterventionId: string): Promise<RoutingLineage> {
  const [lineage] = await getSql()<RoutingLineage[]>`
    SELECT intervention.id AS intervention_id, intervention.institution_id, intervention.course_id,
      intervention.task_id, intervention.episode_id,
      context.id AS context_compilation_id, context.consumer AS context_consumer,
      context.compiler_version, context.context_policy_version, context.input_hash AS context_input_hash,
      context.snapshot_hash AS context_snapshot_hash,
      encode(public.digest(convert_to(context.selected_items::text,'UTF8'),'sha256'),'hex') AS selected_items_hash,
      encode(public.digest(convert_to(context.excluded_items::text,'UTF8'),'sha256'),'hex') AS excluded_items_hash,
      diagnosis.id AS diagnostic_observation_id, diagnosis.attempt_id AS diagnosis_attempt_id,
      diagnosis.status AS diagnosis_status, diagnosis.failure_code, diagnosis.summary AS diagnosis_summary,
      encode(public.digest(convert_to(diagnosis.structured_result::text,'UTF8'),'sha256'),'hex') AS structured_result_hash,
      encode(public.digest(convert_to(diagnosis.input_lineage::text,'UTF8'),'sha256'),'hex') AS diagnosis_input_lineage_hash,
      encode(public.digest(convert_to(diagnosis.output_lineage::text,'UTF8'),'sha256'),'hex') AS diagnosis_output_lineage_hash,
      diagnosis.superseded_by_id AS diagnosis_superseded_by_id,
      resolution.id AS capability_resolution_id, resolution.policy_version,
      resolution.input_hash AS resolution_input_hash, resolution.decision AS resolution_decision,
      resolution.candidate_set, encode(public.digest(convert_to(resolution.candidate_set::text,'UTF8'),'sha256'),'hex') AS candidate_set_hash,
      resolution.selected_capability_id, resolution.selected_capability_version_id,
      resolution.selection_rationale, resolution.no_match,
      capability.key AS selected_capability_key, capability.name AS selected_capability_name,
      version.version AS selected_capability_version, version.content_hash AS selected_capability_version_content_hash,
      capability.active_version_id, version.status AS capability_version_status,
      plan.id AS activity_plan_id, plan.input_hash AS activity_plan_input_hash,
      delivery.id AS runtime_delivery_id, delivery.status AS runtime_status,
      delivery.request_hash AS runtime_request_hash, delivery.output_hash AS runtime_output_hash,
      attempt.id AS learner_attempt_id, attempt.content_hash AS learner_attempt_content_hash,
      attempt.modality AS learner_attempt_modality,
      intervention.action_type, intervention.reason AS intervention_reason,
      intervention.constraint_capability_id, intervention.teacher_id,
      encode(public.digest(convert_to(intervention.target_lineage::text,'UTF8'),'sha256'),'hex') AS target_lineage_hash,
      task.status AS task_status, episode.status AS episode_status,
      EXISTS (SELECT 1 FROM foundry_product.teacher_capability_constraints successor
        WHERE successor.supersedes_constraint_id=constraint_row.id) AS constraint_superseded,
      COALESCE((SELECT jsonb_agg(review.id::text ORDER BY review.created_at,review.id)
        FROM foundry_product.teacher_reviews review WHERE review.observation_id=diagnosis.id),'[]'::jsonb) AS teacher_review_ids,
      COALESCE((SELECT jsonb_agg(outcome.id::text ORDER BY outcome.created_at,outcome.id)
        FROM foundry_product.learning_outcomes outcome
        JOIN foundry_product.retry_attempts retry ON retry.id=outcome.retry_id
        WHERE outcome.task_id=task.id AND retry.original_attempt_id IN (diagnosis.attempt_id,attempt.id)),'[]'::jsonb) AS learning_outcome_ids
    FROM foundry_product.teacher_interventions intervention
    JOIN foundry_product.teacher_capability_constraints constraint_row ON constraint_row.source_intervention_id=intervention.id
    JOIN foundry_product.learning_tasks task ON task.id=intervention.task_id
    JOIN foundry_product.learning_episodes episode ON episode.id=intervention.episode_id AND episode.task_id=task.id
    JOIN foundry_product.context_compilations context ON context.id=intervention.context_compilation_id
    JOIN foundry_product.diagnostic_observations diagnosis ON diagnosis.id=intervention.diagnostic_observation_id
    JOIN foundry_product.capability_resolutions resolution ON resolution.id=intervention.capability_resolution_id
    JOIN foundry_product.activity_plans plan ON plan.id=intervention.activity_plan_id
    JOIN foundry_product.runtime_deliveries delivery ON delivery.id=intervention.runtime_delivery_id
    JOIN foundry_product.learner_attempts attempt ON attempt.id=intervention.learner_attempt_id
    JOIN foundry_product.capabilities capability ON capability.id=resolution.selected_capability_id
    JOIN foundry_product.capability_versions version ON version.id=resolution.selected_capability_version_id AND version.capability_id=capability.id
    WHERE intervention.id=${teacherInterventionId} AND intervention.institution_id=${actor.institutionId}
  `;
  if (!lineage) throw new DomainInvariantError("Routing Optimization requires an authorized exact TeacherIntervention route signal", "ROUTING_OPTIMIZATION_LINEAGE_NOT_FOUND");
  requireCourseAccess(actor, lineage.institution_id, lineage.course_id);
  if (lineage.action_type !== "EXCLUDE_CAPABILITY" || lineage.resolution_decision !== "EXISTING"
    || lineage.constraint_capability_id !== lineage.selected_capability_id
    || lineage.no_match || lineage.task_status !== "OPEN" || lineage.episode_status !== "ACTIVE"
    || lineage.diagnosis_superseded_by_id || lineage.constraint_superseded
    || lineage.active_version_id !== lineage.selected_capability_version_id
    || lineage.capability_version_status !== "ACTIVE"
    || !new Set(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]).has(lineage.runtime_status)
    || !lineage.learner_attempt_content_hash) {
    throw new DomainInvariantError("CAP-08B requires one current explicit teacher exclusion of the exact selected Capability; usage or Attempt correctness is ineligible", "ROUTING_OPTIMIZATION_SIGNAL_INELIGIBLE");
  }
  return lineage;
}

async function assertIdempotencyReplay(commandType: string, actor: Actor, idempotencyKey: string, requestHash: string, expectedResultId: string) {
  const [key] = await getDb().select().from(idempotencyKeys).where(and(
    eq(idempotencyKeys.institutionId, actor.institutionId),
    eq(idempotencyKeys.commandType, commandType),
    eq(idempotencyKeys.key, idempotencyKey),
  )).limit(1);
  if (!key || key.actorUserId !== actor.userId || key.requestHash !== requestHash || key.resultId !== expectedResultId) {
    throw new DomainInvariantError("Routing Optimization idempotency key was reused with different input", "IDEMPOTENCY_MISMATCH");
  }
}

export async function createRoutingOptimizationProposal(actor: Actor, input: { teacherInterventionId: string; idempotencyKey: string }) {
  assertExecutionActive();
  assertOptimizationRole(actor);
  return withTenantDatabase(actor, async () => {
    const lineage = await loadRoutingLineage(actor, input.teacherInterventionId);
    let proposedChange: ReturnType<typeof deriveTeacherOverrideRoutingChange>;
    try {
      proposedChange = deriveTeacherOverrideRoutingChange({
        interventionId: lineage.intervention_id,
        actionType: lineage.action_type,
        constraintCapabilityId: lineage.constraint_capability_id,
        reason: lineage.intervention_reason,
      }, {
        id: lineage.capability_resolution_id,
        policyVersion: lineage.policy_version,
        decision: lineage.resolution_decision,
        selectedCapabilityId: lineage.selected_capability_id,
        selectedCapabilityVersionId: lineage.selected_capability_version_id,
        candidates: lineage.candidate_set,
      });
    } catch {
      throw new DomainInvariantError("The exact selected candidate set does not support the bounded teacher-exclusion routing rule", "ROUTING_OPTIMIZATION_RULE_INAPPLICABLE");
    }
    const evidenceSnapshot = {
      context: {
        id: lineage.context_compilation_id,
        consumer: lineage.context_consumer,
        compilerVersion: lineage.compiler_version,
        contextPolicyVersion: lineage.context_policy_version,
        inputHash: lineage.context_input_hash,
        snapshotHash: lineage.context_snapshot_hash,
        selectedItemsHash: lineage.selected_items_hash,
        excludedItemsHash: lineage.excluded_items_hash,
      },
      diagnosis: {
        id: lineage.diagnostic_observation_id,
        attemptId: lineage.diagnosis_attempt_id,
        status: lineage.diagnosis_status,
        failureCode: lineage.failure_code,
        summary: lineage.diagnosis_summary,
        structuredResultHash: lineage.structured_result_hash,
        inputLineageHash: lineage.diagnosis_input_lineage_hash,
        outputLineageHash: lineage.diagnosis_output_lineage_hash,
      },
      capabilityResolution: {
        id: lineage.capability_resolution_id,
        policyVersion: lineage.policy_version,
        inputHash: lineage.resolution_input_hash,
        decision: lineage.resolution_decision,
        candidateSet: lineage.candidate_set,
        candidateSetHash: lineage.candidate_set_hash,
        selectedCapabilityId: lineage.selected_capability_id,
        selectedCapabilityVersionId: lineage.selected_capability_version_id,
        selectionRationale: lineage.selection_rationale,
      },
      activityPlan: {
        id: lineage.activity_plan_id,
        inputHash: lineage.activity_plan_input_hash,
        capabilityVersionId: lineage.selected_capability_version_id,
        capabilityVersionContentHash: lineage.selected_capability_version_content_hash,
      },
      runtimeDelivery: {
        id: lineage.runtime_delivery_id,
        status: lineage.runtime_status,
        requestHash: lineage.runtime_request_hash,
        outputHash: lineage.runtime_output_hash,
      },
      learnerAttempt: {
        id: lineage.learner_attempt_id,
        contentHash: lineage.learner_attempt_content_hash,
        modality: lineage.learner_attempt_modality,
        interpretation: "LINEAGE_ONLY_NOT_ROUTING_VERDICT",
      },
      teacherIntervention: {
        id: lineage.intervention_id,
        actionType: lineage.action_type,
        reason: lineage.intervention_reason,
        constraintCapabilityId: lineage.constraint_capability_id,
        teacherId: lineage.teacher_id,
        targetLineageHash: lineage.target_lineage_hash,
      },
      teacherReviewIds: lineage.teacher_review_ids,
      learningOutcomeIds: lineage.learning_outcome_ids,
      outcomeEvidenceUsed: false,
    };
    const evidenceRefs = [
      { kind: "CONTEXT_COMPILATION", id: lineage.context_compilation_id },
      { kind: "DIAGNOSTIC_OBSERVATION_PROPOSAL", id: lineage.diagnostic_observation_id },
      { kind: "CAPABILITY_RESOLUTION", id: lineage.capability_resolution_id },
      { kind: "CAPABILITY_VERSION", id: lineage.selected_capability_version_id },
      { kind: "ACTIVITY_PLAN", id: lineage.activity_plan_id },
      { kind: "RUNTIME_DELIVERY", id: lineage.runtime_delivery_id },
      { kind: "LEARNER_ATTEMPT", id: lineage.learner_attempt_id },
      { kind: "TEACHER_INTERVENTION", id: lineage.intervention_id },
      ...lineage.teacher_review_ids.map((id) => ({ kind: "TEACHER_REVIEW", id })),
      ...lineage.learning_outcome_ids.map((id) => ({ kind: "LEARNING_OUTCOME", id })),
    ];
    const commandType = "CREATE_ROUTING_OPTIMIZATION_PROPOSAL";
    const requestHash = commandRequestHash(actor, commandType, { teacherInterventionId: lineage.intervention_id });
    const proposalId = routingOptimizationId(commandType, requestHash);
    const [hashedEvidence] = await getSql()<Array<{ evidence_hash: string }>>`
      SELECT encode(public.digest(convert_to(${JSON.stringify(evidenceSnapshot)}::jsonb::text,'UTF8'),'sha256'),'hex') AS evidence_hash
    `;
    if (!hashedEvidence?.evidence_hash) throw new DomainInvariantError("Routing Optimization evidence hashing is unavailable", "ROUTING_OPTIMIZATION_EVIDENCE_HASH_FAILED");
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`cap08b-proposal:${lineage.intervention_id}`},0))`);
      const [canonical] = await tx.select().from(routingOptimizationProposals)
        .where(eq(routingOptimizationProposals.teacherInterventionId, lineage.intervention_id)).limit(1);
      if (canonical) {
        const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: canonical.id, actorUserId: actor.userId }).onConflictDoNothing().returning();
        if (!reserved.length) await assertIdempotencyReplay(commandType, actor, input.idempotencyKey, requestHash, canonical.id);
        return { proposal: canonical, replayed: true };
      }
      const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: proposalId, actorUserId: actor.userId }).onConflictDoNothing().returning();
      if (!reserved.length) {
        await assertIdempotencyReplay(commandType, actor, input.idempotencyKey, requestHash, proposalId);
        const [existing] = await tx.select().from(routingOptimizationProposals).where(eq(routingOptimizationProposals.id, proposalId)).limit(1);
        if (!existing) throw new DomainInvariantError("Routing Optimization replay target is missing", "IDEMPOTENCY_INTEGRITY");
        return { proposal: existing, replayed: true };
      }
      const [proposal] = await tx.insert(routingOptimizationProposals).values({
        id: proposalId,
        institutionId: lineage.institution_id,
        courseId: lineage.course_id,
        taskId: lineage.task_id,
        episodeId: lineage.episode_id,
        contextCompilationId: lineage.context_compilation_id,
        contextSnapshotHash: lineage.context_snapshot_hash,
        diagnosticObservationId: lineage.diagnostic_observation_id,
        capabilityResolutionId: lineage.capability_resolution_id,
        capabilityResolutionInputHash: lineage.resolution_input_hash,
        selectedCapabilityId: lineage.selected_capability_id,
        selectedCapabilityVersionId: lineage.selected_capability_version_id,
        selectedCapabilityVersionContentHash: lineage.selected_capability_version_content_hash,
        activityPlanId: lineage.activity_plan_id,
        runtimeDeliveryId: lineage.runtime_delivery_id,
        learnerAttemptId: lineage.learner_attempt_id,
        learnerAttemptContentHash: lineage.learner_attempt_content_hash!,
        teacherInterventionId: lineage.intervention_id,
        proposalType: "ROUTING",
        signalKind: "TEACHER_EXCLUSION_OVERRIDE",
        rationale: ROUTING_OPTIMIZATION_RATIONALE,
        proposedChange,
        evidenceSnapshot,
        evidenceRefs,
        evidenceHash: hashedEvidence.evidence_hash,
        limitations: [...ROUTING_OPTIMIZATION_LIMITATIONS],
        ruleKey: ROUTING_OPTIMIZATION_RULE.key,
        ruleVersion: ROUTING_OPTIMIZATION_RULE.version,
        confidence: ROUTING_OPTIMIZATION_RULE.confidence,
        state: "PENDING_GOVERNANCE",
        requestedBy: actor.userId,
        requesterProvenance: actorProvenance(actor),
        requestHash,
      }).returning();
      return { proposal, replayed: false };
    });
  });
}

export async function decideRoutingOptimizationProposal(actor: Actor, input: { proposalId: string; action: RoutingOptimizationDecisionAction; rationale: string; idempotencyKey: string }) {
  assertExecutionActive();
  assertOptimizationRole(actor);
  const action = RoutingOptimizationDecisionAction.parse(input.action);
  const rationale = input.rationale.trim();
  if (rationale.length < 5) throw new DomainInvariantError("Routing Optimization decision rationale must contain at least five characters", "ROUTING_OPTIMIZATION_RATIONALE_REQUIRED");
  return withTenantDatabase(actor, async () => {
    const [proposal] = await getDb().select().from(routingOptimizationProposals).where(and(
      eq(routingOptimizationProposals.id, input.proposalId),
      eq(routingOptimizationProposals.institutionId, actor.institutionId),
    )).limit(1);
    if (!proposal) throw new DomainInvariantError("Routing Optimization Proposal is outside the active institution", "TENANT_ISOLATION");
    requireCourseAccess(actor, proposal.institutionId, proposal.courseId);
    const commandType = "DECIDE_ROUTING_OPTIMIZATION_PROPOSAL";
    const requestHash = commandRequestHash(actor, commandType, { proposalId: proposal.id, action, rationale });
    const decisionId = routingOptimizationId(commandType, requestHash);
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`cap08b-decision:${proposal.id}`},0))`);
      const [canonical] = await tx.select().from(routingOptimizationDecisions).where(eq(routingOptimizationDecisions.proposalId, proposal.id)).limit(1);
      if (canonical) {
        if (canonical.requestHash !== requestHash || canonical.decidedBy !== actor.userId) {
          throw new DomainInvariantError("Routing Optimization Proposal already has an append-only human decision", "ROUTING_OPTIMIZATION_ALREADY_GOVERNED");
        }
        const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: canonical.id, actorUserId: actor.userId }).onConflictDoNothing().returning();
        if (!reserved.length) await assertIdempotencyReplay(commandType, actor, input.idempotencyKey, requestHash, canonical.id);
        return { decision: canonical, replayed: true };
      }
      const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: decisionId, actorUserId: actor.userId }).onConflictDoNothing().returning();
      if (!reserved.length) {
        await assertIdempotencyReplay(commandType, actor, input.idempotencyKey, requestHash, decisionId);
        const [existing] = await tx.select().from(routingOptimizationDecisions).where(eq(routingOptimizationDecisions.id, decisionId)).limit(1);
        if (!existing) throw new DomainInvariantError("Routing Optimization decision replay target is missing", "IDEMPOTENCY_INTEGRITY");
        return { decision: existing, replayed: true };
      }
      const [decision] = await tx.insert(routingOptimizationDecisions).values({
        id: decisionId,
        institutionId: proposal.institutionId,
        courseId: proposal.courseId,
        proposalId: proposal.id,
        taskId: proposal.taskId,
        capabilityResolutionId: proposal.capabilityResolutionId,
        action,
        rationale,
        decidedBy: actor.userId,
        actorProvenance: actorProvenance(actor),
        idempotencyKey: input.idempotencyKey,
        requestHash,
      }).returning();
      return { decision, replayed: false };
    });
  });
}

export async function getRoutingOptimizationWorkspace(actor: Actor) {
  assertOptimizationRole(actor);
  const courseIds = actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"];
  const candidates = await getSql()<Array<Record<string, unknown>>>`
    SELECT intervention.id AS teacher_intervention_id, intervention.reason AS teacher_reason,
      intervention.created_at AS teacher_intervention_created_at,
      task.id AS task_id, task.title AS task_title, context.id AS context_compilation_id,
      context.snapshot_hash AS context_snapshot_hash, diagnosis.id AS diagnostic_observation_id,
      diagnosis.summary AS diagnosis_summary, resolution.id AS capability_resolution_id,
      resolution.policy_version, resolution.candidate_set, resolution.selection_rationale,
      capability.id AS selected_capability_id, capability.key AS selected_capability_key,
      capability.name AS selected_capability_name, version.id AS selected_capability_version_id,
      version.version AS selected_capability_version, version.content_hash AS selected_capability_version_content_hash,
      plan.id AS activity_plan_id, delivery.id AS runtime_delivery_id, delivery.status AS runtime_status,
      attempt.id AS learner_attempt_id, attempt.content_hash AS learner_attempt_content_hash
    FROM foundry_product.teacher_interventions intervention
    JOIN foundry_product.teacher_capability_constraints constraint_row ON constraint_row.source_intervention_id=intervention.id
    JOIN foundry_product.learning_tasks task ON task.id=intervention.task_id
    JOIN foundry_product.learning_episodes episode ON episode.id=intervention.episode_id AND episode.task_id=task.id
    JOIN foundry_product.context_compilations context ON context.id=intervention.context_compilation_id
    JOIN foundry_product.diagnostic_observations diagnosis ON diagnosis.id=intervention.diagnostic_observation_id
    JOIN foundry_product.capability_resolutions resolution ON resolution.id=intervention.capability_resolution_id
    JOIN foundry_product.activity_plans plan ON plan.id=intervention.activity_plan_id
    JOIN foundry_product.runtime_deliveries delivery ON delivery.id=intervention.runtime_delivery_id
    JOIN foundry_product.learner_attempts attempt ON attempt.id=intervention.learner_attempt_id
    JOIN foundry_product.capabilities capability ON capability.id=resolution.selected_capability_id
    JOIN foundry_product.capability_versions version ON version.id=resolution.selected_capability_version_id AND version.capability_id=capability.id
    WHERE intervention.institution_id=${actor.institutionId} AND intervention.course_id=ANY(${courseIds}::uuid[])
      AND intervention.action_type='EXCLUDE_CAPABILITY'
      AND intervention.constraint_capability_id=resolution.selected_capability_id
      AND intervention.capability_version_id=resolution.selected_capability_version_id
      AND constraint_row.effect='EXCLUDE' AND constraint_row.capability_id=resolution.selected_capability_id
      AND resolution.decision='EXISTING' AND NOT resolution.no_match
      AND task.status='OPEN' AND episode.status='ACTIVE' AND diagnosis.superseded_by_id IS NULL
      AND capability.active_version_id=version.id AND version.status='ACTIVE'
      AND delivery.status IN ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED') AND attempt.content_hash IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM foundry_product.teacher_capability_constraints successor WHERE successor.supersedes_constraint_id=constraint_row.id)
      AND NOT EXISTS (SELECT 1 FROM foundry_product.routing_optimization_proposals proposal WHERE proposal.teacher_intervention_id=intervention.id)
    ORDER BY intervention.created_at DESC, intervention.id DESC LIMIT 20
  `;
  const proposals = await getSql()<Array<Record<string, unknown>>>`
    SELECT proposal.id AS proposal_id, proposal.state, proposal.signal_kind, proposal.rationale,
      proposal.proposed_change, proposal.evidence_snapshot, proposal.evidence_refs, proposal.evidence_hash,
      proposal.limitations, proposal.rule_key, proposal.rule_version, proposal.confidence, proposal.created_at,
      proposal.task_id, task.title AS task_title, proposal.context_compilation_id, proposal.context_snapshot_hash,
      context.selected_items AS context_selected_items, context.excluded_items AS context_excluded_items,
      proposal.diagnostic_observation_id, diagnosis.summary AS diagnosis_summary,
      proposal.capability_resolution_id, resolution.policy_version, resolution.candidate_set,
      resolution.selection_rationale, proposal.selected_capability_id, capability.key AS selected_capability_key,
      capability.name AS selected_capability_name, proposal.selected_capability_version_id,
      version.version AS selected_capability_version, proposal.selected_capability_version_content_hash,
      proposal.activity_plan_id, proposal.runtime_delivery_id, proposal.learner_attempt_id,
      proposal.teacher_intervention_id, intervention.reason AS teacher_reason,
      decision.id AS decision_id, decision.action AS decision_action, decision.rationale AS decision_rationale,
      decision.decided_by AS decision_decided_by, decider.name AS decision_actor_name,
      decision.created_at AS decision_created_at,
      task.status='OPEN' AND episode.status='ACTIVE' AND diagnosis.superseded_by_id IS NULL
        AND capability.active_version_id=version.id AND version.status='ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM foundry_product.teacher_capability_constraints successor
          WHERE successor.supersedes_constraint_id=constraint_row.id) AS source_current
    FROM foundry_product.routing_optimization_proposals proposal
    JOIN foundry_product.learning_tasks task ON task.id=proposal.task_id
    JOIN foundry_product.learning_episodes episode ON episode.id=proposal.episode_id AND episode.task_id=task.id
    JOIN foundry_product.context_compilations context ON context.id=proposal.context_compilation_id
    JOIN foundry_product.diagnostic_observations diagnosis ON diagnosis.id=proposal.diagnostic_observation_id
    JOIN foundry_product.capability_resolutions resolution ON resolution.id=proposal.capability_resolution_id
    JOIN foundry_product.capabilities capability ON capability.id=proposal.selected_capability_id
    JOIN foundry_product.capability_versions version ON version.id=proposal.selected_capability_version_id AND version.capability_id=capability.id
    JOIN foundry_product.teacher_interventions intervention ON intervention.id=proposal.teacher_intervention_id
    JOIN foundry_product.teacher_capability_constraints constraint_row ON constraint_row.source_intervention_id=intervention.id
    LEFT JOIN foundry_product.routing_optimization_decisions decision ON decision.proposal_id=proposal.id
    LEFT JOIN foundry_product.users decider ON decider.id=decision.decided_by
    WHERE proposal.institution_id=${actor.institutionId} AND proposal.course_id=ANY(${courseIds}::uuid[])
    ORDER BY proposal.created_at DESC, proposal.id DESC LIMIT 20
  `;
  return { candidates, proposals };
}
