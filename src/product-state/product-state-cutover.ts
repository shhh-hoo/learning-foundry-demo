import {
  PRODUCT_STATE_IMPORT_DECISION_SCHEMA_VERSION,
  PRODUCT_STATE_SCHEMA_VERSION,
  type CanonicalProductStateRepository,
  type ProductStateActor,
  type ProductStateCutoverAcceptance,
  type ProductStateImportDecision,
  type NoImportRequiredInventoryEvidence,
} from "../core/ports/product-state-repository";
import type { ProductStateMode } from "./product-state-mode";

interface Clock {
  now(): string;
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function requireOperator(actor: ProductStateActor): void {
  if (actor.role !== "SYSTEM") throw new Error("SYSTEM permission required.");
  required(actor.actorId, "CUTOVER_ACTOR_REQUIRED");
}

function evidenceText(evidence: Readonly<Record<string, unknown>>, field: string, code: string): string {
  const value = evidence[field];
  return required(typeof value === "string" ? value : "", code);
}

const SHA256_HEX = /^[0-9a-f]{64}$/u;

function requireNoImportInventoryEvidence(
  evidence: Readonly<Record<string, unknown>>,
  environment: string,
  now: string,
): NoImportRequiredInventoryEvidence {
  const evidenceEnvironment = evidenceText(evidence, "environment", "IMPORT_EVIDENCE_ENVIRONMENT_REQUIRED");
  const scope = evidenceText(evidence, "scope", "IMPORT_EVIDENCE_SCOPE_REQUIRED");
  if (evidenceEnvironment !== environment || scope !== environment) {
    throw new Error("IMPORT_EVIDENCE_SCOPE_MUST_MATCH_ENVIRONMENT");
  }
  if (evidence.evidenceKind !== "LEGACY_STATE_INVENTORY" || evidence.sourceSystem !== "LEGACY_SHOWCASE") {
    throw new Error("LEGACY_STATE_INVENTORY_EVIDENCE_REQUIRED");
  }
  evidenceText(evidence, "inventoryId", "LEGACY_INVENTORY_ID_REQUIRED");
  const sourceSystemScanHash = evidenceText(evidence, "sourceSystemScanHash", "LEGACY_INVENTORY_SCAN_HASH_REQUIRED");
  if (!SHA256_HEX.test(sourceSystemScanHash)) throw new Error("LEGACY_INVENTORY_SCAN_HASH_INVALID");
  if (evidence.recordCount !== 0) throw new Error("LEGACY_INVENTORY_ZERO_RECORD_COUNT_REQUIRED");
  const inventoryTimestamp = evidenceText(evidence, "inventoryTimestamp", "LEGACY_INVENTORY_TIMESTAMP_REQUIRED");
  const inventoryTime = Date.parse(inventoryTimestamp);
  const decisionTime = Date.parse(now);
  if (!Number.isFinite(inventoryTime) || !Number.isFinite(decisionTime) || inventoryTime > decisionTime) {
    throw new Error("LEGACY_INVENTORY_TIMESTAMP_INVALID");
  }
  evidenceText(evidence, "scannerImplementationId", "LEGACY_INVENTORY_SCANNER_ID_REQUIRED");
  evidenceText(evidence, "scannerImplementationVersion", "LEGACY_INVENTORY_SCANNER_VERSION_REQUIRED");
  return structuredClone(evidence) as NoImportRequiredInventoryEvidence;
}

export class ProductStateCutoverService {
  constructor(
    private readonly repository: CanonicalProductStateRepository,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {}

  private async requireNonemptyLegacyImportReceipt(receiptId: string): Promise<void> {
    const receipt = await this.repository.getLegacyImportReceiptById(receiptId);
    if (!receipt
      || !receipt.sourceKey.trim()
      || !receipt.sourceHash.trim()
      || !receipt.importedBy.trim()) {
      throw new Error("VALID_LEGACY_IMPORT_RECEIPT_REQUIRED");
    }
    const importedMessageCount = receipt.details.importedMessageCount;
    if (!Number.isInteger(importedMessageCount) || Number(importedMessageCount) < 1) {
      throw new Error("NONEMPTY_LEGACY_IMPORT_RECEIPT_REQUIRED");
    }
    const importedLoop = await this.repository.getLearningLoop(receipt.taskId);
    if (!importedLoop || importedLoop.conversationEvents.length !== importedMessageCount) {
      throw new Error("LEGACY_IMPORT_RECEIPT_CONTENT_MISMATCH");
    }
  }

  async recordImportDecision(
    actor: ProductStateActor,
    input: {
      readonly decisionId: string;
      readonly environment: string;
      readonly decision: ProductStateImportDecision["decision"];
      readonly evidence: Readonly<Record<string, unknown>>;
    },
  ): Promise<ProductStateImportDecision> {
    requireOperator(actor);
    const environment = required(input.environment, "CUTOVER_ENVIRONMENT_REQUIRED");
    const evidenceEnvironment = evidenceText(input.evidence, "environment", "IMPORT_EVIDENCE_ENVIRONMENT_REQUIRED");
    const scope = evidenceText(input.evidence, "scope", "IMPORT_EVIDENCE_SCOPE_REQUIRED");
    if (evidenceEnvironment !== environment || scope !== environment) {
      throw new Error("IMPORT_EVIDENCE_SCOPE_MUST_MATCH_ENVIRONMENT");
    }
    const receiptId = typeof input.evidence.legacyImportReceiptId === "string"
      ? required(input.evidence.legacyImportReceiptId, "LEGACY_IMPORT_RECEIPT_EVIDENCE_REQUIRED")
      : undefined;
    const decidedAt = this.clock.now();
    if (input.decision === "IMPORT_COMPLETED") {
      if (!receiptId) throw new Error("LEGACY_IMPORT_RECEIPT_EVIDENCE_REQUIRED");
      await this.requireNonemptyLegacyImportReceipt(receiptId);
    } else if (receiptId) {
      throw new Error("LEGACY_IMPORT_RECEIPT_NOT_ALLOWED_FOR_NO_IMPORT_DECISION");
    } else {
      requireNoImportInventoryEvidence(input.evidence, environment, decidedAt);
    }
    const decision: ProductStateImportDecision = {
      schemaVersion: PRODUCT_STATE_IMPORT_DECISION_SCHEMA_VERSION,
      id: required(input.decisionId, "IMPORT_DECISION_ID_REQUIRED"),
      environment,
      scope,
      decision: input.decision,
      ...(receiptId ? { legacyImportReceiptId: receiptId } : {}),
      decidedAt,
      decidedBy: actor.actorId,
      evidence: structuredClone({ ...input.evidence, environment, scope, ...(receiptId ? { legacyImportReceiptId: receiptId } : {}) }),
    };
    await this.repository.recordImportDecision(decision);
    return decision;
  }

  async accept(
    actor: ProductStateActor,
    input: {
      readonly acceptanceId: string;
      readonly environment: string;
      readonly mode: ProductStateMode;
      readonly notes: string;
    },
  ): Promise<ProductStateCutoverAcceptance> {
    requireOperator(actor);
    if (input.mode !== "POSTGRES_CANONICAL") throw new Error("POSTGRES_CANONICAL_MODE_REQUIRED");
    const environment = required(input.environment, "CUTOVER_ENVIRONMENT_REQUIRED");
    if (await this.repository.getCutoverAcceptance(environment)) throw new Error("CUTOVER_ALREADY_ACCEPTED");
    const health = await this.repository.health();
    if (!health.ready || health.readOnly || health.schemaVersion !== "0003") {
      throw new Error("PRODUCT_STATE_DATABASE_NOT_READY");
    }
    const importDecision = await this.repository.getImportDecision(environment);
    if (!importDecision) throw new Error("IMPORT_DECISION_REQUIRED");
    if (importDecision.schemaVersion !== PRODUCT_STATE_IMPORT_DECISION_SCHEMA_VERSION
      || importDecision.environment !== environment
      || importDecision.scope !== environment
      || importDecision.evidence.environment !== environment
      || importDecision.evidence.scope !== environment) {
      throw new Error("IMPORT_DECISION_SCOPE_MISMATCH");
    }
    if (importDecision.decision === "IMPORT_COMPLETED") {
      if (!importDecision.legacyImportReceiptId) throw new Error("LEGACY_IMPORT_RECEIPT_EVIDENCE_REQUIRED");
      await this.requireNonemptyLegacyImportReceipt(importDecision.legacyImportReceiptId);
    } else {
      requireNoImportInventoryEvidence(importDecision.evidence, environment, this.clock.now());
    }
    const acceptance: ProductStateCutoverAcceptance = {
      schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
      id: required(input.acceptanceId, "CUTOVER_ACCEPTANCE_ID_REQUIRED"),
      environment,
      mode: "POSTGRES_CANONICAL",
      acceptedAt: this.clock.now(),
      acceptedBy: actor.actorId,
      migrationVersion: health.schemaVersion,
      databaseReady: true,
      importerDecisionId: importDecision.id,
      dualWrite: false,
      notes: required(input.notes, "CUTOVER_NOTES_REQUIRED"),
    };
    await this.repository.recordCutoverAcceptance(acceptance);
    return acceptance;
  }
}
