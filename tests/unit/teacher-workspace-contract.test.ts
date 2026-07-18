import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Teacher escalation workspace contract", () => {
  it("queries the latest Review decision with deterministic ordering", async () => {
    const query = await readFile(new URL("../../application/queries.ts", import.meta.url), "utf8");
    expect(query).toContain("AS review_decision");
    expect(query).toMatch(/r\.decision[\s\S]*ORDER BY r\.created_at DESC, r\.id DESC LIMIT 1\) AS review_decision/);
  });

  it("renders terminal escalation before downstream Retry and Candidate actions", async () => {
    const page = await readFile(new URL("../../app/teacher/page.tsx", import.meta.url), "utf8");
    expect(page).toContain('reviewDecision === "ESCALATE"');
    expect(page).toContain('data-testid="terminal-escalation"');
    expect(page).toMatch(/reviewDecision === "ESCALATE" \? [\s\S]*terminal-escalation[\s\S]* : waitingThread \?[\s\S]* : reviewId \? <><RetryForm[\s\S]*<CandidateForm/);
  });

  it("uses structural-preflight language for Draft edits", async () => {
    const actions = await readFile(new URL("../../components/ClientActions.tsx", import.meta.url), "utf8");
    expect(actions).toContain("Save draft & reset structural preflight");
    expect(actions).not.toContain("Save draft & reset Eval");
  });
});
