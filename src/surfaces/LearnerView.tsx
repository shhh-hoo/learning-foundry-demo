import { useEffect, useState } from "react";
import presetsConfig from "../../config/presets/learner-presets.json";
import type { AgentTrace, InputOrigin } from "../agent/types";
import { applyAgentRun, confirmLibraryProposal, confirmScheduleProposal, setScheduleItemStatus } from "../experience/orchestration";
import type { ExperienceState, GatewayToolResult } from "../experience/types";

type LearnerSection = "CHAT" | "LIBRARY" | "SCHEDULE";
interface LearnerViewProps { readonly state: ExperienceState; readonly onChange: (state: ExperienceState) => void; readonly initialSection?: LearnerSection }
const nav: readonly { readonly id: LearnerSection; readonly label: string }[] = [{ id: "CHAT", label: "Chat" }, { id: "LIBRARY", label: "Library" }, { id: "SCHEDULE", label: "Schedule" }];
const gatewayUrl = "http://127.0.0.1:4176";

export function LearnerView({ state, onChange, initialSection = "CHAT" }: LearnerViewProps) {
  const [section, setSection] = useState<LearnerSection>(initialSection);
  const [input, setInput] = useState("");
  const [inputOrigin, setInputOrigin] = useState<InputOrigin>("USER_INPUT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${gatewayUrl}/health`).then(async (response) => {
      const health = await response.json() as { configured?: boolean; model?: string | null };
      if (!cancelled) onChange({ ...state, agentConfigured: health.configured === true, gatewayModel: health.model ?? null });
    }).catch(() => { if (!cancelled) onChange({ ...state, agentConfigured: false, gatewayModel: null }); });
    return () => { cancelled = true; };
  }, []);

  function selectPreset(value: string) {
    const preset = presetsConfig.presets.find((item) => item.id === value);
    if (!preset) return;
    setInput(preset.input); setInputOrigin("PRESET_INPUT"); setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!input.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${gatewayUrl}/agent/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: state.conversationId, inputOrigin, runPurpose: "PRODUCT", messages: [...state.messages.map((item) => ({ role: item.role === "USER" ? "user" : "assistant", content: item.content })), { role: "user", content: input.trim() }] }) });
      const body = await response.json() as { readonly ok?: boolean; readonly trace?: AgentTrace; readonly toolResults?: readonly GatewayToolResult[]; readonly error?: { readonly message?: string } };
      if (!response.ok || !body.ok || !body.trace) throw new Error(body.error?.message ?? "The Agent run failed.");
      onChange(applyAgentRun(state, input.trim(), body.trace, body.toolResults ?? []));
      setInput(""); setInputOrigin("USER_INPUT");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The Agent run failed."); }
    finally { setBusy(false); }
  }

  const latestDiagnosis = state.diagnoses.at(-1);
  return <main className="product-surface learner-surface">
    <header className="product-header"><a className="brand" href="?view=learner"><span className="brand-mark">LF</span><span>Learning Foundry<small>Learner Workspace</small></span></a><nav aria-label="Learner workspace">{nav.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav><span className={`trusted-chip ${state.agentConfigured ? "" : "warning"}`}>{state.agentConfigured === null ? "Checking Agent" : state.agentConfigured ? "DeepSeek configured" : "Agent not configured"}</span></header>
    {section === "CHAT" ? <section className="learner-workspace"><aside className="conversation-list"><p className="surface-kicker">Presets</p><select aria-label="Fill input from preset" defaultValue="" onChange={(event) => selectPreset(event.target.value)}><option value="" disabled>Choose an input preset</option>{presetsConfig.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select><p>Presets fill the text box only. Every response and tool result must run now.</p><p>Course search currently uses curated local learning-resource metadata. Authoritative syllabus-document retrieval is not connected yet.</p></aside><div className="chat-workspace"><div className="surface-heading"><div><p className="surface-kicker">Chat</p><h1>Ask, inspect evidence, then decide what to keep.</h1></div>{state.gatewayModel ? <code>{state.gatewayModel}</code> : null}</div>
      <div className="conversation-thread">{state.messages.length ? state.messages.map((message) => <div key={message.id} className={message.role === "USER" ? "student-bubble" : "tutor-bubble"}><span>{message.role === "USER" ? "You" : "Learning Foundry"}{message.inputOrigin ? ` · ${message.inputOrigin}` : ""}</span><p>{message.content}</p>{message.sourceRefs?.length ? <small>Sources: {message.sourceRefs.join(" · ")}</small> : null}</div>) : <div className="empty-state">No Agent runs yet. Type a question or fill the input from a preset.</div>}</div>
      {latestDiagnosis ? <details><summary>Learner Diagnosis · {latestDiagnosis.failureCode ?? latestDiagnosis.decision}</summary><dl><div><dt>Trace</dt><dd>{latestDiagnosis.traceId}</dd></div><div><dt>Component</dt><dd>{latestDiagnosis.componentId}@{latestDiagnosis.componentVersion}</dd></div><div><dt>First issue</dt><dd>{latestDiagnosis.firstPedagogicalIssue ?? "None"}</dd></div><div><dt>Evidence</dt><dd>{latestDiagnosis.evidence.join(" ")}</dd></div></dl></details> : null}
      {state.pendingResponse?.proposedLibraryArtifact ? <div className="proposal-card"><strong>Library proposal</strong><p>{state.pendingResponse.proposedLibraryArtifact.title}</p><button className="primary" onClick={() => onChange(confirmLibraryProposal(state))}>Confirm save to Library</button></div> : null}
      {state.pendingResponse?.proposedFollowUp ? <div className="proposal-card"><strong>Schedule proposal</strong><p>{state.pendingResponse.proposedFollowUp.title}</p><button className="primary" onClick={() => onChange(confirmScheduleProposal(state))}>Confirm follow-up</button></div> : null}
      <form className="chat-composer" onSubmit={submit}><textarea aria-label="Message Learning Foundry" value={input} onChange={(event) => { setInput(event.target.value); setInputOrigin("USER_INPUT"); }} placeholder="Show your question or working…" rows={4} /><div><span>Input origin: {inputOrigin}</span><button className="primary" type="submit" disabled={busy || !input.trim()}>{busy ? "Running Agent…" : "Run Agent"}</button></div></form>{error ? <p className="error-message" role="alert">{error}</p> : null}
    </div></section> : null}
    {section === "LIBRARY" ? <section className="surface-body"><div className="surface-heading"><div><p className="surface-kicker">Library</p><h1>Your confirmed learning artifacts.</h1></div></div>{state.library.length ? state.library.map((item) => <article className="library-card" key={item.id}><span>{item.origin}</span><h2>{item.title}</h2><p>{item.content}</p></article>) : <div className="empty-state">Nothing saved. Agent proposals appear here only after your confirmation.</div>}</section> : null}
    {section === "SCHEDULE" ? <section className="surface-body"><div className="surface-heading"><div><p className="surface-kicker">Schedule</p><h1>Follow-ups you confirmed.</h1></div></div>{state.schedule.length ? state.schedule.map((item) => <article className="schedule-card" key={item.id}><div><span>{item.origin}</span><h2>{item.title}</h2><p>{item.reason}</p></div><button onClick={() => onChange(setScheduleItemStatus(state, item.id, item.status === "SCHEDULED" ? "COMPLETED" : "SCHEDULED"))}>{item.status}</button></article>) : <div className="empty-state">No follow-ups scheduled.</div>}</section> : null}
  </main>;
}
