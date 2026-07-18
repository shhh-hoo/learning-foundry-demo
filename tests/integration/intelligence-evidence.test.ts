import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getActor } from "@/application/actor";
import { authorizeFileRead, reviewSourceRights, uploadImageAttempt, uploadLearningMaterial } from "@/application/file-intake";
import { setIntelligenceProvidersForTests, type VisionProvider } from "@/application/intelligence-providers";
import { getTeacherWorkspace } from "@/application/queries";
import { retrieveEvidence } from "@/application/retrieval";
import { closeDb, getDb } from "@/db/client";
import { SEED } from "@/db/ids";
import { courseEnrollments, evidenceUnits, fileAssets, governanceEvents, idempotencyKeys, institutionMemberships, learnerAttempts, sourceRecords, users } from "@/db/schema";
import type { Actor } from "@/domain/model";
import { setFileStorageForTests, type FileStorage } from "@/infrastructure/file-storage";
import { closeWorkflowCheckpointer } from "@/workflows/checkpointer";
import { minimalPng, simplePdf } from "@/tests/helpers/files";

class MemoryStorage implements FileStorage {
  readonly objects = new Map<string, Uint8Array>();
  async put(input: { key: string; bytes: Uint8Array }) { this.objects.set(input.key, input.bytes.slice()); return { storageKey: input.key, byteSize: input.bytes.byteLength }; }
  async read(key: string) { const value = this.objects.get(key); if (!value) throw new Error("missing object"); return value.slice(); }
  async delete(key: string) { this.objects.delete(key); }
}

const embeddingProvider = {
  model: "test-real-vector-adapter",
  embedDocuments: async (texts: string[]) => texts.map(() => [1, 0, 0]),
  embedQuery: async () => [1, 0, 0],
};
const rerankProvider = {
  model: "test-rerank-adapter",
  rerank: async (documents: string[], _query: string, topN: number) => documents.slice(0, topN).map((_document, index) => ({ index, relevanceScore: 1 - index * 0.01 })),
};

function configureTestProviders(vision: VisionProvider | null = null) {
  setIntelligenceProvidersForTests({ embedding: embeddingProvider, rerank: rerankProvider, vision });
}

describe.sequential("Real intelligence and Evidence PostgreSQL integration", () => {
  let learner: Actor;
  let teacher: Actor;
  const storage = new MemoryStorage();

  beforeAll(async () => {
    learner = await getActor(SEED.learner, SEED.institution, "integration-test", `intelligence-learner:${randomUUID()}`);
    teacher = await getActor(SEED.teacher, SEED.institution, "integration-test", `intelligence-teacher:${randomUUID()}`);
    setFileStorageForTests(storage);
    configureTestProviders();
  });

  afterAll(async () => {
    setIntelligenceProvidersForTests(null);
    setFileStorageForTests(null);
    await closeWorkflowCheckpointer();
    await closeDb();
  });

  it("stores real PDF bytes outside Product State and gates page Evidence on human rights approval", async () => {
    const phrase = `lfunique${randomUUID().replaceAll("-", "")}`;
    const bytes = simplePdf(phrase);
    const uploaded = await uploadLearningMaterial(learner, {
      taskId: SEED.task,
      episodeId: SEED.episode,
      title: `PDF integration ${phrase}`,
      rights: "Learner supplied for institution course use; requires teacher verification.",
      bytes,
      declaredMediaType: "application/pdf",
      originalName: "enthalpy-notes.pdf",
      idempotencyKey: `pdf-upload:${randomUUID()}`,
    });
    expect(uploaded.fileAsset?.ingestionStatus).toBe("EXTRACTED");
    expect(storage.objects.get(uploaded.fileAsset!.storageKey)).toEqual(bytes);
    expect(Object.keys(uploaded.fileAsset!)).not.toContain("bytes");
    const [sourceBefore] = await getDb().select().from(sourceRecords).where(eq(sourceRecords.id, uploaded.fileAsset!.sourceId!));
    expect(sourceBefore.rightsAuthorizationStatus).toBe("REVIEW_REQUIRED");
    expect(await getDb().select().from(evidenceUnits).where(eq(evidenceUnits.sourceId, sourceBefore.id))).toHaveLength(0);
    const beforeApproval = await retrieveEvidence({ actor: learner, taskId: SEED.task, query: phrase, purpose: "LEARNING" });
    expect(beforeApproval.hits.some((hit) => hit.sourceId === sourceBefore.id)).toBe(false);

    const decision = await reviewSourceRights(teacher, { sourceId: sourceBefore.id, decision: "APPROVED", rights: "Institution course delivery approved by authenticated teacher.", idempotencyKey: `rights:${randomUUID()}` });
    expect(decision.evidenceCount).toBe(1);
    const [evidence] = await getDb().select().from(evidenceUnits).where(eq(evidenceUnits.sourceId, sourceBefore.id));
    expect(evidence).toMatchObject({ locator: "page:1", embeddingStatus: "AVAILABLE", embeddingModel: "test-real-vector-adapter" });
    expect(evidence.content).toContain(phrase);

    const retrieval = await retrieveEvidence({ actor: learner, taskId: SEED.task, query: phrase, purpose: "LEARNING" });
    expect(retrieval).toMatchObject({ retrievalMode: "POSTGRES_FTS_OPENAI_EXACT_VECTOR", embeddingStatus: "EXECUTED", rerankerStatus: "EXECUTED" });
    expect(retrieval.citations.some((citation) => citation.sourceId === sourceBefore.id && citation.locator === "page:1")).toBe(true);
    expect((await authorizeFileRead(learner, uploaded.fileAsset!.id)).bytes).toEqual(bytes);
    expect((await authorizeFileRead(teacher, uploaded.fileAsset!.id)).bytes).toEqual(bytes);
  });

  it("keeps denied rights and failed ingestion out of Evidence", async () => {
    const denied = await uploadLearningMaterial(learner, {
      taskId: SEED.task, episodeId: SEED.episode, title: "Denied source", rights: "Unknown rights requiring review.",
      bytes: simplePdf(`denied rights ${randomUUID()}`), declaredMediaType: "application/pdf", originalName: "denied.pdf", idempotencyKey: `denied-upload:${randomUUID()}`,
    });
    await reviewSourceRights(teacher, { sourceId: denied.fileAsset!.sourceId!, decision: "DENIED", rights: "Rights could not be verified.", idempotencyKey: `denied-rights:${randomUUID()}` });
    expect(await getDb().select().from(evidenceUnits).where(eq(evidenceUnits.sourceId, denied.fileAsset!.sourceId!))).toHaveLength(0);

    const failed = await uploadLearningMaterial(learner, {
      taskId: SEED.task, episodeId: SEED.episode, title: "Broken PDF", rights: "Course review required.",
      bytes: new TextEncoder().encode("%PDF-not-a-document"), declaredMediaType: "application/pdf", originalName: "broken.pdf", idempotencyKey: `broken-upload:${randomUUID()}`,
    });
    expect(failed.fileAsset).toMatchObject({ ingestionStatus: "FAILED", failureCode: "PDF_EXTRACTION_FAILED" });
  });

  it("allows exactly one conflicting terminal source-rights decision and never replays the losing reservation", async () => {
    const secondTeacherId = randomUUID();
    await getDb().transaction(async (tx) => {
      await tx.insert(users).values({ id: secondTeacherId, email: `rights-race-${secondTeacherId}@integration.invalid`, name: "Rights Race Teacher" });
      await tx.insert(institutionMemberships).values({ userId: secondTeacherId, institutionId: SEED.institution, role: "TEACHER" });
      await tx.insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId: secondTeacherId, role: "TEACHER" });
    });
    const secondTeacher = await getActor(secondTeacherId, SEED.institution, "integration-test", `rights-race-teacher:${randomUUID()}`);
    const uploaded = await uploadLearningMaterial(learner, {
      taskId: SEED.task,
      episodeId: SEED.episode,
      title: `Conflicting rights race ${randomUUID()}`,
      rights: "Concurrent authenticated review required.",
      bytes: simplePdf(`rights race evidence ${randomUUID()}`),
      declaredMediaType: "application/pdf",
      originalName: "rights-race.pdf",
      idempotencyKey: `rights-race-upload:${randomUUID()}`,
    });
    const sourceId = uploaded.fileAsset!.sourceId!;
    const approvedInput = { sourceId, decision: "APPROVED" as const, rights: "Approved for institution course delivery.", idempotencyKey: `rights-race-approved:${randomUUID()}` };
    const deniedInput = { sourceId, decision: "DENIED" as const, rights: "Denied because rights could not be verified.", idempotencyKey: `rights-race-denied:${randomUUID()}` };

    const results = await Promise.allSettled([
      reviewSourceRights(teacher, approvedInput),
      reviewSourceRights(secondTeacher, deniedInput),
    ]);
    const successes = results.filter((result) => result.status === "fulfilled");
    const conflicts = results.filter((result) => result.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ status: "rejected", reason: { code: "SOURCE_RIGHTS_CONFLICT" } });

    const winningDecision = results[0]?.status === "fulfilled" ? "APPROVED" : "DENIED";
    const [sourceAfter] = await getDb().select().from(sourceRecords).where(eq(sourceRecords.id, sourceId));
    const rightsEvents = await getDb().select().from(governanceEvents).where(and(
      eq(governanceEvents.entityType, "SOURCE_RECORD"),
      eq(governanceEvents.entityId, sourceId),
    ));
    const evidence = await getDb().select().from(evidenceUnits).where(eq(evidenceUnits.sourceId, sourceId));
    expect(sourceAfter.rightsAuthorizationStatus).toBe(winningDecision);
    expect(rightsEvents).toHaveLength(1);
    expect(rightsEvents[0]?.action).toBe(`RIGHTS_${winningDecision}`);
    expect(evidence).toHaveLength(winningDecision === "APPROVED" ? 1 : 0);

    const losingActor = winningDecision === "APPROVED" ? secondTeacher : teacher;
    const losingInput = winningDecision === "APPROVED" ? deniedInput : approvedInput;
    expect(await getDb().select().from(idempotencyKeys).where(and(
      eq(idempotencyKeys.institutionId, SEED.institution),
      eq(idempotencyKeys.commandType, "REVIEW_SOURCE_RIGHTS"),
      eq(idempotencyKeys.key, losingInput.idempotencyKey),
    ))).toHaveLength(0);
    await expect(reviewSourceRights(losingActor, losingInput)).rejects.toMatchObject({ code: "SOURCE_RIGHTS_CONFLICT" });
  });

  it("preserves an image Attempt and exposes an honest missing-provider state to Teacher review", async () => {
    const result = await uploadImageAttempt(learner, {
      taskId: SEED.task,
      episodeId: SEED.episode,
      prompt: "Inspect this handwritten equilibrium Attempt.",
      learnerNote: "My equilibrium expression is shown in the image.",
      bytes: minimalPng,
      declaredMediaType: "image/png",
      originalName: "equilibrium-attempt.png",
      idempotencyKey: `image-attempt:${randomUUID()}`,
    });
    expect(result.fileAsset).toMatchObject({ interpretationStatus: "PROVIDER_UNAVAILABLE", failureCode: "MULTIMODAL_PROVIDER_UNAVAILABLE" });
    const [attempt] = await getDb().select().from(learnerAttempts).where(eq(learnerAttempts.fileAssetId, result.fileAsset!.id));
    expect(attempt.structuredInput).toMatchObject({ responseType: "IMAGE", visionStatus: "PROVIDER_UNAVAILABLE", fileAssetId: result.fileAsset!.id });
    const workspace = await getTeacherWorkspace(teacher);
    expect(workspace.queue.some((row) => row.file_asset_id === result.fileAsset!.id && row.file_interpretation_status === "PROVIDER_UNAVAILABLE")).toBe(true);
  });

  it("materializes only an image transcription as Evidence and records its model derivation", async () => {
    const transcription = `VISIBLE_TRANSCRIPTION_${randomUUID()}`;
    const interpretationOnly = `INTERPRETATION_ONLY_${randomUUID()}`;
    configureTestProviders({
      provider: "TEST_VISION_PROVIDER",
      model: "test-vision-model-v1",
      interpret: async () => ({ transcription, interpretation: interpretationOnly, usage: {} }),
    });
    try {
      const uploaded = await uploadLearningMaterial(learner, {
        taskId: SEED.task,
        episodeId: SEED.episode,
        title: `Image transcription integrity ${randomUUID()}`,
        rights: "Authenticated course-rights review required.",
        bytes: minimalPng,
        declaredMediaType: "image/png",
        originalName: "model-transcribed-source.png",
        idempotencyKey: `image-material:${randomUUID()}`,
      });
      expect(uploaded.fileAsset).toMatchObject({
        extractionText: transcription,
        interpretation: interpretationOnly,
        extractionMetadata: {
          derivation: "MODEL_DERIVED_TRANSCRIPTION",
          provider: "TEST_VISION_PROVIDER",
          model: "test-vision-model-v1",
        },
      });
      expect(uploaded.fileAsset?.extractionText).not.toContain(interpretationOnly);

      await reviewSourceRights(teacher, {
        sourceId: uploaded.fileAsset!.sourceId!,
        decision: "APPROVED",
        rights: "Teacher approved original image delivery and its visible-content transcription.",
        idempotencyKey: `image-material-rights:${randomUUID()}`,
      });
      const [evidence] = await getDb().select().from(evidenceUnits).where(eq(evidenceUnits.sourceId, uploaded.fileAsset!.sourceId!));
      expect(evidence.content).toContain(transcription);
      expect(evidence.content).not.toContain(interpretationOnly);
      expect(evidence.structuredContent).toMatchObject({
        fileAssetId: uploaded.fileAsset!.id,
        citedArtifact: "ORIGINAL_UPLOADED_IMAGE",
        derivation: { type: "MODEL_DERIVED_TRANSCRIPTION", provider: "TEST_VISION_PROVIDER", model: "test-vision-model-v1" },
      });
    } finally {
      configureTestProviders();
    }
  });

  it("rejects another learner or institution reading a governed upload", async () => {
    const [asset] = await getDb().select().from(fileAssets).where(and(eq(fileAssets.ownerUserId, learner.userId), eq(fileAssets.purpose, "LEARNING_MATERIAL"))).limit(1);
    const otherLearner: Actor = { ...learner, userId: randomUUID(), sessionId: `other:${randomUUID()}` };
    await expect(authorizeFileRead(otherLearner, asset.id)).rejects.toMatchObject({ code: "FILE_ACCESS_DENIED" });
    const otherInstitution: Actor = { ...teacher, institutionId: randomUUID(), sessionId: `other-institution:${randomUUID()}` };
    await expect(authorizeFileRead(otherInstitution, asset.id)).rejects.toMatchObject({ code: "TENANT_ISOLATION" });
  });
});
