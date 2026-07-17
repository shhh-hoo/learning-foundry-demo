import { describe, expect, it } from "vitest";
import { ProductStateCutoverService } from "../src/product-state/product-state-cutover";
import { TestProductStateRepository } from "./support/product-state-repository";

const actor = { actorId: "deployment-owner", role: "SYSTEM" } as const;

describe("explicit per-environment canonical cutover", () => {
  it("requires readiness and an append-only import/no-import decision before acceptance", async () => {
    const repository = new TestProductStateRepository();
    const service = new ProductStateCutoverService(repository, { now: () => "2026-07-18T12:00:00.000Z" });

    await expect(service.accept(actor, {
      acceptanceId: "acceptance-ci",
      environment: "ci-integration",
      mode: "POSTGRES_CANONICAL",
      notes: "CI canonical state",
    })).rejects.toThrow("IMPORT_DECISION_REQUIRED");

    const decision = await service.recordImportDecision(actor, {
      decisionId: "import-decision-ci",
      environment: "ci-integration",
      decision: "NO_IMPORT_REQUIRED",
      evidence: { reason: "fresh isolated CI database" },
    });
    const acceptance = await service.accept(actor, {
      acceptanceId: "acceptance-ci",
      environment: "ci-integration",
      mode: "POSTGRES_CANONICAL",
      notes: "Migrations and readiness verified.",
    });

    expect(acceptance).toMatchObject({
      environment: "ci-integration",
      mode: "POSTGRES_CANONICAL",
      migrationVersion: "0002",
      databaseReady: true,
      importerDecisionId: decision.id,
      dualWrite: false,
    });
    await expect(service.accept(actor, {
      acceptanceId: "acceptance-ci-duplicate",
      environment: "ci-integration",
      mode: "POSTGRES_CANONICAL",
      notes: "Duplicate",
    })).rejects.toThrow("CUTOVER_ALREADY_ACCEPTED");
  });

  it("does not confuse code availability with Legacy showcase cutover", async () => {
    const service = new ProductStateCutoverService(new TestProductStateRepository(), { now: () => "2026-07-18T12:00:00.000Z" });
    await expect(service.accept(actor, {
      acceptanceId: "legacy-not-cutover",
      environment: "public-showcase",
      mode: "LEGACY_SHOWCASE",
      notes: "No canonical cutover yet.",
    })).rejects.toThrow("POSTGRES_CANONICAL_MODE_REQUIRED");
  });
});
