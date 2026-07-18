import resourceDocument from "../../config/external-learning-components/resources.json";
import reviewDecisionText from "../../config/external-learning-components/review-decisions.jsonl?raw";
import {
  externalComponentResourceDocumentSchema,
  externalComponentReviewDecisionSchema,
  externalLearningComponentSchema,
} from "./schemas";
import type {
  ExternalComponentReviewDecision,
  ExternalComponentStatus,
  ExternalLearningComponent,
  GovernedExternalLearningComponent,
} from "./types";

export interface ExternalComponentRegistry {
  readonly components: readonly GovernedExternalLearningComponent[];
  get(id: string): GovernedExternalLearningComponent | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function parseReviewDecisionLog(text: string): readonly ExternalComponentReviewDecision[] {
  if (text.trim().length === 0) return [];
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (line.trim().length === 0) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`Invalid review decision JSON at line ${index + 1}.`);
    }
    const parsed = externalComponentReviewDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid review decision at line ${index + 1}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }
    return [parsed.data as ExternalComponentReviewDecision];
  });
}

function statusFromDecision(decision: ExternalComponentReviewDecision): ExternalComponentStatus {
  return decision.status === "REVOKED" ? "DISABLED" : decision.status;
}

function validateApproval(component: ExternalLearningComponent, decision: ExternalComponentReviewDecision): void {
  if (!decision.status.startsWith("APPROVED_")) return;
  const approvals = [decision.rightsDecision, decision.privacyDecision, decision.trackingDecision, decision.accessibilityDecision];
  if (!approvals.every((value) => value === "APPROVED")) {
    throw new Error(`Approved decision ${decision.decisionId} has incomplete review gates.`);
  }
  if (decision.termsEvidence.evidenceRef !== component.rights.termsEvidenceRef) {
    throw new Error(`Approved decision ${decision.decisionId} does not match the resource terms Evidence reference.`);
  }
  if (decision.status === "APPROVED_LINK_ONLY" && (component.integrationMode !== "LINK_ONLY" || !component.launch.url)) {
    throw new Error(`Approved link decision ${decision.decisionId} requires a LINK_ONLY HTTPS resource.`);
  }
  if (decision.status === "APPROVED_EMBED" && component.integrationMode !== "IFRAME") {
    throw new Error(`Approved embed decision ${decision.decisionId} requires an IFRAME resource.`);
  }
  if (decision.status === "APPROVED_PACKAGE" && component.integrationMode !== "REVIEWED_PACKAGE") {
    throw new Error(`Approved package decision ${decision.decisionId} requires a REVIEWED_PACKAGE resource.`);
  }
}

export function deriveExternalComponentRegistry(
  rawComponents: readonly unknown[],
  rawDecisions: readonly unknown[],
): ExternalComponentRegistry {
  const components = rawComponents.map((value, index) => {
    const parsed = externalLearningComponentSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Invalid external resource ${index + 1}: ${parsed.error.message}`);
    return parsed.data as ExternalLearningComponent;
  });
  const decisions = rawDecisions.map((value, index) => {
    const parsed = externalComponentReviewDecisionSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Invalid review decision ${index + 1}: ${parsed.error.message}`);
    return parsed.data as ExternalComponentReviewDecision;
  });

  const componentIds = new Set<string>();
  const providerResourceIds = new Set<string>();
  for (const component of components) {
    if (componentIds.has(component.id)) throw new Error(`Duplicate external component id ${component.id}.`);
    const providerIdentity = `${component.provider}\u0000${component.providerResourceId}`;
    if (providerResourceIds.has(providerIdentity)) throw new Error(`Duplicate provider resource identity for ${component.id}.`);
    componentIds.add(component.id);
    providerResourceIds.add(providerIdentity);
  }

  const decisionsById = new Map<string, ExternalComponentReviewDecision>();
  const historyByComponent = new Map<string, ExternalComponentReviewDecision[]>();
  const componentsById = new Map(components.map((component) => [component.id, component]));
  for (const decision of decisions) {
    if (decisionsById.has(decision.decisionId)) throw new Error(`Duplicate decision id ${decision.decisionId}.`);
    const component = componentsById.get(decision.componentId);
    if (!component || component.version !== decision.componentVersion) {
      throw new Error(`Review decision ${decision.decisionId} references an unknown resource version.`);
    }
    const history = historyByComponent.get(decision.componentId) ?? [];
    const prior = history.at(-1);
    if (prior && Date.parse(decision.reviewedAt) < Date.parse(prior.reviewedAt)) {
      throw new Error(`Review decision ${decision.decisionId} is not append-only chronological history.`);
    }
    if (decision.supersedesDecisionId) {
      const superseded = decisionsById.get(decision.supersedesDecisionId);
      if (!superseded || superseded.componentId !== decision.componentId) {
        throw new Error(`Review decision ${decision.decisionId} has an invalid superseded decision reference.`);
      }
    }
    validateApproval(component, decision);
    decisionsById.set(decision.decisionId, decision);
    historyByComponent.set(decision.componentId, [...history, decision]);
  }

  const governed = components.map((component): GovernedExternalLearningComponent => {
    const history = historyByComponent.get(component.id) ?? [];
    const latestDecision = history.at(-1);
    if (!latestDecision && (component.status.startsWith("APPROVED_") || component.status === "REJECTED")) {
      throw new Error(`External resource ${component.id} requires a review decision for status ${component.status}.`);
    }
    const currentStatus = latestDecision ? statusFromDecision(latestDecision) : component.status;
    const authorizedDeploymentScopes = latestDecision?.status.startsWith("APPROVED_")
      ? [latestDecision.deploymentScope]
      : [];
    return Object.freeze({
      ...clone(component),
      currentStatus,
      latestDecision: latestDecision ? clone(latestDecision) : undefined,
      authorizedDeploymentScopes: Object.freeze(authorizedDeploymentScopes),
    });
  });
  const governedById = new Map(governed.map((component) => [component.id, component]));
  return Object.freeze({
    components: Object.freeze(governed),
    get: (id: string) => governedById.get(id) ?? null,
  });
}

export function loadExternalComponentRegistry(): ExternalComponentRegistry {
  const parsed = externalComponentResourceDocumentSchema.safeParse(resourceDocument);
  if (!parsed.success) throw new Error(`External resource registry is invalid: ${parsed.error.message}`);
  return deriveExternalComponentRegistry(parsed.data.components, parseReviewDecisionLog(reviewDecisionText));
}
