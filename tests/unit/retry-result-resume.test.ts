import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  GovernedFollowupReview,
  GovernedFollowupStart,
  RetentionDeclaration,
  TransferDeclaration,
  transferChangedDimensions,
} from "@/domain/governed-followup";

const source = {
  context: "task:canonical-hash",
  representation: "TEXT",
  itemFamily: "stoichiometry",
  problemStructure: "mole-ratio-v1",
};

describe("CAP-06 governed follow-up boundaries", () => {
  it("does not accept a caller-supplied Transfer source signature", () => {
    const parsed = GovernedFollowupStart.safeParse({
      observationId: "20000000-0000-4000-8000-000000000002",
      reviewId: "30000000-0000-4000-8000-000000000003",
      activityType: "TRANSFER",
      prompt: "Apply the reviewed issue in a materially different structure.",
      assignmentIdempotencyKey: "transfer:one",
      source,
      transfer: {
        target: { ...source, context: "new laboratory context", representation: "STRUCTURED" },
        materialDifferenceRationale: "A new laboratory context changes what the learner must interpret.",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects wording-only Transfer and reports exact changed dimensions", () => {
    const unchanged = {
      source,
      target: source,
      materialDifferenceRationale: "Only the wording has changed; structure is identical.",
      evidenceLimit: "TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN" as const,
    };
    expect(TransferDeclaration.safeParse(unchanged).success).toBe(false);
    const changed = TransferDeclaration.parse({
      ...unchanged,
      target: { ...source, context: "new lab setting", representation: "STRUCTURED" },
    });
    expect(transferChangedDimensions(changed)).toEqual(["context", "representation"]);
  });

  it("limits Transfer to the material context difference the current runtime can deliver", () => {
    const valid = {
      source,
      target: { ...source, context: "laboratory sample comparison", representation: "STRUCTURED" },
      materialDifferenceRationale: "The laboratory context changes the applied setting while preserving the exact callable Capability.",
      evidenceLimit: "TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN" as const,
    };
    expect(TransferDeclaration.safeParse(valid).success).toBe(true);
    expect(TransferDeclaration.safeParse({ ...valid, target: { ...valid.target, representation: "DIAGRAM" } }).success).toBe(false);
    expect(TransferDeclaration.safeParse({ ...valid, target: { ...valid.target, itemFamily: "another-capability" } }).success).toBe(false);
    expect(TransferDeclaration.safeParse({ ...valid, target: { ...valid.target, problemStructure: "another-implementation" } }).success).toBe(false);
  });

  it("does not treat Transfer case or whitespace changes as material differences", () => {
    const formattingOnly = {
      source,
      target: {
        context: "  TASK:CANONICAL-HASH  ",
        representation: " text ",
        itemFamily: "STOICHIOMETRY",
        problemStructure: "  MOLE-RATIO-V1  ",
      },
      materialDifferenceRationale: "Only casing and whitespace differ from the source declaration.",
      evidenceLimit: "TARGET_AUTHENTICATED_TEACHER_DECLARATION_NOT_MACHINE_PROVEN" as const,
    };
    expect(TransferDeclaration.safeParse(formattingOnly).success).toBe(false);
  });

  it("requires the complete Retention delay, exposure, equivalence and assistance declaration", () => {
    expect(RetentionDeclaration.parse({
      declaredDelaySeconds: 86_400,
      scheduledFor: "2026-07-22T08:00:00.000Z",
      interveningExposure: { kind: "NONE_DECLARED", detail: "No related practice was assigned." },
      contentEquivalence: { kind: "EQUIVALENT_FORM", rationale: "Same concept and demand in an equivalent form." },
      assistancePolicy: { kind: "INDEPENDENT", allowed: "No hints or worked examples during the attempt." },
    })).toBeTruthy();
    expect(RetentionDeclaration.safeParse({ declaredDelaySeconds: 86_400, scheduledFor: "2026-07-22T08:00:00.000Z" }).success).toBe(false);
  });

  it("records only TeacherReview fields and rejects Outcome/mastery claims", () => {
    const base = {
      decision: "ACCEPT",
      teachingSupport: "Inspect the new governed result and its exact lineage.",
      reviewIdempotencyKey: "review:one",
    };
    expect(GovernedFollowupReview.safeParse(base).success).toBe(true);
    const retentionReview = GovernedFollowupReview.parse({
      ...base,
      retentionExposure: {
        kind: "RELATED_CONTENT",
        detail: "The learner completed a related ratios exercise during the delay.",
      },
    });
    expect(retentionReview.retentionExposure).toEqual({
      kind: "RELATED_CONTENT",
      detail: "The learner completed a related ratios exercise during the delay.",
    });
    expect(GovernedFollowupReview.parse({ ...base, transferContractConfirmed: true }).transferContractConfirmed).toBe(true);
    expect(GovernedFollowupReview.safeParse({
      ...base,
      retentionExposure: { kind: "UNDECLARED", detail: "Unknown exposure." },
    }).success).toBe(false);
    expect(GovernedFollowupReview.safeParse({
      ...base,
      retentionExposure: { kind: "UNKNOWN", detail: "   " },
    }).success).toBe(false);
    expect(GovernedFollowupReview.safeParse({ ...base, outcomeStatus: "MASTERED" }).success).toBe(false);
    expect(GovernedFollowupReview.safeParse({ ...base, mastery: true }).success).toBe(false);
  });

  it("fails closed for unsupported persisted workflow kinds and never replans terminal activities", async () => {
    const [workflowService, followupService] = await Promise.all([
      readFile(new URL("../../application/workflow-service.ts", import.meta.url), "utf8"),
      readFile(new URL("../../application/governed-followup.ts", import.meta.url), "utf8"),
    ]);
    expect(workflowService).toContain("requireCurrentWorkflowKind(run.workflowKind)");
    expect(workflowService).toContain('if (kind === "COMPONENT_LIFECYCLE")');
    expect(workflowService).toContain("WORKFLOW_KIND_UNSUPPORTED");
    const terminalGuard = followupService.indexOf('if (new Set(["FAILED_FINAL", "CANCELLED"]).has(activity.status)) return activity;');
    const plannerLookup = followupService.indexOf("if (activity.activityPlanProposalId)", terminalGuard);
    expect(terminalGuard).toBeGreaterThan(-1);
    expect(plannerLookup).toBeGreaterThan(terminalGuard);
    expect(followupService).toContain("changes.cancellationState ?? changes.failureState");
    expect(followupService).not.toContain("activity.failureState ? undefined : changes.failureState");
  });
});
