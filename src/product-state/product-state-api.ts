import { z, ZodError } from "zod";
import type {
  CanonicalProductStateRepository,
  ProductStateActor,
} from "../core/ports/product-state-repository";
import { ProductStateService } from "./product-state-service";

export interface ProductStateApiRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface ProductStateApiResponse {
  readonly status: number;
  readonly body: unknown;
}

const artifactReferenceSchema = z.object({
  artifactId: z.string().trim().min(1),
  artifactVersion: z.string().trim().min(1),
  contentHash: z.string().trim().min(1),
});
const sourceReferenceSchema = z.object({
  referenceClass: z.literal("SOURCE"),
  sourceId: z.string().trim().min(1),
  sourceVersion: z.string().trim().min(1).optional(),
});
const evidenceReferenceSchema = z.object({
  referenceClass: z.literal("EVIDENCE"),
  evidenceUnitId: z.string().trim().min(1),
  provenanceId: z.string().trim().min(1),
});
const capabilitySchema = z.object({ id: z.string().trim().min(1), version: z.string().trim().min(1) });
const provenanceSchema = z.object({
  capability: capabilitySchema.optional(),
  executionId: z.string().trim().min(1),
  policyVersion: z.string().trim().min(1),
});
const derivedRepresentationSchema = z.object({
  representationVersion: z.string().trim().min(1),
  derivedAt: z.string().datetime(),
  derivation: z.object({
    kind: z.enum(["MODEL", "DETERMINISTIC", "PROJECTION"]),
    implementationId: z.string().trim().min(1),
    implementationVersion: z.string().trim().min(1),
    sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
  }),
  value: z.unknown(),
});

const createTaskSchema = z.object({
  taskId: z.string().trim().min(1),
  learnerId: z.string().trim().min(1).optional(),
  goal: z.string().trim().min(1),
  materialRefs: z.array(artifactReferenceSchema).default([]),
});
const episodeSchema = z.object({ episodeId: z.string().trim().min(1), taskId: z.string().trim().min(1) });
const eventSchema = z.object({
  eventId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  episodeId: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  payload: z.record(z.string(), z.unknown()),
  artifactRefs: z.array(artifactReferenceSchema).default([]),
  sourceRefs: z.array(sourceReferenceSchema).default([]),
  evidenceRefs: z.array(evidenceReferenceSchema).default([]),
});
const attemptSchema = z.object({
  attemptId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  episodeId: z.string().trim().min(1),
  artifactRefs: z.array(artifactReferenceSchema).default([]),
  evidenceRefs: z.array(evidenceReferenceSchema).default([]),
  capability: capabilitySchema.optional(),
  supersedesAttemptId: z.string().trim().min(1).optional(),
});
const observationBaseSchema = z.object({
  observationId: z.string().trim().min(1),
  sourceRefs: z.array(sourceReferenceSchema).default([]),
  evidenceRefs: z.array(evidenceReferenceSchema).default([]),
  provenance: provenanceSchema,
  diagnosisPayload: derivedRepresentationSchema,
});
const observationSchema = observationBaseSchema.extend({ attemptId: z.string().trim().min(1) });
const reviewSchema = z.object({
  reviewId: z.string().trim().min(1),
  observationId: z.string().trim().min(1),
  decision: z.enum(["ACCEPT", "CORRECT", "ESCALATE"]),
  rationale: z.string().trim().min(1),
  evidenceRefs: z.array(evidenceReferenceSchema).default([]),
  supersedesReviewId: z.string().trim().min(1).optional(),
  correction: z.object({ correctionId: z.string().trim().min(1), reason: z.string().trim().min(1) }).optional(),
});
const retrySchema = z.object({
  retryAttemptId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  episodeId: z.string().trim().min(1),
  originalAttemptId: z.string().trim().min(1),
  reviewId: z.string().trim().min(1),
});
const retrySubmissionSchema = z.object({
  attemptId: z.string().trim().min(1),
  artifactRefs: z.array(artifactReferenceSchema).default([]),
  evidenceRefs: z.array(evidenceReferenceSchema).default([]),
  capability: capabilitySchema.optional(),
});
const outcomeSchema = z.object({
  outcomeId: z.string().trim().min(1),
  retryAttemptId: z.string().trim().min(1),
  outcomeType: z.enum(["RETRY", "TRANSFER", "RETENTION"]),
  result: z.enum(["IMPROVED", "UNCHANGED", "REGRESSED", "INCONCLUSIVE"]),
  evidenceRefs: z.array(evidenceReferenceSchema).default([]),
});

function actorFrom(headers: ProductStateApiRequest["headers"]): ProductStateActor {
  const actorId = headers["x-foundry-actor-id"]?.trim();
  const role = headers["x-foundry-actor-role"]?.trim();
  if (!actorId || !role || !["LEARNER", "TEACHER", "FOUNDRY", "SYSTEM"].includes(role)) {
    throw new Error("VALID_ACTOR_HEADERS_REQUIRED");
  }
  return { actorId, role: role as ProductStateActor["role"] };
}

function errorResponse(error: unknown): ProductStateApiResponse {
  if (error instanceof ZodError) return { status: 400, body: { ok: false, error: { code: "INVALID_REQUEST", issues: error.issues } } };
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  if (message.includes("permission required") || message === "TASK_ACCESS_DENIED") {
    return { status: 403, body: { ok: false, error: { code: message } } };
  }
  if (message.includes("NOT_FOUND")) return { status: 404, body: { ok: false, error: { code: message } } };
  if (message.includes("INVALID_") || message === "VALID_ACTOR_HEADERS_REQUIRED") {
    return { status: 400, body: { ok: false, error: { code: message } } };
  }
  if (message.includes("DATABASE") || message.includes("ECONN")) {
    return { status: 503, body: { ok: false, error: { code: "PRODUCT_STATE_UNAVAILABLE" } } };
  }
  if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
    const code = (error as { code: string }).code;
    return {
      status: code === "23505" || code === "23503" || code === "23514" ? 409 : 503,
      body: { ok: false, error: { code: code === "23505" ? "PRODUCT_STATE_CONFLICT" : "PRODUCT_STATE_WRITE_FAILED" } },
    };
  }
  if (/(REQUIRED|DENIED|ALREADY|LINEAGE|PROHIBITED|CONFLICT|NOT_ALLOWED)/.test(message)) {
    return { status: 409, body: { ok: false, error: { code: message } } };
  }
  return { status: 500, body: { ok: false, error: { code: "PRODUCT_STATE_INTERNAL_ERROR" } } };
}

export class ProductStateApi {
  constructor(
    private readonly service: ProductStateService,
    private readonly repository: CanonicalProductStateRepository,
  ) {}

  async handle(request: ProductStateApiRequest): Promise<ProductStateApiResponse> {
    try {
      if (request.method === "GET" && request.path === "/v1/product-state/health") {
        const health = await this.repository.health();
        return { status: health.ready ? 200 : 503, body: { ok: health.ready, health } };
      }
      const actor = actorFrom(request.headers);
      const taskMatch = /^\/v1\/product-state\/tasks\/([^/]+)$/.exec(request.path);
      if (request.method === "GET" && taskMatch) {
        return { status: 200, body: { ok: true, learningLoop: await this.service.getLearningLoop(actor, decodeURIComponent(taskMatch[1]!)) } };
      }
      if (request.method !== "POST") return { status: 404, body: { ok: false, error: { code: "ROUTE_NOT_FOUND" } } };
      if (request.path === "/v1/product-state/tasks") {
        return { status: 201, body: { ok: true, task: await this.service.createTask(actor, createTaskSchema.parse(request.body)) } };
      }
      if (request.path === "/v1/product-state/episodes") {
        return { status: 201, body: { ok: true, episode: await this.service.startEpisode(actor, episodeSchema.parse(request.body)) } };
      }
      if (request.path === "/v1/product-state/conversation-events") {
        return { status: 201, body: { ok: true, event: await this.service.appendConversationEvent(actor, eventSchema.parse(request.body)) } };
      }
      if (request.path === "/v1/product-state/attempts") {
        return { status: 201, body: { ok: true, attempt: await this.service.submitAttempt(actor, attemptSchema.parse(request.body)) } };
      }
      if (request.path === "/v1/product-state/observations") {
        return { status: 201, body: { ok: true, observation: await this.service.recordObservation(actor, observationSchema.parse(request.body)) } };
      }
      if (request.path === "/v1/product-state/reviews") {
        return { status: 201, body: { ok: true, review: await this.service.reviewObservation(actor, reviewSchema.parse(request.body)) } };
      }
      if (request.path === "/v1/product-state/retries") {
        return { status: 201, body: { ok: true, retry: await this.service.planRetry(actor, retrySchema.parse(request.body)) } };
      }
      const retrySubmissionMatch = /^\/v1\/product-state\/retries\/([^/]+)\/submission$/.exec(request.path);
      if (retrySubmissionMatch) {
        const input = retrySubmissionSchema.parse(request.body);
        return { status: 201, body: { ok: true, attempt: await this.service.submitRetry(actor, { ...input, retryAttemptId: decodeURIComponent(retrySubmissionMatch[1]!) }) } };
      }
      const retryResultMatch = /^\/v1\/product-state\/retries\/([^/]+)\/result$/.exec(request.path);
      if (retryResultMatch) {
        const input = observationBaseSchema.parse(request.body);
        return { status: 201, body: { ok: true, observation: await this.service.recordRetryResult(actor, { ...input, retryAttemptId: decodeURIComponent(retryResultMatch[1]!) }) } };
      }
      if (request.path === "/v1/product-state/outcomes") {
        return { status: 201, body: { ok: true, outcome: await this.service.recordOutcome(actor, outcomeSchema.parse(request.body)) } };
      }
      return { status: 404, body: { ok: false, error: { code: "ROUTE_NOT_FOUND" } } };
    } catch (error) {
      return errorResponse(error);
    }
  }
}
