import { describe, expect, it } from "vitest";
import { assertUpgradeDatabaseTarget } from "@/scripts/rehearse-component-upgrade";

describe("Component upgrade rehearsal safety", () => {
  it("refuses remote, misnamed and unapproved PostgreSQL targets", () => {
    const prior = process.env.UPGRADE_REHEARSAL_ALLOWED;
    try {
      delete process.env.UPGRADE_REHEARSAL_ALLOWED;
      expect(() => assertUpgradeDatabaseTarget("postgresql://postgres:postgres@db.example.com/learning_foundry_upgrade_rehearsal")).toThrow(/local/);
      expect(() => assertUpgradeDatabaseTarget("postgresql://postgres:postgres@127.0.0.1/learning_foundry")).toThrow(/named exactly/);
      expect(() => assertUpgradeDatabaseTarget("postgresql://postgres:postgres@127.0.0.1/learning_foundry_upgrade_rehearsal")).toThrow(/UPGRADE_REHEARSAL_ALLOWED/);
      process.env.UPGRADE_REHEARSAL_ALLOWED = "true";
      expect(assertUpgradeDatabaseTarget("postgresql://postgres:postgres@127.0.0.1/learning_foundry_upgrade_rehearsal")).toContain("learning_foundry_upgrade_rehearsal");
    } finally {
      if (prior === undefined) delete process.env.UPGRADE_REHEARSAL_ALLOWED;
      else process.env.UPGRADE_REHEARSAL_ALLOWED = prior;
    }
  });
});
