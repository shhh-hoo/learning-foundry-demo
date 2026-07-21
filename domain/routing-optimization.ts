import { createHash } from "node:crypto";
import { z } from "zod";

export const RoutingOptimizationDecisionAction = z.enum(["REQUEST_POLICY_REVIEW", "KEEP_CURRENT_POLICY"]);
export type RoutingOptimizationDecisionAction = z.infer<typeof RoutingOptimizationDecisionAction>;

export const ROUTING_OPTIMIZATION_RULE = {
  key: "cap08b.teacher-exclusion-selected-route-review",
  version: "1.0.0",
  confidence: 0.55,
} as const;

export const ROUTING_OPTIMIZATION_RATIONALE = "An authenticated teacher explicitly excluded the exact Capability selected by this recorded Resolution for the next cycle. This independent human intervention supports review of selection policy for comparable authorized Context; the Attempt is lineage only and does not establish a routing failure, asset defect, causation, or learning effectiveness.";

export const ROUTING_OPTIMIZATION_LIMITATIONS = [
  "ONE_TEACHER_OVERRIDE_ONLY",
  "ATTEMPT_LINEAGE_NOT_ROUTING_VERDICT",
  "NO_EFFECTIVENESS_CLAIM",
  "NO_CAUSAL_ATTRIBUTION",
  "NO_ASSET_OPTIMIZATION",
  "NO_LEARNING_STRATEGY_OPTIMIZATION",
  "NO_AUTOMATIC_POLICY_CHANGE",
  "CURRENT_POLICY_REMAINS_ACTIVE",
] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function routingOptimizationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function routingOptimizationId(namespace: string, value: unknown): string {
  const raw = routingOptimizationHash({ namespace, value }).slice(0, 32).split("");
  raw[12] = "5";
  raw[16] = ((Number.parseInt(raw[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const id = raw.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}

type RoutingSignal = {
  interventionId: string;
  actionType: string;
  constraintCapabilityId: string;
  reason: string;
};

type QuestionedResolution = {
  id: string;
  policyVersion: string;
  decision: string;
  selectedCapabilityId: string | null;
  selectedCapabilityVersionId: string | null;
  candidates: Array<Record<string, unknown>>;
};

export function deriveTeacherOverrideRoutingChange(signal: RoutingSignal, resolution: QuestionedResolution) {
  if (signal.actionType !== "EXCLUDE_CAPABILITY" || resolution.decision !== "EXISTING"
    || !resolution.selectedCapabilityId || !resolution.selectedCapabilityVersionId
    || signal.constraintCapabilityId !== resolution.selectedCapabilityId) {
    throw new Error("Routing Optimization requires an explicit teacher exclusion of the exact selected Capability");
  }
  const selectedCandidate = resolution.candidates.find((candidate) => (
    candidate.capabilityId === resolution.selectedCapabilityId
    && candidate.versionId === resolution.selectedCapabilityVersionId
    && candidate.eligibility === "ELIGIBLE"
  ));
  if (!selectedCandidate || typeof selectedCandidate.capabilityKey !== "string" || typeof selectedCandidate.version !== "string") {
    throw new Error("Routing Optimization requires the exact eligible selected candidate in the recorded candidate set");
  }
  return {
    optimizationDomain: "ROUTING",
    changeKind: "REVIEW_SELECTION_POLICY_FOR_TEACHER_EXCLUSION",
    target: "CAPABILITY_RESOLUTION_POLICY_SUCCESSOR",
    contextComparisonScope: "COMPARABLE_AUTHORIZED_CONTEXT_ONLY",
    capabilityResolutionId: resolution.id,
    policyVersion: resolution.policyVersion,
    selectedCapabilityId: resolution.selectedCapabilityId,
    selectedCapabilityVersionId: resolution.selectedCapabilityVersionId,
    selectedCapabilityKey: selectedCandidate.capabilityKey,
    selectedCapabilityVersion: selectedCandidate.version,
    teacherInterventionId: signal.interventionId,
    teacherReason: signal.reason,
    description: `Review whether a successor to selection policy ${resolution.policyVersion} should avoid ${selectedCandidate.capabilityKey}@${selectedCandidate.version} for future authorized Contexts comparable to this exact snapshot when the same teacher exclusion applies. The current policy and rankings remain unchanged.`,
    currentPolicyRemainsActive: true,
    rankingChanged: false,
    eligibilityRuleChanged: false,
    automaticApproval: false,
  } as const;
}
