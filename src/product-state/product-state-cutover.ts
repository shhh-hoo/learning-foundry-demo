import {
  PRODUCT_STATE_SCHEMA_VERSION,
  type CanonicalProductStateRepository,
  type ProductStateActor,
  type ProductStateCutoverAcceptance,
  type ProductStateImportDecision,
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

export class ProductStateCutoverService {
  constructor(
    private readonly repository: CanonicalProductStateRepository,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {}

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
    if (input.decision === "IMPORT_COMPLETED" && typeof input.evidence.legacyImportReceiptId !== "string") {
      throw new Error("LEGACY_IMPORT_RECEIPT_EVIDENCE_REQUIRED");
    }
    const decision: ProductStateImportDecision = {
      schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
      id: required(input.decisionId, "IMPORT_DECISION_ID_REQUIRED"),
      environment,
      decision: input.decision,
      decidedAt: this.clock.now(),
      decidedBy: actor.actorId,
      evidence: structuredClone(input.evidence),
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
    if (!health.ready || health.readOnly || health.schemaVersion !== "0002") {
      throw new Error("PRODUCT_STATE_DATABASE_NOT_READY");
    }
    const importDecision = await this.repository.getImportDecision(environment);
    if (!importDecision) throw new Error("IMPORT_DECISION_REQUIRED");
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
