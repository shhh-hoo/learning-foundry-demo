import { performance } from "node:perf_hooks";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
import type { Actor, Citation } from "@/domain/model";
import type { RetrievalHit } from "@/application/retrieval";
import { traced } from "@/application/telemetry";
import { getDb } from "@/db/client";
import { modelRuns } from "@/db/schema";

type SynthesisClient = { invoke(input: Array<{ role: string; content: string }>): Promise<BaseMessage> };
type SynthesisProvider = { provider: "DEEPSEEK" | "OPENAI"; model: string; client: SynthesisClient };

let synthesisProvider: SynthesisProvider | null | undefined;

function configuredProvider(): SynthesisProvider | null {
  if (synthesisProvider !== undefined) return synthesisProvider;
  const requested = process.env.FOUNDRY_SYNTHESIS_PROVIDER?.toUpperCase();
  if ((requested === "DEEPSEEK" || !requested) && process.env.DEEPSEEK_API_KEY) {
    const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    synthesisProvider = {
      provider: "DEEPSEEK",
      model,
      client: new ChatDeepSeek({
        apiKey: process.env.DEEPSEEK_API_KEY,
        model,
        temperature: 0.2,
        maxRetries: 2,
        configuration: { baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com" },
      }) as SynthesisClient,
    };
    return synthesisProvider;
  }
  if ((requested === "OPENAI" || !requested) && process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_SYNTHESIS_MODEL ?? "gpt-4.1-mini";
    synthesisProvider = {
      provider: "OPENAI",
      model,
      client: new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY, model, temperature: 0.2, maxRetries: 2 }) as SynthesisClient,
    };
    return synthesisProvider;
  }
  synthesisProvider = null;
  return null;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => typeof part === "object" && part && "text" in part && typeof part.text === "string" ? [part.text] : []).join("").trim();
}

export function citedEvidence(text: string, citations: Citation[]): { citations: Citation[]; valid: boolean } {
  const indexes = [...text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  if (!indexes.length) return { citations: [], valid: false };
  if (indexes.some((index) => !Number.isInteger(index) || index < 1 || index > citations.length)) return { citations: [], valid: false };
  const unique = [...new Set(indexes)];
  return { citations: unique.map((index) => citations[index - 1]), valid: true };
}

async function recordRun(input: {
  actor: Actor;
  taskId: string;
  provider: string;
  model: string;
  status: string;
  latencyMs: number;
  evidenceUnitIds: string[];
  response?: BaseMessage;
  failureCode?: string;
}) {
  const usage = (input.response as { usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } } | undefined)?.usage_metadata;
  await getDb().insert(modelRuns).values({
    institutionId: input.actor.institutionId,
    taskId: input.taskId,
    callType: "GROUNDED_EXPLANATION",
    provider: input.provider,
    model: input.model,
    status: input.status,
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
    totalTokens: usage?.total_tokens,
    latencyMs: input.latencyMs,
    evidenceUnitIds: input.evidenceUnitIds,
    failureCode: input.failureCode,
  });
}

export async function explainWithEvidence(input: { actor: Actor; taskId: string; question: string; hits: RetrievalHit[]; citations: Citation[]; context: string[] }) {
  if (!input.hits.length) return { text: "No authorized Evidence matched this request. Model synthesis was not run.", model: null, provider: null, status: "REVIEW_REQUIRED" as const, citations: [] as Citation[] };
  const active = configuredProvider();
  if (!active) {
    return {
      text: "Model synthesis is unavailable. Review the attached governed Evidence and citations; no answer was generated.",
      model: null,
      provider: null,
      status: "UNAVAILABLE" as const,
      citations: input.citations,
    };
  }
  return traced("foundry.model.grounded_explanation", { "model.name": active.model, "model.provider": active.provider, "evidence.count": input.hits.length }, async () => {
    const started = performance.now();
    try {
      const evidence = input.hits.map((hit, index) => `[${index + 1}] ${hit.content}\nSource locator: ${hit.locator}`).join("\n\n");
      const response = await active.client.invoke([
        { role: "system", content: "You are Learning Foundry. Answer only from the supplied authorized Evidence. Every factual teaching claim must cite one or more supplied Evidence numbers such as [1]. State when Evidence is insufficient. Never cite a number that is not supplied. Do not claim a tool or Diagnosis was executed." },
        { role: "user", content: `Question: ${input.question}\nScoped Context selected by the enforced compiler:\n${input.context.join("\n")}\n\nAuthorized Evidence:\n${evidence}` },
      ]);
      const text = contentText(response.content);
      const integrity = citedEvidence(text, input.citations);
      if (!text || !integrity.valid) {
        await recordRun({ actor: input.actor, taskId: input.taskId, provider: active.provider, model: active.model, status: "CITATION_VALIDATION_FAILED", latencyMs: performance.now() - started, evidenceUnitIds: input.hits.map((hit) => hit.evidenceUnitId), response, failureCode: "CITATION_INTEGRITY" });
        return {
          text: "The configured model response was withheld because it did not contain a valid citation to the selected Evidence. Teacher review is required.",
          model: active.model,
          provider: active.provider,
          status: "REVIEW_REQUIRED" as const,
          citations: [] as Citation[],
        };
      }
      await recordRun({ actor: input.actor, taskId: input.taskId, provider: active.provider, model: active.model, status: "SUCCEEDED", latencyMs: performance.now() - started, evidenceUnitIds: integrity.citations.map((citation) => citation.evidenceUnitId), response });
      return { text, model: active.model, provider: active.provider, status: "AVAILABLE" as const, citations: integrity.citations };
    } catch (error) {
      await recordRun({ actor: input.actor, taskId: input.taskId, provider: active.provider, model: active.model, status: "FAILED", latencyMs: performance.now() - started, evidenceUnitIds: input.hits.map((hit) => hit.evidenceUnitId), failureCode: error instanceof Error ? error.name : "MODEL_FAILURE" });
      return {
        text: "The configured model call failed. No answer was generated; the governed Evidence remains available for teacher review.",
        model: active.model,
        provider: active.provider,
        status: "REVIEW_REQUIRED" as const,
        citations: [] as Citation[],
      };
    }
  });
}
