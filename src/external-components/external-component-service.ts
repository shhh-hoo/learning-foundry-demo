import type { ExternalComponentRegistry } from "./registry";
import type {
  ExternalLaunchDenialReason,
  ExternalLaunchRequestResult,
  ExternalLaunchTelemetryEvent,
  ExternalLaunchTelemetryRepository,
  GovernedExternalLearningComponent,
} from "./types";

interface ExternalComponentServiceDependencies {
  readonly registry: ExternalComponentRegistry;
  readonly telemetryRepository: ExternalLaunchTelemetryRepository;
  readonly open: (url?: string | URL, target?: string, features?: string) => Window | null;
  readonly now?: () => string;
  readonly createRequestId?: () => string;
}

interface ExternalLaunchRequest {
  readonly componentId: string;
  readonly deploymentScope: string;
}

type LaunchAuthorization =
  | { readonly ok: true; readonly component: GovernedExternalLearningComponent; readonly url: string }
  | { readonly ok: false; readonly reason: ExternalLaunchDenialReason };

function defaultRequestId(): string {
  return `external-launch-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

export class ExternalComponentService {
  private readonly registry: ExternalComponentRegistry;
  private readonly telemetryRepository: ExternalLaunchTelemetryRepository;
  private readonly open: ExternalComponentServiceDependencies["open"];
  private readonly now: () => string;
  private readonly createRequestId: () => string;

  constructor(dependencies: ExternalComponentServiceDependencies) {
    this.registry = dependencies.registry;
    this.telemetryRepository = dependencies.telemetryRepository;
    this.open = dependencies.open;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createRequestId = dependencies.createRequestId ?? defaultRequestId;
  }

  private authorize(request: ExternalLaunchRequest): LaunchAuthorization {
    const component = this.registry.get(request.componentId);
    if (!component) return { ok: false, reason: "RESOURCE_NOT_FOUND" };
    if (component.currentStatus !== "APPROVED_LINK_ONLY") return { ok: false, reason: "STATUS_NOT_APPROVED" };
    if (!component.authorizedDeploymentScopes.includes(request.deploymentScope)) return { ok: false, reason: "DEPLOYMENT_SCOPE_NOT_APPROVED" };
    if (component.integrationMode !== "LINK_ONLY") return { ok: false, reason: "INTEGRATION_MODE_NOT_LINK_ONLY" };
    if (!component.launch.url) return { ok: false, reason: "LAUNCH_URL_MISSING" };
    return { ok: true, component, url: component.launch.url };
  }

  async requestLaunch(request: ExternalLaunchRequest): Promise<ExternalLaunchRequestResult> {
    const authorization = this.authorize(request);
    if (!authorization.ok) return { status: "DENIED", reason: authorization.reason };

    const requestId = this.createRequestId();
    const common: Omit<ExternalLaunchTelemetryEvent, "eventId" | "occurredAt" | "type"> = {
      schemaVersion: "1.0.0",
      requestId,
      componentId: authorization.component.id,
      componentVersion: authorization.component.version,
      providerResourceId: authorization.component.providerResourceId,
      deploymentScope: request.deploymentScope,
      outcomeEligible: false,
    };
    await this.telemetryRepository.append({
      ...common,
      eventId: `${requestId}:requested`,
      occurredAt: this.now(),
      type: "LAUNCH_REQUESTED",
    });

    const opened = this.open(authorization.url, "_blank", "noopener,noreferrer");
    const status = opened ? "WINDOW_CREATED" : "POPUP_BLOCKED";
    await this.telemetryRepository.append({
      ...common,
      eventId: `${requestId}:terminal`,
      occurredAt: this.now(),
      type: status,
    });
    return { status, requestId };
  }
}
