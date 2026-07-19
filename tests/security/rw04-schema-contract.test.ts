import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("RW-04 canonical review and Component lifecycle contract", () => {
  it("maps each canonical Class A object without a parallel review model", async () => {
    const schema = await read("../../db/schema.ts");
    for (const table of [
      "component_draft_revisions",
      "component_review_assignments",
      "component_review_comments",
      "component_change_requests",
      "component_review_decisions",
      "component_deprecation_decisions",
      "component_disable_decisions",
      "component_rollback_decisions",
    ]) expect(schema).toContain(`\"${table}\"`);
    expect(schema).toContain("component_version_publication_fact_ck");
    expect(schema).toContain("PRIVATE_INTERNAL");
  });

  it("backfills evaluated drafts and exact RW-03 Evidence references", async () => {
    const migration = await read("../../db/migrations/0005_canonical_review_component_lifecycle.sql");
    expect(migration).toMatch(/status WHEN 'PUBLISHED'[\s\S]*component_evaluations[\s\S]*'READY_FOR_REVIEW'/);
    expect(migration).toContain("jsonb_array_elements(COALESCE(mapped.content->'evidenceRefs','[]'::jsonb))");
    expect(migration).toContain("Component content Evidence reference is outside its tenant/source authority");
    expect(migration).toContain("r.evidence_unit_ids IS DISTINCT FROM ARRAY");
  });

  it("makes evaluation replay state-compatible without duplicating the run", async () => {
    const evaluation = await read("../../application/component-evaluation.ts");
    expect(evaluation).toMatch(/if \(existing\)[\s\S]*existing\.draftRevisionId !== locked\.draftRevisionId/);
    expect(evaluation).toMatch(/if \(existing\)[\s\S]*lifecycleState: \"READY_FOR_REVIEW\"[\s\S]*replayed: true/);
  });

  it("allocates a Component-wide monotonic revision number under the Component lock", async () => {
    const commands = await read("../../application/commands.ts");
    const lockPosition = commands.indexOf("for(\"update\").limit(1)");
    const maximumPosition = commands.indexOf("orderBy(desc(componentDraftRevisions.revisionNumber)");
    expect(lockPosition).toBeGreaterThan(-1);
    expect(maximumPosition).toBeGreaterThan(lockPosition);
    expect(commands).toContain("const nextRevisionNumber = latestRevision.revisionNumber + 1");
    expect(commands).toContain("predecessorRevisionId: currentRevision.id");
    const migration = await read("../../db/migrations/0005_canonical_review_component_lifecycle.sql");
    expect(migration).toContain("p.revision_number<NEW.revision_number");
  });

  it("backfills branches in deterministic graph order and postflights every predecessor", async () => {
    const migration = await read("../../db/migrations/0005_canonical_review_component_lifecycle.sql");
    expect(migration).toContain("WITH RECURSIVE lineage AS");
    expect(migration).toContain("parent.lineage_path||child.id::text");
    expect(migration).toContain("ORDER BY lineage.lineage_path");
    expect(migration).toMatch(/JOIN foundry_product\.component_draft_revisions parent ON parent\.id=child\.predecessor_revision_id[\s\S]*parent\.revision_number>=child\.revision_number/);

    const rehearsal = await read("../../scripts/rehearse-rw04-topological-upgrade.ts");
    expect(rehearsal).toContain("Equal-timestamp branch fixture was not constructed exactly");
    expect(rehearsal).toContain("legacyTimestampOrderWouldViolate: true");
    expect(rehearsal).toContain("exactSuccessorBranchesPreserved: 2");
  });
});
