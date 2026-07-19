import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { workflowRuns } from "@/db/schema";
import { DomainInvariantError } from "@/domain/invariants";

export const RESUME_LEASE_MS = 5 * 60 * 1_000;

export type ResumeClaim = {
  runId: string;
  interruptVersion: number;
  token: string;
  version: number;
  expiresAt: Date;
};

type WorkflowRun = typeof workflowRuns.$inferSelect;

function claimIsFresh(run: WorkflowRun, now: Date): boolean {
  const expiresAt = run.resumeLeaseExpiresAt
    ?? (run.resumeClaimedAt ? new Date(run.resumeClaimedAt.getTime() + RESUME_LEASE_MS) : null);
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

export function isRecoverableResumeClaim(run: WorkflowRun, now = new Date()): boolean {
  return run.status === "RESUMING" && !claimIsFresh(run, now);
}

export async function claimWorkflowResume(run: WorkflowRun, expectedInterruptVersion: number, now = new Date()): Promise<ResumeClaim> {
  if (run.interruptVersion !== expectedInterruptVersion) {
    throw new DomainInvariantError("Resume requires the current interrupt version", "RESUME_CONFLICT");
  }
  if (run.status === "RESUMING" && claimIsFresh(run, now)) {
    throw new DomainInvariantError("Workflow resume is already held by an active lease", "WORKFLOW_RESUME_IN_PROGRESS");
  }
  if (run.status !== "INTERRUPTED" && run.status !== "RESUMING") {
    throw new DomainInvariantError("Workflow is not waiting for a recoverable human resume", "WORKFLOW_NOT_INTERRUPTED");
  }

  const token = randomUUID();
  const version = run.resumeClaimVersion + 1;
  const expiresAt = new Date(now.getTime() + RESUME_LEASE_MS);
  const priorToken = run.resumeClaimToken
    ? eq(workflowRuns.resumeClaimToken, run.resumeClaimToken)
    : isNull(workflowRuns.resumeClaimToken);
  const priorExpiry = run.resumeLeaseExpiresAt
    ? lte(workflowRuns.resumeLeaseExpiresAt, now)
    : isNull(workflowRuns.resumeLeaseExpiresAt);
  const statusPredicate = run.status === "INTERRUPTED"
    ? eq(workflowRuns.status, "INTERRUPTED")
    : and(
      eq(workflowRuns.status, "RESUMING"),
      eq(workflowRuns.resumeClaimVersion, run.resumeClaimVersion),
      priorToken,
      priorExpiry,
    );
  const [claimed] = await getDb().update(workflowRuns).set({
    status: "RESUMING",
    resumeClaimedAt: now,
    resumeClaimToken: token,
    resumeClaimVersion: version,
    resumeLeaseExpiresAt: expiresAt,
    failure: null,
    completedAt: null,
  }).where(and(
    eq(workflowRuns.id, run.id),
    eq(workflowRuns.interruptVersion, expectedInterruptVersion),
    statusPredicate,
  )).returning({ id: workflowRuns.id });
  if (!claimed) throw new DomainInvariantError("Resume claim changed before the compare-and-swap completed", "RESUME_CONFLICT");
  return { runId: run.id, interruptVersion: expectedInterruptVersion, token, version, expiresAt };
}

export async function finalizeWorkflowResumeClaim(claim: ResumeClaim, values: Partial<typeof workflowRuns.$inferInsert>, now = new Date()): Promise<void> {
  const [updated] = await getDb().update(workflowRuns).set({
    ...values,
    resumeClaimedAt: null,
    resumeClaimToken: null,
    resumeLeaseExpiresAt: null,
  }).where(and(
    eq(workflowRuns.id, claim.runId),
    eq(workflowRuns.status, "RESUMING"),
    eq(workflowRuns.interruptVersion, claim.interruptVersion),
    eq(workflowRuns.resumeClaimToken, claim.token),
    eq(workflowRuns.resumeClaimVersion, claim.version),
    gt(workflowRuns.resumeLeaseExpiresAt, now),
  )).returning({ id: workflowRuns.id });
  if (!updated) throw new DomainInvariantError("Resume lease was lost before finalization", "WORKFLOW_RESUME_LEASE_LOST");
}
