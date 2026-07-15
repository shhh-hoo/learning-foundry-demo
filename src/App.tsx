import { useEffect, useMemo, useRef, useState } from "react";
import { DemoShell } from "./demo/DemoShell";
import { dispatchProductEvent } from "./demo/events";
import { createExperienceRepository } from "./experience/repository";
import type { ExperienceState, FoundryCandidateHandoff } from "./experience/types";
import { InspectorView } from "./surfaces/InspectorView";
import { LearnerView } from "./surfaces/LearnerView";
import { StudioView } from "./surfaces/StudioView";

type ProductView = "learner" | "studio" | "inspector" | "demo";

function viewFromLocation(): ProductView {
  const value = new URLSearchParams(window.location.search).get("view");
  if (value === "studio" || value === "governance") return "studio";
  if (value === "inspector") return "inspector";
  if (value === "demo") return "demo";
  return "learner";
}

function learnerSection() {
  const value = new URLSearchParams(window.location.search).get("section")?.toUpperCase();
  return value === "LIBRARY" || value === "SCHEDULE" ? value : "CHAT";
}

function studioSection() {
  const value = new URLSearchParams(window.location.search).get("section")?.toUpperCase();
  if (value === "CANDIDATE" || value === "CONTRACT_CHECKS" || value === "REVIEW" || value === "REGISTRY") return value;
  return "PATTERNS";
}

export default function App() {
  const repository = useMemo(() => createExperienceRepository(window.localStorage), []);
  const [view, setView] = useState<ProductView>(viewFromLocation);
  const [state, setState] = useState<ExperienceState>(() => repository.load());
  const [handoff, setHandoff] = useState<FoundryCandidateHandoff | null>(() => repository.loadHandoff());
  const sent = useRef(new Set<string>());

  useEffect(() => {
    const onPopState = () => setView(viewFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => repository.save(state), [repository, state]);
  useEffect(() => {
    if (handoff) repository.saveHandoff(handoff);
    else repository.clearHandoff();
  }, [handoff, repository]);

  useEffect(() => {
    if (view === "demo") return;
    for (const event of state.eventLog) {
      if (sent.current.has(event.eventId)) continue;
      sent.current.add(event.eventId);
      dispatchProductEvent(event);
    }
  }, [state.eventLog, view]);

  if (view === "demo") return <DemoShell />;
  if (view === "studio") return <StudioView state={state} handoff={handoff} onChange={setState} onHandoffChange={setHandoff} initialSection={studioSection()} />;
  if (view === "inspector") return <InspectorView state={state} handoff={handoff} />;
  return <LearnerView state={state} onChange={setState} initialSection={learnerSection()} />;
}
