import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolveComponentExecutorClientConfig } from "@/application/component-executor-client";
import { resolveComponentExecutorServiceConfig } from "@/component-executor/config";
import { EvaluateWebComponentDraftCommand, PreviewWebComponentDraftCommand } from "@/component-executor/protocol";

const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  institutionId: "10000000-0000-4000-8000-000000000002",
  authMethod: "oidc",
  sessionId: "10000000-0000-4000-8000-000000000003",
};
const hash = `sha256:${"a".repeat(64)}`;

describe("separate Component Executor authority boundary", () => {
  it("rejects an executor database credential in product web configuration", () => {
    expect(() => resolveComponentExecutorClientConfig({
      COMPONENT_EXECUTOR_DATABASE_URL: "postgresql://executor:secret@db/foundry",
      COMPONENT_EXECUTOR_SERVICE_URL: "http://127.0.0.1:3202",
      COMPONENT_EXECUTOR_SERVICE_TOKEN: "x".repeat(32),
    })).toThrow(/must not receive COMPONENT_EXECUTOR_DATABASE_URL/);
    expect(resolveComponentExecutorClientConfig({
      COMPONENT_EXECUTOR_SERVICE_URL: "http://127.0.0.1:3202",
      COMPONENT_EXECUTOR_SERVICE_TOKEN: "x".repeat(32),
    })).toMatchObject({ endpoint: "http://127.0.0.1:3202", token: "x".repeat(32) });
  });

  it("requires the database credential only in the separate executor configuration", () => {
    expect(resolveComponentExecutorServiceConfig({
      COMPONENT_EXECUTOR_PRODUCT_DATABASE_URL: "postgresql://product:one@db/foundry",
      COMPONENT_EXECUTOR_DATABASE_URL: "postgresql://executor:two@db/foundry",
      COMPONENT_EXECUTOR_SERVICE_TOKEN: "y".repeat(32),
      COMPONENT_EXECUTOR_PORT: "0",
    })).toMatchObject({ port: 0, token: "y".repeat(32) });
  });

  it("accepts only canonical evaluation and preview facts, never evidence", () => {
    const evaluation = {
      command: "EVALUATE_WEB_COMPONENT_DRAFT",
      actor,
      componentVersionId: "10000000-0000-4000-8000-000000000004",
      expectedContentHash: hash,
    } as const;
    expect(EvaluateWebComponentDraftCommand.parse(evaluation)).toEqual(evaluation);
    expect(() => EvaluateWebComponentDraftCommand.parse({ ...evaluation, systemChecks: [{ status: "PASSED" }] })).toThrow(/Unrecognized key/);

    const preview = {
      command: "PREVIEW_WEB_COMPONENT_DRAFT",
      actor,
      componentId: "10000000-0000-4000-8000-000000000005",
      componentVersionId: evaluation.componentVersionId,
      expectedContentHash: hash,
      selectedChoiceId: "verify-contract",
      idempotencyKey: "cap07-preview:stable",
    } as const;
    expect(PreviewWebComponentDraftCommand.parse(preview)).toEqual(preview);
    for (const fabricated of [
      { runtimeOutput: { correct: true } },
      { eventTrace: [] },
      { executorReceiptHash: hash },
      { status: "SUCCEEDED" },
    ]) expect(() => PreviewWebComponentDraftCommand.parse({ ...preview, ...fabricated })).toThrow(/Unrecognized key/);
  });

  it("keeps raw privileged SQL out of the product client and evidence construction inside the service", async () => {
    const [databaseClient, productSupply, executorService] = await Promise.all([
      readFile(new URL("../../db/client.ts", import.meta.url), "utf8"),
      readFile(new URL("../../application/capability-supply.ts", import.meta.url), "utf8"),
      readFile(new URL("../../component-executor/service.ts", import.meta.url), "utf8"),
    ]);
    expect(databaseClient).not.toContain("withComponentExecutor");
    expect(databaseClient).not.toContain("getComponentExecutorDatabaseUrl");
    expect(databaseClient).not.toContain("COMPONENT_EXECUTOR_DATABASE_URL");
    expect(productSupply).not.toContain("record_web_component_evaluation");
    expect(productSupply).not.toContain("record_component_asset_preview");
    expect(productSupply).not.toContain("executeHashBoundWebComponentAsset");
    expect(executorService).toContain("executeHashBoundWebComponentAsset");
    expect(executorService).toContain("institution_memberships");
    expect(executorService).toContain("course_enrollments");
    expect(executorService).toContain("row.version.contentHash !== command.expectedContentHash");
    expect(executorService).toContain("requireCourseAccess(actor");
  });
});
