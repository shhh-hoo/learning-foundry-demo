import { useMemo, useState } from "react";
import { ExternalComponentService } from "./external-component-service";
import { loadExternalComponentRegistry, type ExternalComponentRegistry } from "./registry";
import { BrowserExternalLaunchTelemetryRepository } from "./telemetry-repository";
import type { ExternalLaunchRequestResult, GovernedExternalLearningComponent } from "./types";
import "./external-components.css";

interface ExternalComponentCatalogViewProps {
  readonly registry?: ExternalComponentRegistry;
  readonly service?: ExternalComponentService;
  readonly deploymentScope?: string;
}

type CatalogSetup =
  | { readonly registry: ExternalComponentRegistry; readonly service: ExternalComponentService }
  | { readonly error: string };

function statusLabel(status: GovernedExternalLearningComponent["currentStatus"]): string {
  return status.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function isLaunchable(component: GovernedExternalLearningComponent, deploymentScope: string): boolean {
  return component.currentStatus === "APPROVED_LINK_ONLY"
    && component.integrationMode === "LINK_ONLY"
    && component.authorizedDeploymentScopes.includes(deploymentScope);
}

export function ExternalComponentCatalogView({
  registry: providedRegistry,
  service: providedService,
  deploymentScope = "PUBLIC_SHOWCASE",
}: ExternalComponentCatalogViewProps) {
  const setup = useMemo<CatalogSetup>(() => {
    try {
      const registry = providedRegistry ?? loadExternalComponentRegistry();
      const service = providedService ?? new ExternalComponentService({
        registry,
        telemetryRepository: new BrowserExternalLaunchTelemetryRepository(window.localStorage),
        open: (url, target, features) => window.open(url, target, features),
      });
      return { registry, service };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "External component registry unavailable." };
    }
  }, [providedRegistry, providedService]);
  const [result, setResult] = useState<ExternalLaunchRequestResult | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if ("error" in setup) {
    return <main className="product-surface external-catalog-surface"><div className="external-catalog-error" role="alert"><strong>Catalog unavailable</strong><p>{setup.error}</p><p>No provider was opened.</p></div></main>;
  }
  const { registry, service } = setup;

  async function requestLaunch(component: GovernedExternalLearningComponent) {
    setPendingId(component.id);
    setResult(null);
    setLaunchError(null);
    try {
      setResult(await service.requestLaunch({ componentId: component.id, deploymentScope }));
    } catch {
      setLaunchError("Launch failed closed because operational telemetry could not be preserved. No successful provider state is claimed.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="product-surface external-catalog-surface">
      <header className="product-header external-catalog-header">
        <a className="brand" href="?view=components"><span className="brand-mark">LF</span><span>Learning Foundry<small>External learning catalog</small></span></a>
        <nav aria-label="External learning component catalog">
          <a href="?view=learner">Learner</a>
          <a href="?view=studio">Foundry Studio</a>
          <a aria-current="page" href="?view=components">External catalog</a>
        </nav>
        <span className="trusted-chip warning">Disabled by default</span>
      </header>

      <section className="external-catalog-intro">
        <div>
          <p className="surface-kicker">Governed provider resources</p>
          <h1>Useful interactives, without borrowed authority.</h1>
          <p>Every resource needs a resource-specific rights, privacy, tracking, accessibility and deployment review before launch.</p>
        </div>
        <aside>
          <strong>Evidence limit</strong>
          <p>Opening a link is not completion or learning evidence. Launch telemetry is browser-local operational evidence and is never a Learning Outcome.</p>
        </aside>
      </section>

      {result ? <p className="external-launch-result" role="status">{result.status === "DENIED" ? `Launch denied: ${result.reason}` : result.status === "WINDOW_CREATED" ? "A reviewed window was created. Provider load is unverified." : "The reviewed launch request was recorded, but the popup was blocked."}</p> : null}
      {launchError ? <p className="external-launch-result" role="alert">{launchError}</p> : null}

      <section className="external-component-grid" aria-label="External learning resources">
        {registry.components.map((component) => {
          const launchable = isLaunchable(component, deploymentScope);
          return (
            <article key={`${component.id}@${component.version}`}>
              <div className="external-card-heading">
                <span className={`external-status external-status-${component.currentStatus.toLowerCase()}`}>{statusLabel(component.currentStatus)}</span>
                <code>{component.providerResourceId}</code>
              </div>
              <p className="surface-kicker">{component.provider}</p>
              <h2>{component.title}</h2>
              <p>{component.description}</p>
              <dl>
                <div><dt>Mode</dt><dd>{component.integrationMode}</dd></div>
                <div><dt>Tracking</dt><dd>{component.privacy.cookieOrTrackingStatus}</dd></div>
                <div><dt>Outcome eligible</dt><dd>False</dd></div>
              </dl>
              <div className="external-accessibility"><strong>Accessibility</strong><ul>{component.accessibilityNotes.map((note) => <li key={note}>{note}</li>)}</ul></div>
              <p className="external-attribution">Attribution: {component.rights.attribution}</p>
              <button disabled={!launchable || pendingId === component.id} onClick={() => void requestLaunch(component)}>{launchable ? pendingId === component.id ? "Recording request…" : "Open reviewed resource" : statusLabel(component.currentStatus)}</button>
            </article>
          );
        })}
      </section>
    </main>
  );
}
