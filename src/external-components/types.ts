export type ExternalComponentIntegrationMode =
  | "SELF_HOSTED_PACKAGE"
  | "REMOTE_EMBED"
  | "API_RENDERER"
  | "EXTERNAL_LINK";

export type ExternalComponentCommercialUse =
  | "ALLOWED"
  | "PROHIBITED"
  | "LICENSE_REQUIRED"
  | "REVIEW_REQUIRED";

export type ExternalComponentModification =
  | "ALLOWED"
  | "PROHIBITED"
  | "REVIEW_REQUIRED";

export type ExternalComponentPrivacyApproval =
  | "APPROVED"
  | "NOT_APPROVED"
  | "REVIEW_REQUIRED";

export type ExternalComponentCompletionSignal =
  | "NONE"
  | "XAPI"
  | "LTI"
  | "PROVIDER_API"
  | "CUSTOM";

export type ExternalComponentStatus =
  | "DISCOVERED"
  | "LICENSE_REVIEW_REQUIRED"
  | "APPROVED_LINK_ONLY"
  | "APPROVED_EMBED"
  | "APPROVED_SELF_HOSTED"
  | "REJECTED";

export interface ExternalLearningComponent {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly version: string;
  readonly provider: string;
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
    readonly licenseUrl: string;
    readonly attribution: string;
    readonly commercialUse: ExternalComponentCommercialUse;
    readonly modification: ExternalComponentModification;
  };
  readonly privacy: {
    readonly sendsLearnerData: boolean;
    readonly destination?: string;
    readonly approvalStatus: ExternalComponentPrivacyApproval;
  };
  readonly evidence: {
    readonly launchTrace: boolean;
    readonly completionSignal: ExternalComponentCompletionSignal;
    readonly outcomeEligible: boolean;
  };
  readonly status: ExternalComponentStatus;
}

export interface ExternalLearningComponentRegistry {
  readonly schemaVersion: "1.0.0";
  readonly registryVersion: string;
  readonly reviewedAt: string;
  readonly deploymentScope: "NON_COMMERCIAL_PUBLIC_SHOWCASE";
  readonly components: readonly ExternalLearningComponent[];
}

export interface ExternalComponentLaunchRecord {
  readonly schemaVersion: "1.0.0";
  readonly launchId: string;
  readonly componentId: string;
  readonly componentVersion: string;
  readonly provider: string;
  readonly integrationMode: ExternalComponentIntegrationMode;
  readonly launchedAt: string;
  readonly origin: "USER_ACTION";
  readonly evidenceClass: "SHOWCASE_EXTERNAL_LAUNCH";
  readonly outcomeEligible: false;
}
