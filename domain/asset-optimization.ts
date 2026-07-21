import { createHash } from "node:crypto";
import { z } from "zod";
import { WebComponentAssetPackage } from "@/domain/web-component-asset";

export const AssetOptimizationDecisionAction = z.enum(["REQUEST_SUCCESSOR", "KEEP_CURRENT"]);
export type AssetOptimizationDecisionAction = z.infer<typeof AssetOptimizationDecisionAction>;

export const ASSET_OPTIMIZATION_RULE = {
  key: "cap08a.incorrect-attempt-distractor-feedback-review",
  version: "1.1.0",
  confidence: 0.35,
} as const;

export const ASSET_OPTIMIZATION_LIMITATIONS = [
  "ONE_ATTEMPT_ONLY",
  "NO_EFFECTIVENESS_CLAIM",
  "NO_CAUSAL_ATTRIBUTION",
  "NO_ROUTING_OPTIMIZATION",
  "NO_LEARNING_STRATEGY_OPTIMIZATION",
  "CURRENT_VERSION_REMAINS_ACTIVE",
] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function assetOptimizationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function assetOptimizationId(namespace: string, value: unknown): string {
  const raw = assetOptimizationHash({ namespace, value }).slice(0, 32).split("");
  raw[12] = "5";
  raw[16] = ((Number.parseInt(raw[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const id = raw.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}

export function deriveAttemptDrivenAssetChange(rawPackage: unknown, selectedChoiceId: string) {
  const componentPackage = WebComponentAssetPackage.parse(rawPackage);
  const selectedChoice = componentPackage.choices.find((choice) => choice.id === selectedChoiceId);
  if (!selectedChoice || selectedChoice.id === componentPackage.correctChoiceId) {
    throw new Error("Asset Optimization requires an incorrect choice declared by the exact ComponentAssetVersion package");
  }
  return {
    optimizationDomain: "ASSET",
    changeKind: "ADD_DISTRACTOR_SPECIFIC_RETRY_FEEDBACK",
    target: "EXACT_COMPONENT_ASSET_SUCCESSOR",
    selectedChoiceId: selectedChoice.id,
    selectedChoiceLabel: selectedChoice.label,
    currentRetryFeedback: componentPackage.retryFeedback,
    description: `Consider a successor that preserves the exact prompt, choices and correct answer, while adding bounded retry feedback specific to the selected incorrect choice “${selectedChoice.label}”. The current exact package exposes one shared retry-feedback message.`,
    currentVersionRemainsActive: true,
    successorCreated: false,
    checksRun: false,
    availabilityChanged: false,
  } as const;
}
