import { afterEach, describe, expect, it } from "vitest";
import { explainWithEvidence } from "@/application/model";
import type { Citation } from "@/domain/model";
import type { RetrievalHit } from "@/application/retrieval";
import { explanationEventInput, mapExplanationResult } from "@/workflows/explanation";

const priorApiKey = process.env.DEEPSEEK_API_KEY;
const priorOpenAiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (priorApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = priorApiKey;
  if (priorOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = priorOpenAiKey;
});

describe("Evidence-present explanation without a configured model", () => {
  it("maps the honest response into graph state and preserves citations for the persisted event", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const hit: RetrievalHit = {
      evidenceUnitId: "70000000-0000-4000-8000-000000000001",
      sourceId: "60000000-0000-4000-8000-000000000001",
      sourceVersion: "checkpoint-a",
      sourceTitle: "Reviewed synthetic teacher note",
      locator: "synthetic-note#reasoning-route",
      modality: "TEXT",
      content: "Inspect units and justify each transformation.",
      structuredContent: null,
      rightsAuthorizationStatus: "APPROVED",
      distributionScope: "PUBLIC",
      allowedPurposes: ["LEARNING"],
      institutionId: null,
      evidenceInstitutionId: null,
      lexicalScore: 1,
      vectorScore: null,
      rerankerScore: null,
      score: 1,
      embedding: null,
      embeddingStatus: "PROVIDER_UNAVAILABLE",
    };
    const citation: Citation = {
      evidenceUnitId: hit.evidenceUnitId,
      sourceId: hit.sourceId,
      sourceVersion: hit.sourceVersion,
      locator: hit.locator,
      label: "Reviewed synthetic teacher note · reasoning route",
    };

    const synthesis = await explainWithEvidence({
      actor: { userId: "20000000-0000-4000-8000-000000000001", institutionId: "10000000-0000-4000-8000-000000000001", roles: ["LEARNER"], courseIds: ["40000000-0000-4000-8000-000000000001"], authMethod: "test", sessionId: "test" },
      taskId: "80000000-0000-4000-8000-000000000001",
      question: "How should I inspect the calculation?", hits: [hit], citations: [citation], context: [],
    });
    const mapped = mapExplanationResult(synthesis);
    expect(mapped).toMatchObject({ model: null, synthesisStatus: "UNAVAILABLE" });
    expect(mapped.response).toContain("Model synthesis is unavailable");
    expect(mapped.response.length).toBeGreaterThan(0);

    const event = explanationEventInput({
      taskId: "80000000-0000-4000-8000-000000000001",
      episodeId: "80000000-0000-4000-8000-000000000002",
      response: mapped.response,
      citations: [citation],
      eventIdempotencyKey: "explanation-event:test",
    });
    expect(event.content).toBe(mapped.response);
    expect(event.sourceRefs).toEqual([{ sourceId: citation.sourceId, sourceVersion: citation.sourceVersion, locator: citation.locator }]);
    expect(event.evidenceRefs).toEqual([{ evidenceUnitId: citation.evidenceUnitId, kind: "RETRIEVAL" }]);
  });
});
