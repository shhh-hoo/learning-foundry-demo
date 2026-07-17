import { useEffect, useMemo, useRef, useState } from "react";
import { DemoShell } from "./demo/DemoShell";
import { dispatchProductEvent } from "./demo/events";
import { createExperienceRepository } from "./experience/repository";
import { loadPersistedLearningEvidence } from "./experience/persisted-evidence";
import type { ExperienceState, FoundryCandidateHandoff } from "./experience/types";
import { ComponentCatalogView } from "./surfaces/ComponentCatalogView";
import { InspectorView } from "./surfaces/InspectorView";
import { LearnerView } from "./surfaces/LearnerView";
import { StudioView } from "./surfaces/StudioView";

type ProductView = "learner" | "components" | "studio" | "inspector" | "demo";

function viewFromLocation(): ProductView {
  const value = new URLSearchParams(window.location.search).get("view");
  if (value === "components") return "components";
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
    let cancelled = false;
    loadPersistedLearningEvidence().then((evidence) => {
      if (!cancelled) setState((current) => ({ ...current, agentTraces: evidence.agentTraces, diagnoses: evidence.diagnoses }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
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
  if (view === "components") return <ComponentCatalogView />;
  if (view === "studio") return <StudioView state={state} handoff={handoff} onChange={setState} onHandoffChange={setHandoff} initialSection={studioSection()} />;
  if (view === "inspector") return <InspectorView state={state} handoff={handoff} onEvidenceCleared={() => setState((current) => ({ ...current, agentTraces: [], diagnoses: [] }))} />;
  return <LearnerView state={state} onChange={setState} initialSection={learnerSection()} />;
}
