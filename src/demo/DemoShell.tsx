import { useEffect, useMemo, useRef, useState } from "react";
import { HANDOFF_KEY, SESSION_KEY } from "../experience/repository";
import { isDemoEvent, type DemoEvent, type DemoEventType } from "./events";

type DemoMode = "GUIDED" | "FREE";

interface StoryScene {
  readonly id: number;
  readonly title: string;
  readonly persona: string;
  readonly time: string;
  readonly route: string;
  readonly required: readonly DemoEventType[];
  readonly proves: string;
  readonly initialExplanation: string;
}

const trainerUrl = import.meta.env.VITE_TRAINER_URL ?? "http://127.0.0.1:4174/";
const scenes: readonly StoryScene[] = [
  { id: 1, title: "Learner asks", persona: "Student", time: "Today", route: "?view=learner&section=chat&embedded=1", required: ["LEARNER_DIAGNOSIS_COMPLETED"], proves: "A learner can show enough working for a bounded diagnostic tool, rather than a generic answer generator.", initialExplanation: "The product is waiting for a real learner action inside the frame." },
  { id: 2, title: "Preserve learning", persona: "Student", time: "Today", route: "?view=learner&section=library&embedded=1", required: ["EVIDENCE_PERSISTED", "RETRY_SCHEDULED"], proves: "A correction becomes useful learning memory and a delayed transfer task.", initialExplanation: "The correction and schedule come from the completed diagnosis, not from the shell." },
  { id: 3, title: "Pattern threshold", persona: "Teacher · Learning Product Owner", time: "After three actual local runs", route: "?view=studio&section=patterns&embedded=1", required: ["PATTERN_THRESHOLD_REACHED"], proves: "Three matching actual Agent runs create the first eligible pattern.", initialExplanation: "The repository begins empty and aggregates only real diagnosis evidence." },
  { id: 4, title: "Candidate and governance", persona: "Teacher · Subject Expert", time: "Three days later", route: "?view=studio&section=candidate&embedded=1", required: ["CANDIDATE_CREATED", "CANDIDATE_EVALUATED", "COMPONENT_APPROVED"], proves: "Evidence proposes a change; contract checks and Expert Review authorize it.", initialExplanation: "Create the candidate, run Component Contract Checks, then record Expert Review inside Foundry Studio." },
  { id: 5, title: "Publish to registry", persona: "Learning Product Owner", time: "After approval", route: "?view=studio&section=registry&embedded=1", required: ["COMPONENT_PUBLISHED", "REGISTRY_COMPONENT_ACCEPTED"], proves: "v1.1.0 is immutable and accepted by a validating local runtime registry.", initialExplanation: "Publishing is incomplete until the connected registry validates the snapshot." },
  { id: 6, title: "Improved runtime behavior", persona: "New student", time: "Later", route: `${trainerUrl}${trainerUrl.includes("?") ? "&" : "?"}embedded=1&component=stoichiometric-product-mass`, required: ["RUNTIME_COMPONENT_SELECTED", "RUNTIME_DIAGNOSIS_COMPLETED"], proves: "The downstream runtime loads v1.1.0 and selects the strengthened 1:1 support hint.", initialExplanation: "Use the same wrong ratio in Standard Trainer to verify behavior, not just a version label." },
];

const eventCopy: Partial<Record<DemoEventType, { readonly title: string; readonly body: string; readonly evidence: string }>> = {
  LEARNER_DIAGNOSIS_COMPLETED: { title: "What happened", body: "The published Stoichiometric Product Mass contract identified the first error at the mole-ratio stage.", evidence: "FORMULA · WRONG_STOICHIOMETRIC_RATIO · observed 0.5 · expected 1" },
  EVIDENCE_PERSISTED: { title: "Learning memory created", body: "The bounded trace was persisted for later aggregation and learner review.", evidence: "evidence-mgo-ratio-current" },
  RETRY_SCHEDULED: { title: "Transfer scheduled", body: "A delayed task now checks whether the correction transfers to a fresh problem.", evidence: "Today → in 3 days" },
  PATTERN_THRESHOLD_REACHED: { title: "Threshold reached", body: "The current learner evidence became the third real matching trace.", evidence: "2 historical + 1 current = 3" },
  CANDIDATE_CREATED: { title: "Candidate created", body: "The evidence now proposes a draft-only change. It does not authorize publication.", evidence: "stoichiometric-product-mass@1.1.0 DRAFT" },
  CANDIDATE_EVALUATED: { title: "Contract checks passed", body: "Foundry checks the draft contract before a human can approve it.", evidence: "15 governed checks" },
  COMPONENT_APPROVED: { title: "Expert authority recorded", body: "A subject expert accepted the bounded hint change.", evidence: "Approval gate satisfied" },
  COMPONENT_PUBLISHED: { title: "Immutable publication", body: "The candidate is now an immutable v1.1.0 component.", evidence: "The next step must prove that a downstream runtime loads it." },
  REGISTRY_COMPONENT_ACCEPTED: { title: "Registry accepted", body: "The local bridge validated schema, status and content hash before accepting v1.1.0.", evidence: "Available to connected runtimes" },
  RUNTIME_COMPONENT_SELECTED: { title: "Runtime selected v1.1.0", body: "The downstream registry merged static and dynamic snapshots and chose the highest compatible version.", evidence: "Source · local demo registry" },
  RUNTIME_DIAGNOSIS_COMPLETED: { title: "Improved support delivered", body: "Diagnosis remains deterministic; the governed hint is selected afterward from the first pedagogical error.", evidence: "2Mg : 2MgO simplifies to 1:1" },
};

function routeOrigin(route: string): string {
  return new URL(route, window.location.href).origin;
}

export function DemoShell() {
  const [mode, setMode] = useState<DemoMode>("GUIDED");
  const [step, setStep] = useState(0);
  const [events, setEvents] = useState<readonly DemoEvent[]>([]);
  const [freeRoute, setFreeRoute] = useState("?view=learner&embedded=1");
  const [frameKey, setFrameKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scene = scenes[step]!;
  const route = mode === "GUIDED" ? scene.route : freeRoute;
  const seen = useMemo(() => new Set(events.map((event) => event.type)), [events]);
  const complete = scene.required.every((type) => seen.has(type));
  const relevant = [...events].reverse().find((event) => scene.required.includes(event.type));
  const explanation = relevant ? eventCopy[relevant.type] : null;

  function receiveMessage(message: MessageEvent) {
    const sourceMatches = message.source === frameRef.current?.contentWindow;
    if (!sourceMatches || message.origin !== routeOrigin(route)) return;
    const data = message.data as { readonly source?: unknown; readonly event?: unknown };
    if (data?.source !== "learning-foundry-product" && data?.source !== "standard-trainer-product") return;
    const event = data.event;
    if (!isDemoEvent(event)) return;
    if (data.source === "standard-trainer-product") {
      try {
        const key = SESSION_KEY;
        const stored = window.localStorage.getItem(key);
        if (stored) {
          const productState = JSON.parse(stored) as { eventLog?: DemoEvent[] };
          if (!productState.eventLog?.some((item) => item.eventId === event.eventId)) {
            productState.eventLog = [...(productState.eventLog ?? []), event];
            window.localStorage.setItem(key, JSON.stringify(productState));
          }
        }
      } catch { /* an invalid local session is ignored by the shell */ }
    }
    setEvents((current) => current.some((item) => item.eventId === event.eventId) ? current : [...current, event]);
  }

  useEffect(() => {
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [route]);

  async function restart() {
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(HANDOFF_KEY);
    setEvents([]);
    setStep(0);
    setFrameKey((value) => value + 1);
    try { await fetch("http://127.0.0.1:4175/session", { method: "DELETE" }); } catch { /* local bridge is optional online */ }
  }

  return <main className="demo-shell">
    <header className="demo-topbar">
      <a className="brand shell-brand" href="?view=demo"><span className="brand-mark">LF</span><span>Learning Foundry<small>Demo Shell · outside the product</small></span></a>
      <div className="story-meta"><div><span>Persona</span><strong>{mode === "GUIDED" ? scene.persona : "Free explore"}</strong></div><div><span>Time</span><strong>{mode === "GUIDED" ? scene.time : "Any point"}</strong></div><div><span>Step</span><strong>{mode === "GUIDED" ? `${scene.id} of ${scenes.length}` : "—"}</strong></div></div>
      <div className="mode-switch"><button className={mode === "GUIDED" ? "active" : ""} onClick={() => setMode("GUIDED")}>Guided Story</button><button className={mode === "FREE" ? "active" : ""} onClick={() => setMode("FREE")}>Free Explore</button></div>
    </header>
    {mode === "FREE" ? <div className="free-picker"><label>Product surface<select value={freeRoute} onChange={(event) => setFreeRoute(event.target.value)}><option value="?view=learner&embedded=1">Learner Workspace</option><option value="?view=studio&embedded=1">Foundry Studio</option><option value="?view=inspector&embedded=1">Engineering Inspector</option><option value={`${trainerUrl}${trainerUrl.includes("?") ? "&" : "?"}embedded=1&component=stoichiometric-product-mass`}>Standard Trainer</option></select></label></div> : null}
    <div className="demo-stage">
      <section className="product-frame-wrap"><div className="frame-label"><span>Live product frame</span><strong>{mode === "GUIDED" ? scene.title : "Explore independently"}</strong></div><iframe key={`${route}-${frameKey}`} ref={frameRef} title="Live product surface" src={route} /></section>
      <aside className="demo-annotation">
        <div><p className="surface-kicker">What this proves</p><h1>{mode === "GUIDED" ? scene.proves : "Explore real product surfaces without guided step gates."}</h1></div>
        <div className={`triggered-copy ${explanation ? "active" : ""}`}><span>{explanation?.title ?? "Waiting for product event"}</span><p>{explanation?.body ?? scene.initialExplanation}</p><code>{explanation?.evidence ?? scene.required.join(" + ")}</code></div>
        <div className="event-receipt"><span>Event status</span>{scene.required.map((type) => <div key={type}><i className={seen.has(type) ? "received" : ""} /><code>{type}</code></div>)}</div>
        <div className="boundary-note"><strong>Boundary</strong><p>The shell explains product events. It does not create diagnosis, evidence, candidate, publication or runtime state.</p></div>
      </aside>
    </div>
    <footer className="demo-controls"><button disabled={mode !== "GUIDED" || step === 0} onClick={() => setStep((value) => value - 1)}>Previous</button><div><span className={complete ? "complete" : ""}>{complete ? "Required product events received" : "Complete the real action inside the product frame"}</span><button onClick={restart}>Restart</button></div><button disabled={mode !== "GUIDED" || !complete || step === scenes.length - 1} onClick={() => setStep((value) => value + 1)}>Next</button></footer>
  </main>;
}
