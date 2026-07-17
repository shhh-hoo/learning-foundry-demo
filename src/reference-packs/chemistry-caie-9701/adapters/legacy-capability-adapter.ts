import type { CapabilityProfile } from "../../../core/domain/capability";

export interface LegacyAgentCapabilityRecord {
  readonly id: string;
  readonly version: string;
  readonly purpose: string;
  readonly requiredInput: string;
  readonly outputContract: string;
  readonly limitations: readonly string[];
  readonly readiness: string;
  readonly runtimeEndpoint: string;
  readonly visibility: "AGENT" | "ENGINEERING_ONLY";
}

export function adaptLegacyCapability(
  record: LegacyAgentCapabilityRecord,
): { readonly profile: CapabilityProfile; readonly implementation: LegacyAgentCapabilityRecord } {
  return {
    profile: {
      identity: { id: record.id, version: record.version },
      title: record.id,
      purpose: record.purpose,
      inputContract: { id: `${record.id}-input`, version: record.version },
      outputContract: { id: `${record.id}-output`, version: record.version },
      executionKind: "DETERMINISTIC",
      limitations: record.limitations,
    },
    implementation: record,
  };
}
