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
  readonly inputContract: ContractReference;
  readonly outputContract: ContractReference;
  readonly executionKind:
    | "MODEL"
    | "DETERMINISTIC"
    | "HYBRID"
    | "PRODUCT_ACTION";
  readonly limitations: readonly string[];
}
