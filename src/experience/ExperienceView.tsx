import { useState } from "react";
import { publishedComponents } from "../components/published";
import { caie9701StandardPack } from "../standards/caie-9701";
import { diagnoseStoichiometryConversation, promoteComponentCandidate, setScheduleItemStatus } from "./orchestration";
import type { ExperienceState, FoundryCandidateHandoff } from "./types";

type ExperienceSection = "CHAT" | "LIBRARY" | "SCHEDULE" | "LIFECYCLE";

interface ExperienceViewProps {
  readonly state: ExperienceState;
  readonly onChange: (state: ExperienceState) => void;
  readonly onReset: () => void;
  readonly onPromote: (state: ExperienceState, handoff: FoundryCandidateHandoff) => void;
  readonly onNavigate: (view: "experience" | "governance") => void;
}

const sections: readonly { readonly id: ExperienceSection; readonly label: string; readonly detail: string }[] = [
  { id: "CHAT", label: "Chat", detail: "Ask and diagnose" },
  { id: "LIBRARY", label: "Library", detail: "Resources and evidence" },
  { id: "SCHEDULE", label: "Schedule", detail: "Review and retry" },
  { id: "LIFECYCLE", label: "Component Lifecycle", detail: "Detect and improve" },
];

const journey = ["Ask", "Route", "Diagnose", "Save", "Schedule", "Improve the component"];
const trainerUrl = import.meta.env.VITE_TRAINER_URL ?? "https://shhh-hoo.github.io/standard-trainer-demo/";

function ChatWorkspace({ state, onChange }: Pick<ExperienceViewProps, "state" | "onChange">) {
  return <>
    <div className="experience-section-heading">
      <div><p className="stage-number">01 / LEARNER CONVERSATION</p><h2>Find the first error, then preserve what matters.</h2></div>
      <span className="source-chip">CONVERSATION · {state.conversation.id}</span>
    </div>
    <div className="chat-thread">
      <article className="chat-message student-message"><span>Student</span><p>{state.conversation.messages[0]?.content}</p></article>
      {state.diagnosis ? <article className="chat-message foundry-message"><span>Learning Foundry · grounded response</span><p>{state.diagnosis.groundedResponse}</p></article> : <article className="orchestration-card">
        <div><span className="orchestration-step">1</span><p>Read the learner’s explicit mass → amount → ratio path.</p></div>
        <div><span className="orchestration-step">2</span><p>Resolve it against the published calculation contract.</p></div>
        <div><span className="orchestration-step">3</span><p>Return the earliest bounded pedagogical error.</p></div>
      </article>}
    </div>
    {state.diagnosis ? <div className="diagnosis-banner negative">
      <div><p className="stage-number">FIRST PEDAGOGICAL ERROR · {state.diagnosis.stage}</p><code>{state.diagnosis.failureCode}</code></div>
      <div><span>Observed ratio</span><strong>{state.diagnosis.observedRatio}</strong></div>
      <div><span>Expected ratio</span><strong>{state.diagnosis.expectedRatio}</strong></div>
    </div> : <button className="primary experience-cta" onClick={() => onChange(diagnoseStoichiometryConversation(state))}>Diagnose learner attempt</button>}
    <p className="simulation-note"><strong>Deterministic demo orchestration.</strong> No external model call. The response is selected from the runtime failure code, not generated as general advice.</p>
  </>;
}

function LibraryWorkspace({ state }: Pick<ExperienceViewProps, "state">) {
  const standardTopics = caie9701StandardPack.topics;
  return <>
    <div className="experience-section-heading"><div><p className="stage-number">02 / LEARNING LIBRARY</p><h2>One place for trusted inputs and learning outputs.</h2></div><span className="source-chip">SESSION MEMORY</span></div>
    <div className="library-grid">
      <article className="library-group"><p className="library-kicker">Trusted Resources</p>{standardTopics.map((topic) => <div className="library-row" key={topic.id}><span className="library-icon">SR</span><div><strong>CAIE 9701 {topic.title} Standard Pack</strong><small>Trusted curriculum constraints</small></div></div>)}</article>
      <article className="library-group"><p className="library-kicker">Published Components</p>{publishedComponents.map((component) => <div className="library-row" key={component.id}><span className="library-icon published-icon">PC</span><div><strong>{component.presentation.title}</strong><small>{component.id}@{component.version}</small></div></div>)}{state.publishedCandidate ? <div className="library-row new-publication"><span className="library-icon published-icon">NEW</span><div><strong>{state.publishedCandidate.presentation.title}</strong><small>{state.publishedCandidate.id}@{state.publishedCandidate.version} · Published from learner evidence</small></div></div> : null}</article>
      <article className="library-group"><p className="library-kicker">Diagnostic Evidence</p>{state.evidence.length ? state.evidence.map((item) => <div className="evidence-record" key={item.id}><code>{item.failureCode}</code><p>Student error · {item.stage}</p><dl><div><dt>Component</dt><dd>{item.componentId}@{item.componentVersion}</dd></div><div><dt>Ratio evidence</dt><dd><span>Observed ratio: {item.observedEvidence.observedRatio}</span><span>Expected ratio: {item.observedEvidence.expectedRatio}</span></dd></div></dl></div>) : <div className="library-empty">Run the diagnosis to save a bounded evidence trace.</div>}</article>
      <article className="library-group"><p className="library-kicker">Learning Artifacts</p>{state.learningArtifacts.length ? state.learningArtifacts.map((item) => <div className="correction-card" key={item.id}><strong>{item.title}</strong><div className="correction-route">{item.steps.map((step, index) => <span key={step}>{step}{index < item.steps.length - 1 ? <b>→</b> : null}</span>)}</div></div>) : <div className="library-empty">A worked correction appears after diagnosis.</div>}</article>
      <article className="library-group candidate-library"><p className="library-kicker">Component Candidates</p><div className="library-row"><span className="library-icon candidate-icon">CC</span><div><strong>Mole-ratio diagnostic transfer</strong><small>{state.candidate.status} · 3 related traces</small></div></div></article>
    </div>
  </>;
}

function ScheduleWorkspace({ state, onChange, onOpenChat }: Pick<ExperienceViewProps, "state" | "onChange"> & { readonly onOpenChat: () => void }) {
  return <>
    <div className="experience-section-heading"><div><p className="stage-number">03 / DELAYED PRACTICE</p><h2>Turn a correction into a memory check.</h2></div><span className="source-chip">LIGHTWEIGHT SCHEDULE</span></div>
    <div className="timeline">
      <article><div className="timeline-date"><span>Today</span><b>01</b></div><div><p className="stage-number">CORRECTION ROUTE</p><h3>Review the corrected reasoning route</h3><p>Trace the first error without hiding the successful mass-to-amount step.</p><button onClick={onOpenChat}>Jump back to Chat</button></div></article>
      <article><div className="timeline-date future"><span>In 3 days</span><b>02</b></div><div><p className="stage-number">DELAYED TRANSFER</p><h3>Complete a delayed transfer attempt</h3>{state.schedule.length ? state.schedule.map((item) => <div className="schedule-card" key={item.id}><div><strong>{item.title}</strong><p>{item.reason}</p><small>Due {new Date(item.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</small></div><div><span className={`badge ${item.status === "COMPLETED" ? "positive" : "warning"}`}>{item.status}</span><button onClick={() => onChange(setScheduleItemStatus(state, item.id, item.status === "COMPLETED" ? "SCHEDULED" : "COMPLETED"))}>{item.status === "COMPLETED" ? "Reopen" : "Mark complete"}</button><a className="button-link" href={trainerUrl} target="_blank" rel="noreferrer">Open Trainer</a></div></div>) : <div className="library-empty">Run the diagnosis to schedule a retry three days later.</div>}</div></article>
    </div>
  </>;
}

function LifecycleWorkspace({ state, onPromote }: Pick<ExperienceViewProps, "state" | "onPromote">) {
  const traces = state.candidate.sourceEvidenceIds;
  return <>
    <div className="experience-section-heading"><div><p className="stage-number">04 / CONVERSATION TO COMPONENT</p><h2>A repeated learner need becomes governed work.</h2></div><span className="source-chip">DEMO EVIDENCE SET</span></div>
    <div className="seeded-note"><strong>Seeded demonstration evidence</strong><span>Not production analytics</span><p>These three fixtures make the lifecycle visible without claiming real cross-user measurement.</p></div>
    <div className="trace-grid">{traces.map((trace, index) => <article key={trace}><span>0{index + 1}</span><div><strong>{trace}</strong><code>WRONG_STOICHIOMETRIC_RATIO</code><p>Shared stage · FORMULA</p></div></article>)}</div>
    <article className="pattern-card"><div className="pattern-count"><strong>3</strong><span>similar learner traces</span></div><div className="pattern-copy"><p className="kicker">Reusable pattern detected</p><h3>Strengthen the diagnostic hint and transfer item</h3><dl><div><dt>Shared stage</dt><dd>FORMULA</dd></div><div><dt>Shared failure code</dt><dd>WRONG_STOICHIOMETRIC_RATIO</dd></div><div><dt>Existing component</dt><dd>stoichiometric-product-mass@1.0.0</dd></div><div><dt>Candidate source</dt><dd>CONVERSATION_DERIVED</dd></div></dl></div></article>
    <div className="lifecycle-action"><div><span className={`badge ${state.candidate.status === "DETECTED" ? "warning" : "positive"}`}>{state.candidate.status}</span><p>Promotion creates a draft with source conversation and evidence IDs. Evaluation starts at NOT RUN and approval remains locked.</p></div><button className="primary" disabled={state.candidate.status !== "DETECTED"} onClick={() => { const promoted = promoteComponentCandidate(state); onPromote(promoted.state, promoted.handoff); }}>Promote to Foundry candidate</button></div>
  </>;
}

export function ExperienceView({ state, onChange, onReset, onPromote, onNavigate }: ExperienceViewProps) {
  const [section, setSection] = useState<ExperienceSection>("CHAT");
  const evidenceStatus = state.diagnosis ? "Captured" : "Awaiting diagnosis";

  return <main className="experience-shell">
    <header className="masthead experience-masthead">
      <a className="brand" href="?view=experience" onClick={(event) => { event.preventDefault(); onNavigate("experience"); }}><span className="brand-mark">LF</span><span>Learning Foundry<small>Product Experience</small></span></a>
      <nav className="view-switcher" aria-label="Product areas"><a className="active" href="?view=experience" onClick={(event) => { event.preventDefault(); onNavigate("experience"); }}>Product Experience</a><a href="?view=governance" onClick={(event) => { event.preventDefault(); onNavigate("governance"); }}>Governance Workbench</a></nav>
      <button className="reset-button" onClick={() => { onReset(); setSection("CHAT"); }}>Reset demo</button>
    </header>

    <section className="experience-hero">
      <div><p className="kicker">Learning need → reliable component</p><h1>See the learner. Preserve the evidence. <em>Improve the system.</em></h1><p>A deterministic product slice connecting conversation, trusted standards, bounded diagnosis, delayed practice, and expert-governed publication.</p></div>
      <ol className="journey-strip">{journey.map((step, index) => <li className={index < (state.diagnosis ? 5 : 2) ? "complete" : ""} key={step}><span>{String(index + 1).padStart(2, "0")}</span>{step}</li>)}</ol>
    </section>

    <div className="experience-layout">
      <aside className="experience-sidebar"><p className="panel-label">Product spaces</p>{sections.map((item) => <button aria-label={item.label} className={section === item.id ? "active" : ""} key={item.id} onClick={() => setSection(item.id)}><span>{item.label}</span><small>{item.detail}</small>{item.id === "LIBRARY" && state.evidence.length ? <b>{state.evidence.length + state.learningArtifacts.length}</b> : null}</button>)}<div className="authority-card"><span>Runtime link</span><strong>standard-trainer@1.0.0</strong><a href={trainerUrl} target="_blank" rel="noreferrer">Open local Trainer ↗</a></div></aside>

      <section className="experience-workspace" aria-live="polite">
        {section === "CHAT" ? <ChatWorkspace state={state} onChange={onChange} /> : null}
        {section === "LIBRARY" ? <LibraryWorkspace state={state} /> : null}
        {section === "SCHEDULE" ? <ScheduleWorkspace state={state} onChange={onChange} onOpenChat={() => setSection("CHAT")} /> : null}
        {section === "LIFECYCLE" ? <LifecycleWorkspace state={state} onPromote={onPromote} /> : null}
      </section>

      <aside className="evidence-rail">
        <div><p className="panel-label">Retrieved source</p><strong>CAIE 9701 · Stoichiometry</strong><span>Trusted standard pack</span></div>
        <div><p className="panel-label">Selected capability</p><strong>Stoichiometric Product Mass Trainer</strong><span>Structured mass → amount → ratio → mass path</span></div>
        <div><p className="panel-label">Published component</p><strong>stoichiometric-product-mass@1.0.0</strong><span>Runtime · standard-trainer@1.0.0</span></div>
        <div><p className="panel-label">Evidence stream</p><strong>{evidenceStatus}</strong><span>{state.evidence.length} diagnostic record · {state.schedule.length} scheduled retry</span></div>
        <div><p className="panel-label">Current lifecycle</p><strong>{state.candidate.status}</strong><span>3 seeded related traces</span></div>
      </aside>
    </div>

    <footer className="experience-footer"><strong>Deterministic product simulation</strong><p>No real LLM · No cross-user analytics · No student database</p><span>Learning needs flow into existing governed, executable contracts.</span></footer>
  </main>;
}
