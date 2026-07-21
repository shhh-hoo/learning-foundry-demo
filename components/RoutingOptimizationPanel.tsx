import type { getRoutingOptimizationWorkspace } from "@/application/routing-optimization";
import { RoutingOptimizationDecisionForm, RoutingOptimizationProposalButton } from "@/components/ClientActions";
import { Badge, Card, Empty } from "@/components/ui";

type Workspace = Awaited<ReturnType<typeof getRoutingOptimizationWorkspace>>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function RoutingOptimizationPanel({ workspace }: { workspace: Workspace }) {
  return <Card eyebrow="CAP-08B · Routing only" title="Evidence-driven Routing Optimization">
    <p>An explicit teacher exclusion of the exact selected Capability can question one recorded route. The teacher action—not usage or Attempt correctness—is the signal. No rank, eligibility rule or active policy changes automatically.</p>
    <div className="stack">
      {workspace.candidates.map((candidate) => <article className="evidence-card" data-testid="routing-optimization-candidate" key={String(candidate.teacher_intervention_id)}>
        <div className="header-actions"><strong>{String(candidate.task_title)}</strong><Badge tone="warn">TEACHER EXCLUSION · REVIEWABLE SIGNAL</Badge><Badge>ROUTING</Badge></div>
        <p>The teacher excluded the exact selected route <strong>{String(candidate.selected_capability_key)}@{String(candidate.selected_capability_version)}</strong> for the next cycle: {String(candidate.teacher_reason)}</p>
        <small>Context {String(candidate.context_compilation_id)} · Diagnosis {String(candidate.diagnostic_observation_id)} · Resolution {String(candidate.capability_resolution_id)} · ActivityPlan {String(candidate.activity_plan_id)} · RuntimeDelivery {String(candidate.runtime_delivery_id)} · LearnerAttempt {String(candidate.learner_attempt_id)}</small>
        <RoutingOptimizationProposalButton teacherInterventionId={String(candidate.teacher_intervention_id)}/>
      </article>)}
      {workspace.candidates.length === 0 ? <Empty>No current unclaimed teacher exclusion of an exact selected Capability is eligible for this bounded Routing-only slice.</Empty> : null}
    </div>
    <h3>Proposals and human next-action decisions</h3>
    <div className="stack">
      {workspace.proposals.map((row) => {
        const change = record(row.proposed_change);
        const evidence = record(row.evidence_snapshot);
        const decided = Boolean(row.decision_id);
        const current = row.source_current === true;
        return <article className="evidence-card" data-testid="routing-optimization-proposal" key={String(row.proposal_id)}>
          <div className="header-actions"><strong>{String(row.task_title)} · {String(row.selected_capability_key)}@{String(row.selected_capability_version)}</strong><Badge tone={decided ? "good" : current ? "warn" : "bad"}>{decided ? String(row.decision_action) : current ? "PENDING GOVERNANCE" : "STALE SOURCE · INSPECTION ONLY"}</Badge>{decided && !current ? <Badge tone="bad">STALE SOURCE · INSPECTION ONLY</Badge> : null}<Badge>ROUTING · NOT ASSET · NOT STRATEGY</Badge></div>
          <p>{String(row.rationale)}</p>
          <p><strong>Why this route is questioned:</strong> {String(row.teacher_reason)}</p>
          <p><strong>Proposed next work:</strong> {String(change.description ?? "No bounded policy-review description is available.")}</p>
          <small>Rule {String(row.rule_key)}@{String(row.rule_version)} · confidence {String(row.confidence)} · evidence {String(row.evidence_hash)}</small>
          <details><summary>Exact Context → route → downstream evidence lineage</summary><pre>{JSON.stringify({
            context: { id: row.context_compilation_id, snapshotHash: row.context_snapshot_hash, selectedItems: row.context_selected_items, excludedItems: row.context_excluded_items },
            diagnosis: { id: row.diagnostic_observation_id, summary: row.diagnosis_summary },
            capabilityResolution: { id: row.capability_resolution_id, policyVersion: row.policy_version, selectionRationale: row.selection_rationale, candidateSet: row.candidate_set },
            selectedCapabilityVersion: { id: row.selected_capability_version_id, contentHash: row.selected_capability_version_content_hash },
            activityPlanId: row.activity_plan_id,
            runtimeDeliveryId: row.runtime_delivery_id,
            learnerAttemptId: row.learner_attempt_id,
            teacherInterventionId: row.teacher_intervention_id,
            evidenceSnapshot: evidence,
            evidenceRefs: row.evidence_refs,
            limitations: row.limitations,
          }, null, 2)}</pre></details>
          {decided
            ? <section data-testid="routing-optimization-decision"><p><strong>{String(row.decision_action)}</strong> — {String(row.decision_rationale)}</p><small>Recorded by {String(row.decision_actor_name ?? row.decision_decided_by)} at {new Date(String(row.decision_created_at)).toLocaleString()}. The current policy and rankings remain unchanged. No route, CapabilityVersion, ActivityPlan, LearningOutcome, Asset Optimization or Learning Strategy record was created.</small></section>
            : current
              ? <RoutingOptimizationDecisionForm proposalId={String(row.proposal_id)}/>
              : null}
          {!current ? <small data-testid="routing-optimization-stale-source">The evidence and any historical decision remain append-only and inspectable, but the Task/Episode, Diagnosis, exact CapabilityVersion or teacher constraint is no longer current. A current-policy decision is blocked.</small> : null}
        </article>;
      })}
      {workspace.proposals.length === 0 ? <Empty>No Routing Optimization Proposal has been created.</Empty> : null}
    </div>
  </Card>;
}
