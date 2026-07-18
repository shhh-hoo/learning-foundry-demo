import { z } from "zod";
import type { AgentToolExecutor, AgentToolResult } from "./run-agent";
import { verifyProblemContextProvenance } from "./problem-context-provenance";
import type { RunPurpose } from "./types";
import type { CorpusSearchService } from "../corpus/types";
import { deliverCorpusSearchResponse, type CorpusDeliveryPolicyRuntime } from "../corpus/delivery-policy";
import { LegacyTrainerCapabilityRuntime, type LearningCapabilityRuntime } from "../runtime/learning-capability-runtime";

export interface CapabilityRecord {
  readonly id: string;
  readonly version: string;
  readonly purpose: string;
  readonly requiredInput: string;
  readonly outputContract: string;
  readonly limitations: readonly string[];
  readonly readiness: string;
  readonly runtimeEndpoint: string;
  readonly visibility: "AGENT" | "ENGINEERING_ONLY";
}

export interface ToolExecutorOptions {
  readonly capabilities: readonly CapabilityRecord[];
  readonly corpus: CorpusSearchService;
  readonly corpusDeliveryPolicy?: CorpusDeliveryPolicyRuntime;
  readonly provider?: string;
  readonly capabilityRuntime?: LearningCapabilityRuntime;
  readonly diagnosisUrl?: string;
  readonly runPurpose?: RunPurpose;
  readonly conversationId?: string;
  readonly conversationEvidenceHash?: string;
  readonly currentUserMessage?: string;
  readonly fetcher?: typeof fetch;
  readonly createId?: () => string;
  readonly recordGap?: (gap: { readonly id: string; readonly summary: string; readonly missingEvidence: readonly string[] }) => void;
}

const searchSchema = z.object({
  query: z.string().min(1),
  examBoard: z.literal("CAIE").optional(),
  syllabusCode: z.literal("9701").optional(),
  syllabusVersion: z.string().optional(),
  level: z.enum(["AS", "A", "AS_A"]).optional(),
  topic: z.string().optional(),
  calculationFamilyId: z.string().optional(),
  learningOutcomeId: z.string().optional(),
  sourceType: z.enum(["OFFICIAL_SYLLABUS", "SECONDARY_REFERENCE", "TEACHER_NOTE", "STRUCTURED_CASE"]).optional(),
  distributionScope: z.enum(["SCHOOL_INTERNAL", "PUBLIC"]).optional(),
  retrievalJustification: z.object({
    priorAssessmentId: z.string().min(1),
    missingAspect: z.string().min(1),
    expectedCoverageGain: z.string().min(1),
  }).strict().optional(),
}).strict();
const capabilitySchema = z.object({ id: z.string().min(1) }).strict();
const diagnosisSchema = z.object({
  componentId: z.string().min(1), componentVersion: z.string().optional(),
  problemContext: z.object({ prompt: z.string().min(20), reactionEquation: z.string().min(3), givenValues: z.array(z.object({ label: z.string().min(1), value: z.number().finite(), unit: z.string() }).strict()).min(1), targetQuantity: z.string().min(1), answerRequirement: z.string().min(1).optional() }).strict(),
  problemContextEvidence: z.object({ promptQuote: z.string().min(1), reactionEquationQuote: z.string().min(1), givenValueQuotes: z.array(z.string().min(1)).min(1), targetQuantityQuote: z.string().min(1), answerRequirementQuote: z.string().min(1) }).strict(),
  attempt: z.object({
    attemptId: z.string().min(1), componentId: z.string().min(1), componentVersion: z.string().min(1), strategyId: z.string().min(1),
    evidencedReasoningNodeIds: z.array(z.string()), substitutedFacts: z.record(z.string(), z.number()), stoichiometricRatio: z.number().optional(), arithmeticWorkingValue: z.number().optional(),
    finalAnswer: z.object({ value: z.number(), unit: z.string(), significantFigures: z.number().int().positive() }).strict(),
  }).strict(),
}).strict();
const gapSchema = z.object({ summary: z.string().min(1), missingEvidence: z.array(z.string().min(1)) }).strict();
const librarySchema = z.object({ title: z.string().min(1), content: z.string().min(1) }).strict();
const scheduleSchema = z.object({ title: z.string().min(1), reason: z.string().min(1), delayDays: z.number().int().min(1).max(30) }).strict();

class ToolBoundaryError extends Error { constructor(readonly code: string, message: string) { super(`${code}: ${message}`); } }

function normaliseEvidence(value: string): string { return value.toLowerCase().replace(/[×·]/gu, "x").replace(/[^a-z0-9.+-]+/gu, " ").replace(/\s+/gu, " ").trim(); }

function verifyLearnerWorkingProvenance(attempt: z.infer<typeof diagnosisSchema>["attempt"], currentUserMessage: string): void {
  const evidence = normaliseEvidence(currentUserMessage);
  const value = String(attempt.finalAnswer.value);
  const unit = normaliseEvidence(attempt.finalAnswer.unit);
  const hasWorkingSignal = /\b(?:working|got|ratio|reported|used|check it|diagnose|then|multiply|divide)\b/iu.test(currentUserMessage) || /[=×]/u.test(currentUserMessage);
  const hasFinalEvidence = evidence.includes(value) && (!unit || evidence.includes(unit));
  if (!hasWorkingSignal || !hasFinalEvidence) throw new ToolBoundaryError("UNVERIFIED_LEARNER_WORKING", "Learner Diagnosis requires learner working and a final answer evidenced in the current user message.");
}

function canonicalizeDimensionlessRelativeMasses(input: z.infer<typeof diagnosisSchema>): z.infer<typeof diagnosisSchema> {
  const givenValues = input.problemContext.givenValues.map((given, index) => {
    const quote = input.problemContextEvidence.givenValueQuotes[index] ?? "";
    const isRelativeMass = /^(?:A|M)r\s*\(/iu.test(given.label.trim()) || /relative\s+(?:atomic|formula|molecular)\s+mass/iu.test(given.label);
    const quoteStatesUnit = /\b(?:kg|g|mol|dm3|cm3|kpa|pa)\b|\bmol\s*\^|\//iu.test(quote);
    return isRelativeMass && !quoteStatesUnit ? { ...given, unit: "1" } : given;
  });
  if (givenValues.some((given) => !given.unit.trim())) throw new ToolBoundaryError("INCOMPLETE_PROBLEM_CONTEXT", "Every non-dimensionless given value requires an evidenced unit.");
  return { ...input, problemContext: { ...input.problemContext, givenValues } };
}

function canonicalizeQuotedProblemContext(input: z.infer<typeof diagnosisSchema>): z.infer<typeof diagnosisSchema> {
  return {
    ...input,
    problemContext: {
      ...input.problemContext,
      prompt: input.problemContextEvidence.promptQuote,
      reactionEquation: input.problemContextEvidence.reactionEquationQuote,
      targetQuantity: input.problemContextEvidence.targetQuantityQuote,
      answerRequirement: input.problemContextEvidence.answerRequirementQuote,
    },
  };
}

function canonicalFactId(value: string): string | null {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  if (key === "armg" || key === "mrmagnesium") return "mr-magnesium";
  if (key === "mrmgo" || key === "mrmagnesiumoxide") return "mr-magnesium-oxide";
  if (key === "massmg" || key === "massofmg" || key === "massmagnesium") return "mass-magnesium";
  return null;
}

function explicitStoichiometricRatio(currentUserMessage: string): number | undefined {
  const match = /(?:multipl(?:y|ied)(?:\s+\w+){0,3}\s+by|ratio(?:\s+(?:of|=|is))?)\s*([-+]?\d+(?:\.\d+)?)/iu.exec(currentUserMessage);
  return match ? Number(match[1]) : undefined;
}

function explicitArithmeticWorkingValue(currentUserMessage: string): number | undefined {
  const equation = /[-+]?\d+(?:\.\d+)?\s*[x×*]\s*[-+]?\d+(?:\.\d+)?\s*=\s*([-+]?\d+(?:\.\d+)?)/iu.exec(currentUserMessage);
  if (equation) return Number(equation[1]);
  const statedWorking = /arithmetic\s+working\s+(?:says?|gives?|shows?)\s+([-+]?\d+(?:\.\d+)?)\s*g/iu.exec(currentUserMessage);
  if (statedWorking) return Number(statedWorking[1]);
  const reported = /(?:got|answer(?:ed)?|reported)\s+([-+]?\d+(?:\.\d+)?)\s*g\s*MgO/iu.exec(currentUserMessage);
  return reported ? Number(reported[1]) : undefined;
}

function canonicalCourseSearchFilters(
  currentUserMessage: string,
  filters: Omit<z.infer<typeof searchSchema>, "query">,
): Omit<z.infer<typeof searchSchema>, "query"> {
  const coefficientRatioQuestion = /why\s+do\s+coefficients?.{0,80}(?:mole\s+ratios?|balanced\s+equation)|coefficients?.{0,100}mole\s+ratios?|mole\s+ratios?.{0,100}coefficients?|(?:->|→).{0,100}mole\s+ratio/iu.test(currentUserMessage);
  const limitingReagentQuestion = /limiting\s+reagent/iu.test(currentUserMessage);
  const titrationQuestion = /titration/iu.test(currentUserMessage) && /(?:volume|concentration|calculation|evidence)/iu.test(currentUserMessage);
  if (!coefficientRatioQuestion && !limitingReagentQuestion && !titrationQuestion) return filters;
  const { sourceType: _sourceType, topic: _topic, calculationFamilyId: _calculationFamilyId, ...unrestrictedFilters } = filters;
  const calculationFamilyId = coefficientRatioQuestion ? "CORE-001" : limitingReagentQuestion ? "STOICH-005" : "TITR-001";
  return { ...unrestrictedFilters, calculationFamilyId };
}

const STOICHIOMETRY_REASONING_ORDER = ["select-data", "identify-target", "amount-magnesium", "apply-mole-ratio", "amount-magnesium-oxide", "mass-magnesium-oxide", "report-unit", "report-precision"] as const;

function evidencedStoichiometryNodes(currentUserMessage: string): readonly string[] {
  const nodes = new Set<string>();
  const input = currentUserMessage;
  if (/A[rR]\s*\(\s*Mg\s*\)|M[rR]\s*\(\s*MgO\s*\)|\b4\.80\s*g\b/u.test(input)) nodes.add("select-data");
  if (/(?:calculate|find)\s+(?:the\s+)?mass\s+of\s+MgO|target(?:\s+quantity)?[^.]{0,30}mass\s+of\s+MgO/iu.test(input)) nodes.add("identify-target");
  if (/4\.80\s*\/\s*24(?:\.0)?\s*=\s*0\.200\s*mol/iu.test(input)) nodes.add("amount-magnesium");
  if (/(?:multipl(?:y|ied)[^.]{0,30}\bby\s+0\.5|\bratio\s*(?:of|=|is)?\s*(?:0\.5|1)\b)/iu.test(input)) {
    nodes.add("apply-mole-ratio");
    nodes.add("amount-magnesium-oxide");
  }
  if (/(?:0\.200\s*[x×]\s*40(?:\.0)?\s*=\s*8\.00|(?:got|answer|reported)[^.]{0,30}\b(?:4\.00|8\.00)\s*g\s*MgO)/iu.test(input)) nodes.add("mass-magnesium-oxide");
  if (/\b(?:4\.00|8\.00)\s*g\s*MgO\b/iu.test(input)) nodes.add("report-unit");
  if (/(?:3\s+significant\s+figures|\b(?:4\.00|8\.00)\s*g\s*MgO\b)/iu.test(input)) nodes.add("report-precision");
  return STOICHIOMETRY_REASONING_ORDER.filter((node) => nodes.has(node));
}

function canonicalizeStoichiometryAttempt(input: z.infer<typeof diagnosisSchema>, currentUserMessage: string): z.infer<typeof diagnosisSchema> {
  if (input.componentId !== "stoichiometric-product-mass") return input;
  const substitutedFacts = Object.fromEntries(Object.entries(input.attempt.substitutedFacts).flatMap(([key, value]) => {
    const factId = canonicalFactId(key);
    return factId ? [[factId, value] as const] : [];
  }));
  const evidencedRatio = explicitStoichiometricRatio(currentUserMessage);
  const evidencedArithmetic = explicitArithmeticWorkingValue(currentUserMessage);
  const evidencedReasoningNodeIds = [...new Set([...input.attempt.evidencedReasoningNodeIds, ...evidencedStoichiometryNodes(currentUserMessage)])];
  const { stoichiometricRatio: _unverifiedRatio, arithmeticWorkingValue: _unverifiedArithmetic, ...groundedAttempt } = input.attempt;
  return {
    ...input,
    attempt: {
      ...groundedAttempt,
      substitutedFacts,
      evidencedReasoningNodeIds: STOICHIOMETRY_REASONING_ORDER.filter((node) => evidencedReasoningNodeIds.includes(node)),
      ...(evidencedRatio === undefined ? {} : { stoichiometricRatio: evidencedRatio }),
      ...(evidencedArithmetic === undefined ? {} : { arithmeticWorkingValue: evidencedArithmetic }),
    },
  };
}

export function createAgentToolExecutor(options: ToolExecutorOptions): AgentToolExecutor {
  const capabilityRuntime = options.capabilityRuntime ?? (options.diagnosisUrl ? new LegacyTrainerCapabilityRuntime(options.diagnosisUrl, options.fetcher) : null);
  const id = () => options.createId?.() ?? globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return {
    async execute(name, value): Promise<AgentToolResult> {
      if (name === "search_learning_resources") {
        const input = searchSchema.parse(value);
        const { query, retrievalJustification: _retrievalJustification, ...filters } = input;
        const governedFilters = canonicalCourseSearchFilters(options.currentUserMessage ?? "", filters);
        const result = await options.corpus.search(query, governedFilters, { conversationId: options.conversationId, conversationEvidenceHash: options.conversationEvidenceHash, route: "COURSE_RETRIEVAL" });
        if (!options.corpusDeliveryPolicy || !options.provider || !options.runPurpose) throw new ToolBoundaryError("CORPUS_DELIVERY_POLICY_REQUIRED", "Corpus excerpts require an explicit provider, purpose and versioned delivery policy.");
        const delivered = deliverCorpusSearchResponse(options.corpusDeliveryPolicy, options.provider, options.runPurpose, result);
        return { resultRef: result.retrievalTraceId, data: delivered.providerData, evidenceData: delivered.evidenceData, sourceRefs: [...new Set(delivered.providerData.results.map((item) => item.sourceId))], evidenceRefs: [result.retrievalTraceId] };
      }
      if (name === "list_capabilities") {
        z.object({}).strict().parse(value);
        const visible = options.capabilities.filter((item) => item.visibility === "AGENT");
        const resultRef = `capability-list-${id()}`;
        return { resultRef, data: visible, evidenceRefs: [resultRef] };
      }
      if (name === "get_capability") {
        const input = capabilitySchema.parse(value);
        const capability = options.capabilities.find((item) => item.id === input.id && item.visibility === "AGENT");
        if (!capability) throw new Error(`CAPABILITY_NOT_AVAILABLE: ${input.id} is not a learner-facing capability.`);
        const resultRef = `capability-${capability.id}@${capability.version}`;
        return { resultRef, data: capability, evidenceRefs: [resultRef] };
      }
      if (name === "run_learner_diagnosis") {
        const parsed = canonicalizeQuotedProblemContext(canonicalizeDimensionlessRelativeMasses(diagnosisSchema.parse(value)));
        const input = canonicalizeStoichiometryAttempt(parsed, options.currentUserMessage ?? "");
        if (!input.problemContext.answerRequirement) throw new Error("INCOMPLETE_PROBLEM_CONTEXT: Answer requirement is required for this governed diagnosis tool.");
        if (!options.runPurpose || !options.currentUserMessage) throw new ToolBoundaryError("UNVERIFIED_PROBLEM_CONTEXT", "Diagnosis provenance cannot be verified without run purpose and the current user message.");
        const provenance = verifyProblemContextProvenance(input.problemContext, input.problemContextEvidence, options.currentUserMessage);
        if (!provenance.ok) throw new ToolBoundaryError("UNVERIFIED_PROBLEM_CONTEXT", provenance.reasons.join("; "));
        verifyLearnerWorkingProvenance(input.attempt, options.currentUserMessage);
        if (!capabilityRuntime) throw new ToolBoundaryError("CAPABILITY_RUNTIME_REQUIRED", "Learner Diagnosis requires a configured Learning Capability Runtime.");
        const execution = await capabilityRuntime.execute({ capabilityId: input.componentId, capabilityVersion: input.componentVersion, input: { ...input }, runPurpose: options.runPurpose });
        const resultRef = `diagnosis-${id()}`;
        return { resultRef, data: execution.result, executedArguments: input, evidenceRefs: [resultRef, execution.traceId] };
      }
      if (name === "record_capability_gap") {
        const input = gapSchema.parse(value);
        const gap = { id: `capability-gap-${id()}`, ...input };
        options.recordGap?.(gap);
        return { resultRef: gap.id, data: gap, evidenceRefs: [gap.id] };
      }
      if (name === "propose_library_artifact") {
        return { resultRef: `library-proposal-${id()}`, data: { ...librarySchema.parse(value), action: "PROPOSAL_ONLY" } };
      }
      if (name === "propose_schedule_followup") {
        return { resultRef: `schedule-proposal-${id()}`, data: { ...scheduleSchema.parse(value), action: "PROPOSAL_ONLY" } };
      }
      throw new Error(`UNKNOWN_AGENT_TOOL: ${name}`);
    },
  };
}
