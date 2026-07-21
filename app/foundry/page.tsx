import { withWorkspaceActor } from "@/application/identity";
import { getFoundryWorkspace } from "@/application/queries";
import { CandidateForm, ComponentEvaluationButton, ComponentVersionForm, GapSupplyButton, PublicationReviewForm, RollbackForm, WebComponentPreviewForm } from "@/components/ClientActions";
import { Badge, Card, Empty, SurfaceHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function webChoices(value: unknown): Array<{ id: string; label: string }> {
  return Array.isArray(value) ? value.flatMap((choice) => {
    const item = record(choice);
    return typeof item.id === "string" && typeof item.label === "string" ? [{ id: item.id, label: item.label }] : [];
  }) : [];
}

export default async function FoundryPage() {
  return withWorkspaceActor(["EXPERT", "ADMIN"], "Capability Workshop", async (actor) => {
  const workspace = await getFoundryWorkspace(actor);
  const evidenceOptions = workspace.evidenceOptions.map(({ evidence, source }) => ({ id: evidence.id, title: evidence.title, locator: evidence.locator, sourceTitle: source.title }));
  const componentGroups = [...workspace.candidates.reduce((groups, row) => {
    const group = groups.get(row.component.id) ?? { component: row.component, rows: [] as typeof workspace.candidates };
    group.rows.push(row);
    groups.set(row.component.id, group);
    return groups;
  }, new Map<string, { component: (typeof workspace.candidates)[number]["component"]; rows: typeof workspace.candidates }>()).values()];

  return <>
    <SurfaceHeader eyebrow="Capability Workshop" title="Resolve real gaps into governed exact-version assets" description="Need-driven proposals move through checks, exact learner preview, authenticated confirmation, scoped Registry availability, re-resolution and learner delivery." />
    <div className="showcase-banner"><Badge tone="warn">Synthetic showcase data</Badge> No automated pedagogy, domain or safety score is fabricated. Deterministic fixtures execute; expert rubric remains a human decision.</div>
    <Card eyebrow="Reviewed product signals" title="Repeated capability failure signals">
      {workspace.reviewedPatterns.map((pattern, index) => <p key={`${String(pattern.pattern)}:${String(pattern.capability_id)}:${index}`}><strong>{String(pattern.pattern)}</strong> · {String(pattern.count)} distinct reviewed Attempts · {String(pattern.reference_pack_key)} {Number(pattern.count) >= 2 ? <Badge tone="good">REUSE ELIGIBLE</Badge> : <Badge tone="warn">ONE SIGNAL · DRAFT ONLY</Badge>}</p>)}
      {workspace.reviewedPatterns.length === 0 ? <Empty>No unsuperseded CAPABILITY failure signal has a current eligible authenticated Review. Unavailable/null/unreviewed signals are excluded.</Empty> : null}
    </Card>
    <Card eyebrow="Current human-reviewed lineage" title="Create a structured Component Draft">
      {workspace.candidateSources.map((source) => <article className="evidence-card" data-testid="foundry-candidate-source" key={String(source.observation_id)}><strong>{String(source.task_title)}</strong><p>{String(source.summary)}</p><div className="header-actions"><Badge>{String(source.capability_name)}</Badge><Badge>{String(source.reference_pack_key)}</Badge><Badge tone={Number(source.repeated_attempt_count) >= 2 ? "good" : "warn"}>{String(source.repeated_attempt_count)} reviewed Attempts</Badge></div><small>{String(source.failure_code)} · current Review {String(source.review_decision)} · bindings are persisted</small><CandidateForm observationId={String(source.observation_id)} evidenceOptions={evidenceOptions}/></article>)}
      {workspace.candidateSources.length === 0 ? <Empty>No current eligible reviewed capability signal is available for Draft creation.</Empty> : null}
    </Card>
    <Card eyebrow="CAP-02 no-match signals" title="Supply only when reuse, parameterize and compose do not resolve the need">
      {workspace.gapSignals.map((gap) => <article className="evidence-card" data-testid="capability-gap-signal" key={String(gap.capability_resolution_id)}>
        <div className="header-actions"><strong>{String(gap.task_title)}</strong><Badge tone="warn">{String(gap.decision)}</Badge><Badge>{String(gap.plan_state)}</Badge></div>
        <p>{String(gap.diagnosis_summary)}</p><small>{String(gap.selection_rationale)} · exact CAP-02 resolution {String(gap.capability_resolution_id)}</small>
        <GapSupplyButton capabilityResolutionId={String(gap.capability_resolution_id)}/>
      </article>)}
      {workspace.gapSignals.length === 0 ? <Empty>No current unclaimed ADAPT gap is available. GENERATE and generation-forbidden NO_MATCH are outside this bounded slice; existing, parameterized and composed matches are not widened into supply work.</Empty> : null}
    </Card>
    <div className="stack">{componentGroups.map(({ component, rows }) => {
      const publishedVersions = rows.flatMap(({ version }) => version?.status === "PUBLISHED" ? [{ id: version.id, version: version.version }] : []);
      return <Card key={component.id} eyebrow={`${component.key} · ${component.referencePackKey}`} title={component.title}>
        <div className="header-actions"><Badge tone={component.status === "PUBLISHED" ? "good" : component.status === "REJECTED" ? "bad" : "warn"}>{component.status}</Badge><Badge>{component.assetType === "WEB_COMPONENT_ASSET" ? "WEB COMPONENT ASSET" : rows[0]?.capability?.name ?? "Unregistered gap"}</Badge><small>active {component.activeVersionId ?? "none"}</small></div>
        {rows.filter(({ version }) => Boolean(version)).map(({ version, evaluation }) => {
          if (!version) return null;
          const contract = record(version.contract);
          const content = record(version.content);
          const pending = workspace.pendingWorkflows.find((run) => run.productLinks.componentVersionId === version.id && run.interruptType === "EXPERT_PUBLICATION_REVIEW_REQUIRED");
          const checks = evaluation?.systemChecks ?? [];
          const preview = workspace.previews.find((item) => item.componentVersionId === version.id && item.contentHash === version.contentHash && item.status === "SUCCEEDED");
          const previewInput = record(preview?.learnerInput);
          const previewOutput = record(preview?.runtimeOutput);
          const previewChoice = webChoices(content.choices).find((choice) => choice.id === previewInput.selectedChoiceId);
          const previewEvents = Array.isArray(preview?.eventTrace) ? preview.eventTrace.map(record) : [];
          const isWebAsset = component.assetType === "WEB_COMPONENT_ASSET";
          const readyRegistration = workspace.readyRegistrations.find((item) => item.component_id === component.id && item.capability_version_id === component.registeredCapabilityVersionId);
          return <article className="evidence-card" data-testid="component-version-card" key={version.id}>
            <div className="header-actions"><strong>{String(contract.title ?? component.title)} · v{version.version}</strong><Badge tone={version.status === "PUBLISHED" ? "good" : version.status === "REJECTED" ? "bad" : "warn"}>{version.status}</Badge>{component.activeVersionId === version.id ? <Badge tone="good">ACTIVE</Badge> : null}</div>
            <p>{String(contract.purpose ?? "")}</p><small>{isWebAsset ? `${String(contract.supplyStrategy)} from CAP-02 gap · declarative trusted template · arbitrary code prohibited` : `Capability ${String(contract.capabilityKey ?? "unavailable")} · Evidence policy ${String(contract.evidencePolicy ?? "invalid")}`} · content {version.contentHash.slice(0, 12)}</small>
            {!isWebAsset ? <details open={version.status === "DRAFT"}><summary>{version.status === "DRAFT" ? "Edit Draft" : "Create a semantic successor from this immutable version"}</summary><ComponentVersionForm componentId={component.id} versionId={version.id} contract={contract} content={content} evidenceOptions={evidenceOptions}/></details> : <details><summary>Exact declarative package and explicit non-claims</summary><pre>{JSON.stringify({ contract, content }, null, 2)}</pre></details>}
            <h3>Versioned system evaluation</h3>
            {evaluation ? <><div className="header-actions"><Badge tone={evaluation.systemStatus === "PASSED" ? "good" : "bad"}>{evaluation.systemStatus}</Badge><small>{evaluation.evaluatorKey}@{evaluation.evaluatorVersion}</small></div>{checks.map((item, index) => { const itemRecord = record(item); return <p key={`${String(itemRecord.id)}:${index}`}><Badge tone={itemRecord.status === "PASSED" ? "good" : itemRecord.status === "NOT_REQUIRED" ? "info" : "bad"}>{String(itemRecord.status)}</Badge> <strong>{String(itemRecord.id)}</strong> — {String(itemRecord.detail)}</p>; })}<p><Badge tone="warn">PROVIDER CHECKS · UNAVAILABLE</Badge> No automated domain, pedagogy or safety score ran.</p></> : <Empty>No current system evaluation exists for this content hash.</Empty>}
            {version.status === "DRAFT" && !pending ? <ComponentEvaluationButton componentId={component.id} versionId={version.id}/> : null}
            {isWebAsset && evaluation?.systemStatus === "PASSED" ? <><h3>Exact learner preview</h3>{preview ? <section className="stack compact" data-testid="persisted-web-component-preview" role="status" aria-live="polite" aria-atomic="true">
              <p><Badge tone="good">PREVIEW PASSED</Badge> This one persisted exact preview is the approval gate for this immutable version and input. It is preview evidence, not a learner delivery.</p>
              <p><strong>Selected input:</strong> {previewChoice?.label ?? "Unknown package choice"} <small>({String(previewInput.selectedChoiceId ?? "missing")})</small></p>
              <p><strong>Correct:</strong> {String(previewOutput.correct)} · <strong>Feedback:</strong> {String(previewOutput.feedback ?? "No feedback recorded")}</p>
              <small>Executor receipt {preview.executorVersion} · {preview.executorReceiptHash}</small>
              <div><strong>Persisted event trace</strong>{previewEvents.map((event, index) => <p key={`${String(event.eventType)}:${String(event.sequence)}:${index}`}><small>{String(event.sequence)} · {String(event.eventType)} · previewOnly {String(event.previewOnly)}</small></p>)}</div>
              <small>Preview {preview.id} · evaluation {preview.componentEvaluationId} · exact content {preview.contentHash}</small>
            </section> : <WebComponentPreviewForm componentId={component.id} componentVersionId={version.id} prompt={String(content.prompt ?? "")} choices={webChoices(content.choices)}/>}</> : null}
            {pending ? <><h3>Authenticated expert confirmation interrupt</h3><PublicationReviewForm threadId={pending.threadId} expectedVersion={pending.interruptVersion} approvalAllowed={evaluation?.systemStatus === "PASSED" && (!isWebAsset || Boolean(preview))}/></> : null}
            {readyRegistration ? <p><Badge tone="good">REGISTERED · EXACT VERSION · READY</Badge> CapabilityVersion {readyRegistration.capability_version_id} · resolution {readyRegistration.capability_resolution_id} · plan {readyRegistration.activity_plan_proposal_id} · institution/course private.</p> : component.registeredCapabilityVersionId ? <p><Badge tone="bad">REGISTRATION INTEGRITY BLOCKED</Badge> A Registry ID exists without latest exact READY planning evidence; no learner-ready claim is made.</p> : null}
          </article>;
        })}
        {component.activeVersionId && publishedVersions.length > 1 ? <><h3>Governed rollback</h3><RollbackForm componentId={component.id} expectedActiveVersionId={component.activeVersionId} versions={publishedVersions}/></> : null}
      </Card>;
    })}{componentGroups.length === 0 ? <Empty>No Component Draft exists. A current reviewed capability signal may create the first version.</Empty> : null}</div>
    <Card eyebrow="Immutable governance history" title="Publication and rollback decisions">{workspace.decisions.map(({ decision }) => <p key={decision.id}><Badge tone={decision.action === "APPROVE" ? "good" : decision.action === "REJECT" ? "bad" : "info"}>{decision.action}</Badge> {decision.rationale} · {decision.createdAt.toLocaleString()} · version {decision.componentVersionId}</p>)}{workspace.decisions.length === 0 ? <Empty>No expert publication or rollback decision has been recorded.</Empty> : null}</Card>
  </>;
  });
}
