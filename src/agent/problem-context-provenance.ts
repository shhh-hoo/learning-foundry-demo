export interface ProblemContextValue { readonly label: string; readonly value: number; readonly unit: string }
export interface ProblemContext {
  readonly prompt: string;
  readonly reactionEquation: string;
  readonly givenValues: readonly ProblemContextValue[];
  readonly targetQuantity: string;
  readonly answerRequirement?: string;
}
export interface ProblemContextEvidence {
  readonly promptQuote: string;
  readonly reactionEquationQuote: string;
  readonly givenValueQuotes: readonly string[];
  readonly targetQuantityQuote: string;
  readonly answerRequirementQuote: string;
}
export type ProblemContextProvenanceResult = { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] };

const subscriptDigits: Readonly<Record<string, string>> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };
function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[₀-₉]/g, (digit) => subscriptDigits[digit] ?? digit).replace(/[→⟶]/g, "->").replace(/\s+/g, " ").trim().toLowerCase();
}
function normalizedEquation(value: string): string { return normalized(value).replace(/\s+/g, ""); }
function isQuoted(source: string, quote: string): boolean { return Boolean(quote.trim()) && source.includes(quote); }
function isDerived(value: string, quote: string): boolean { const expected = normalized(value); const evidence = normalized(quote); return Boolean(expected) && (evidence === expected || evidence.includes(expected)); }
function numberAppears(value: number, quote: string): boolean { return (quote.match(/[-+]?\d+(?:\.\d+)?/g) ?? []).some((token) => Number(token) === value); }
function unitAppears(unit: string, quote: string): boolean { const canonical = normalized(unit); return canonical === "1" || canonical === "unitless" || normalized(quote).includes(canonical); }

export function verifyProblemContextProvenance(problemContext: ProblemContext, evidence: ProblemContextEvidence, currentUserMessage: string): ProblemContextProvenanceResult {
  const reasons: string[] = [];
  const quotes = [evidence.promptQuote, evidence.reactionEquationQuote, ...evidence.givenValueQuotes, evidence.targetQuantityQuote, evidence.answerRequirementQuote];
  quotes.forEach((quote, index) => { if (!isQuoted(currentUserMessage, quote)) reasons.push(`quote[${index}] is not an exact substring of the current user message`); });
  if (!isDerived(problemContext.prompt, evidence.promptQuote)) reasons.push("prompt does not match promptQuote");
  if (normalizedEquation(problemContext.reactionEquation) !== normalizedEquation(evidence.reactionEquationQuote)) reasons.push("reactionEquation does not match reactionEquationQuote");
  if (evidence.givenValueQuotes.length !== problemContext.givenValues.length) reasons.push("givenValueQuotes must map one-to-one to givenValues");
  problemContext.givenValues.forEach((given, index) => {
    const quote = evidence.givenValueQuotes[index] ?? "";
    if (!numberAppears(given.value, quote)) reasons.push(`givenValues[${index}].value is absent from its quote`);
    if (!unitAppears(given.unit, quote)) reasons.push(`givenValues[${index}].unit is absent from its quote`);
  });
  if (!isDerived(problemContext.targetQuantity, evidence.targetQuantityQuote)) reasons.push("targetQuantity does not match targetQuantityQuote");
  if (!problemContext.answerRequirement || !isDerived(problemContext.answerRequirement, evidence.answerRequirementQuote)) reasons.push("answerRequirement does not match answerRequirementQuote");
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
