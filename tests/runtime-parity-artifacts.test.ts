import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeParityArtifactRepository } from "../scripts/lib/runtime-parity-artifacts";
import type { RuntimeParityReport } from "../src/runtime/runtime-parity";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

function report(): RuntimeParityReport {
  return {
    schemaVersion: "1.0.0",
    reportId: "report-1",
    comparisonMode: "CANDIDATE_SHADOW",
    plan: {
      schemaVersion: "1.0.0",
      planId: "plan-1",
      suiteVersion: "2.0.0",
      selection: { mode: "CHECKPOINT" },
      cases: [{ caseId: "case-1", suiteVersion: "2.0.0", selection: { mode: "CHECKPOINT" }, requiredTools: [], forbiddenTools: [] }],
      createdAt: "2026-07-17T00:00:00.000Z",
    },
    results: [{
      caseId: "case-1",
      classification: "INFRASTRUCTURE_FAILURE",
      authoritative: null,
      candidate: null,
      differences: [{
        field: "terminalError",
        severity: "REGRESSION",
        authoritative: { message: "Bearer secret-token and /Users/person/private-sources/file.pdf", apiKey: "sk-secretsecretsecret" },
        candidate: null,
        message: "preserved",
      }],
      behavioralEquivalence: "NOT_EVALUATED",
      governedQuality: { classification: "NOT_EVALUATED", checks: {} },
      operationalImpact: { classification: "NOT_EVALUATED" },
      reviewRequired: false,
    }],
    counts: { EXACT_MATCH: 0, REVIEW_REQUIRED: 0, REGRESSION: 0, NOT_EXECUTED: 0, INFRASTRUCTURE_FAILURE: 1 },
    behavioralCounts: { EXACT_MATCH: 0, BEHAVIORAL_DIFFERENCE: 0, NOT_EVALUATED: 1 },
    qualityCounts: { QUALITY_MATCH: 0, CANDIDATE_REGRESSION: 0, CANDIDATE_IMPROVEMENT: 0, SHARED_QUALITY_FAILURE: 0, NOT_EVALUATED: 1 },
    operationalCounts: { OPERATIONAL_MATCH: 0, OPERATIONAL_DIFFERENCE: 0, NOT_EVALUATED: 1 },
    reviewRequiredCases: 0,
    coverage: { plannedCases: 1, executedCases: 1, status: "COMPLETE", coverageComplete: true },
    fullSuiteCoverageComplete: false,
    createdAt: "2026-07-17T00:01:00.000Z",
  };
}

describe("runtime parity artifact persistence", () => {
  it("writes role-separated evidence and safely redacts secrets and private paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runtime-parity-")); directories.push(directory);
    const repository = new RuntimeParityArtifactRepository(directory);
    const artifactDirectory = await repository.save(report());

    const names = ["plan.json", "authoritative.json", "candidate.json", "differences.json", "report.json"];
    const contents = await Promise.all(names.map((name) => readFile(join(artifactDirectory, name), "utf8")));
    expect(contents.join("\n")).not.toMatch(/secret-token|sk-secret|private-sources|\/Users\/person/u);
    expect(JSON.parse(contents.at(-1)!)).toMatchObject({ reportId: "report-1", schemaVersion: "1.0.0" });
  });

  it.each(["../escape", ".", ".."])('rejects unsafe report identifier "%s"', async (reportId) => {
    const directory = await mkdtemp(join(tmpdir(), "runtime-parity-")); directories.push(directory);
    await expect(new RuntimeParityArtifactRepository(directory).save({ ...report(), reportId })).rejects.toThrow("INVALID_RUNTIME_PARITY_REPORT_ID");
  });
});
