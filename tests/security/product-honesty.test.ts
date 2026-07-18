import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { assertE2eDatabaseTarget } from "@/scripts/setup-e2e";

describe("A2a product-honesty surfaces", () => {
  it("refuses unsafe E2E database reset targets", () => {
    const prior = process.env.E2E_RESET_ALLOWED;
    try {
      delete process.env.E2E_RESET_ALLOWED;
      expect(() => assertE2eDatabaseTarget("postgresql://postgres:postgres@db.example.com:5432/learning_foundry_e2e")).toThrow(/local/);
      expect(() => assertE2eDatabaseTarget("postgresql://postgres:postgres@127.0.0.1:5432/learning_foundry")).toThrow(/named exactly learning_foundry_e2e/);
      expect(() => assertE2eDatabaseTarget("postgresql://postgres:postgres@127.0.0.1:5432/learning_foundry_e2e")).toThrow(/E2E_RESET_ALLOWED/);
      process.env.E2E_RESET_ALLOWED = "true";
      expect(assertE2eDatabaseTarget("postgresql://postgres:postgres@127.0.0.1:5432/learning_foundry_e2e")).toContain("learning_foundry_e2e");
    } finally {
      if (prior === undefined) delete process.env.E2E_RESET_ALLOWED;
      else process.env.E2E_RESET_ALLOWED = prior;
    }
  });

  it("aggregates only reviewed CAPABILITY observations with failure codes", async () => {
    const queries = await readFile(new URL("../../application/queries.ts", import.meta.url), "utf8");
    expect(queries.match(/o\.observation_source = 'CAPABILITY'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(queries.match(/o\.failure_code IS NOT NULL/g)?.length).toBeGreaterThanOrEqual(2);
    expect(queries).toContain("o.superseded_by_id IS NULL");
    expect(queries).toContain("current_review.decision IN ('ACCEPT','CORRECT','SUPPLEMENT')");
    expect(queries).toContain("current_review.actor_provenance->>'userId' = current_review.teacher_id::text");
    expect(queries).not.toContain("coalesce(o.failure_code, 'NO_FAILURE')");
  });

  it("discloses enforced Context budgets and answer-level Evidence refs", async () => {
    const learner = await readFile(new URL("../../app/learner/page.tsx", import.meta.url), "utf8");
    const timeline = await readFile(new URL("../../components/ui.tsx", import.meta.url), "utf8");
    expect(learner).toContain("lifecycle and budget enforcement");
    expect(learner).toContain("Token budget · ENFORCED");
    expect(learner).toContain("Modality budget · ENFORCED");
    expect(learner).toContain("model tokens selected");
    expect(learner).toContain("Authorized Evidence catalog");
    expect(learner).toContain("not necessarily used by an answer");
    expect(timeline).toContain("sourceRefs: item.sourceRefs");
    expect(timeline).toContain("This event does not claim Evidence grounding");
  });

  it("uses the same explicit rights approval check for Catalog, retrieval and Library", async () => {
    const queries = await readFile(new URL("../../application/queries.ts", import.meta.url), "utf8");
    const retrieval = await readFile(new URL("../../application/retrieval.ts", import.meta.url), "utf8");
    const commands = await readFile(new URL("../../application/commands.ts", import.meta.url), "utf8");
    expect(queries).toContain('authorizePersistedEvidence(actor, row.source, "LEARNING")');
    expect(retrieval).toContain("authorizePersistedEvidence(input.actor, row, input.purpose)");
    expect(commands).toContain('authorizePersistedEvidence(actor, scope.source, "LEARNING")');
  });

  it("keeps Study Review reminders distinct from governed Retry", async () => {
    const workflow = await readFile(new URL("../../workflows/learner-task.ts", import.meta.url), "utf8");
    const commands = await readFile(new URL("../../application/commands.ts", import.meta.url), "utf8");
    const schema = await readFile(new URL("../../db/schema.ts", import.meta.url), "utf8");
    expect(workflow).toContain('"STUDY_REVIEW"');
    expect(workflow).not.toContain('activityType: "RETRY", dueAt');
    expect(commands).toContain('commandType = "ADD_LIBRARY_ITEM"');
    expect(commands).toContain("learnerId, courseId: input.courseId");
    expect(commands).toContain("existingItem.learnerId !== actor.userId");
    expect(commands).toContain('commandType = "SCHEDULE_STUDY_REVIEW"');
    expect(schema).toContain("schedule_activity_ck");
    expect(schema).toContain("= 'STUDY_REVIEW'");
  });

  it("labels implementation checks without claiming product or learning Eval", async () => {
    const engineering = await readFile(new URL("../../app/engineering/page.tsx", import.meta.url), "utf8");
    const runner = await readFile(new URL("../../evals/run.ts", import.meta.url), "utf8");
    expect(engineering).toContain("Framework/core contract checks");
    expect(engineering).toContain("not product, pedagogy or learning-effectiveness Eval");
    expect(runner).toContain('dataset: "framework-core-contract-checks"');
  });
});
