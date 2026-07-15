import { z } from "zod";
import type { AgentToolExecutor, AgentToolResult } from "./run-agent";
import { verifyProblemContextProvenance } from "./problem-context-provenance";
import type { RunPurpose } from "./types";

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

export interface LearningResource {
  readonly origin: "CURATED_LOCAL_RESOURCE";
  readonly sourceId: string;
  readonly title: string;
  readonly excerpt: string;
  readonly syllabusCode: string;
  readonly topic: string;
  readonly keywords: readonly string[];
}

export interface ToolExecutorOptions {
  readonly capabilities: readonly CapabilityRecord[];
  readonly resources: readonly LearningResource[];
  readonly diagnosisUrl: string;
  readonly runPurpose?: RunPurpose;
  readonly currentUserMessage?: string;
  readonly fetcher?: typeof fetch;
  readonly createId?: () => string;
  readonly recordGap?: (gap: { readonly id: string; readonly summary: string; readonly missingEvidence: readonly string[] }) => void;
}

const searchSchema = z.object({ query: z.string().min(1), syllabusCode: z.string().optional(), topic: z.string().optional() }).strict();
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

function words(value: string): readonly string[] { return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2); }

class ToolBoundaryError extends Error { constructor(readonly code: string, message: string) { super(`${code}: ${message}`); } }

export function createAgentToolExecutor(options: ToolExecutorOptions): AgentToolExecutor {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const id = () => options.createId?.() ?? globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return {
    async execute(name, value): Promise<AgentToolResult> {
      if (name === "search_learning_resources") {
        const input = searchSchema.parse(value);
        const queryWords = words(input.query);
        const matches = options.resources.filter((resource) =>
          (!input.syllabusCode || resource.syllabusCode === input.syllabusCode) &&
          (!input.topic || resource.topic.toLowerCase() === input.topic.toLowerCase()) &&
          queryWords.some((word) => `${resource.title} ${resource.excerpt} ${resource.keywords.join(" ")}`.toLowerCase().includes(word)),
        );
        const resultRef = `resource-search-${id()}`;
        return { resultRef, data: matches.map(({ keywords: _keywords, ...resource }) => resource), claimRefs: matches.map((item) => item.sourceId) };
      }
      if (name === "list_capabilities") {
        z.object({}).strict().parse(value);
        const visible = options.capabilities.filter((item) => item.visibility === "AGENT");
        return { resultRef: `capability-list-${id()}`, data: visible };
      }
      if (name === "get_capability") {
        const input = capabilitySchema.parse(value);
        const capability = options.capabilities.find((item) => item.id === input.id && item.visibility === "AGENT");
        if (!capability) throw new Error(`CAPABILITY_NOT_AVAILABLE: ${input.id} is not a learner-facing capability.`);
        return { resultRef: `capability-${capability.id}@${capability.version}`, data: capability };
      }
      if (name === "run_learner_diagnosis") {
        const input = diagnosisSchema.parse(value);
        if (!input.problemContext.answerRequirement) throw new Error("INCOMPLETE_PROBLEM_CONTEXT: Answer requirement is required for this governed diagnosis tool.");
        if (!options.runPurpose || !options.currentUserMessage) throw new ToolBoundaryError("UNVERIFIED_PROBLEM_CONTEXT", "Diagnosis provenance cannot be verified without run purpose and the current user message.");
        const provenance = verifyProblemContextProvenance(input.problemContext, input.problemContextEvidence, options.currentUserMessage);
        if (!provenance.ok) throw new ToolBoundaryError("UNVERIFIED_PROBLEM_CONTEXT", provenance.reasons.join("; "));
        const response = await fetcher(options.diagnosisUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, runPurpose: options.runPurpose }) });
        const body = await response.json() as { readonly ok?: boolean; readonly result?: { readonly traceId?: string }; readonly error?: { readonly code?: string; readonly message?: string } };
        if (!response.ok || !body.ok || !body.result?.traceId) throw new Error(`${body.error?.code ?? "TRAINER_DIAGNOSIS_FAILED"}: ${body.error?.message ?? `HTTP ${response.status}`}`);
        return { resultRef: `diagnosis-${id()}`, data: body.result, claimRefs: [body.result.traceId] };
      }
      if (name === "record_capability_gap") {
        const input = gapSchema.parse(value);
        const gap = { id: `capability-gap-${id()}`, ...input };
        options.recordGap?.(gap);
        return { resultRef: gap.id, data: gap, claimRefs: [gap.id] };
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
