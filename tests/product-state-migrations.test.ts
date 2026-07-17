import { describe, expect, it } from "vitest";
import { loadProductStateMigrations } from "../scripts/lib/product-state-migrations";

describe("versioned Product State migrations", () => {
  it("defines explicit canonical tables, state transitions and append-only governance records", async () => {
    const migrations = await loadProductStateMigrations();

    expect(migrations.map((migration) => migration.version)).toEqual(["0001", "0002", "0003"]);
    expect(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.contentHash))).toBe(true);
    const sql = migrations.map((migration) => migration.sql).join("\n");
    for (const table of [
      "learning_task",
      "learning_episode",
      "conversation_event",
      "learner_attempt",
      "diagnostic_observation",
      "teacher_review",
      "retry_attempt",
      "learning_outcome",
      "product_state_decision",
      "outbox_message",
      "legacy_import_receipt",
      "cutover_acceptance",
    ]) {
      expect(sql).toContain(`product_state.${table}`);
    }
    expect(sql).toContain("reject_append_only_mutation");
    expect(sql).toContain("enforce_retry_transition");
    expect(sql).toContain("enforce_attempt_supersession");
    expect(sql).toContain("enforce_teacher_review_chain");
    expect(sql).toContain("enforce_retry_review_and_scope");
    expect(sql).toContain("enforce_import_decision_receipt");
    expect(sql).toContain("cutover_import_scope_guard");
    expect(sql).toContain("CHECK (dual_write = false)");
    expect(sql).not.toContain("runtime_execution");
    expect(sql).not.toContain("external_component_review");
  });
});
