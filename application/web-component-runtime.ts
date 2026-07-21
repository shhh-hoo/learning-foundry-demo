import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activityPlanProposals, capabilityVersions, componentVersions } from "@/db/schema";
import type { Actor } from "@/domain/model";
import { DomainInvariantError, requireRole } from "@/domain/invariants";
import { AssetRuntimeRequest } from "@/domain/asset-runtime";
import { WebComponentAssetPackage } from "@/domain/web-component-asset";

/**
 * Converts the learner's exact choice into the immutable package prompt and
 * label. Client-authored prompt/response prose never crosses this boundary.
 */
export async function deriveWebComponentAssetRuntimeRequest(actor: Actor, input: {
  taskId: string;
  episodeId: string;
  activityPlanProposalId: string;
  retryOfDeliveryId?: string;
  selectedChoiceId: string;
  idempotencyKey: string;
}) {
  requireRole(actor, ["LEARNER", "ADMIN"]);
  const [binding] = await getDb().select({ proposal: activityPlanProposals, capabilityVersion: capabilityVersions, componentVersion: componentVersions })
    .from(activityPlanProposals)
    .innerJoin(capabilityVersions, eq(capabilityVersions.id, activityPlanProposals.selectedCapabilityVersionId))
    .innerJoin(componentVersions, eq(componentVersions.id, capabilityVersions.componentAssetVersionId))
    .where(and(
      eq(activityPlanProposals.id, input.activityPlanProposalId),
      eq(activityPlanProposals.institutionId, actor.institutionId),
      eq(activityPlanProposals.taskId, input.taskId),
      eq(activityPlanProposals.episodeId, input.episodeId),
    )).limit(1);
  if (!binding || binding.proposal.state !== "READY" || binding.proposal.resolutionDecision !== "EXISTING"
    || binding.proposal.selectedCapabilityVersionId !== binding.capabilityVersion.id
    || binding.capabilityVersion.componentAssetVersionId !== binding.componentVersion.id
    || binding.componentVersion.status !== "PUBLISHED") {
    throw new DomainInvariantError("Learner ComponentAsset request is not bound to an exact published READY version", "ASSET_RUNTIME_PLAN_NOT_READY");
  }
  const envelope = binding.capabilityVersion.contract as Record<string, unknown>;
  const asset = envelope.componentAsset;
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    throw new DomainInvariantError("Exact CapabilityVersion has no ComponentAsset package", "ASSET_RUNTIME_CONTRACT_INVALID");
  }
  const assetRecord = asset as Record<string, unknown>;
  if (assetRecord.versionId !== binding.componentVersion.id || assetRecord.contentHash !== binding.componentVersion.contentHash) {
    throw new DomainInvariantError("ComponentAsset package lineage changed after exact registration", "ASSET_RUNTIME_CONTRACT_CHANGED");
  }
  const componentPackage = WebComponentAssetPackage.parse(assetRecord.package);
  const selected = componentPackage.choices.find((choice) => choice.id === input.selectedChoiceId);
  if (!selected) throw new DomainInvariantError("Selected choice is not part of the exact ComponentAssetVersion", "ASSET_RUNTIME_INPUT_INVALID");
  return AssetRuntimeRequest.parse({
    taskId: input.taskId,
    episodeId: input.episodeId,
    activityPlanProposalId: input.activityPlanProposalId,
    retryOfDeliveryId: input.retryOfDeliveryId,
    prompt: componentPackage.prompt,
    response: selected.label,
    structuredInput: { selectedChoiceId: selected.id },
    modality: "STRUCTURED",
    idempotencyKey: input.idempotencyKey,
    deadlineMs: 30_000,
  });
}
