import { requireWorkspaceActor } from "@/application/identity";
import { getFoundryWorkspace } from "@/application/queries";
import { CandidateForm, ComponentVersionForm, StructuralPreflightButton } from "@/components/ClientActions";
import { Badge, Card, Empty, SurfaceHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FoundryPage() {
  const actor = await requireWorkspaceActor(["EXPERT", "ADMIN"], "Foundry Studio");
  const workspace = await getFoundryWorkspace(actor);
  return <>
    <SurfaceHeader eyebrow="Foundry Studio" title="Turn reviewed signals into governed Drafts" description="Structural preflight is available. Component Eval and publication remain closed until real evaluators exist." />
    <div className="showcase-banner"><Badge tone="warn">Synthetic showcase data</Badge> Structural preflight is not Eval and never confers publication eligibility.</div>
    <Card eyebrow="Reviewed capability signal eligibility" title="Eligible failure codes">{workspace.reviewedPatterns.map((pattern, index) => <p key={`${String(pattern.pattern)}:${index}`}><strong>{String(pattern.pattern)}</strong> · {String(pattern.count)} reviewed capability observations · last {String(pattern.last_reviewed_at)}</p>)}{workspace.reviewedPatterns.length === 0 ? <Empty>No reviewed CAPABILITY observation with a failure code is eligible. This is not an automated pattern-discovery claim.</Empty> : null}</Card>
    <Card eyebrow="Direct human-reviewed lineage" title="Create a Component Draft">{workspace.candidateSources.map((source) => <article className="evidence-card" data-testid="foundry-candidate-source" key={String(source.observation_id)}><strong>{String(source.task_title)}</strong><p>{String(source.summary)}</p><small>{String(source.observation_source)} · current Review {String(source.review_decision)}</small><CandidateForm observationId={String(source.observation_id)}/></article>)}{workspace.candidateSources.length === 0 ? <Empty>No current eligible human Review is available for Component draft creation.</Empty> : null}</Card>
    <div className="stack">{workspace.candidates.map(({ component, version }) => version ? <Card key={version.id} eyebrow={`${component.key} · ${version.version}`} title={component.title}>
      <div className="header-actions"><Badge tone={version.status === "PUBLISHED" ? "good" : version.status === "DRAFT" ? "warn" : "info"}>{version.status}</Badge><small>content {version.contentHash.slice(0, 12)}</small></div>
      {version.status !== "PUBLISHED" ? <ComponentVersionForm componentId={component.id} versionId={version.id} contract={version.contract} content={version.content}/> : null}
      <h3>Structural preflight</h3><pre>{JSON.stringify(version.validation, null, 2)}</pre><h3>Required Component Eval</h3>{version.evalResult ? <pre>{JSON.stringify(version.evalResult, null, 2)}</pre> : <Empty>Capability execution, domain correctness, pedagogy/safety Eval and reuse validation are UNAVAILABLE.</Empty>}
      {version.status === "DRAFT" ? <StructuralPreflightButton componentId={component.id} versionId={version.id}/> : null}
    </Card> : null)}{workspace.candidates.length === 0 ? <Empty>No Component candidate exists. A teacher must review an Observation and submit effective support first.</Empty> : null}</div>
    <Card eyebrow="Version history" title="Publication decisions">{workspace.decisions.map(({ decision }) => <p key={decision.id}><Badge>{decision.action}</Badge> {decision.rationale} · {decision.createdAt.toLocaleString()}</p>)}{workspace.decisions.length === 0 ? <Empty>No expert decision has been recorded.</Empty> : null}</Card>
  </>;
}
