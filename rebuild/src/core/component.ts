import type { VersionedIdentity } from "./capability";

export const FOUNDRY_COMPONENT_PROTOCOL_VERSION = "0.1" as const;

export interface WebRuntimeContract {
  readonly type: "web";
  readonly launchUrl: string;
  readonly protocolVersion: typeof FOUNDRY_COMPONENT_PROTOCOL_VERSION;
}

export interface ComponentAssetProfile {
  readonly identity: VersionedIdentity;
  readonly title: string;
  readonly status: "DRAFT" | "APPROVED" | "PUBLISHED" | "DEPRECATED" | "RETIRED";
  readonly capabilityIds: readonly string[];
  readonly contentHash: string;
  readonly runtime: WebRuntimeContract;
  readonly availability: "AVAILABLE" | "DISABLED" | "SUPERSEDED";
}
