import { describe, expect, it, vi } from "vitest";
import {
  resolveProductStateConfiguration,
  selectProductStateBackend,
} from "../src/product-state/product-state-mode";

describe("Product State mode selection", () => {
  it("requires one explicit valid mode and a database URL only for canonical mode", () => {
    expect(resolveProductStateConfiguration({ PRODUCT_STATE_MODE: "LEGACY_SHOWCASE", FOUNDRY_ENVIRONMENT: "public-showcase" })).toEqual({
      mode: "LEGACY_SHOWCASE",
      environment: "public-showcase",
    });
    expect(() => resolveProductStateConfiguration({ FOUNDRY_ENVIRONMENT: "ci" })).toThrow("PRODUCT_STATE_MODE_REQUIRED");
    expect(() => resolveProductStateConfiguration({ PRODUCT_STATE_MODE: "POSTGRES_CANONICAL", FOUNDRY_ENVIRONMENT: "ci" })).toThrow("PRODUCT_STATE_DATABASE_URL_REQUIRED");
    expect(() => resolveProductStateConfiguration({
      PRODUCT_STATE_MODE: "POSTGRES_CANONICAL",
      PRODUCT_STATE_DATABASE_URL: "postgresql://configured",
      PRODUCT_STATE_DUAL_WRITE: "true",
      FOUNDRY_ENVIRONMENT: "ci",
    })).toThrow("PRODUCT_STATE_DUAL_WRITE_PROHIBITED");
  });

  it("never invokes or falls back to the legacy backend after canonical selection", async () => {
    const legacy = vi.fn(() => ({ authority: "legacy" }));
    const postgres = vi.fn(async () => { throw new Error("DATABASE_UNAVAILABLE"); });
    const configuration = resolveProductStateConfiguration({
      PRODUCT_STATE_MODE: "POSTGRES_CANONICAL",
      PRODUCT_STATE_DATABASE_URL: "postgresql://configured",
      FOUNDRY_ENVIRONMENT: "canonical-sandbox",
    });

    await expect(selectProductStateBackend(configuration, { legacy, postgres })).rejects.toThrow("DATABASE_UNAVAILABLE");
    expect(postgres).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });
});
