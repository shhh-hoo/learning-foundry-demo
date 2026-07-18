import { describe, expect, it } from "vitest";
import { ProductStateCutoverService } from "../src/product-state/product-state-cutover";
import { LegacyExperienceImporter } from "../src/product-state/legacy-experience-importer";
import { TestProductStateRepository } from "./support/product-state-repository";

const actor = { actorId: "deployment-owner", role: "SYSTEM" } as const;
const noImportEvidence = (environment: string) => ({
  environment,
  scope: environment,
  evidenceKind: "LEGACY_STATE_INVENTORY",
  inventoryId: `inventory:${environment}:2026-07-18`,
  sourceSystem: "LEGACY_SHOWCASE",
  sourceSystemScanHash: "a".repeat(64),
  recordCount: 0,
  inventoryTimestamp: "2026-07-18T11:59:00.000Z",
  scannerImplementationId: "legacy-showcase-inventory",
  scannerImplementationVersion: "1.0.0",
} as const);

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
      evidence: noImportEvidence("ci-integration"),
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
      migrationVersion: "0003",
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

  it("binds IMPORT_COMPLETED to a real nonempty receipt in the same environment scope and verifies it again at acceptance", async () => {
    const repository = new TestProductStateRepository();
    const clock = { now: () => "2026-07-18T12:00:00.000Z" };
    const service = new ProductStateCutoverService(repository, clock);

    await expect(service.recordImportDecision(actor, {
      decisionId: "missing-receipt",
      environment: "canonical-sandbox",
      decision: "IMPORT_COMPLETED",
      evidence: {
        environment: "canonical-sandbox",
        scope: "canonical-sandbox",
        legacyImportReceiptId: "not-real",
      },
    })).rejects.toThrow("VALID_LEGACY_IMPORT_RECEIPT_REQUIRED");

    await expect(service.recordImportDecision(actor, {
      decisionId: "wrong-scope",
      environment: "canonical-sandbox",
      decision: "NO_IMPORT_REQUIRED",
      evidence: { environment: "canonical-sandbox", scope: "another-environment" },
    })).rejects.toThrow("IMPORT_EVIDENCE_SCOPE_MUST_MATCH_ENVIRONMENT");

    await expect(service.recordImportDecision(actor, {
      decisionId: "strings-only-no-import",
      environment: "canonical-sandbox",
      decision: "NO_IMPORT_REQUIRED",
      evidence: { environment: "canonical-sandbox", scope: "canonical-sandbox" },
    })).rejects.toThrow("LEGACY_STATE_INVENTORY_EVIDENCE_REQUIRED");

    const imported = await new LegacyExperienceImporter(repository, clock).import({
      snapshot: {
        conversationId: "legacy-cutover",
        messages: [{ id: "message-cutover", role: "USER", content: "Canonical import evidence" }],
      },
      goal: "Continue imported learning",
      learnerId: "learner-imported",
      importedBy: "migration-operator",
    });
    const decision = await service.recordImportDecision(actor, {
      decisionId: "completed-import",
      environment: "canonical-sandbox",
      decision: "IMPORT_COMPLETED",
      evidence: {
        environment: "canonical-sandbox",
        scope: "canonical-sandbox",
        legacyImportReceiptId: imported.receipt.id,
      },
    });
    expect(decision).toMatchObject({
      schemaVersion: "1.1.0",
      scope: "canonical-sandbox",
      legacyImportReceiptId: imported.receipt.id,
    });

    repository.importReceipts.set("LEGACY_SHOWCASE:legacy-cutover", {
      ...imported.receipt,
      details: { ...imported.receipt.details, importedMessageCount: 0 },
    });
    await expect(service.accept(actor, {
      acceptanceId: "acceptance-with-corrupt-receipt",
      environment: "canonical-sandbox",
      mode: "POSTGRES_CANONICAL",
      notes: "Must recheck receipt content.",
    })).rejects.toThrow("NONEMPTY_LEGACY_IMPORT_RECEIPT_REQUIRED");
  });

  it("revalidates governed zero-record inventory evidence at cutover", async () => {
    const repository = new TestProductStateRepository();
    const service = new ProductStateCutoverService(repository, { now: () => "2026-07-18T12:00:00.000Z" });
    const decision = await service.recordImportDecision(actor, {
      decisionId: "no-import-with-inventory",
      environment: "canonical-empty",
      decision: "NO_IMPORT_REQUIRED",
      evidence: noImportEvidence("canonical-empty"),
    });
    repository.importDecisions.set("canonical-empty", {
      ...decision,
      evidence: { ...decision.evidence, recordCount: 1 },
    });

    await expect(service.accept(actor, {
      acceptanceId: "invalidated-no-import",
      environment: "canonical-empty",
      mode: "POSTGRES_CANONICAL",
      notes: "Must revalidate inventory evidence.",
    })).rejects.toThrow("LEGACY_INVENTORY_ZERO_RECORD_COUNT_REQUIRED");
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

  it("does not let a preserved schema 1.0 decision authorize a new cutover", async () => {
    const repository = new TestProductStateRepository();
    repository.importDecisions.set("legacy-environment", {
      schemaVersion: "1.0.0",
      id: "legacy-import-decision",
      environment: "legacy-environment",
      scope: "legacy-environment",
      decision: "NO_IMPORT_REQUIRED",
      decidedAt: "2026-07-17T00:00:00.000Z",
      decidedBy: "legacy-operator",
      evidence: { environment: "legacy-environment", scope: "legacy-environment" },
    });
    const service = new ProductStateCutoverService(repository, { now: () => "2026-07-18T12:00:00.000Z" });

    await expect(service.accept(actor, {
      acceptanceId: "legacy-decision-acceptance",
      environment: "legacy-environment",
      mode: "POSTGRES_CANONICAL",
      notes: "A schema 1.1 decision is required.",
    })).rejects.toThrow("IMPORT_DECISION_SCOPE_MISMATCH");
  });
});
