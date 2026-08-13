import type { CapabilityCandidate, VersionedIdentity } from "./capability";

export type SupplyRecommendation = "PARAMETERIZE" | "COMPOSE" | "ADAPT" | "GENERATE";

export type CapabilityResolutionDecision =
  | {
      readonly type: "SELECT";
      readonly capability: VersionedIdentity;
      readonly parameters: Record<string, unknown>;
    }
  | {
      readonly type: "NO_MATCH";
      readonly recommendedAction: SupplyRecommendation;
    };

/** Structured orchestration output. Dify may produce it; Foundry persists it. */
export interface CapabilityResolution {
  readonly contextSnapshotId: string;
  readonly candidates: readonly CapabilityCandidate[];
  readonly decision: CapabilityResolutionDecision;
  readonly rationale: string;
  readonly teacherReviewRequired: boolean;
}

export interface ActivityPlan {
  readonly id: string;
  readonly taskId: string;
  readonly episodeId: string;
  readonly contextSnapshotId: string;
  readonly status: "READY" | "BLOCKED" | "ESCALATED";
  readonly capability?: VersionedIdentity;
  readonly parameters?: Record<string, unknown>;
  readonly rationale: string;
  readonly createdAt: string;
}
