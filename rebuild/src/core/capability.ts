export interface VersionedIdentity {
  readonly id: string;
  readonly version: string;
}

export interface ContractReference {
  readonly id: string;
  readonly version: string;
}

export interface CapabilityProfile {
  readonly identity: VersionedIdentity;
  readonly title: string;
  readonly purpose: string;
  readonly inputContract?: ContractReference;
  readonly outputContract?: ContractReference;
  readonly limitations: readonly string[];
  readonly availability: "AVAILABLE" | "DISABLED" | "SUPERSEDED";
}

export interface CapabilityCandidate {
  readonly capability: CapabilityProfile;
  readonly eligible: boolean;
  readonly exclusionReasons: readonly string[];
  readonly rationale: string;
}
