import { and, eq, sql } from "drizzle-orm";
import { getDb, getSql, withTenantDatabase } from "@/db/client";
import {
  activityPlans,
  assetOptimizationDecisions,
  assetOptimizationProposals,
  capabilities,
  capabilitySupplyRelations,
  capabilityVersions,
  componentVersions,
  components,
  idempotencyKeys,
  learnerAttempts,
  runtimeDeliveries,
} from "@/db/schema";
import type { Actor } from "@/domain/model";
import {
  ASSET_OPTIMIZATION_LIMITATIONS,
  ASSET_OPTIMIZATION_RULE,
  AssetOptimizationDecisionAction,
  assetOptimizationId,
  deriveAttemptDrivenAssetChange,
} from "@/domain/asset-optimization";
import { DomainInvariantError, requireCourseAccess, requireRole } from "@/domain/invariants";
import { WebComponentAssetContract, WebComponentAssetPackage, webComponentAssetHash } from "@/domain/web-component-asset";
import { assertExecutionActive } from "@/application/execution-control";
import { commandRequestHash } from "@/application/commands";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

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

async function loadAttemptLineage(actor: Actor, runtimeDeliveryId: string) {
  const [lineage] = await getDb().select({
    delivery: runtimeDeliveries,
    attempt: learnerAttempts,
    plan: activityPlans,
    capability: capabilities,
    capabilityVersion: capabilityVersions,
    component: components,
    componentVersion: componentVersions,
    supply: capabilitySupplyRelations,
  }).from(runtimeDeliveries)
    .innerJoin(learnerAttempts, eq(learnerAttempts.runtimeDeliveryId, runtimeDeliveries.id))
    .innerJoin(activityPlans, eq(activityPlans.id, runtimeDeliveries.activityPlanId))
    .innerJoin(capabilityVersions, eq(capabilityVersions.id, runtimeDeliveries.capabilityVersionId))
    .innerJoin(capabilities, eq(capabilities.id, runtimeDeliveries.capabilityId))
    .innerJoin(componentVersions, eq(componentVersions.id, capabilityVersions.componentAssetVersionId))
    .innerJoin(components, eq(components.id, componentVersions.componentId))
    .innerJoin(capabilitySupplyRelations, and(
      eq(capabilitySupplyRelations.componentId, components.id),
      eq(capabilitySupplyRelations.componentVersionId, componentVersions.id),
      eq(capabilitySupplyRelations.registeredCapabilityId, capabilities.id),
      eq(capabilitySupplyRelations.registeredCapabilityVersionId, capabilityVersions.id),
    ))
    .where(and(eq(runtimeDeliveries.id, runtimeDeliveryId), eq(runtimeDeliveries.institutionId, actor.institutionId)))
    .limit(1);
  if (!lineage) throw new DomainInvariantError("Asset Optimization requires exact CAP-07 supply and delivery lineage", "ASSET_OPTIMIZATION_LINEAGE_NOT_FOUND");
  requireCourseAccess(actor, lineage.delivery.institutionId, lineage.delivery.courseId);
  const output = asRecord(lineage.delivery.normalizedOutput);
  const structuredInput = asRecord(lineage.attempt.structuredInput);
  const runtimeInput = asRecord(structuredInput.assetRuntimeInput);
  const selectedChoiceId = typeof runtimeInput.selectedChoiceId === "string" ? runtimeInput.selectedChoiceId : "";
  const componentContract = WebComponentAssetContract.safeParse(lineage.componentVersion.contract);
  const componentPackage = WebComponentAssetPackage.safeParse(lineage.componentVersion.content);
  if (lineage.component.assetType !== "WEB_COMPONENT_ASSET"
    || lineage.component.status !== "PUBLISHED"
    || lineage.component.activeVersionId !== lineage.componentVersion.id
    || lineage.componentVersion.status !== "PUBLISHED"
    || lineage.capability.activeVersionId !== lineage.capabilityVersion.id
    || lineage.capabilityVersion.status !== "ACTIVE"
    || lineage.delivery.status !== "SUCCEEDED"
    || output.correct !== false
    || output.selectedChoiceId !== selectedChoiceId
    || !lineage.delivery.outputHash
    || !lineage.attempt.contentHash
    || lineage.delivery.capabilityVersionContentHash !== lineage.capabilityVersion.contentHash
    || lineage.capabilityVersion.componentAssetVersionId !== lineage.componentVersion.id
    || !componentContract.success || !componentPackage.success
    || webComponentAssetHash(componentContract.data, componentPackage.data) !== lineage.componentVersion.contentHash) {
    throw new DomainInvariantError("CAP-08A requires one real successful incorrect learner Attempt; usage, completion, preview, or fabricated output is ineligible", "ASSET_OPTIMIZATION_SIGNAL_INELIGIBLE");
  }
  let proposedChange: ReturnType<typeof deriveAttemptDrivenAssetChange>;
  try {
    proposedChange = deriveAttemptDrivenAssetChange(componentPackage.data, selectedChoiceId);
  } catch {
    throw new DomainInvariantError("The exact ComponentAssetVersion package does not support the bounded incorrect-choice feedback rule", "ASSET_OPTIMIZATION_RULE_INAPPLICABLE");
  }
  return { ...lineage, output, selectedChoiceId, proposedChange, attemptContentHash: lineage.attempt.contentHash };
}

async function assertIdempotencyReplay(commandType: string, actor: Actor, idempotencyKey: string, requestHash: string, expectedResultId: string) {
  const [key] = await getDb().select().from(idempotencyKeys).where(and(
    eq(idempotencyKeys.institutionId, actor.institutionId),
    eq(idempotencyKeys.commandType, commandType),
    eq(idempotencyKeys.key, idempotencyKey),
  )).limit(1);
  if (!key || key.actorUserId !== actor.userId || key.requestHash !== requestHash || key.resultId !== expectedResultId) {
    throw new DomainInvariantError("Asset Optimization idempotency key was reused with different input", "IDEMPOTENCY_MISMATCH");
  }
}

export async function createAssetOptimizationProposal(actor: Actor, input: { runtimeDeliveryId: string; idempotencyKey: string }) {
  assertExecutionActive();
  assertOptimizationRole(actor);
  return withTenantDatabase(actor, async () => {
    const lineage = await loadAttemptLineage(actor, input.runtimeDeliveryId);
    const evidenceSnapshot = {
      runtimeDeliveryId: lineage.delivery.id,
      runtimeStatus: lineage.delivery.status,
      runtimeOutputHash: lineage.delivery.outputHash,
      learnerAttemptId: lineage.attempt.id,
      learnerAttemptContentHash: lineage.attemptContentHash,
      selectedChoiceId: lineage.selectedChoiceId,
      correct: false,
      feedback: typeof lineage.output.feedback === "string" ? lineage.output.feedback : "No runtime feedback was recorded.",
      componentId: lineage.component.id,
      componentVersionId: lineage.componentVersion.id,
      componentVersionContentHash: lineage.componentVersion.contentHash,
      capabilityId: lineage.capability.id,
      capabilityVersionId: lineage.capabilityVersion.id,
      capabilityVersionContentHash: lineage.capabilityVersion.contentHash,
      capabilitySupplyRelationId: lineage.supply.id,
      activityPlanId: lineage.plan.id,
    };
    const evidenceRefs = [
      { kind: "COMPONENT_ASSET_VERSION", id: lineage.componentVersion.id },
      { kind: "CAPABILITY_VERSION", id: lineage.capabilityVersion.id },
      { kind: "CAPABILITY_SUPPLY_RELATION", id: lineage.supply.id },
      { kind: "ACTIVITY_PLAN", id: lineage.plan.id },
      { kind: "RUNTIME_DELIVERY", id: lineage.delivery.id },
      { kind: "LEARNER_ATTEMPT", id: lineage.attempt.id },
    ];
    const proposedChange = lineage.proposedChange;
    const rationale = "One persisted incorrect learner Attempt on this exact delivered version supports human review of distractor-specific retry feedback. It does not establish an asset defect, a repeated pattern, causation, or learning effectiveness.";
    const commandType = "CREATE_ASSET_OPTIMIZATION_PROPOSAL";
    const requestHash = commandRequestHash(actor, commandType, { runtimeDeliveryId: lineage.delivery.id });
    const proposalId = assetOptimizationId(commandType, requestHash);
    const [hashedEvidence] = await getSql()<Array<{ evidence_hash: string }>>`
      SELECT encode(public.digest(convert_to(${JSON.stringify(evidenceSnapshot)}::jsonb::text,'UTF8'),'sha256'),'hex') AS evidence_hash
    `;
    if (!hashedEvidence?.evidence_hash) throw new DomainInvariantError("Asset Optimization evidence hashing is unavailable", "ASSET_OPTIMIZATION_EVIDENCE_HASH_FAILED");
    const evidenceHash = hashedEvidence.evidence_hash;
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`cap08a-proposal:${lineage.delivery.id}`},0))`);
      const [canonical] = await tx.select().from(assetOptimizationProposals).where(eq(assetOptimizationProposals.runtimeDeliveryId, lineage.delivery.id)).limit(1);
      if (canonical) {
        const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: canonical.id, actorUserId: actor.userId }).onConflictDoNothing().returning();
        if (!reserved.length) await assertIdempotencyReplay(commandType, actor, input.idempotencyKey, requestHash, canonical.id);
        return { proposal: canonical, replayed: true };
      }
      const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: proposalId, actorUserId: actor.userId }).onConflictDoNothing().returning();
      if (!reserved.length) {
        await assertIdempotencyReplay(commandType, actor, input.idempotencyKey, requestHash, proposalId);
        const [existing] = await tx.select().from(assetOptimizationProposals).where(eq(assetOptimizationProposals.id, proposalId)).limit(1);
        if (!existing) throw new DomainInvariantError("Asset Optimization replay target is missing", "IDEMPOTENCY_INTEGRITY");
        return { proposal: existing, replayed: true };
      }
      const [proposal] = await tx.insert(assetOptimizationProposals).values({
        id: proposalId,
        institutionId: actor.institutionId,
        courseId: lineage.delivery.courseId,
        componentId: lineage.component.id,
        componentVersionId: lineage.componentVersion.id,
        componentVersionContentHash: lineage.componentVersion.contentHash,
        capabilityId: lineage.capability.id,
        capabilityVersionId: lineage.capabilityVersion.id,
        capabilityVersionContentHash: lineage.capabilityVersion.contentHash,
        capabilitySupplyRelationId: lineage.supply.id,
        runtimeDeliveryId: lineage.delivery.id,
        learnerAttemptId: lineage.attempt.id,
        learnerAttemptContentHash: lineage.attemptContentHash,
        proposalType: "ASSET",
        signalKind: "INCORRECT_ATTEMPT",
        rationale,
        proposedChange,
        evidenceSnapshot,
        evidenceRefs,
        evidenceHash,
        limitations: [...ASSET_OPTIMIZATION_LIMITATIONS],
        ruleKey: ASSET_OPTIMIZATION_RULE.key,
        ruleVersion: ASSET_OPTIMIZATION_RULE.version,
        confidence: ASSET_OPTIMIZATION_RULE.confidence,
        state: "PENDING_GOVERNANCE",
        requestedBy: actor.userId,
        requesterProvenance: actorProvenance(actor),
        requestHash,
      }).returning();
      return { proposal, replayed: false };
    });
  });
}

export async function decideAssetOptimizationProposal(actor: Actor, input: { proposalId: string; action: AssetOptimizationDecisionAction; rationale: string; idempotencyKey: string }) {
  assertExecutionActive();
  assertOptimizationRole(actor);
  const action = AssetOptimizationDecisionAction.parse(input.action);
  const rationale = input.rationale.trim();
  if (rationale.length < 5) throw new DomainInvariantError("Asset Optimization decision rationale must contain at least five characters", "ASSET_OPTIMIZATION_RATIONALE_REQUIRED");
  return withTenantDatabase(actor, async () => {
    const [proposal] = await getDb().select().from(assetOptimizationProposals).where(and(
      eq(assetOptimizationProposals.id, input.proposalId),
      eq(assetOptimizationProposals.institutionId, actor.institutionId),
    )).limit(1);
    if (!proposal) throw new DomainInvariantError("Asset Optimization Proposal is outside the active institution", "TENANT_ISOLATION");
    requireCourseAccess(actor, proposal.institutionId, proposal.courseId);
    const commandType = "DECIDE_ASSET_OPTIMIZATION_PROPOSAL";
    const requestHash = commandRequestHash(actor, commandType, { proposalId: proposal.id, action, rationale });
    const decisionId = assetOptimizationId(commandType, requestHash);
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`cap08a-decision:${proposal.id}`},0))`);
      const [canonical] = await tx.select().from(assetOptimizationDecisions).where(eq(assetOptimizationDecisions.proposalId, proposal.id)).limit(1);
      if (canonical) {
        if (canonical.requestHash !== requestHash || canonical.decidedBy !== actor.userId) {
          throw new DomainInvariantError("Asset Optimization Proposal already has an append-only human decision", "ASSET_OPTIMIZATION_ALREADY_GOVERNED");
        }
        const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: canonical.id, actorUserId: actor.userId }).onConflictDoNothing().returning();
        if (!reserved.length) await assertIdempotencyReplay(commandType, actor, input.idempotencyKey, requestHash, canonical.id);
        return { decision: canonical, replayed: true };
      }
      const reserved = await tx.insert(idempotencyKeys).values({ institutionId: actor.institutionId, key: input.idempotencyKey, commandType, requestHash, resultId: decisionId, actorUserId: actor.userId }).onConflictDoNothing().returning();
      if (!reserved.length) {
        await assertIdempotencyReplay(commandType, actor, input.idempotencyKey, requestHash, decisionId);
        const [existing] = await tx.select().from(assetOptimizationDecisions).where(eq(assetOptimizationDecisions.id, decisionId)).limit(1);
        if (!existing) throw new DomainInvariantError("Asset Optimization decision replay target is missing", "IDEMPOTENCY_INTEGRITY");
        return { decision: existing, replayed: true };
      }
      const [decision] = await tx.insert(assetOptimizationDecisions).values({
        id: decisionId,
        institutionId: proposal.institutionId,
        courseId: proposal.courseId,
        proposalId: proposal.id,
        componentId: proposal.componentId,
        componentVersionId: proposal.componentVersionId,
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

export async function getAssetOptimizationWorkspace(actor: Actor) {
  assertOptimizationRole(actor);
  const courseIds = actor.courseIds.length ? actor.courseIds : ["00000000-0000-0000-0000-000000000000"];
  const candidates = await getSql()<Array<Record<string, unknown>>>`
    SELECT delivery.id AS runtime_delivery_id, delivery.status AS runtime_status, delivery.output_hash,
      delivery.normalized_output->>'correct' AS correct, delivery.normalized_output->>'feedback' AS feedback,
      attempt.id AS learner_attempt_id, attempt.content_hash AS learner_attempt_content_hash,
      attempt.structured_input->'assetRuntimeInput'->>'selectedChoiceId' AS selected_choice_id,
      plan.id AS activity_plan_id, task.id AS task_id, task.title AS task_title,
      component.id AS component_id, component.title AS component_title,
      component_version.id AS component_version_id, component_version.version AS component_version,
      component_version.content_hash AS component_version_content_hash,
      capability.id AS capability_id, capability.name AS capability_name,
      capability_version.id AS capability_version_id, capability_version.version AS capability_version,
      capability_version.content_hash AS capability_version_content_hash,
      supply.id AS capability_supply_relation_id
    FROM foundry_product.runtime_deliveries delivery
    JOIN foundry_product.learner_attempts attempt ON attempt.runtime_delivery_id=delivery.id
    JOIN foundry_product.activity_plans plan ON plan.id=delivery.activity_plan_id AND plan.id=attempt.activity_plan_id
    JOIN foundry_product.learning_tasks task ON task.id=delivery.task_id
    JOIN foundry_product.capabilities capability ON capability.id=delivery.capability_id
    JOIN foundry_product.capability_versions capability_version ON capability_version.id=delivery.capability_version_id AND capability_version.capability_id=capability.id
    JOIN foundry_product.component_versions component_version ON component_version.id=capability_version.component_asset_version_id
    JOIN foundry_product.components component ON component.id=component_version.component_id AND component.asset_type='WEB_COMPONENT_ASSET'
    JOIN foundry_product.capability_supply_relations supply ON supply.component_id=component.id AND supply.component_version_id=component_version.id
      AND supply.registered_capability_id=capability.id AND supply.registered_capability_version_id=capability_version.id
    WHERE delivery.institution_id=${actor.institutionId} AND delivery.course_id=ANY(${courseIds}::uuid[])
      AND delivery.status='SUCCEEDED' AND jsonb_typeof(delivery.normalized_output->'correct')='boolean'
      AND NOT (delivery.normalized_output->>'correct')::boolean
      AND delivery.output_hash IS NOT NULL
      AND component.status='PUBLISHED' AND component.active_version_id=component_version.id AND component_version.status='PUBLISHED'
      AND capability.active_version_id=capability_version.id AND capability_version.status='ACTIVE'
      AND delivery.capability_version_content_hash=capability_version.content_hash
      AND component_version.content->>'packageType'='DECLARATIVE_WEB_COMPONENT_ASSET'
      AND length(COALESCE(attempt.structured_input->'assetRuntimeInput'->>'selectedChoiceId',''))>0
      AND attempt.structured_input->'assetRuntimeInput'->>'selectedChoiceId'<>component_version.content->>'correctChoiceId'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(component_version.content->'choices') choice
        WHERE choice->>'id'=attempt.structured_input->'assetRuntimeInput'->>'selectedChoiceId')
      AND NOT EXISTS (SELECT 1 FROM foundry_product.asset_optimization_proposals proposal WHERE proposal.runtime_delivery_id=delivery.id)
    ORDER BY delivery.finished_at DESC, delivery.id DESC LIMIT 20
  `;
  const proposals = await getSql()<Array<Record<string, unknown>>>`
    SELECT proposal.id AS proposal_id, proposal.state, proposal.signal_kind, proposal.rationale,
      proposal.proposed_change, proposal.evidence_snapshot, proposal.evidence_refs, proposal.evidence_hash,
      proposal.limitations, proposal.rule_key, proposal.rule_version, proposal.confidence, proposal.created_at,
      proposal.runtime_delivery_id, proposal.learner_attempt_id,
      proposal.component_id, component.title AS component_title,
      proposal.component_version_id, component_version.version AS component_version,
      proposal.component_version_content_hash,
      proposal.capability_version_id, capability_version.version AS capability_version,
      proposal.capability_version_content_hash,
      decision.id AS decision_id, decision.action AS decision_action, decision.rationale AS decision_rationale,
      decision.decided_by AS decision_decided_by, decision.actor_provenance AS decision_actor_provenance,
      decider.name AS decision_actor_name, decision.created_at AS decision_created_at
    FROM foundry_product.asset_optimization_proposals proposal
    JOIN foundry_product.components component ON component.id=proposal.component_id
    JOIN foundry_product.component_versions component_version ON component_version.id=proposal.component_version_id AND component_version.component_id=component.id
    JOIN foundry_product.capability_versions capability_version ON capability_version.id=proposal.capability_version_id
    LEFT JOIN foundry_product.asset_optimization_decisions decision ON decision.proposal_id=proposal.id
    LEFT JOIN foundry_product.users decider ON decider.id=decision.decided_by
    WHERE proposal.institution_id=${actor.institutionId} AND proposal.course_id=ANY(${courseIds}::uuid[])
    ORDER BY proposal.created_at DESC, proposal.id DESC LIMIT 20
  `;
  return { candidates, proposals };
}
