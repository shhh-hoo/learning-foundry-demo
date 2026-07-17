import type { CapabilityProfile } from "./capability";
import type { ComponentProfile } from "./component";

export type ReferencePackExtractionStatus =
  | "CURRENT_LEGACY"
  | "REGISTERED"
  | "NOT_EXTRACTED";

export type ReferencePackAssetKind =
  | "CURRICULUM_MAPPING"
  | "TERMINOLOGY"
  | "SOURCE_REGISTRATION"
  | "EVIDENCE_PARSER"
  | "RETRIEVAL_ENRICHER"
  | "CAPABILITY"
  | "COMPONENT"
  | "EVALUATOR"
  | "RENDERER";

export interface ReferencePackAssetOwnership {
  readonly id: string;
  readonly kind: ReferencePackAssetKind;
  readonly status: ReferencePackExtractionStatus;
  readonly legacyPaths: readonly string[];
  readonly removalTarget: string;
}

export interface ReferencePackManifest {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly domains: readonly string[];
  readonly registrationStatus: "REGISTERED";
  readonly ownership: readonly ReferencePackAssetOwnership[];
}

export interface ReferencePackRegistration {
  readonly manifest: ReferencePackManifest;
  readonly capabilities: readonly {
    readonly profile: CapabilityProfile;
    readonly implementation: unknown;
  }[];
  readonly components: readonly {
    readonly profile: ComponentProfile;
    readonly implementation: unknown;
  }[];
}
