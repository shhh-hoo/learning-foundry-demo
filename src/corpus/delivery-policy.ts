import { z } from "zod";
import type { RunPurpose } from "../agent/types";
import type { CorpusSearchResponse, CorpusSourceType, DistributionScope } from "./types";

const corpusDeliveryPolicySchema = z.object({
  version: z.string().min(1),
  provider: z.string().min(1),
  allowedPurposes: z.array(z.enum(["PRODUCT", "AGENT_EVAL"])).min(1),
  allowedDistributionScopes: z.array(z.enum(["SCHOOL_INTERNAL", "PUBLIC"])).min(1),
  allowedSourceTypes: z.array(z.enum(["OFFICIAL_SYLLABUS", "SECONDARY_REFERENCE", "TEACHER_NOTE", "STRUCTURED_CASE"])).min(1),
  maxExcerptWordsPerResult: z.number().int().positive(),
  maxResultsPerRequest: z.number().int().positive(),
  allowRawPdfBytes: z.boolean(),
  allowFullDocument: z.boolean(),
  persistDeliveredExcerpt: z.boolean(),
  approvedBy: z.string().min(1),
  approvedAt: z.string().min(1),
}).strict();

export interface CorpusDeliveryPolicy {
  readonly version: string;
  readonly provider: string;
  readonly allowedPurposes: readonly RunPurpose[];
  readonly allowedDistributionScopes: readonly DistributionScope[];
  readonly allowedSourceTypes: readonly CorpusSourceType[];
  readonly maxExcerptWordsPerResult: number;
  readonly maxResultsPerRequest: number;
  readonly allowRawPdfBytes: boolean;
  readonly allowFullDocument: boolean;
  readonly persistDeliveredExcerpt: boolean;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface CorpusDeliveryPolicyRuntime {
  readonly policy: CorpusDeliveryPolicy;
  readonly contentHash: string;
}

export interface DeliveredCorpusSearchResponse {
  readonly providerData: CorpusSearchResponse & { readonly deliveryPolicy: { readonly version: string; readonly contentHash: string } };
  readonly evidenceData: {
    readonly retrievalTraceId: string;
    readonly deliveryPolicy: { readonly version: string; readonly contentHash: string };
    readonly resultCount: number;
    readonly results: readonly {
      readonly chunkId: string;
      readonly sourceId: string;
      readonly sourceType: CorpusSourceType;
      readonly distributionScope: DistributionScope;
      readonly syllabusCode: "9701";
      readonly syllabusVersion?: string;
      readonly learningOutcomeIds: readonly string[];
      readonly calculationFamilyIds: readonly string[];
      readonly page?: number;
      readonly section?: string;
      readonly score: number;
    }[];
  };
}

export class CorpusDeliveryPolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

export function createCorpusDeliveryPolicyRuntime(value: unknown, contentHash: string): CorpusDeliveryPolicyRuntime {
  return { policy: corpusDeliveryPolicySchema.parse(value), contentHash };
}

function capWords(value: string, maximum: number): string {
  return value.trim().split(/\s+/u).filter(Boolean).slice(0, maximum).join(" ");
}

function containsDisallowedPayload(value: unknown): boolean {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  if (typeof value === "string") {
    return /(?:^|\s)(?:file:\/\/|\/(?:Users|home|private|var|tmp)\/|[A-Za-z]:\\)/u.test(value)
      || /(?:^|[\\/])private-sources(?:[\\/]|$)/iu.test(value)
      || /\bBearer\s+\S+/iu.test(value)
      || /\bsk-[A-Za-z0-9_-]{12,}\b/u.test(value);
  }
  if (Array.isArray(value)) return value.some(containsDisallowedPayload);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => (
    /^(?:pdf_?bytes|raw_?pdf|local_?path|source_?path|expectedLocalFilename|authorization|api_?key)$/iu.test(key)
    || containsDisallowedPayload(item)
  ));
}

export function deliverCorpusSearchResponse(
  runtime: CorpusDeliveryPolicyRuntime,
  provider: string,
  purpose: RunPurpose,
  response: CorpusSearchResponse,
): DeliveredCorpusSearchResponse {
  if (provider !== runtime.policy.provider) {
    throw new CorpusDeliveryPolicyError("CORPUS_PROVIDER_NOT_APPROVED", `Provider ${provider} is not approved by delivery policy ${runtime.policy.version}.`);
  }
  if (!runtime.policy.allowedPurposes.includes(purpose)) {
    throw new CorpusDeliveryPolicyError("CORPUS_PURPOSE_NOT_APPROVED", `Purpose ${purpose} is not approved by delivery policy ${runtime.policy.version}.`);
  }
  const unapprovedSourceType = response.results.find((result) => !runtime.policy.allowedSourceTypes.includes(result.sourceType));
  if (unapprovedSourceType) {
    throw new CorpusDeliveryPolicyError("CORPUS_SOURCE_TYPE_NOT_APPROVED", `Source type ${unapprovedSourceType.sourceType} is not approved by delivery policy ${runtime.policy.version}.`);
  }
  const unapprovedScope = response.results.find((result) => !runtime.policy.allowedDistributionScopes.includes(result.distributionScope));
  if (unapprovedScope) {
    throw new CorpusDeliveryPolicyError("CORPUS_DISTRIBUTION_SCOPE_NOT_APPROVED", `Distribution scope ${unapprovedScope.distributionScope} is not approved by delivery policy ${runtime.policy.version}.`);
  }
  if (containsDisallowedPayload(response)) {
    throw new CorpusDeliveryPolicyError("CORPUS_DELIVERY_PAYLOAD_UNSAFE", `Corpus delivery was blocked by policy ${runtime.policy.version}.`);
  }
  const deliveryPolicy = { version: runtime.policy.version, contentHash: runtime.contentHash };
  const results = response.results.slice(0, runtime.policy.maxResultsPerRequest).map((result) => ({
    ...result,
    excerpt: capWords(result.excerpt, runtime.policy.maxExcerptWordsPerResult),
  }));
  return { providerData: {
    ...response,
    results,
    deliveryPolicy,
  }, evidenceData: {
    retrievalTraceId: response.retrievalTraceId,
    deliveryPolicy,
    resultCount: results.length,
    results: results.map((result) => ({
      chunkId: result.chunkId,
      sourceId: result.sourceId,
      sourceType: result.sourceType,
      distributionScope: result.distributionScope,
      syllabusCode: result.syllabusCode,
      ...(result.syllabusVersion ? { syllabusVersion: result.syllabusVersion } : {}),
      learningOutcomeIds: result.learningOutcomeIds,
      calculationFamilyIds: result.calculationFamilyIds,
      ...(result.page !== undefined ? { page: result.page } : {}),
      ...(result.section ? { section: result.section } : {}),
      score: result.score,
    })),
  } };
}
