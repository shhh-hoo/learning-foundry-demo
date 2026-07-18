export type ExternalComponentIntegrationMode =
  | "LINK_ONLY"
  | "IFRAME"
  | "PROVIDER_API"
  | "REVIEWED_PACKAGE"
  | "LTI_OR_EQUIVALENT";

export type ExternalComponentStatus =
  | "DISCOVERED"
  | "REVIEW_REQUIRED"
  | "APPROVED_LINK_ONLY"
  | "APPROVED_EMBED"
  | "APPROVED_PACKAGE"
  | "DISABLED"
  | "REJECTED";

export interface ExternalLearningComponent {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly version: string;
  readonly provider: string;
  readonly providerResourceId: string;
  readonly title: string;
  readonly description: string;
  readonly subjects: readonly string[];
  readonly concepts: readonly string[];
  readonly curriculumAlignments: readonly string[];
  readonly integrationMode: ExternalComponentIntegrationMode;
  readonly launch: {
    readonly url?: string;
    readonly packageRef?: string;
    readonly apiProvider?: string;
  };
  readonly rights: {
    readonly licenseId: string;
    readonly termsEvidenceRef: string;
    readonly attribution: string;
    readonly commercialUse: "ALLOWED" | "PROHIBITED" | "LICENSE_REQUIRED" | "REVIEW_REQUIRED";
    readonly modification: "ALLOWED" | "PROHIBITED" | "REVIEW_REQUIRED";
    readonly redistribution: "ALLOWED" | "PROHIBITED" | "REVIEW_REQUIRED";
  };
  readonly privacy: {
    readonly sendsLearnerData: boolean;
    readonly dataCategories: readonly string[];
    readonly destination?: string;
    readonly cookieOrTrackingStatus: "NONE_DECLARED" | "PRESENT" | "UNKNOWN";
    readonly approvalStatus: "APPROVED" | "NOT_APPROVED" | "REVIEW_REQUIRED";
  };
  readonly accessibilityNotes: readonly string[];
  readonly evidence: {
    readonly launchTrace: boolean;
    readonly completionSignal: "NONE" | "XAPI" | "LTI" | "PROVIDER_API" | "CUSTOM";
    readonly outcomeEligible: false;
  };
  readonly lastReviewedAt?: string;
  readonly status: ExternalComponentStatus;
}

export type ExternalReviewDecisionStatus =
  | "REVIEW_REQUIRED"
  | "APPROVED_LINK_ONLY"
  | "APPROVED_EMBED"
  | "APPROVED_PACKAGE"
  | "DISABLED"
  | "REJECTED"
  | "REVOKED";

export interface ExternalComponentReviewDecision {
  readonly schemaVersion: "1.0.0";
  readonly decisionId: string;
  readonly componentId: string;
  readonly componentVersion: string;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly termsEvidence: {
    readonly url: string;
    readonly evidenceRef: string;
    readonly sha256: string;
  };
  readonly deploymentScope: string;
  readonly rightsDecision: "APPROVED" | "NOT_APPROVED" | "REVIEW_REQUIRED";
  readonly privacyDecision: "APPROVED" | "NOT_APPROVED" | "REVIEW_REQUIRED";
  readonly trackingDecision: "APPROVED" | "NOT_APPROVED" | "REVIEW_REQUIRED";
  readonly accessibilityDecision: "APPROVED" | "NOT_APPROVED" | "REVIEW_REQUIRED";
  readonly status: ExternalReviewDecisionStatus;
  readonly supersedesDecisionId?: string;
  readonly notes?: string;
}

export interface GovernedExternalLearningComponent extends ExternalLearningComponent {
  readonly currentStatus: ExternalComponentStatus;
  readonly latestDecision?: ExternalComponentReviewDecision;
  readonly authorizedDeploymentScopes: readonly string[];
}

export type ExternalLaunchEventType =
  | "LAUNCH_REQUESTED"
  | "WINDOW_CREATED"
  | "POPUP_BLOCKED";

export interface ExternalLaunchTelemetryEvent {
  readonly schemaVersion: "1.0.0";
  readonly eventId: string;
  readonly requestId: string;
  readonly occurredAt: string;
  readonly type: ExternalLaunchEventType;
  readonly componentId: string;
  readonly componentVersion: string;
  readonly providerResourceId: string;
  readonly deploymentScope: string;
  readonly outcomeEligible: false;
}

export interface ExternalLaunchTelemetryRepository {
  append(event: ExternalLaunchTelemetryEvent): Promise<void>;
  list(): Promise<readonly ExternalLaunchTelemetryEvent[]>;
}

export type ExternalLaunchDenialReason =
  | "RESOURCE_NOT_FOUND"
  | "STATUS_NOT_APPROVED"
  | "DEPLOYMENT_SCOPE_NOT_APPROVED"
  | "INTEGRATION_MODE_NOT_LINK_ONLY"
  | "LAUNCH_URL_MISSING";

export type ExternalLaunchRequestResult =
  | {
      readonly status: "DENIED";
      readonly reason: ExternalLaunchDenialReason;
    }
  | {
      readonly status: "WINDOW_CREATED" | "POPUP_BLOCKED";
      readonly requestId: string;
    };
