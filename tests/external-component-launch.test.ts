import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalComponentService } from "../src/external-components/external-component-service";
import { deriveExternalComponentRegistry } from "../src/external-components/registry";
import { BrowserExternalLaunchTelemetryRepository } from "../src/external-components/telemetry-repository";
import type { ExternalComponentReviewDecision, ExternalLearningComponent } from "../src/external-components/types";

function approvedRegistry() {
  const component: ExternalLearningComponent = {
    schemaVersion: "1.0.0",
    id: "reviewed-link",
    version: "1.0.0",
    provider: "Reviewed Provider",
    providerResourceId: "resource-1",
    title: "Reviewed resource",
    description: "Synthetic reviewed fixture.",
    subjects: ["Mathematics"],
    concepts: [],
    curriculumAlignments: [],
    integrationMode: "LINK_ONLY",
    launch: { url: "https://example.edu/activity" },
    rights: { licenseId: "Synthetic", termsEvidenceRef: "terms:1", attribution: "Reviewed Provider", commercialUse: "REVIEW_REQUIRED", modification: "REVIEW_REQUIRED", redistribution: "REVIEW_REQUIRED" },
    privacy: { sendsLearnerData: true, dataCategories: ["NETWORK_METADATA"], destination: "example.edu", cookieOrTrackingStatus: "UNKNOWN", approvalStatus: "REVIEW_REQUIRED" },
    accessibilityNotes: ["Synthetic fixture."],
    evidence: { launchTrace: true, completionSignal: "NONE", outcomeEligible: false },
    status: "REVIEW_REQUIRED",
  };
  const decision: ExternalComponentReviewDecision = {
    schemaVersion: "1.0.0",
    decisionId: "decision-1",
    componentId: component.id,
    componentVersion: component.version,
    reviewer: "synthetic-reviewer",
    reviewedAt: "2026-07-17T00:00:00.000Z",
    termsEvidence: { url: "https://example.edu/terms", evidenceRef: "terms:1", sha256: "a".repeat(64) },
    deploymentScope: "SYNTHETIC_TEST",
    rightsDecision: "APPROVED",
    privacyDecision: "APPROVED",
    trackingDecision: "APPROVED",
    accessibilityDecision: "APPROVED",
    status: "APPROVED_LINK_ONLY",
  };
  return deriveExternalComponentRegistry([component], [decision]);
}

function createService(open: (url?: string | URL, target?: string, features?: string) => Window | null) {
  const repository = new BrowserExternalLaunchTelemetryRepository(window.localStorage);
  const service = new ExternalComponentService({
    registry: approvedRegistry(),
    telemetryRepository: repository,
    open,
    now: () => "2026-07-17T01:00:00.000Z",
    createRequestId: () => "request-1",
  });
  return { repository, service };
}

describe("external component launch governance", () => {
  beforeEach(() => window.localStorage.clear());

  it("appends the governed request before opening and records only window creation", async () => {
    const open = vi.fn(() => ({}) as Window);
    const { repository, service } = createService(open);

    await expect(service.requestLaunch({ componentId: "reviewed-link", deploymentScope: "SYNTHETIC_TEST" })).resolves.toEqual({ status: "WINDOW_CREATED", requestId: "request-1" });
    expect(open).toHaveBeenCalledWith("https://example.edu/activity", "_blank", "noopener,noreferrer");
    expect((await repository.list()).map((event) => event.type)).toEqual(["LAUNCH_REQUESTED", "WINDOW_CREATED"]);
    expect((await repository.list()).every((event) => event.outcomeEligible === false)).toBe(true);
  });

  it("records popup blocking without claiming provider load or engagement", async () => {
    const { repository, service } = createService(vi.fn(() => null));
    await expect(service.requestLaunch({ componentId: "reviewed-link", deploymentScope: "SYNTHETIC_TEST" })).resolves.toEqual({ status: "POPUP_BLOCKED", requestId: "request-1" });
    expect((await repository.list()).at(-1)?.type).toBe("POPUP_BLOCKED");
  });

  it("fails closed on corrupt history before opening a provider", async () => {
    window.localStorage.setItem("learning-foundry.external-launch-telemetry.v1", "not-json");
    const open = vi.fn(() => ({}) as Window);
    const { service } = createService(open);

    await expect(service.requestLaunch({ componentId: "reviewed-link", deploymentScope: "SYNTHETIC_TEST" })).rejects.toThrow(/corrupt launch telemetry/i);
    expect(open).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("learning-foundry.external-launch-telemetry.v1")).toBe("not-json");
  });

  it("rejects deployment mismatches without telemetry or a window", async () => {
    const open = vi.fn(() => ({}) as Window);
    const { repository, service } = createService(open);
    await expect(service.requestLaunch({ componentId: "reviewed-link", deploymentScope: "PUBLIC_SHOWCASE" })).resolves.toEqual({ status: "DENIED", reason: "DEPLOYMENT_SCOPE_NOT_APPROVED" });
    expect(await repository.list()).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it("rejects duplicate event identities without rewriting existing history", async () => {
    const { repository, service } = createService(vi.fn(() => ({}) as Window));
    await service.requestLaunch({ componentId: "reviewed-link", deploymentScope: "SYNTHETIC_TEST" });
    const [first] = await repository.list();

    await expect(repository.append(first!)).rejects.toThrow(/duplicate event id/i);
    expect((await repository.list()).map((event) => event.type)).toEqual(["LAUNCH_REQUESTED", "WINDOW_CREATED"]);
  });
});
