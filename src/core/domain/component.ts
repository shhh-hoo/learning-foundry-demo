import type { ContractReference, VersionedIdentity } from "./capability";

export interface ComponentProfile {
  readonly identity: VersionedIdentity;
  readonly title: string;
  readonly status: "DRAFT" | "APPROVED" | "PUBLISHED" | "DEPRECATED" | "RETIRED";
  readonly contract: ContractReference;
  readonly capabilityIds: readonly string[];
  readonly contentHash?: string;
}
