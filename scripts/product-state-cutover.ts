import { randomUUID } from "node:crypto";
import { ProductStateCutoverService } from "../src/product-state/product-state-cutover";
import { resolveProductStateConfiguration } from "../src/product-state/product-state-mode";
import { createPostgresProductStateRepository } from "../src/product-state/postgres-product-state-repository";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

const configuration = resolveProductStateConfiguration(process.env);
if (configuration.mode !== "POSTGRES_CANONICAL") throw new Error("POSTGRES_CANONICAL_MODE_REQUIRED");
const actor = { actorId: required("PRODUCT_STATE_CUTOVER_ACTOR_ID"), role: "SYSTEM" } as const;
const decisionValue = required("PRODUCT_STATE_IMPORT_DECISION");
if (decisionValue !== "IMPORT_COMPLETED" && decisionValue !== "NO_IMPORT_REQUIRED") {
  throw new Error("INVALID_PRODUCT_STATE_IMPORT_DECISION");
}
const evidence = JSON.parse(required("PRODUCT_STATE_IMPORT_EVIDENCE")) as unknown;
if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error("INVALID_PRODUCT_STATE_IMPORT_EVIDENCE");

const connection = createPostgresProductStateRepository(configuration.databaseUrl);
try {
  const service = new ProductStateCutoverService(connection.repository);
  const decision = await service.recordImportDecision(actor, {
    decisionId: `import-decision:${randomUUID()}`,
    environment: configuration.environment,
    decision: decisionValue,
    evidence: {
      ...(evidence as Record<string, unknown>),
      environment: configuration.environment,
      scope: configuration.environment,
    },
  });
  const acceptance = await service.accept(actor, {
    acceptanceId: `cutover-acceptance:${randomUUID()}`,
    environment: configuration.environment,
    mode: configuration.mode,
    notes: required("PRODUCT_STATE_CUTOVER_NOTES"),
  });
  console.log(JSON.stringify({ ok: true, decision, acceptance }));
} finally {
  await connection.close();
}
