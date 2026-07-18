import type { AgentRoute } from "../types";
import type { CapabilityIdentity, CapabilityResolutionResult } from "./observability";

interface ResolutionInput {
  readonly route: AgentRoute;
  readonly requestText: string;
  readonly registryEvidenceRef: string;
  readonly registryResult: unknown;
}

const STOP_WORDS = new Set([
  "available", "capability", "capabilities", "current", "diagnose", "diagnosis", "entire",
  "learner", "main", "recommended", "required", "structured", "supported", "tool", "tools", "working",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function identities(value: unknown): readonly CapabilityIdentity[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const capability = record(item);
    if (typeof capability?.id !== "string" || typeof capability.version !== "string") return [];
    const key = `${capability.id}@${capability.version}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: capability.id, version: capability.version }];
  });
}

function normalized(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, " ").trim();
}

function words(value: string): Set<string> {
  return new Set(normalized(value).split(/[\s._-]+/u).filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function explicitReference(value: string): string | null {
  const patterns = [
    /\b([\p{L}][\p{L}\p{N}._-]{1,64})\s+(?:is|as)\s+(?:(?:the|a)\s+)?(?:(?:recommended|main|available|supported)\s+){0,3}capabilit(?:y|ies)\b/iu,
    /\b(?:capability|tool)\s+(?:(?:id|named|called)\s+)["'`]?([\p{L}][\p{L}\p{N}._-]{1,64})/iu,
    /\b(?:run|use)\s+(?:(?:a|the)\s+)?([\p{L}][\p{L}\p{N}._-]{1,64})\s+(?:diagnosis\s+)?tool\b/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return normalized(match[1]);
  }
  return null;
}

function searchableText(value: unknown, identity: CapabilityIdentity): string {
  if (!Array.isArray(value)) return identity.id;
  const item = value.map(record).find((candidate) => candidate?.id === identity.id && candidate.version === identity.version);
  if (!item) return identity.id;
  return [item.id, item.purpose, item.requiredInput, item.outputContract]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

function explicitMatches(reference: string, identity: CapabilityIdentity, value: unknown): boolean {
  const candidate = normalized(searchableText(value, identity));
  return normalized(identity.id) === reference || candidate.split(/[\s._-]+/u).includes(reference);
}

/** Resolves only identities returned by the governed Registry result. */
export class CapabilityResolutionAssessor {
  assess(input: ResolutionInput): CapabilityResolutionResult {
    const returnedCapabilities = identities(input.registryResult);
    const explicit = explicitReference(input.requestText);
    let matchedCapabilities: readonly CapabilityIdentity[] = [];

    if (input.route === "LEARNER_DIAGNOSIS_COMPLETE" && returnedCapabilities.length === 1) {
      matchedCapabilities = returnedCapabilities;
    } else if (explicit) {
      matchedCapabilities = returnedCapabilities.filter((identity) => explicitMatches(explicit, identity, input.registryResult));
    } else {
      const requestWords = words(input.requestText);
      const scored = returnedCapabilities.map((identity) => ({
        identity,
        score: [...words(searchableText(input.registryResult, identity))].filter((token) => requestWords.has(token)).length,
      }));
      const maximum = Math.max(0, ...scored.map((candidate) => candidate.score));
      if (maximum > 0) matchedCapabilities = scored.filter((candidate) => candidate.score === maximum).map((candidate) => candidate.identity);
    }

    if (matchedCapabilities.length === 1) return {
      status: "REQUESTED_CAPABILITY_FOUND",
      registryEvidenceRef: input.registryEvidenceRef,
      returnedCapabilities,
      matchedCapabilities,
    };
    if (explicit && matchedCapabilities.length === 0) return {
      status: "REQUESTED_CAPABILITY_NOT_FOUND",
      registryEvidenceRef: input.registryEvidenceRef,
      returnedCapabilities,
      matchedCapabilities: [],
    };
    return {
      status: "REQUEST_AMBIGUOUS",
      registryEvidenceRef: input.registryEvidenceRef,
      returnedCapabilities,
      matchedCapabilities,
      missingClarification: "Name one requested capability or provide the complete problem and learner Attempt needed to resolve it.",
    };
  }

  executionFailed(failureCode: string): CapabilityResolutionResult {
    return {
      status: "REGISTRY_EXECUTION_FAILED",
      returnedCapabilities: [],
      matchedCapabilities: [],
      failureCode,
    };
  }
}

export function explicitCapabilityReference(value: string): string | null {
  return explicitReference(value);
}
