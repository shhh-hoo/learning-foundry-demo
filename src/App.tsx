import { useMemo, useState } from "react";
import { publishedComponents } from "./components/published";
import type { DiagnosticLearningComponent, PublishedDiagnosticLearningComponent } from "./contracts/diagnostic-component";
import { generateInvalidStoichiometryDraft, generateValidStoichiometryDraft } from "./generation/deterministic-generator";
import { evaluateComponent, type FoundryEvaluationReport } from "./governance/evaluation";
import { incrementVersion, publishApprovedComponent } from "./governance/publishing";
import { evaluatePreviewAttempt, type PreviewDiagnosis } from "./runtime/preview-adapter";
import { standardTrainerCapability } from "./runtime/capability";
import { caie9701StandardPack } from "./standards/caie-9701";

const workflow = ["Standard Pack", "Author / Generate", "Evaluation", "Expert Review", "Publish", "Runtime Preview"];
const originLabels = { MIGRATED: "Migrated asset", EXPERT_AUTHORED: "Expert-authored", AI_GENERATED: "AI-generated simulation" } as const;

function statusTone(status: string): string {
  return status === "PASS" || status === "PUBLISHED" || status === "PASSED" || status === "SOLVED" ? "positive" : status === "FAIL" || status === "FAILED" || status === "STUDENT_ERROR" ? "negative" : "warning";
}

export default function App() {
  const [component, setComponent] = useState<DiagnosticLearningComponent>(publishedComponents[1]);
  const [evaluation, setEvaluation] = useState<FoundryEvaluationReport | null>(() => evaluateComponent(publishedComponents[1], caie9701StandardPack, standardTrainerCapability, "2026-07-15T09:05:00.000Z"));
  const [reviewNotes, setReviewNotes] = useState("Checked numerical route, graph dependencies, unit and mark allocation.");
  const [previewValue, setPreviewValue] = useState("8.00");
  const [previewUnit, setPreviewUnit] = useState("g");
  const [previewSf, setPreviewSf] = useState("3");
  const [previewStrategy, setPreviewStrategy] = useState<"CANONICAL" | "WRONG_RATIO" | "MISSING_LINK">("CANONICAL");
  const [diagnosis, setDiagnosis] = useState<PreviewDiagnosis | null>(null);

  const compatibility = evaluation?.checks.find((check) => check.id === "runtime_capability_compatibility");
  const canApprove = component.status === "DRAFT" && evaluation?.outcome === "PASSED";
  const canPublish = component.status === "APPROVED";
  const lifecycle = component.status === "PUBLISHED" ? "PUBLISHED" : evaluation?.outcome === "FAILED" ? "EVALUATION_FAILED" : canApprove ? "READY_FOR_REVIEW" : component.status;
  const selectedTopic = useMemo(() => caie9701StandardPack.topics.find((topic) => topic.title === component.curriculum.topic)!, [component]);

  function load(next: DiagnosticLearningComponent) {
    setComponent(structuredClone(next));
    setEvaluation(next.status === "PUBLISHED" ? evaluateComponent(next, caie9701StandardPack, standardTrainerCapability, "2026-07-15T09:05:00.000Z") : null);
    setDiagnosis(null);
    setPreviewValue(String(next.target.expectedValue));
    setPreviewUnit(next.target.acceptedUnits[0]);
    setPreviewSf(String(next.target.significantFigures));
    setPreviewStrategy("CANONICAL");
  }

  function editPrompt(prompt: string) {
    setComponent((current) => ({
      ...current,
      version: current.status === "PUBLISHED" ? incrementVersion(current.version, "CONTENT") : current.version,
      status: "DRAFT",
      presentation: { ...current.presentation, prompt },
      review: undefined,
      publication: undefined,
    }));
    setEvaluation(null);
  }

  function approve() {
    if (!canApprove) return;
    setComponent((current) => ({ ...current, status: "APPROVED", review: { reviewer: "Dr A. Chen, CAIE Chemistry reviewer", reviewedAt: "2026-07-15T09:10:00.000Z", notes: reviewNotes } }));
  }

  function publish() {
    if (!canPublish) return;
    setComponent(publishApprovedComponent(component, { publishedAt: "2026-07-15T09:15:00.000Z", publishedBy: "Learning Foundry demo publisher" }));
  }

  const published = component.status === "PUBLISHED" ? component as PublishedDiagnosticLearningComponent : null;

  return (
    <main>
      <header className="masthead">
        <a className="brand" href="#top" aria-label="Learning Foundry home"><span className="brand-mark">LF</span><span>Learning Foundry<small>Governed component production</small></span></a>
        <div className="environment"><span className="pulse" /> Static demo · Registry 2026-07-15.1</div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker">Expert-governed learning infrastructure</p>
          <h1>Turn curriculum intent into <em>executable learning contracts.</em></h1>
          <p>Author reasoning models, reject invalid drafts, require expert approval, and publish immutable components to bounded deterministic runtimes.</p>
        </div>
        <div className="flow-card" aria-label="Foundry to runtime architecture">
          {['Standard pack','Authoring','Evaluation','Expert review','Registry','Trainer','Evidence trace'].map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, '0')}</span>{step}</div>)}
        </div>
      </section>

      <nav className="workflow-nav" aria-label="Foundry workflow">
        {workflow.map((step, index) => <a href={`#stage-${index + 1}`} key={step}><span>{index + 1}</span>{step}</a>)}
      </nav>

      <section className="command-bar" aria-label="Current component">
        <label>Component
          <select value={`${component.id}@${component.version}`} onChange={(event) => {
            const selected = publishedComponents.find((item) => `${item.id}@${item.version}` === event.target.value);
            if (selected) load(selected);
          }}>
            {publishedComponents.map((item) => <option key={item.id} value={`${item.id}@${item.version}`}>{item.presentation.title}</option>)}
            {!publishedComponents.some((item) => item.id === component.id) ? <option value={`${component.id}@${component.version}`}>{component.presentation.title}</option> : null}
          </select>
        </label>
        <div><span className="meta-label">Lifecycle</span><strong className={`badge ${statusTone(lifecycle)}`}>{lifecycle}</strong></div>
        <div><span className="meta-label">Origin</span><strong>{originLabels[component.provenance.origin]}</strong></div>
        <div><span className="meta-label">Version</span><strong>{component.version}</strong></div>
        <div><span className="meta-label">Foundry evaluation</span><strong className={`badge ${statusTone(evaluation?.outcome ?? 'NOT RUN')}`}>{evaluation?.outcome ?? "NOT RUN"}</strong></div>
        <div><span className="meta-label">Trainer compatibility</span><strong className={`badge ${statusTone(compatibility?.status ?? 'NOT RUN')}`}>{compatibility?.status ?? "NOT RUN"}</strong></div>
      </section>

      <div className="workspace">
        <section className="panel standard-panel" id="stage-1">
          <div className="panel-heading"><div><p className="stage-number">01 / STANDARD PACK</p><h2>{caie9701StandardPack.title}</h2></div><span className="source-chip">{selectedTopic.id}</span></div>
          <p className="objective">{component.curriculum.learningObjectiveText}</p>
          <div className="constraint-grid">
            <div><h3>Required concepts</h3><ul>{selectedTopic.requiredConcepts.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div><h3>Permitted equations</h3><ul>{selectedTopic.permittedEquations.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div><h3>Authoring constraints</h3><ul>{[...selectedTopic.forbiddenAmbiguity, ...selectedTopic.disallowedShortcuts].map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
          <p className="provenance-line">Curriculum source: {component.curriculum.sourceIds.join(" · ")}</p>
        </section>

        <section className="panel studio" id="stage-2">
          <div className="panel-heading"><div><p className="stage-number">02 / COMPONENT STUDIO</p><h2>Author and generate</h2></div><div className="actions"><button onClick={() => load(generateValidStoichiometryDraft())}>Generate valid draft</button><button className="danger-outline" onClick={() => load(generateInvalidStoichiometryDraft())}>Generate invalid draft</button></div></div>
          <div className="generator-note"><span>GENERATOR</span><strong>{component.provenance.generatorId ?? "No generator — governed source asset"}</strong><p>Simulation only. No external model call is made.</p></div>
          <label className="field">Prompt<textarea value={component.presentation.prompt} onChange={(event) => editPrompt(event.target.value)} rows={4} /></label>
          <div className="studio-grid">
            <article><h3>Authored facts <span>{component.authoredFacts.length}</span></h3>{component.authoredFacts.map((fact) => <div className="row" key={fact.id}><span>{fact.label}</span><strong>{fact.value} {fact.unit}</strong></div>)}</article>
            <article><h3>Target contract</h3><div className="target-kind">{component.target.kind}</div><dl><div><dt>Expected</dt><dd>{component.target.expectedValue} {component.target.acceptedUnits[0]}</dd></div><div><dt>Precision</dt><dd>{component.target.significantFigures} s.f.</dd></div><div><dt>Adapter</dt><dd>{component.target.kind === "KP" || component.target.kind === "MASS" ? "Supported" : "Unsupported"}</dd></div></dl></article>
            <article className="graph-card"><h3>Reasoning graph <span>{component.reasoningGraph.version}</span></h3><ol>{component.reasoningGraph.pedagogicalOrder.map((id) => <li key={id}><span>{component.reasoningGraph.nodes[id].category}</span>{component.reasoningGraph.nodes[id].label}<small>{component.reasoningGraph.nodes[id].dependencies.length ? `after ${component.reasoningGraph.nodes[id].dependencies.join(', ')}` : 'entry node'}</small></li>)}</ol></article>
            <article><h3>Mark scheme <span>{component.presentation.marks} marks</span></h3>{component.markScheme.map((point) => <div className="mark-row" key={point.id}><b>{point.marks}</b><span>{point.description}</span></div>)}</article>
          </div>
        </section>

        <section className="panel evaluation" id="stage-3">
          <div className="panel-heading"><div><p className="stage-number">03 / FOUNDRY EVALUATION</p><h2>Reliability before learner exposure</h2></div><button className="primary" onClick={() => setEvaluation(evaluateComponent(component, caie9701StandardPack, standardTrainerCapability))}>Run 15 checks</button></div>
          <p className="boundary-note"><strong>Content evaluation</strong> asks whether this component may enter a runtime. <strong>Learner diagnosis</strong> later evaluates an attempt against the published contract.</p>
          {evaluation ? <div className="checks">{evaluation.checks.map((check) => <details key={check.id} open={check.status === "FAIL"}><summary><span className={`status-dot ${statusTone(check.status)}`} /> <code>{check.id}</code><strong className={statusTone(check.status)}>{check.status}</strong></summary><div>{check.evidence.map((item) => <p key={item}>{item}</p>)}{check.recommendation ? <p className="recommendation">Recommendation: {check.recommendation}</p> : null}</div></details>)}</div> : <div className="empty-state">Evaluation is invalidated after every edit. Run checks before requesting expert review.</div>}
        </section>

        <section className="panel review" id="stage-4">
          <div className="panel-heading"><div><p className="stage-number">04 / EXPERT REVIEW</p><h2>Human authority remains explicit</h2></div><strong className={`badge ${statusTone(component.status)}`}>{component.status}</strong></div>
          <div className="review-grid"><div><label className="field">Reviewer notes<textarea rows={5} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} /></label><div className="actions"><button className="primary" disabled={!canApprove} onClick={approve}>Approve component</button><button disabled={component.status === "PUBLISHED"} onClick={() => { setComponent((current) => ({ ...current, status: "DRAFT", review: undefined, publication: undefined })); setEvaluation(null); }}>Reject to draft</button></div></div><aside><h3>Approval gate</h3><p>{canApprove ? "All blocking checks pass. Reviewer judgment is now required." : component.status === "APPROVED" || component.status === "PUBLISHED" ? "Expert approval is recorded and version-pinned." : "Approval remains locked until every blocking check passes."}</p><dl><div><dt>Reviewer</dt><dd>{component.review?.reviewer ?? "Not assigned"}</dd></div><div><dt>Reviewed</dt><dd>{component.review?.reviewedAt.slice(0, 10) ?? "—"}</dd></div></dl></aside></div>
        </section>

        <section className="panel publish" id="stage-5">
          <div className="panel-heading"><div><p className="stage-number">05 / PUBLISH</p><h2>Immutable registry snapshot</h2></div><button className="primary" disabled={!canPublish} onClick={publish}>Publish {component.version}</button></div>
          <div className="publish-grid"><div><span className="meta-label">Version</span><strong>{component.version}</strong></div><div><span className="meta-label">Content hash</span><code>{component.publication?.contentHash ?? "Generated at publication"}</code></div><div><span className="meta-label">Manifest entry</span><strong>{component.id}@{component.version}</strong></div><div><span className="meta-label">Downstream</span><strong>{compatibility?.status === "PASS" ? "Standard Trainer eligible" : "Blocked"}</strong></div></div>
          <p className="immutable-note">Published snapshots cannot be edited. Content revisions create a new minor version; compatible metadata changes create a patch; schema breaks create a major version.</p>
        </section>

        <section className="panel preview" id="stage-6">
          <div className="panel-heading"><div><p className="stage-number">06 / RUNTIME PREVIEW</p><h2>Standard Trainer verification panel</h2></div><span className="source-chip">Adapter contract 1.0.0</span></div>
          {!published ? <div className="empty-state">Only immutable published snapshots can run in the downstream preview.</div> : <div className="preview-grid"><form onSubmit={(event) => { event.preventDefault(); setDiagnosis(evaluatePreviewAttempt(published, { value: Number(previewValue), unit: previewUnit, significantFigures: Number(previewSf), strategy: previewStrategy })); }}><label>Reasoning route<select value={previewStrategy} onChange={(event) => setPreviewStrategy(event.target.value as typeof previewStrategy)}><option value="CANONICAL">Canonical authored route</option><option value="WRONG_RATIO">Wrong stoichiometric ratio</option><option value="MISSING_LINK">Missing reasoning link</option></select></label><label>Final value<input type="number" step="any" value={previewValue} onChange={(event) => setPreviewValue(event.target.value)} /></label><label>Unit<input value={previewUnit} onChange={(event) => setPreviewUnit(event.target.value)} /></label><label>Significant figures<input type="number" min="1" value={previewSf} onChange={(event) => setPreviewSf(event.target.value)} /></label><button className="primary" type="submit">Diagnose learner evidence</button></form><div className={`diagnosis-card ${diagnosis ? statusTone(diagnosis.decision) : ''}`}>{diagnosis ? <><p className="stage-number">TRAINER LEARNER DIAGNOSIS</p><h3>{diagnosis.decision === "SOLVED" ? "Evidence satisfies the contract" : `First pedagogical error: ${diagnosis.stage}`}</h3><code>{diagnosis.firstFailureCode ?? "SOLVED"}</code>{diagnosis.evidence.map((item) => <p key={item}>{item}</p>)}</> : <><p className="stage-number">AWAITING ATTEMPT</p><h3>Run a bounded learner attempt</h3><p>The preview selects the same target adapter contract used downstream.</p></>}</div></div>}
        </section>
      </div>

      <footer><strong>Learning Foundry</strong><p>Upstream authority for governed learning components. Standard Trainer is one downstream deterministic runtime.</p><span>Static persistence boundary · No authentication · No external model</span></footer>
    </main>
  );
}
