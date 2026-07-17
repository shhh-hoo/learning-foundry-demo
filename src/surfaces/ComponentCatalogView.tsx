import { useMemo, useState } from "react";
import registryValue from "../../config/external-learning-components/registry.json";
import { createExternalComponentLaunchRecord, createExternalComponentLaunchRepository } from "../external-components/launch-repository";
import { canLaunchExternalComponent, parseExternalComponentRegistry } from "../external-components/registry";
import type { ExternalLearningComponent } from "../external-components/types";

const registry = parseExternalComponentRegistry(registryValue);

function statusText(component: ExternalLearningComponent): string {
  if (component.status === "APPROVED_LINK_ONLY") return "Approved link only";
  if (component.status === "APPROVED_EMBED") return "Approved embed";
  if (component.status === "APPROVED_SELF_HOSTED") return "Approved self-hosted";
  if (component.status === "LICENSE_REVIEW_REQUIRED") return "License review required";
  if (component.status === "REJECTED") return "Rejected";
  return "Discovered";
}

function rightsSummary(component: ExternalLearningComponent): string {
  const commercial = component.rights.commercialUse === "PROHIBITED"
    ? "non-commercial only"
    : component.rights.commercialUse === "LICENSE_REQUIRED"
      ? "commercial license required"
      : component.rights.commercialUse === "ALLOWED"
        ? "commercial use allowed"
        : "commercial use under review";
  return `${component.rights.licenseId} · ${commercial}`;
}

export function ComponentCatalogView() {
  const launchRepository = useMemo(() => createExternalComponentLaunchRepository(window.localStorage), []);
  const subjects = useMemo(() => [...new Set(registry.components.flatMap((component) => component.subjects))].sort(), []);
  const [subject, setSubject] = useState("ALL");
  const [launchCount, setLaunchCount] = useState(() => launchRepository.list().length);
  const components = subject === "ALL" ? registry.components : registry.components.filter((component) => component.subjects.includes(subject));

  function launch(component: ExternalLearningComponent): void {
    if (!canLaunchExternalComponent(component) || !component.launch.url) return;
    launchRepository.append(createExternalComponentLaunchRecord(component));
    setLaunchCount(launchRepository.list().length);
    const opened = window.open(component.launch.url, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  }

  return <main className="product-surface component-catalog-surface">
    <header className="product-header">
      <button className="brand" type="button" onClick={() => { window.location.href = "?view=learner"; }}><span className="brand-mark">LF</span><span>Learning Foundry<small>External Component Catalog</small></span></button>
      <nav aria-label="Component catalog navigation">
        <button type="button" onClick={() => { window.location.href = "?view=learner"; }}>Learner</button>
        <button className="active" type="button">Components</button>
        <button type="button" onClick={() => { window.location.href = "?view=inspector"; }}>Inspector</button>
      </nav>
      <span className="trusted-chip">{launchCount} local launch records</span>
    </header>

    <section className="surface-page">
      <div className="surface-heading">
        <div>
          <p className="surface-kicker">Governed external resources</p>
          <h1>Useful components, without pretending every embed is safe.</h1>
          <p>Launch permission depends on deployment scope, license, privacy and Evidence behavior. A launch record proves only that the learner opened a resource; it is never a Learning Outcome.</p>
        </div>
        <label className="component-catalog-filter">Subject
          <select value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="ALL">All subjects</option>
            {subjects.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <div className="component-catalog-grid">
        {components.map((component) => {
          const launchable = canLaunchExternalComponent(component) && Boolean(component.launch.url);
          return <article key={`${component.id}@${component.version}`} className={launchable ? "component-catalog-card launchable" : "component-catalog-card"}>
            <div className="component-card-heading">
              <div><span className="card-type">{component.provider}</span><h2>{component.title}</h2></div>
              <strong className="status-badge">{statusText(component)}</strong>
            </div>
            <p>{component.description}</p>
            <dl className="component-metadata">
              <div><dt>Concepts</dt><dd>{component.concepts.join(" · ")}</dd></div>
              <div><dt>Alignment</dt><dd>{component.curriculumAlignments.length ? component.curriculumAlignments.join(" · ") : "Not yet mapped"}</dd></div>
              <div><dt>Rights</dt><dd>{rightsSummary(component)}</dd></div>
              <div><dt>Evidence</dt><dd>{component.evidence.completionSignal === "NONE" ? "Launch only; no completion evidence" : `${component.evidence.completionSignal} candidate; Outcome disabled`}</dd></div>
              <div><dt>Attribution</dt><dd>{component.rights.attribution}</dd></div>
            </dl>
            <div className="component-card-actions">
              <button className="primary" type="button" disabled={!launchable} onClick={() => launch(component)}>{launchable ? "Open governed link" : "Unavailable until review"}</button>
              <a href={component.rights.licenseUrl} target="_blank" rel="noreferrer">Review license</a>
            </div>
          </article>;
        })}
      </div>
    </section>
  </main>;
}
