import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import type { Actor, Citation } from "@/domain/model";
import { authorizeEvidenceUnitInstitution, authorizePersistedEvidence, assertCitationIntegrity } from "@/domain/evidence";
import { DomainInvariantError, requireCourseAccess } from "@/domain/invariants";
import { getDb, getSql } from "@/db/client";
import { courses, learningTasks, retrievalRuns, subjects } from "@/db/schema";
import { traced } from "@/application/telemetry";

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
  score: number;
};

export type RetrievalResult = {
  hits: RetrievalHit[];
  citations: Citation[];
  missingSignal: boolean;
  conflictingSignal: boolean;
  retrievalMode: "POSTGRES_LEXICAL_CANDIDATE";
  matureHybridStatus: "UNAVAILABLE";
  rerankerStatus: "UNAVAILABLE";
};

export async function retrieveEvidence(input: { actor: Actor; taskId: string; query: string; purpose: "LEARNING" | "TEACHING" | "EVAL"; limit?: number }): Promise<RetrievalResult> {
  return traced("foundry.retrieval.lexical_candidate", { userId: input.actor.userId, institutionId: input.actor.institutionId, taskId: input.taskId }, async () => {
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
    const rows = await getSql()<RetrievalHit[]>`
      SELECT e.id AS "evidenceUnitId", s.id AS "sourceId", s.version AS "sourceVersion", s.title AS "sourceTitle",
             e.locator, e.modality, e.content, e.structured_content AS "structuredContent",
             s.rights_authorization_status AS "rightsAuthorizationStatus", s.distribution_scope AS "distributionScope",
             s.allowed_purposes AS "allowedPurposes", s.institution_id AS "institutionId",
             e.institution_id AS "evidenceInstitutionId",
             ts_rank_cd(to_tsvector('english', e.search_document), plainto_tsquery('english', ${input.query}))::real AS "lexicalScore",
             ts_rank_cd(to_tsvector('english', e.search_document), plainto_tsquery('english', ${input.query}))::real AS score
      FROM foundry_product.evidence_units e
      JOIN foundry_product.source_records s ON s.id = e.source_id
      WHERE s.active = true
        AND s.rights_authorization_status = 'APPROVED'
        AND s.allowed_purposes ? ${input.purpose}
        AND (s.distribution_scope = 'PUBLIC' OR s.institution_id = ${input.actor.institutionId})
        AND (e.institution_id IS NULL OR e.institution_id = ${input.actor.institutionId})
        AND (
          e.metadata->'courseIds' ? ${scope.task.courseId}
          OR e.metadata->>'referencePackKey' = ${scope.subject.referencePackKey}
        )
        AND to_tsvector('english', e.search_document) @@ plainto_tsquery('english', ${input.query})
      ORDER BY "lexicalScore" DESC, e.id
      LIMIT ${input.limit ?? 4}
    `;
    for (const row of rows) {
      authorizePersistedEvidence(input.actor, row, input.purpose);
      authorizeEvidenceUnitInstitution(input.actor, row.evidenceInstitutionId);
    }
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
    await getDb().insert(retrievalRuns).values({
      institutionId: input.actor.institutionId,
      taskId: input.taskId,
      query: input.query,
      purpose: input.purpose,
      selectedEvidenceIds: rows.map((row) => row.evidenceUnitId),
      rankingEvidence: rows.map((row) => ({ id: row.evidenceUnitId, method: "POSTGRES_FTS", lexicalScore: row.lexicalScore })),
      missingSignal,
      conflictingSignal,
      latencyMs: performance.now() - started,
    });
    return {
      hits: rows,
      citations,
      missingSignal,
      conflictingSignal,
      retrievalMode: "POSTGRES_LEXICAL_CANDIDATE",
      matureHybridStatus: "UNAVAILABLE",
      rerankerStatus: "UNAVAILABLE",
    };
  });
}
