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

export function parseLegacyAgentCapabilityRecord(value: unknown): LegacyAgentCapabilityRecord {
  if (!value || typeof value !== "object") throw new Error("INVALID_LEGACY_CAPABILITY_BINDING");
  const record = value as Partial<Record<keyof LegacyAgentCapabilityRecord, unknown>>;
  const stringFields = ["id", "version", "purpose", "requiredInput", "outputContract", "readiness", "runtimeEndpoint"] as const;
  if (stringFields.some((field) => typeof record[field] !== "string" || !record[field].trim())
    || !Array.isArray(record.limitations)
    || record.limitations.some((item) => typeof item !== "string")
    || (record.visibility !== "AGENT" && record.visibility !== "ENGINEERING_ONLY")) {
    throw new Error("INVALID_LEGACY_CAPABILITY_BINDING");
  }
  return structuredClone(record) as LegacyAgentCapabilityRecord;
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
