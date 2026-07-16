import { z } from "zod";
import type { AgentToolExecutor, AgentToolResult } from "./run-agent";
import { verifyProblemContextProvenance } from "./problem-context-provenance";
import type { RunPurpose } from "./types";
import type { CorpusSearchService } from "../corpus/types";

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
  readonly diagnosisUrl: string;
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
}).strict();
const capabilitySchema = z.object({ id: z.string().min(1) }).strict();
const diagnosisSchema = z.object({
  componentId: z.string().min(1), componentVersion: z.string().optional(),
  problemContext: z.object({ prompt: z.string().min(20), reactionEquation: z.string().min(3), givenValues: z.array(z.object({ label: z.string().min(1), value: z.number().finite(), unit: z.string().min(1) }).strict()).min(1), targetQuantity: z.string().min(1), answerRequirement: z.string().min(1).optional() }).strict(),
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

export function createAgentToolExecutor(options: ToolExecutorOptions): AgentToolExecutor {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const id = () => options.createId?.() ?? globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return {
    async execute(name, value): Promise<AgentToolResult> {
      if (name === "search_learning_resources") {
        const input = searchSchema.parse(value);
        const { query, ...filters } = input;
        const result = await options.corpus.search(query, filters, { conversationId: options.conversationId, conversationEvidenceHash: options.conversationEvidenceHash, route: "COURSE_RETRIEVAL" });
        return { resultRef: result.retrievalTraceId, data: result, sourceRefs: [...new Set(result.results.map((item) => item.sourceId))], evidenceRefs: [result.retrievalTraceId] };
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
        const input = diagnosisSchema.parse(value);
        if (!input.problemContext.answerRequirement) throw new Error("INCOMPLETE_PROBLEM_CONTEXT: Answer requirement is required for this governed diagnosis tool.");
        if (!options.runPurpose || !options.currentUserMessage) throw new ToolBoundaryError("UNVERIFIED_PROBLEM_CONTEXT", "Diagnosis provenance cannot be verified without run purpose and the current user message.");
        const provenance = verifyProblemContextProvenance(input.problemContext, input.problemContextEvidence, options.currentUserMessage);
        if (!provenance.ok) throw new ToolBoundaryError("UNVERIFIED_PROBLEM_CONTEXT", provenance.reasons.join("; "));
        verifyLearnerWorkingProvenance(input.attempt, options.currentUserMessage);
        const response = await fetcher(options.diagnosisUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, runPurpose: options.runPurpose }) });
        const body = await response.json() as { readonly ok?: boolean; readonly result?: { readonly traceId?: string }; readonly error?: { readonly code?: string; readonly message?: string } };
        if (!response.ok || !body.ok || !body.result?.traceId) throw new Error(`${body.error?.code ?? "TRAINER_DIAGNOSIS_FAILED"}: ${body.error?.message ?? `HTTP ${response.status}`}`);
        const diagnosisBaseUrl = options.diagnosisUrl.replace(/\/diagnose\/?$/u, "");
        const resolution = await fetcher(`${diagnosisBaseUrl}/diagnoses/${encodeURIComponent(body.result.traceId)}`);
        const resolved = await resolution.json() as { readonly ok?: boolean; readonly diagnosis?: { readonly traceId?: string } };
        if (!resolution.ok || !resolved.ok || resolved.diagnosis?.traceId !== body.result.traceId) throw new ToolBoundaryError("UNRESOLVABLE_DIAGNOSIS_TRACE", `Diagnosis trace ${body.result.traceId} did not resolve after persistence.`);
        const resultRef = `diagnosis-${id()}`;
        return { resultRef, data: body.result, evidenceRefs: [resultRef, body.result.traceId] };
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
