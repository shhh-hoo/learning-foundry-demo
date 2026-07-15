import { useState } from "react";
import { diagnoseStoichiometryConversation, setScheduleItemStatus } from "../experience/orchestration";
import type { ExperienceState } from "../experience/types";

type LearnerSection = "CHAT" | "LIBRARY" | "SCHEDULE";

interface LearnerViewProps {
  readonly state: ExperienceState;
  readonly onChange: (state: ExperienceState) => void;
  readonly initialSection?: LearnerSection;
}

const nav: readonly { readonly id: LearnerSection; readonly label: string }[] = [
  { id: "CHAT", label: "Chat" },
  { id: "LIBRARY", label: "Library" },
  { id: "SCHEDULE", label: "Schedule" },
];

export function LearnerView({ state, onChange, initialSection = "CHAT" }: LearnerViewProps) {
  const [section, setSection] = useState<LearnerSection>(initialSection);
  const currentEvidence = state.evidence.find((item) => item.id === "evidence-mgo-ratio-current");

  return (
    <main className="product-surface learner-surface">
      <header className="product-header">
        <a className="brand" href="?view=learner" aria-label="Learning Foundry Learner Workspace">
          <span className="brand-mark">LF</span>
          <span>Learning Foundry<small>Learner Workspace</small></span>
        </a>
        <nav aria-label="Learner workspace">
          {nav.map((item) => (
            <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="user-chip"><span>MA</span><div><strong>Mina A.</strong><small>CAIE Chemistry</small></div></div>
      </header>

      {section === "CHAT" ? (
        <section className="learner-workspace">
          <aside className="conversation-list">
            <p className="surface-kicker">Recent</p>
            <button className="selected"><strong>Magnesium oxide calculation</strong><small>Stoichiometry · Today</small></button>
            <button><strong>Kp from equilibrium amounts</strong><small>Equilibria · Yesterday</small></button>
          </aside>
          <div className="chat-workspace">
            <div className="surface-heading"><div><p className="surface-kicker">Chat</p><h1>Work through the first mistake.</h1></div><span className="trusted-chip">Trusted course tools</span></div>
            <div className="student-bubble"><span>You</span><p>{state.conversation.messages[0]?.content}</p></div>
            {state.diagnosis ? (
              <div className="tutor-bubble">
                <span>Learning Foundry</span>
                <p>{state.diagnosis.groundedResponse}</p>
                <details>
                  <summary>Why this answer?</summary>
                  <dl>
                    <div><dt>Curriculum source</dt><dd>CAIE 9701 Stoichiometry</dd></div>
                    <div><dt>Learning tool</dt><dd>Stoichiometric Product Mass</dd></div>
                    <div><dt>Detected issue</dt><dd>Mole-ratio error</dd></div>
                  </dl>
                </details>
              </div>
            ) : (
              <div className="ready-card"><strong>Your working is ready to check.</strong><p>I’ll preserve the correct mass-to-amount step and focus on the first place the route changes.</p></div>
            )}
            {!state.diagnosis ? <button className="primary learner-primary" onClick={() => onChange(diagnoseStoichiometryConversation(state))}>Check my working</button> : null}
          </div>
        </section>
      ) : null}

      {section === "LIBRARY" ? (
        <section className="surface-page">
          <div className="surface-heading"><div><p className="surface-kicker">Library</p><h1>Your learning memory.</h1><p>Corrections, practice and trusted resources saved for when you need them.</p></div></div>
          <div className="learner-card-grid">
            <article><span className="card-type">Saved explanation</span><h2>Why the Mg:MgO ratio is 1:1</h2><p>The balanced coefficients are 2 and 2. Simplifying 2:2 gives one mole of MgO for every mole of Mg.</p></article>
            <article><span className="card-type">Worked correction</span><h2>Magnesium to magnesium oxide</h2>{state.learningArtifacts.length ? <ol>{state.learningArtifacts[0]?.steps.map((step) => <li key={step}>{step}</li>)}</ol> : <p>Check your working to save a correction.</p>}</article>
            <article><span className="card-type">Practice history</span><h2>Stoichiometric product mass</h2><p>{currentEvidence ? "Correction saved today · Review scheduled" : "No attempt recorded yet"}</p></article>
            <article><span className="card-type">Trusted resource</span><h2>CAIE 9701 · Stoichiometry</h2><p>Balanced equations, amount of substance and reacting masses.</p></article>
          </div>
        </section>
      ) : null}

      {section === "SCHEDULE" ? (
        <section className="surface-page schedule-page">
          <div className="surface-heading"><div><p className="surface-kicker">Schedule</p><h1>Small checks, spaced well.</h1></div></div>
          <div className="review-timeline">
            <article><time>Today</time><div><span className="card-type">Review</span><h2>Review the corrected route</h2><p>Keep 4.80 ÷ 24.0, then replace the ratio step with 2:2 → 1:1.</p><button onClick={() => setSection("CHAT")}>Start review</button></div></article>
            <article><time>In 3 days</time><div><span className="card-type">Transfer</span><h2>Complete a new mole-ratio transfer problem</h2><p>Use a fresh equation to show the correction transfers beyond this example.</p><div className="schedule-actions"><button>Start transfer problem</button>{state.schedule[0] ? <button disabled={state.schedule[0].status === "COMPLETED"} onClick={() => onChange(setScheduleItemStatus(state, state.schedule[0]!.id, "COMPLETED"))}>{state.schedule[0].status === "COMPLETED" ? "Completed" : "Mark complete"}</button> : null}</div></div></article>
          </div>
        </section>
      ) : null}
    </main>
  );
}
