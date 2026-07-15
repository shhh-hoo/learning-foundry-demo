import { useState } from "react";
import { createDemoEvent } from "../demo/events";
import { aggregatePatternEvidence, createComponentCandidate, promoteComponentCandidate } from "../experience/orchestration";
import type { ExperienceState, FoundryCandidateHandoff } from "../experience/types";
import type { DiagnosticLearningComponent } from "../contracts/diagnostic-component";
import { evaluateComponent } from "../governance/evaluation";
import { publishApprovedComponent } from "../governance/publishing";
import { standardTrainerCapability } from "../runtime/capability";
import { caie9701StandardPack } from "../standards/caie-9701";

type StudioSection = "PATTERNS" | "CANDIDATE" | "COMPONENT" | "EVALUATION" | "REVIEW" | "REGISTRY";

interface StudioViewProps {
  readonly state: ExperienceState;
  readonly handoff: FoundryCandidateHandoff | null;
  readonly onChange: (state: ExperienceState) => void;
  readonly onHandoffChange: (handoff: FoundryCandidateHandoff) => void;
  readonly initialSection?: StudioSection;
}

const nav: readonly { readonly id: StudioSection; readonly label: string }[] = [
  { id: "PATTERNS", label: "Pattern Inbox" },
  { id: "CANDIDATE", label: "Candidate Review" },
  { id: "COMPONENT", label: "Component Studio" },
  { id: "EVALUATION", label: "Foundry Evaluation" },
  { id: "REVIEW", label: "Expert Review" },
  { id: "REGISTRY", label: "Published Registry" },
];

function withEvent(state: ExperienceState, event: ReturnType<typeof createDemoEvent>): ExperienceState {
  return { ...state, eventLog: [...state.eventLog, event] };
}

export function StudioView({ state, handoff, onChange, onHandoffChange, initialSection = "PATTERNS" }: StudioViewProps) {
  const [section, setSection] = useState<StudioSection>(initialSection);
  const [publishError, setPublishError] = useState<string | null>(null);
  const pattern = aggregatePatternEvidence(state.evidence);
  const component = handoff?.component ?? null;
  const evaluation = handoff?.evaluation ?? null;
  const canEvaluate = component?.status === "DRAFT";
  const canApprove = component?.status === "DRAFT" && evaluation?.outcome === "PASSED";
  const canPublish = component?.status === "APPROVED";

  function createCandidate() {
    const created = createComponentCandidate(state);
    const promoted = promoteComponentCandidate(created);
    onChange(promoted.state);
    onHandoffChange(promoted.handoff);
    setSection("CANDIDATE");
  }

  function runEvaluation() {
    if (!handoff || !canEvaluate) return;
    const report = evaluateComponent(handoff.component, caie9701StandardPack, standardTrainerCapability);
    onHandoffChange({ ...handoff, evaluation: report });
    onChange(withEvent({ ...state, candidate: state.candidate ? { ...state.candidate, status: "EVALUATED" } : null }, createDemoEvent("CANDIDATE_EVALUATED", "FOUNDRY", { candidateId: state.candidate?.id ?? "", outcome: report.outcome })));
  }

  function approve() {
    if (!handoff || !canApprove) return;
    const approved: DiagnosticLearningComponent = {
      ...handoff.component,
      status: "APPROVED",
      review: {
        reviewer: "Dr A. Chen, CAIE Chemistry reviewer",
        reviewedAt: new Date().toISOString(),
        notes: "The strengthened ratio hint is accurate, bounded and supported by the attached evidence.",
      },
    };
    onHandoffChange({ ...handoff, component: approved });
    onChange(withEvent({ ...state, candidate: state.candidate ? { ...state.candidate, status: "APPROVED" } : null }, createDemoEvent("COMPONENT_APPROVED", "SUBJECT_EXPERT", { componentId: approved.id, version: approved.version })));
  }

  async function publish() {
    if (!handoff || !canPublish) return;
    setPublishError(null);
    const published = publishApprovedComponent(handoff.component, {
      publishedAt: new Date().toISOString(),
      publishedBy: "Learning Foundry local publisher",
    });
    onHandoffChange({ ...handoff, component: published });
    let next = withEvent(
      { ...state, candidate: state.candidate ? { ...state.candidate, status: "PUBLISHED" } : null, publishedCandidate: published },
      createDemoEvent("COMPONENT_PUBLISHED", "FOUNDRY", { componentId: published.id, version: published.version, contentHash: published.publication.contentHash }),
    );
    onChange(next);

    const configuredUrl = import.meta.env.VITE_DEMO_REGISTRY_URL as string | undefined;
    const registryUrl = configuredUrl ?? (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? "http://127.0.0.1:4175" : null);
    if (!registryUrl) return;
    try {
      const response = await fetch(`${registryUrl}/components`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(published),
      });
      const result = await response.json() as { readonly ok?: boolean; readonly error?: { readonly message?: string } };
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "The local registry rejected the component.");
      next = withEvent({ ...next, registryAccepted: true }, createDemoEvent("REGISTRY_COMPONENT_ACCEPTED", "FOUNDRY", { componentId: published.id, version: published.version, registry: registryUrl }));
      onChange(next);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "The local registry could not be reached.");
    }
  }

  return (
    <main className="product-surface studio-surface">
      <header className="product-header studio-header">
        <a className="brand" href="?view=studio"><span className="brand-mark">LF</span><span>Learning Foundry<small>Foundry Studio</small></span></a>
        <div className="studio-context"><span>Stoichiometry</span><strong>Component improvement</strong></div>
        <div className="user-chip"><span>AC</span><div><strong>Dr A. Chen</strong><small>Subject expert</small></div></div>
      </header>
      <div className="studio-layout">
        <nav className="studio-nav" aria-label="Foundry Studio">
          <p className="surface-kicker">Workspace</p>
          {nav.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>{item.label}</button>)}
        </nav>
        <section className="studio-main">
          {section === "PATTERNS" ? <>
            <div className="surface-heading"><div><p className="surface-kicker">Pattern Inbox</p><h1>Repeated needs, ready for review.</h1><p>Patterns are aggregated from persisted learner evidence. A threshold suggests work; it does not create or approve it.</p></div><span className={`threshold-pill ${pattern.thresholdReached ? "reached" : ""}`}>{pattern.occurrenceCount} / {pattern.threshold}</span></div>
            <article className="pattern-inbox-card">
              <div className="pattern-summary"><span className="card-type">{pattern.thresholdReached ? "Reusable pattern detected" : "Below candidate threshold"}</span><h2>Incorrect Mg:MgO coefficient transfer</h2><p>{pattern.occurrenceCount} similar traces · FORMULA stage · Stoichiometric product mass</p></div>
              <div className="pattern-equation"><strong>2 historical traces</strong><span>+</span><strong>{pattern.occurrenceCount > 2 ? "1 current learner trace" : "0 current learner traces"}</strong><span>=</span><strong>{pattern.occurrenceCount} matching traces</strong></div>
              <button className="primary" disabled={!pattern.thresholdReached || Boolean(state.candidate)} onClick={createCandidate}>{state.candidate ? "Candidate created" : "Create component candidate"}</button>
            </article>
          </> : null}

          {section === "CANDIDATE" ? <>
            <div className="surface-heading"><div><p className="surface-kicker">Candidate Review</p><h1>Evidence proposes the change.</h1></div><span className="status-badge">{state.candidate?.status ?? "NOT CREATED"}</span></div>
            {state.candidate ? <div className="candidate-review-grid">
              <article><span>Pattern</span><strong>FORMULA / WRONG_STOICHIOMETRIC_RATIO</strong></article><article><span>Affected component</span><strong>stoichiometric-product-mass@1.0.0</strong></article><article><span>Evidence count</span><strong>{state.candidate.pattern.occurrenceCount}</strong></article><article><span>Expected learning effect</span><strong>Make the 2:2 → 1:1 transfer explicit</strong></article>
              <article className="wide"><span>Current behavior</span><p>Compare the coefficients of Mg and MgO.</p></article><article className="wide"><span>Proposed change</span><p>2Mg : 2MgO simplifies to 1:1. Each mole of Mg forms one mole of MgO.</p></article><article className="wide"><span>Risks</span><p>Hint must remain support after diagnosis, not replace the diagnosis contract.</p></article><article className="wide"><span>Source evidence</span><p>{state.candidate.sourceEvidenceIds.join(" · ")}</p></article>
              <button className="primary" onClick={() => setSection("EVALUATION")}>Continue to evaluation</button>
            </div> : <div className="empty-state">Create a candidate from Pattern Inbox after the threshold is reached.</div>}
          </> : null}

          {section === "COMPONENT" ? <>
            <div className="surface-heading"><div><p className="surface-kicker">Component Studio</p><h1>Strengthen one governed hint.</h1></div><span className="status-badge">{component ? `v${component.version} ${component.status}` : "NO DRAFT"}</span></div>
            <div className="component-diff"><article><span>Published · v1.0.0</span><h2>Mass-ratio hint</h2><p>Compare the coefficients of Mg and MgO.</p></article><article className="new"><span>Draft · v1.1.0</span><h2>Mass-ratio hint</h2><p>2Mg : 2MgO simplifies to 1:1.<br />Each mole of Mg forms one mole of MgO.</p></article></div>
          </> : null}

          {section === "EVALUATION" ? <>
            <div className="surface-heading"><div><p className="surface-kicker">Foundry Evaluation</p><h1>Reliability before exposure.</h1></div><span className="status-badge">{evaluation?.outcome ?? "NOT RUN"}</span></div>
            <button className="primary" disabled={!canEvaluate} onClick={runEvaluation}>Run 15 checks</button>
            {evaluation ? <div className="evaluation-list">{evaluation.checks.map((check) => <div key={check.id}><span>{check.status}</span><strong>{check.id.replaceAll("_", " ")}</strong></div>)}</div> : <div className="empty-state">Evaluation is intentionally empty for a new draft. Approval stays locked until checks pass.</div>}
          </> : null}

          {section === "REVIEW" ? <>
            <div className="surface-heading"><div><p className="surface-kicker">Expert Review</p><h1>Publication requires human authority.</h1></div><span className="status-badge">{component?.status ?? "NO DRAFT"}</span></div>
            <article className="review-card"><h2>Ratio-transfer improvement</h2><p>Evidence is attached as draft-only metadata. The published v1.0.0 contract remains unchanged.</p><label>Review notes<textarea defaultValue="The strengthened ratio hint is accurate, bounded and supported by the attached evidence." rows={5} /></label><button className="primary" disabled={!canApprove} onClick={approve}>Approve component</button></article>
          </> : null}

          {section === "REGISTRY" ? <>
            <div className="surface-heading"><div><p className="surface-kicker">Published Registry</p><h1>Immutable, runtime-ready versions.</h1></div></div>
            <div className="registry-list"><article><div><span className="card-type">Published</span><h2>Stoichiometric product mass</h2><p>v1.0.0 · Available</p></div><strong>Current</strong></article>{state.publishedCandidate ? <article className="new"><div><span className="card-type">Published</span><h2>Stoichiometric product mass</h2><p>v{state.publishedCandidate.version} · {state.registryAccepted ? "Available to connected runtimes" : "Awaiting connected registry"}</p></div><strong>New</strong></article> : null}</div>
            {!state.publishedCandidate ? <button className="primary" disabled={!canPublish} onClick={publish}>Publish {component?.version ?? "candidate"}</button> : null}
            {publishError ? <p className="error-message">{publishError}</p> : null}
          </> : null}
        </section>
      </div>
    </main>
  );
}
