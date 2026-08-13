import type { CapabilityProfile } from "../core/capability";
import type { ContextSnapshot } from "../core/context";
import type { LearnerAttempt } from "../core/learning";
import type { ActivityPlan, CapabilityResolution } from "../core/orchestration";

/**
 * Replaceable AI orchestration boundary. The first implementation is Dify.
 * Product State and Component execution remain outside this port.
 */
export interface LearningOrchestrator {
  resolve(input: {
    context: ContextSnapshot;
    availableCapabilities: readonly CapabilityProfile[];
    currentAttempt?: LearnerAttempt;
  }): Promise<CapabilityResolution>;

  plan(input: {
    taskId: string;
    episodeId: string;
    context: ContextSnapshot;
    resolution: CapabilityResolution;
  }): Promise<ActivityPlan>;
}
