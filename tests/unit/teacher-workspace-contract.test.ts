import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Teacher escalation workspace contract", () => {
  it("queries the latest Review decision with deterministic ordering", async () => {
    const query = await readFile(new URL("../../application/queries.ts", import.meta.url), "utf8");
    expect(query).toContain("AS review_decision");
    expect(query).toMatch(/r\.decision[\s\S]*ORDER BY r\.created_at DESC, r\.id DESC LIMIT 1\) AS review_decision/);
  });

  it("renders terminal escalation before downstream follow-up and Candidate actions", async () => {
    const page = await readFile(new URL("../../app/teacher/page.tsx", import.meta.url), "utf8");
    expect(page).toContain('reviewDecision === "ESCALATE"');
    expect(page).toContain('data-testid="terminal-escalation"');
    expect(page).toMatch(/reviewDecision === "ESCALATE" \? [\s\S]*terminal-escalation[\s\S]* : waitingThread \?[\s\S]* : reviewId && String\(row\.observation_source\) === "CAPABILITY" \? <>[\s\S]*teacherCommandCourseIds\.has[\s\S]*GovernedFollowupForm[\s\S]*<CandidateForm/);
  });

  it("uses honest Component evaluation language for Draft edits", async () => {
    const actions = await readFile(new URL("../../components/ClientActions.tsx", import.meta.url), "utf8");
    expect(actions).toContain("Save Draft and reset Component evaluation");
    expect(actions).not.toContain("Save draft & reset Eval");
  });

  it("shows immutable follow-up contracts and fails closed when the activity mapping is absent", async () => {
    const [page, actions] = await Promise.all([
      readFile(new URL("../../app/teacher/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../components/ClientActions.tsx", import.meta.url), "utf8"),
    ]);
    expect(page).toContain("followup-contract-integrity-error");
    expect(page).not.toContain('activity?.activityType ?? "RETRY"');
    expect(actions).toContain("immutable-transfer-contract");
    expect(actions).toContain("immutable-retention-contract");
    expect(actions).toContain("transferContractConfirmed");
    expect(actions).toContain("Material-difference rationale:");
    expect(actions).toContain("Evidence limit ·");
  });

  it("keeps terminal follow-up history readable while gating human commands to exact course authority", async () => {
    const [teacher, learner, query] = await Promise.all([
      readFile(new URL("../../app/teacher/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../app/learner/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../application/queries.ts", import.meta.url), "utf8"),
    ]);
    expect(teacher).toContain('data-testid="teacher-followup-history"');
    expect(teacher).toContain('data-testid="followup-review-authority-unavailable"');
    expect(teacher).toContain("current TEACHER authority for this exact course is required");
    expect(learner).toContain('data-testid="governed-followup-history"');
    expect(learner).toContain('data-testid="followup-result-review-history"');
    expect(query).toContain("resultReview: teacherReviews");
    expect(query).toContain("capabilityVersionId: capabilityVersions.id");
  });
});
