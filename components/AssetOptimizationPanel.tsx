import type { getAssetOptimizationWorkspace } from "@/application/asset-optimization";
import { AssetOptimizationDecisionForm, AssetOptimizationProposalButton } from "@/components/ClientActions";
import { Badge, Card, Empty } from "@/components/ui";

type Workspace = Awaited<ReturnType<typeof getAssetOptimizationWorkspace>>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function AssetOptimizationPanel({ workspace }: { workspace: Workspace }) {
  return <Card eyebrow="CAP-08A · Asset only" title="Evidence-driven Asset Optimization">
    <p>A real incorrect Attempt may suggest a change to one exact ComponentAssetVersion. It is not an Outcome, effectiveness result, routing change or learning-strategy decision.</p>
    <div className="stack">
      {workspace.candidates.map((candidate) => <article className="evidence-card" data-testid="asset-optimization-candidate" key={String(candidate.runtime_delivery_id)}>
        <div className="header-actions"><strong>{String(candidate.component_title)} · v{String(candidate.component_version)}</strong><Badge tone="warn">INCORRECT ATTEMPT · REVIEWABLE SIGNAL</Badge><Badge>ASSET</Badge></div>
        <p>The exact runtime completed, but this Attempt selected <strong>{String(candidate.selected_choice_id)}</strong> and recorded <strong>correct: false</strong>. One Attempt can support only a bounded proposal.</p>
        <small>RuntimeDelivery {String(candidate.runtime_delivery_id)} · LearnerAttempt {String(candidate.learner_attempt_id)} · ComponentAssetVersion {String(candidate.component_version_id)} · hash {String(candidate.component_version_content_hash)}</small>
        <AssetOptimizationProposalButton runtimeDeliveryId={String(candidate.runtime_delivery_id)}/>
      </article>)}
      {workspace.candidates.length === 0 ? <Empty>No unclaimed successful incorrect exact-version Attempt is eligible for this bounded Asset-only slice.</Empty> : null}
    </div>
    <h3>Proposals and human next-action decisions</h3>
    <div className="stack">
      {workspace.proposals.map((row) => {
        const change = record(row.proposed_change);
        const evidence = record(row.evidence_snapshot);
        const decided = Boolean(row.decision_id);
        return <article className="evidence-card" data-testid="asset-optimization-proposal" key={String(row.proposal_id)}>
          <div className="header-actions"><strong>{String(row.component_title)} · v{String(row.component_version)}</strong><Badge tone={decided ? "good" : "warn"}>{decided ? String(row.decision_action) : "PENDING GOVERNANCE"}</Badge><Badge>ASSET · NOT ROUTING · NOT STRATEGY</Badge></div>
          <p>{String(row.rationale)}</p>
          <p><strong>Proposed change:</strong> {String(change.description ?? "No bounded change description is available.")}</p>
          <small>Rule {String(row.rule_key)}@{String(row.rule_version)} · confidence {String(row.confidence)} · evidence {String(row.evidence_hash)}</small>
          <details><summary>Exact delivered-version and Attempt lineage</summary><pre>{JSON.stringify({
            runtimeDeliveryId: row.runtime_delivery_id,
            learnerAttemptId: row.learner_attempt_id,
            componentAssetVersion: { id: row.component_version_id, version: row.component_version, contentHash: row.component_version_content_hash },
            capabilityVersion: { id: row.capability_version_id, version: row.capability_version, contentHash: row.capability_version_content_hash },
            evidenceSnapshot: evidence,
            evidenceRefs: row.evidence_refs,
            limitations: row.limitations,
          }, null, 2)}</pre></details>
          {decided
            ? <section data-testid="asset-optimization-decision"><p><strong>{String(row.decision_action)}</strong> — {String(row.decision_rationale)}</p><small>Recorded by {String(row.decision_actor_name ?? row.decision_decided_by)} at {new Date(String(row.decision_created_at)).toLocaleString()}. The current exact version remains active. No successor, check, confirmation, availability, Outcome, routing or strategy record was created.</small></section>
            : <AssetOptimizationDecisionForm proposalId={String(row.proposal_id)}/>}
        </article>;
      })}
      {workspace.proposals.length === 0 ? <Empty>No Asset Optimization Proposal has been created.</Empty> : null}
    </div>
  </Card>;
}
