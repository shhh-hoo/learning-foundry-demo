import { describe, expect, it } from "vitest";
import { publishedComponents } from "../src/components/published";
import { evaluatePreviewAttempt } from "../src/runtime/preview-adapter";

const mass = publishedComponents[1];

describe("runtime preview adapter", () => {
  it("solves a correct mass attempt", () => {
    expect(evaluatePreviewAttempt(mass, { value: 8, unit: "g", significantFigures: 3, strategy: "CANONICAL" }).decision).toBe("SOLVED");
  });

  it("selects first pedagogical errors deterministically", () => {
    expect(evaluatePreviewAttempt(mass, { value: 8, unit: "g", significantFigures: 3, strategy: "WRONG_RATIO" }).firstFailureCode).toBe("WRONG_STOICHIOMETRIC_RATIO");
    expect(evaluatePreviewAttempt(mass, { value: 8, unit: "kg", significantFigures: 3, strategy: "CANONICAL" }).firstFailureCode).toBe("UNIT_ERROR");
    expect(evaluatePreviewAttempt(mass, { value: 8, unit: "g", significantFigures: 2, strategy: "CANONICAL" }).firstFailureCode).toBe("SIGNIFICANT_FIGURES_ERROR");
  });
});

