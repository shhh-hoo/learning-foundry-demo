import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import type { Actor, Citation } from "@/domain/model";
import { authorizeEvidenceUnitInstitution, authorizePersistedEvidence, assertCitationIntegrity } from "@/domain/evidence";
import { DomainInvariantError, requireCourseAccess } from "@/domain/invariants";
import { getDb, getSql } from "@/db/client";
import { courses, learningTasks, retrievalRuns, subjects } from "@/db/schema";
import { traced } from "@/application/telemetry";
import { getEmbeddingProvider, getRerankProvider } from "@/application/intelligence-providers";

export type RetrievalHit = {
  evidenceUnitId: string;
  sourceId: string;
  sourceVersion: string;
  sourceTitle: string;
  locator: string;
  modality: string;
  content: string;
  structuredContent: Record<string, unknown> | null;
  rightsAuthorizationStatus: string;
  distributionScope: string;
  allowedPurposes: string[];
  institutionId: string | null;
  evidenceInstitutionId: string | null;
  lexicalScore: number;
  vectorScore: number | null;
  rerankerScore: number | null;
  score: number;
  embedding: number[] | null;
  embeddingStatus: string;
};

export type RetrievalResult = {
  hits: RetrievalHit[];
  citations: Citation[];
  missingSignal: boolean;
  conflictingSignal: boolean;
  retrievalMode: "POSTGRES_FTS" | "POSTGRES_FTS_OPENAI_EXACT_VECTOR";
  embeddingStatus: "EXECUTED" | "UNAVAILABLE" | "FAILED" | "NO_INDEXED_VECTORS";
  embeddingModel: string | null;
  rerankerStatus: "EXECUTED" | "UNAVAILABLE" | "FAILED" | "NO_CANDIDATES";
  rerankerModel: string | null;
};

function cosine(left: number[], right: number[]): number | null {
  if (!left.length || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function reciprocalRankFusion(rows: RetrievalHit[]): RetrievalHit[] {
  const scores = new Map<string, number>();
  const lexical = rows.filter((row) => row.lexicalScore > 0).sort((left, right) => right.lexicalScore - left.lexicalScore || left.evidenceUnitId.localeCompare(right.evidenceUnitId));
  const vector = rows.filter((row) => row.vectorScore !== null).sort((left, right) => (right.vectorScore ?? -1) - (left.vectorScore ?? -1) || left.evidenceUnitId.localeCompare(right.evidenceUnitId));
  for (const [rank, row] of lexical.entries()) scores.set(row.evidenceUnitId, (scores.get(row.evidenceUnitId) ?? 0) + 1 / (60 + rank + 1));
  for (const [rank, row] of vector.entries()) scores.set(row.evidenceUnitId, (scores.get(row.evidenceUnitId) ?? 0) + 1 / (60 + rank + 1));
  return rows
    .filter((row) => scores.has(row.evidenceUnitId))
    .map((row) => ({ ...row, score: scores.get(row.evidenceUnitId) ?? 0 }))
    .sort((left, right) => right.score - left.score || left.evidenceUnitId.localeCompare(right.evidenceUnitId));
}

export async function retrieveEvidence(input: { actor: Actor; taskId: string; query: string; purpose: "LEARNING" | "TEACHING" | "EVAL"; limit?: number }): Promise<RetrievalResult> {
  return traced("foundry.retrieval.governed_hybrid", { userId: input.actor.userId, institutionId: input.actor.institutionId, taskId: input.taskId }, async () => {
    const [scope] = await getDb().select({ task: learningTasks, subject: subjects })
      .from(learningTasks)
      .innerJoin(courses, eq(courses.id, learningTasks.courseId))
      .innerJoin(subjects, eq(subjects.id, courses.subjectId))
      .where(eq(learningTasks.id, input.taskId))
      .limit(1);
    if (!scope) throw new DomainInvariantError("Learning Task not found", "TASK_NOT_FOUND");
    requireCourseAccess(input.actor, scope.task.institutionId, scope.task.courseId);
    if (input.actor.roles.includes("LEARNER") && scope.task.learnerId !== input.actor.userId) {
      throw new DomainInvariantError("Learner cannot retrieve Evidence for another learner's Task", "TENANT_ISOLATION");
    }
    const started = performance.now();
    const candidates = await getSql()<RetrievalHit[]>`
      SELECT e.id AS "evidenceUnitId", s.id AS "sourceId", s.version AS "sourceVersion", s.title AS "sourceTitle",
             e.locator, e.modality, e.content, e.structured_content AS "structuredContent",
             s.rights_authorization_status AS "rightsAuthorizationStatus", s.distribution_scope AS "distributionScope",
             s.allowed_purposes AS "allowedPurposes", s.institution_id AS "institutionId",
             e.institution_id AS "evidenceInstitutionId", e.embedding, e.embedding_status AS "embeddingStatus",
             ts_rank_cd(to_tsvector('english', e.search_document), websearch_to_tsquery('english', ${input.query}))::real AS "lexicalScore",
             NULL::real AS "vectorScore", NULL::real AS "rerankerScore", 0::real AS score
      FROM foundry_product.evidence_units e
      JOIN foundry_product.source_records s ON s.id = e.source_id
      WHERE s.active = true
        AND s.rights_authorization_status = 'APPROVED'
        AND s.allowed_purposes ? ${input.purpose}
        AND (s.distribution_scope = 'PUBLIC' OR s.institution_id = ${input.actor.institutionId})
        AND (e.institution_id IS NULL OR e.institution_id = ${input.actor.institutionId})
        AND (
          s.course_id = ${scope.task.courseId}
          OR e.metadata->'courseIds' ? ${scope.task.courseId}
          OR e.metadata->>'referencePackKey' = ${scope.subject.referencePackKey}
        )
        AND (
          to_tsvector('english', e.search_document) @@ websearch_to_tsquery('english', ${input.query})
          OR (e.embedding_status = 'AVAILABLE' AND e.embedding IS NOT NULL)
        )
      ORDER BY "lexicalScore" DESC, e.created_at DESC, e.id
      LIMIT 100
    `;
    for (const row of candidates) {
      authorizePersistedEvidence(input.actor, row, input.purpose);
      authorizeEvidenceUnitInstitution(input.actor, row.evidenceInstitutionId);
    }

    const embeddingProvider = getEmbeddingProvider();
    let embeddingStatus: RetrievalResult["embeddingStatus"] = embeddingProvider ? "NO_INDEXED_VECTORS" : "UNAVAILABLE";
    const embeddingModel: string | null = embeddingProvider?.model ?? null;
    if (embeddingProvider) {
      try {
        const queryVector = await embeddingProvider.embedQuery(input.query);
        if (!queryVector.length || queryVector.some((value) => !Number.isFinite(value))) throw new Error("Embedding provider returned an invalid query vector");
        let vectorCount = 0;
        for (const row of candidates) {
          const similarity = row.embedding ? cosine(queryVector, row.embedding) : null;
          row.vectorScore = similarity;
          if (similarity !== null) vectorCount += 1;
        }
        embeddingStatus = vectorCount ? "EXECUTED" : "NO_INDEXED_VECTORS";
      } catch {
        embeddingStatus = "FAILED";
      }
    }

    let ranked = reciprocalRankFusion(candidates);
    const rerankerProvider = getRerankProvider();
    let rerankerStatus: RetrievalResult["rerankerStatus"] = ranked.length ? "UNAVAILABLE" : "NO_CANDIDATES";
    const rerankerModel: string | null = rerankerProvider?.model ?? null;
    if (rerankerProvider && ranked.length) {
      try {
        const pool = ranked.slice(0, 20);
        const reranked = await rerankerProvider.rerank(pool.map((row) => row.content), input.query, Math.min(input.limit ?? 4, pool.length));
        if (!reranked.length || reranked.some((result) => !Number.isInteger(result.index) || result.index < 0 || result.index >= pool.length || !Number.isFinite(result.relevanceScore))) throw new Error("Reranker returned invalid ranking evidence");
        ranked = reranked.flatMap((result) => {
          const row = pool[result.index];
          return row ? [{ ...row, rerankerScore: result.relevanceScore, score: result.relevanceScore }] : [];
        });
        rerankerStatus = "EXECUTED";
      } catch {
        rerankerStatus = "FAILED";
      }
    }

    const rows = ranked.slice(0, input.limit ?? 4);
    const citations: Citation[] = rows.map((row) => ({
      evidenceUnitId: row.evidenceUnitId,
      sourceId: row.sourceId,
      sourceVersion: row.sourceVersion,
      locator: row.locator,
      label: `${row.sourceTitle} · ${row.locator}`,
    }));
    assertCitationIntegrity(citations);
    const missingSignal = rows.length === 0;
    const conflictingSignal = false;
    const retrievalMode: RetrievalResult["retrievalMode"] = embeddingStatus === "EXECUTED" ? "POSTGRES_FTS_OPENAI_EXACT_VECTOR" : "POSTGRES_FTS";
    await getDb().insert(retrievalRuns).values({
      institutionId: input.actor.institutionId,
      taskId: input.taskId,
      query: input.query,
      purpose: input.purpose,
      selectedEvidenceIds: rows.map((row) => row.evidenceUnitId),
      rankingEvidence: rows.map((row) => ({
        id: row.evidenceUnitId,
        fusion: embeddingStatus === "EXECUTED" ? "RECIPROCAL_RANK_FUSION" : "POSTGRES_FTS",
        lexicalScore: row.lexicalScore,
        vectorCosine: row.vectorScore,
        rerankerScore: row.rerankerScore,
      })),
      retrievalMode,
      embeddingStatus,
      embeddingModel,
      rerankerStatus,
      rerankerModel,
      missingSignal,
      conflictingSignal,
      latencyMs: performance.now() - started,
    });
    return { hits: rows, citations, missingSignal, conflictingSignal, retrievalMode, embeddingStatus, embeddingModel, rerankerStatus, rerankerModel };
  });
}
