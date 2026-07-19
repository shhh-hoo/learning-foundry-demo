import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_ATTEMPT_INTERPRETER_MODEL_KWARGS,
  normalizeAttemptInterpretation,
} from "@/application/attempt-interpreter";

const activities = [{
  publicKey: "chemistry-molar-concentration",
  name: "Molar concentration",
  purpose: "Check concentration.",
  fields: [
    { key: "amount", kind: "quantity" as const, unitOptions: ["mol", "mmol"] },
    { key: "volume", kind: "quantity" as const, unitOptions: ["L", "mL", "cm3"] },
    { key: "learnerAnswer", kind: "number" as const },
  ],
}];

describe("DeepSeek Attempt interpreter compatibility", () => {
  it("disables thinking for forced structured extraction", () => {
    expect(DEEPSEEK_ATTEMPT_INTERPRETER_MODEL_KWARGS).toEqual({
      thinking: { type: "disabled" },
    });
  });

  it("splits only explicit allowed quantity units into Pack field keys", () => {
    expect(normalizeAttemptInterpretation({
      status: "MATCHED",
      capabilityPublicKey: "chemistry-molar-concentration",
      fields: { amount: "0.250 mol", volume: "500 cm3", learnerAnswer: "0.500", invented: "1" },
      note: "Mapped explicit values.",
    }, activities).fields).toEqual({
      amount: "0.250",
      amountUnit: "mol",
      volume: "500",
      volumeUnit: "cm3",
      learnerAnswer: "0.500",
    });
  });

  it("removes stray identifiers and values from a safe non-match", () => {
    expect(normalizeAttemptInterpretation({
      status: "AMBIGUOUS",
      capabilityPublicKey: "null",
      fields: { learnerAnswer: "0.25" },
      note: "More than one mapping is plausible.",
    }, activities)).toMatchObject({ capabilityPublicKey: null, fields: {} });
  });
});
