import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { and, desc, eq } from "drizzle-orm";
import type { Actor } from "@/domain/model";
import { DomainInvariantError, requireCourseAccess, requireHumanCommand, requireRole } from "@/domain/invariants";
import { validateUpload } from "@/domain/file-intake";
import { getDb } from "@/db/client";
import {
  courses,
  evidenceUnits,
  fileAssets,
  governanceEvents,
  idempotencyKeys,
  modelRuns,
  sourceRecords,
  sourceAssetVersions,
  sourceProcessingAttempts,
  subjects,
} from "@/db/schema";
import { commandRequestHash } from "@/application/commands";
import { requireWritableGeneralEpisode } from "@/application/task-scope";
import { extractPdfPages } from "@/application/pdf-extraction";
import { getEmbeddingProvider, getVisionProvider, type TokenUsage } from "@/application/intelligence-providers";
import { getFileStorage } from "@/infrastructure/file-storage";
import { startDiagnosisWithTeacherReview } from "@/application/workflow-service";
import { assertExecutionActive, currentExecutionControl, executionStopStatus, rethrowIfExecutionStopped } from "@/application/execution-control";
import { deterministicUuid, putWithDatabaseCompensation } from "@/application/canonical-data";

type UploadInput = {
  taskId: string;
  episodeId: string;
  bytes: Uint8Array;
  declaredMediaType: string;
  originalName: string;
  idempotencyKey: string;
};

type ExtractedPage = { page: number; locator: string; text: string };

function errorCode(error: unknown): string {
  if (error instanceof DomainInvariantError) return error.code;
  if (error instanceof Error && error.name) return error.name;
  return "UNKNOWN_PROVIDER_FAILURE";
}

async function recordModelCall(input: {
  actor: Actor;
  taskId?: string;
  fileAssetId?: string;
  callType: string;
  provider: string;
  model: string;
  status: string;
  latencyMs: number;
  usage?: TokenUsage;
  evidenceUnitIds?: string[];
  failureCode?: string;
}) {
  await getDb().insert(modelRuns).values({
    institutionId: input.actor.institutionId,
    taskId: input.taskId,
    fileAssetId: input.fileAssetId,
    callType: input.callType,
    provider: input.provider,
    model: input.model,
    status: input.status,
    inputTokens: input.usage?.inputTokens,
    outputTokens: input.usage?.outputTokens,
    totalTokens: input.usage?.totalTokens,
    latencyMs: input.latencyMs,
    evidenceUnitIds: input.evidenceUnitIds ?? [],
    failureCode: input.failureCode,
  });
}

async function reserveUpload(actor: Actor, input: {
  commandType: string;
  idempotencyKey: string;
  resultId: string;
  request: unknown;
}): Promise<{ replayed: boolean; resultId: string }> {
  const requestHash = commandRequestHash(actor, input.commandType, input.request);
  const inserted = await getDb().insert(idempotencyKeys).values({
    institutionId: actor.institutionId,
    key: input.idempotencyKey,
    commandType: input.commandType,
    requestHash,
    resultId: input.resultId,
  }).onConflictDoNothing().returning();
  if (inserted.length) return { replayed: false, resultId: input.resultId };
  const [existing] = await getDb().select().from(idempotencyKeys).where(and(
    eq(idempotencyKeys.institutionId, actor.institutionId),
    eq(idempotencyKeys.commandType, input.commandType),
    eq(idempotencyKeys.key, input.idempotencyKey),
  )).limit(1);
  if (!existing || existing.requestHash !== requestHash) {
    throw new DomainInvariantError("Idempotency key was reused by a different actor or request", "IDEMPOTENCY_MISMATCH");
  }
  return { replayed: true, resultId: existing.resultId };
}

async function interpretImage(actor: Actor, input: {
  taskId: string;
  fileAssetId: string;
  bytes: Uint8Array;
  mediaType: string;
  purpose: "LEARNING_MATERIAL" | "LEARNER_ATTEMPT";
}) {
  const control = currentExecutionControl();
  assertExecutionActive(control);
  const provider = getVisionProvider();
  if (!provider) {
    await getDb().update(fileAssets).set({
      ingestionStatus: "PROVIDER_UNAVAILABLE",
      interpretationStatus: "PROVIDER_UNAVAILABLE",
      failureCode: "MULTIMODAL_PROVIDER_UNAVAILABLE",
      failureMessage: "OPENAI_API_KEY is not configured; no image interpretation was generated.",
      updatedAt: new Date(),
    }).where(eq(fileAssets.id, input.fileAssetId));
    await recordModelCall({ actor, taskId: input.taskId, fileAssetId: input.fileAssetId, callType: "IMAGE_INTERPRETATION", provider: "OPENAI", model: process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini", status: "UNAVAILABLE", latencyMs: 0, failureCode: "PROVIDER_NOT_CONFIGURED" });
    return { status: "PROVIDER_UNAVAILABLE" as const, transcription: "", interpretation: "" };
  }
  const started = performance.now();
  try {
    const result = await provider.interpret({ bytes: input.bytes, mediaType: input.mediaType, purpose: input.purpose }, control);
    assertExecutionActive(control);
    const transcription = result.transcription.trim();
    await getDb().update(fileAssets).set({
      ingestionStatus: "EXTRACTED",
      extractionText: transcription || null,
      extractionMetadata: {
        derivation: "MODEL_DERIVED_TRANSCRIPTION",
        transcription,
        provider: provider.provider,
        model: provider.model,
        purpose: input.purpose,
      },
      interpretation: result.interpretation.trim() || null,
      interpretationStatus: "AVAILABLE",
      providerModel: provider.model,
      failureCode: null,
      failureMessage: null,
      updatedAt: new Date(),
    }).where(eq(fileAssets.id, input.fileAssetId));
    await recordModelCall({ actor, taskId: input.taskId, fileAssetId: input.fileAssetId, callType: "IMAGE_INTERPRETATION", provider: provider.provider, model: provider.model, status: "SUCCEEDED", latencyMs: performance.now() - started, usage: result.usage });
    return { status: "AVAILABLE" as const, transcription: result.transcription, interpretation: result.interpretation };
  } catch (error) {
    const stopped = executionStopStatus(error, control);
    if (stopped) {
      await recordModelCall({ actor, taskId: input.taskId, fileAssetId: input.fileAssetId, callType: "IMAGE_INTERPRETATION", provider: provider.provider, model: provider.model, status: stopped, latencyMs: performance.now() - started, failureCode: stopped === "TIMED_OUT" ? "EXECUTION_TIMED_OUT" : "EXECUTION_ABORTED" });
    }
    rethrowIfExecutionStopped(error, control);
    await getDb().update(fileAssets).set({
      ingestionStatus: "FAILED",
      interpretationStatus: "FAILED",
      providerModel: provider.model,
      failureCode: errorCode(error),
      failureMessage: error instanceof Error ? error.message : String(error),
      updatedAt: new Date(),
    }).where(eq(fileAssets.id, input.fileAssetId));
    await recordModelCall({ actor, taskId: input.taskId, fileAssetId: input.fileAssetId, callType: "IMAGE_INTERPRETATION", provider: provider.provider, model: provider.model, status: "FAILED", latencyMs: performance.now() - started, failureCode: errorCode(error) });
    return { status: "FAILED" as const, transcription: "", interpretation: "" };
  }
}

export async function uploadLearningMaterial(actor: Actor, input: UploadInput & { title: string; rights: string }) {
  const control = currentExecutionControl();
  assertExecutionActive(control);
  requireRole(actor, ["LEARNER", "TEACHER", "ADMIN"]);
  const scope = await requireWritableGeneralEpisode(actor, { taskId: input.taskId, episodeId: input.episodeId, learnerOriginated: actor.roles.includes("LEARNER") });
  const upload = validateUpload({ bytes: input.bytes, declaredMediaType: input.declaredMediaType, originalName: input.originalName, purpose: "LEARNING_MATERIAL" });
  const fileAssetId = randomUUID();
  const sourceId = randomUUID();
  const reservation = await reserveUpload(actor, {
    commandType: "UPLOAD_LEARNING_MATERIAL",
    idempotencyKey: input.idempotencyKey,
    resultId: fileAssetId,
    request: { taskId: input.taskId, episodeId: input.episodeId, title: input.title, rights: input.rights, mediaType: upload.mediaType, contentHash: upload.contentHash },
  });
  if (reservation.replayed) {
    const [existing] = await getDb().select().from(fileAssets).where(and(eq(fileAssets.id, reservation.resultId), eq(fileAssets.ownerUserId, actor.userId))).limit(1);
    if (!existing) throw new DomainInvariantError("Upload replay does not belong to the active actor", "IDEMPOTENCY_MISMATCH");
    return { fileAsset: existing, replayed: true };
  }

  const storageKey = `${actor.institutionId}/${scope.task.courseId}/materials/${fileAssetId}.${upload.extension}`;
  await getDb().transaction(async (tx) => {
    await tx.insert(sourceRecords).values({
      id: sourceId,
      institutionId: actor.institutionId,
      courseId: scope.task.courseId,
      sourceKey: `upload:${sourceId}`,
      title: input.title.trim(),
      sourceType: upload.mediaType === "application/pdf" ? "UPLOADED_PDF" : "UPLOADED_IMAGE",
      version: upload.contentHash,
      authority: "UPLOADED_PENDING_HUMAN_RIGHTS_REVIEW",
      rights: input.rights.trim(),
      rightsAuthorizationStatus: "REVIEW_REQUIRED",
      distributionScope: "INSTITUTION",
      allowedPurposes: ["LEARNING", "TEACHING"],
      contentHash: upload.contentHash,
    });
    await tx.insert(fileAssets).values({
      id: fileAssetId,
      institutionId: actor.institutionId,
      courseId: scope.task.courseId,
      taskId: input.taskId,
      ownerUserId: actor.userId,
      sourceId,
      purpose: "LEARNING_MATERIAL",
      storageKey,
      originalName: upload.safeName,
      mediaType: upload.mediaType,
      byteSize: upload.byteSize,
      contentHash: upload.contentHash,
    });
  });
  try {
    await getFileStorage().put({ key: storageKey, bytes: upload.bytes }, control);
  } catch (error) {
    await getDb().update(fileAssets).set({ ingestionStatus: "FAILED", failureCode: "STORAGE_WRITE_FAILED", failureMessage: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(fileAssets.id, fileAssetId));
    throw error;
  }

  if (upload.mediaType === "application/pdf") {
    try {
      const pages = await extractPdfPages(upload.bytes);
      if (!pages.some((page) => page.text.trim())) throw new DomainInvariantError("PDF contains no extractable text; OCR is not configured", "PDF_TEXT_UNAVAILABLE");
      await getDb().update(fileAssets).set({
        ingestionStatus: "EXTRACTED",
        extractionText: pages.map((page) => page.text).filter(Boolean).join("\n\n"),
        extractionMetadata: { extractor: "PDFJS", pages },
        interpretationStatus: "NOT_APPLICABLE",
        failureCode: null,
        failureMessage: null,
        updatedAt: new Date(),
      }).where(eq(fileAssets.id, fileAssetId));
    } catch (error) {
      await getDb().update(fileAssets).set({ ingestionStatus: "FAILED", failureCode: "PDF_EXTRACTION_FAILED", failureMessage: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(fileAssets.id, fileAssetId));
    }
  } else {
    await interpretImage(actor, { taskId: input.taskId, fileAssetId, bytes: upload.bytes, mediaType: upload.mediaType, purpose: "LEARNING_MATERIAL" });
  }
  const [fileAsset] = await getDb().select().from(fileAssets).where(eq(fileAssets.id, fileAssetId)).limit(1);
  return { fileAsset, replayed: false };
}

function extractedPages(asset: typeof fileAssets.$inferSelect): ExtractedPage[] {
  const pages = asset.extractionMetadata.pages;
  if (Array.isArray(pages)) {
    return pages.flatMap((page) => {
      if (!page || typeof page !== "object") return [];
      const value = page as Record<string, unknown>;
      if (typeof value.page !== "number" || typeof value.locator !== "string" || typeof value.text !== "string" || !value.text.trim()) return [];
      return [{ page: value.page, locator: value.locator, text: value.text }];
    });
  }
  if (!asset.extractionText?.trim()) return [];
  return [{ page: 1, locator: asset.mediaType.startsWith("image/") ? "image:full" : "page:1", text: asset.extractionText }];
}

function evidenceStructuredContent(asset: typeof fileAssets.$inferSelect, page: ExtractedPage): Record<string, unknown> {
  const base = { page: page.page, fileAssetId: asset.id, mediaType: asset.mediaType };
  if (!asset.mediaType.startsWith("image/")) {
    return { ...base, derivation: { type: "PDF_TEXT_EXTRACTION", extractor: "PDFJS" } };
  }
  const provider = typeof asset.extractionMetadata.provider === "string" ? asset.extractionMetadata.provider : undefined;
  const model = asset.providerModel ?? (typeof asset.extractionMetadata.model === "string" ? asset.extractionMetadata.model : undefined);
  return {
    ...base,
    derivation: {
      type: "MODEL_DERIVED_TRANSCRIPTION",
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    },
    citedArtifact: "ORIGINAL_UPLOADED_IMAGE",
  };
}

async function embedEvidence(actor: Actor, taskId: string, rows: Array<typeof evidenceUnits.$inferSelect>) {
  const control = currentExecutionControl();
  assertExecutionActive(control);
  const provider = getEmbeddingProvider();
  if (!provider) {
    for (const row of rows) {
      await getDb().update(evidenceUnits).set({ embeddingStatus: "PROVIDER_UNAVAILABLE", embeddingFailure: "OPENAI_API_KEY is not configured" }).where(eq(evidenceUnits.id, row.id));
    }
    await recordModelCall({ actor, taskId, callType: "EVIDENCE_EMBEDDING", provider: "OPENAI", model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small", status: "UNAVAILABLE", latencyMs: 0, evidenceUnitIds: rows.map((row) => row.id), failureCode: "PROVIDER_NOT_CONFIGURED" });
    return;
  }
  const started = performance.now();
  try {
    const vectors = await provider.embedDocuments(rows.map((row) => row.content), control);
    assertExecutionActive(control);
    if (vectors.length !== rows.length || vectors.some((vector) => !vector.length || vector.some((value) => !Number.isFinite(value)))) throw new Error("Embedding provider returned an invalid vector batch");
    for (const [index, row] of rows.entries()) {
      const vector = vectors[index];
      await getDb().update(evidenceUnits).set({ embedding: vector, embeddingModel: provider.model, embeddingDimensions: vector.length, embeddingStatus: "AVAILABLE", embeddingFailure: null }).where(eq(evidenceUnits.id, row.id));
    }
    await recordModelCall({ actor, taskId, callType: "EVIDENCE_EMBEDDING", provider: "OPENAI", model: provider.model, status: "SUCCEEDED", latencyMs: performance.now() - started, evidenceUnitIds: rows.map((row) => row.id) });
  } catch (error) {
    const stopped = executionStopStatus(error, control);
    if (stopped) {
      await recordModelCall({ actor, taskId, callType: "EVIDENCE_EMBEDDING", provider: "OPENAI", model: provider.model, status: stopped, latencyMs: performance.now() - started, evidenceUnitIds: rows.map((row) => row.id), failureCode: stopped === "TIMED_OUT" ? "EXECUTION_TIMED_OUT" : "EXECUTION_ABORTED" });
    }
    rethrowIfExecutionStopped(error, control);
    for (const row of rows) await getDb().update(evidenceUnits).set({ embeddingStatus: "FAILED", embeddingFailure: error instanceof Error ? error.message : String(error) }).where(eq(evidenceUnits.id, row.id));
    await recordModelCall({ actor, taskId, callType: "EVIDENCE_EMBEDDING", provider: "OPENAI", model: provider.model, status: "FAILED", latencyMs: performance.now() - started, evidenceUnitIds: rows.map((row) => row.id), failureCode: errorCode(error) });
  }
}

export async function reviewSourceRights(actor: Actor, input: { sourceId: string; decision: "APPROVED" | "DENIED"; rights: string; idempotencyKey: string }) {
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  const [scope] = await getDb().select({ source: sourceRecords, sourceVersion: sourceAssetVersions, asset: fileAssets, course: courses, subject: subjects })
    .from(sourceRecords)
    .innerJoin(sourceAssetVersions, eq(sourceAssetVersions.id, sourceRecords.sourceAssetVersionId))
    .innerJoin(fileAssets, eq(fileAssets.sourceId, sourceRecords.id))
    .innerJoin(courses, eq(courses.id, fileAssets.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .where(eq(sourceRecords.id, input.sourceId))
    .limit(1);
  if (!scope) throw new DomainInvariantError("Uploaded Source was not found", "SOURCE_NOT_FOUND");
  requireCourseAccess(actor, scope.asset.institutionId, scope.asset.courseId);
  if (!scope.asset.taskId) throw new DomainInvariantError("Learning material is missing its Task lineage", "FILE_LINEAGE_INVALID");
  const commandType = "REVIEW_SOURCE_RIGHTS";
  const requestHash = commandRequestHash(actor, commandType, {
    sourceId: input.sourceId,
    decision: input.decision,
    rights: input.rights,
  });
  const pages = input.decision === "APPROVED" && scope.asset.ingestionStatus === "EXTRACTED" ? extractedPages(scope.asset) : [];
  const rightsSnapshotHash = createHash("sha256").update(JSON.stringify({
    predecessor: scope.sourceVersion.id,
    decision: input.decision,
    rights: input.rights.trim(),
    actorUserId: actor.userId,
  })).digest("hex");
  const rightsVersionId = deterministicUuid(`source-rights-version|${scope.sourceVersion.id}|${rightsSnapshotHash}`);
  const rightsVersionKey = `${scope.source.version}:rights:${rightsSnapshotHash.slice(0, 16)}`;
  const outcome = await getDb().transaction(async (tx) => {
    const reservation = await tx.insert(idempotencyKeys).values({
      institutionId: actor.institutionId,
      key: input.idempotencyKey,
      commandType,
      requestHash,
      resultId: input.sourceId,
    }).onConflictDoNothing().returning();
    if (!reservation.length) {
      const [existing] = await tx.select().from(idempotencyKeys).where(and(
        eq(idempotencyKeys.institutionId, actor.institutionId),
        eq(idempotencyKeys.commandType, commandType),
        eq(idempotencyKeys.key, input.idempotencyKey),
      )).limit(1);
      if (!existing || existing.requestHash !== requestHash) {
        throw new DomainInvariantError("Idempotency key was reused by a different actor or request", "IDEMPOTENCY_MISMATCH");
      }
      return { replayed: true, evidence: [] as Array<typeof evidenceUnits.$inferSelect> };
    }

    await tx.insert(sourceAssetVersions).values({
      id: rightsVersionId,
      sourceAssetId: scope.source.sourceAssetId,
      institutionId: scope.source.institutionId,
      versionKey: rightsVersionKey,
      contentHash: scope.sourceVersion.contentHash,
      storageKey: scope.sourceVersion.storageKey,
      stableLocator: scope.sourceVersion.stableLocator,
      mediaType: scope.sourceVersion.mediaType,
      byteSize: scope.sourceVersion.byteSize,
      provenance: {
        predecessorSourceAssetVersionId: scope.sourceVersion.id,
        rightsReview: "AUTHENTICATED_HUMAN_COMMAND",
        actorUserId: actor.userId,
        sourceRecordId: scope.source.id,
      },
      rightsBasis: input.rights.trim(),
      rightsStatus: input.decision,
      accessScope: scope.source.distributionScope,
      effectiveFrom: new Date(),
      supersedesVersionId: scope.sourceVersion.id,
      createdBy: actor.userId,
    }).onConflictDoNothing();
    const transitioned = await tx.update(sourceRecords).set({
      rightsAuthorizationStatus: input.decision,
      rights: input.rights.trim(),
      authority: "AUTHENTICATED_HUMAN_RIGHTS_REVIEW",
      active: input.decision === "APPROVED",
      sourceAssetVersionId: rightsVersionId,
    }).where(and(
      eq(sourceRecords.id, input.sourceId),
      eq(sourceRecords.rightsAuthorizationStatus, "REVIEW_REQUIRED"),
    )).returning({ id: sourceRecords.id });
    if (!transitioned.length) {
      throw new DomainInvariantError("Source rights already have a terminal decision", "SOURCE_RIGHTS_CONFLICT");
    }
    const relinkedFiles = await tx.update(fileAssets).set({ sourceAssetVersionId: rightsVersionId, updatedAt: new Date() })
      .where(and(eq(fileAssets.sourceId, input.sourceId), eq(fileAssets.sourceAssetVersionId, scope.sourceVersion.id)))
      .returning({ id: fileAssets.id });
    if (!relinkedFiles.length) throw new DomainInvariantError("Source rights transition lost its FileAsset lineage", "SOURCE_VERSION_LINEAGE");
    await tx.insert(governanceEvents).values({
      institutionId: actor.institutionId,
      actorUserId: actor.userId,
      entityType: "SOURCE_RECORD",
      entityId: input.sourceId,
      action: `RIGHTS_${input.decision}`,
      payload: { courseId: scope.asset.courseId, fileAssetId: scope.asset.id, rights: input.rights, actorProvenance: { userId: actor.userId, authMethod: actor.authMethod, sessionId: actor.sessionId } },
    });
    if (!pages.length) return { replayed: false, evidence: [] as Array<typeof evidenceUnits.$inferSelect> };
    const evidence = await tx.insert(evidenceUnits).values(pages.map((page) => ({
      sourceId: scope.source.id,
      sourceAssetVersionId: rightsVersionId,
      institutionId: scope.asset.institutionId,
      modality: scope.asset.mediaType === "application/pdf" ? "TEXT" : "FIGURE",
      locator: page.locator,
      title: `${scope.source.title} · ${page.locator}`,
      content: page.text,
      structuredContent: evidenceStructuredContent(scope.asset, page),
      searchDocument: page.text,
      metadata: { courseIds: [scope.asset.courseId], referencePackKey: scope.subject.referencePackKey, fileAssetId: scope.asset.id, originalName: scope.asset.originalName },
      contentHash: createHash("sha256").update(`${scope.source.contentHash}:${page.locator}:${page.text}`).digest("hex"),
      embeddingStatus: "PENDING",
    }))).onConflictDoNothing().returning();
    return { replayed: false, evidence };
  });
  if (outcome.replayed) return { sourceId: input.sourceId, replayed: true, evidenceCount: 0 };
  if (outcome.evidence.length) await embedEvidence(actor, scope.asset.taskId, outcome.evidence);
  return { sourceId: input.sourceId, replayed: false, evidenceCount: outcome.evidence.length };
}

export async function uploadImageAttempt(actor: Actor, input: UploadInput & { prompt: string; learnerNote?: string }) {
  const control = currentExecutionControl();
  assertExecutionActive(control);
  requireRole(actor, ["LEARNER", "ADMIN"]);
  const scope = await requireWritableGeneralEpisode(actor, { taskId: input.taskId, episodeId: input.episodeId, learnerOriginated: true });
  const upload = validateUpload({ bytes: input.bytes, declaredMediaType: input.declaredMediaType, originalName: input.originalName, purpose: "LEARNER_ATTEMPT" });
  const fileAssetId = randomUUID();
  const reservation = await reserveUpload(actor, {
    commandType: "UPLOAD_IMAGE_ATTEMPT",
    idempotencyKey: input.idempotencyKey,
    resultId: fileAssetId,
    request: { taskId: input.taskId, episodeId: input.episodeId, prompt: input.prompt, learnerNote: input.learnerNote ?? "", mediaType: upload.mediaType, contentHash: upload.contentHash },
  });
  if (reservation.replayed) {
    const [existing] = await getDb().select().from(fileAssets).where(and(eq(fileAssets.id, reservation.resultId), eq(fileAssets.ownerUserId, actor.userId))).limit(1);
    if (!existing) throw new DomainInvariantError("Attempt upload replay does not belong to the active learner", "IDEMPOTENCY_MISMATCH");
    return { fileAsset: existing, replayed: true };
  }
  const storageKey = `${actor.institutionId}/${scope.task.courseId}/attempts/${fileAssetId}.${upload.extension}`;
  await getDb().insert(fileAssets).values({
    id: fileAssetId,
    institutionId: actor.institutionId,
    courseId: scope.task.courseId,
    taskId: input.taskId,
    ownerUserId: actor.userId,
    purpose: "LEARNER_ATTEMPT",
    storageKey,
    originalName: upload.safeName,
    mediaType: upload.mediaType,
    byteSize: upload.byteSize,
    contentHash: upload.contentHash,
  });
  try {
    await getFileStorage().put({ key: storageKey, bytes: upload.bytes }, control);
  } catch (error) {
    await getDb().update(fileAssets).set({ ingestionStatus: "FAILED", failureCode: "STORAGE_WRITE_FAILED", failureMessage: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(fileAssets.id, fileAssetId));
    throw error;
  }
  const vision = await interpretImage(actor, { taskId: input.taskId, fileAssetId, bytes: upload.bytes, mediaType: upload.mediaType, purpose: "LEARNER_ATTEMPT" });
  const response = vision.transcription || input.learnerNote?.trim() || "Image Attempt submitted. Multimodal transcription is unavailable; inspect the original upload.";
  const workflow = await startDiagnosisWithTeacherReview(actor, {
    taskId: input.taskId,
    episodeId: input.episodeId,
    fileAssetId,
    prompt: input.prompt,
    response,
    structuredInput: {
      responseType: "IMAGE",
      fileAssetId,
      mediaType: upload.mediaType,
      learnerNote: input.learnerNote?.trim() ?? "",
      visionStatus: vision.status,
      transcription: vision.transcription,
      interpretation: vision.interpretation,
    },
    sourceRefs: [],
    idempotencyKey: `${input.idempotencyKey}:attempt`,
  });
  const [fileAsset] = await getDb().select().from(fileAssets).where(eq(fileAssets.id, fileAssetId)).limit(1);
  return { fileAsset, workflow, replayed: false };
}

export async function authorizeFileRead(actor: Actor, fileAssetId: string) {
  const [asset] = await getDb().select().from(fileAssets).where(eq(fileAssets.id, fileAssetId)).limit(1);
  if (!asset) throw new DomainInvariantError("File was not found", "FILE_NOT_FOUND");
  requireCourseAccess(actor, asset.institutionId, asset.courseId);
  if (actor.roles.includes("LEARNER") && asset.ownerUserId !== actor.userId) throw new DomainInvariantError("Learner cannot read another learner's file", "FILE_ACCESS_DENIED");
  return { asset, bytes: await getFileStorage().read(asset.storageKey, currentExecutionControl()) };
}

/**
 * Application-only repair command for a legacy/canonical FileAsset whose
 * external storage write failed. It preserves canonical IDs and requires the
 * caller to supply the original bytes again; it is not an ingestion route.
 */
export async function retryFailedSourceStorage(actor: Actor, input: {
  fileAssetId: string;
  bytes: Uint8Array;
  idempotencyKey: string;
}) {
  requireHumanCommand(actor, ["TEACHER", "ADMIN"]);
  if (input.idempotencyKey.trim().length < 8) throw new DomainInvariantError("Storage repair requires a stable command identity", "IDEMPOTENCY_KEY_REQUIRED");
  const [lineage] = await getDb().select({ asset: fileAssets, version: sourceAssetVersions })
    .from(fileAssets)
    .innerJoin(sourceAssetVersions, eq(sourceAssetVersions.id, fileAssets.sourceAssetVersionId))
    .where(eq(fileAssets.id, input.fileAssetId))
    .limit(1);
  if (!lineage) throw new DomainInvariantError("Failed FileAsset was not found", "FILE_NOT_FOUND");
  requireCourseAccess(actor, lineage.asset.institutionId, lineage.asset.courseId);
  const suppliedHash = createHash("sha256").update(input.bytes).digest("hex");
  if (suppliedHash !== lineage.asset.contentHash || suppliedHash !== lineage.version.contentHash || input.bytes.byteLength !== lineage.asset.byteSize) {
    throw new DomainInvariantError("Repair bytes do not match the immutable SourceAssetVersion", "SOURCE_VERSION_HASH_MISMATCH");
  }
  const [replay] = await getDb().select().from(sourceProcessingAttempts).where(and(
    eq(sourceProcessingAttempts.institutionId, actor.institutionId),
    eq(sourceProcessingAttempts.operation, "STORAGE_REPAIR"),
    eq(sourceProcessingAttempts.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  if (replay) {
    if (replay.fileAssetId !== lineage.asset.id || replay.sourceAssetVersionId !== lineage.version.id) {
      throw new DomainInvariantError("Repair idempotency key belongs to a different source version", "IDEMPOTENCY_MISMATCH");
    }
    return { fileAssetId: lineage.asset.id, sourceAssetVersionId: lineage.version.id, attemptId: replay.id, status: replay.status, replayed: true };
  }
  if (lineage.asset.ingestionStatus !== "FAILED" || lineage.asset.failureCode !== "STORAGE_WRITE_FAILED") {
    throw new DomainInvariantError("Only a failed storage write can be repaired by this command", "STORAGE_REPAIR_NOT_ELIGIBLE");
  }
  const [prior] = await getDb().select().from(sourceProcessingAttempts)
    .where(and(eq(sourceProcessingAttempts.fileAssetId, lineage.asset.id), eq(sourceProcessingAttempts.status, "FAILED")))
    .orderBy(desc(sourceProcessingAttempts.startedAt))
    .limit(1);
  const attemptId = randomUUID();
  const reserved = await getDb().insert(sourceProcessingAttempts).values({
    id: attemptId,
    institutionId: actor.institutionId,
    sourceAssetVersionId: lineage.version.id,
    fileAssetId: lineage.asset.id,
    operation: "STORAGE_REPAIR",
    processor: "FOUNDRY_FILE_STORAGE",
    processorVersion: "rw03",
    status: "STARTED",
    retryOfAttemptId: prior?.id,
    actorUserId: actor.userId,
    idempotencyKey: input.idempotencyKey,
  }).onConflictDoNothing().returning();
  if (!reserved.length) {
    const [existing] = await getDb().select().from(sourceProcessingAttempts).where(and(
      eq(sourceProcessingAttempts.institutionId, actor.institutionId),
      eq(sourceProcessingAttempts.operation, "STORAGE_REPAIR"),
      eq(sourceProcessingAttempts.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (existing && (existing.fileAssetId !== lineage.asset.id || existing.sourceAssetVersionId !== lineage.version.id)) {
      throw new DomainInvariantError("Repair idempotency key belongs to a different source version", "IDEMPOTENCY_MISMATCH");
    }
    if (existing) return { fileAssetId: lineage.asset.id, sourceAssetVersionId: lineage.version.id, attemptId: existing.id, status: existing.status, replayed: true };
    const [active] = await getDb().select().from(sourceProcessingAttempts).where(and(
      eq(sourceProcessingAttempts.fileAssetId, lineage.asset.id),
      eq(sourceProcessingAttempts.operation, "STORAGE_REPAIR"),
      eq(sourceProcessingAttempts.status, "STARTED"),
    )).limit(1);
    if (active) throw new DomainInvariantError("A storage repair is already in progress for this FileAsset", "STORAGE_REPAIR_IN_PROGRESS");
    throw new DomainInvariantError("Storage repair reservation conflicted with another command", "STORAGE_REPAIR_CONFLICT");
  }
  try {
    await putWithDatabaseCompensation({
      storage: getFileStorage(),
      key: lineage.asset.storageKey,
      bytes: input.bytes,
      control: currentExecutionControl(),
      finalize: async () => getDb().transaction(async (tx) => {
        const updated = await tx.update(fileAssets).set({
          ingestionStatus: "STORED",
          failureCode: null,
          failureMessage: null,
          updatedAt: new Date(),
        }).where(and(
          eq(fileAssets.id, lineage.asset.id),
          eq(fileAssets.institutionId, actor.institutionId),
          eq(fileAssets.contentHash, suppliedHash),
          eq(fileAssets.ingestionStatus, "FAILED"),
        )).returning({ id: fileAssets.id });
        if (!updated.length) throw new DomainInvariantError("Failed FileAsset changed before repair finalization", "STORAGE_REPAIR_CONFLICT");
        await tx.update(sourceProcessingAttempts).set({ status: "SUCCEEDED", finishedAt: new Date(), failureCode: null, failureMessage: null })
          .where(and(eq(sourceProcessingAttempts.id, attemptId), eq(sourceProcessingAttempts.status, "STARTED")));
        return updated[0];
      }),
    });
  } catch (error) {
    await getDb().update(sourceProcessingAttempts).set({
      status: "FAILED",
      finishedAt: new Date(),
      failureCode: error instanceof AggregateError ? "STORAGE_COMPENSATION_FAILED" : "STORAGE_REPAIR_FAILED",
      failureMessage: error instanceof Error ? error.message : String(error),
    }).where(and(eq(sourceProcessingAttempts.id, attemptId), eq(sourceProcessingAttempts.status, "STARTED")));
    throw error;
  }
  return { fileAssetId: lineage.asset.id, sourceAssetVersionId: lineage.version.id, attemptId, status: "SUCCEEDED" as const, replayed: false };
}
