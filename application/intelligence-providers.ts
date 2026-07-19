import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { CohereRerank } from "@langchain/cohere";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

export type TokenUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export interface EmbeddingProvider {
  readonly model: string;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export interface RerankProvider {
  readonly model: string;
  rerank(documents: string[], query: string, topN: number): Promise<Array<{ index: number; relevanceScore: number }>>;
}

export type VisionResult = {
  transcription: string;
  interpretation: string;
  usage: TokenUsage;
};

export interface VisionProvider {
  readonly provider: string;
  readonly model: string;
  interpret(input: { bytes: Uint8Array; mediaType: string; purpose: "LEARNING_MATERIAL" | "LEARNER_ATTEMPT" }): Promise<VisionResult>;
}

let embeddingOverride: EmbeddingProvider | null | undefined;
let rerankOverride: RerankProvider | null | undefined;
let visionOverride: VisionProvider | null | undefined;
let embeddingProvider: EmbeddingProvider | null = null;
let rerankProvider: RerankProvider | null = null;
let visionProvider: VisionProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (embeddingOverride !== undefined) return embeddingOverride;
  if (!process.env.OPENAI_API_KEY) return null;
  if (!embeddingProvider) {
    const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
    const dimensions = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? "1536");
    const client = new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY, model, dimensions, maxRetries: 2 });
    embeddingProvider = {
      model,
      embedDocuments: (texts) => client.embedDocuments(texts),
      embedQuery: (text) => client.embedQuery(text),
    };
  }
  return embeddingProvider;
}

export function getRerankProvider(): RerankProvider | null {
  if (rerankOverride !== undefined) return rerankOverride;
  if (!process.env.COHERE_API_KEY) return null;
  if (!rerankProvider) {
    const model = process.env.COHERE_RERANK_MODEL ?? "rerank-v3.5";
    const client = new CohereRerank({ apiKey: process.env.COHERE_API_KEY, model });
    rerankProvider = {
      model,
      rerank: (documents, query, topN) => client.rerank(documents, query, { model, topN }),
    };
  }
  return rerankProvider;
}

const VisionPayload = z.object({
  transcription: z.string(),
  interpretation: z.string(),
});

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => typeof part === "object" && part && "text" in part && typeof part.text === "string" ? [part.text] : []).join("");
}

function parseJsonPayload(text: string): z.infer<typeof VisionPayload> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  return VisionPayload.parse(JSON.parse(fenced.trim()));
}

export function getVisionProvider(): VisionProvider | null {
  if (visionOverride !== undefined) return visionOverride;
  if (!process.env.OPENAI_API_KEY) return null;
  if (!visionProvider) {
    const modelName = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";
    const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY, model: modelName, temperature: 0, maxRetries: 2 });
    visionProvider = {
      provider: "OPENAI",
      model: modelName,
      async interpret(input) {
        const instruction = input.purpose === "LEARNER_ATTEMPT"
          ? "Transcribe all visible handwritten or printed learner work exactly, preserving equations and uncertainty. Then provide a concise interpretation for an authorized teacher. Do not grade, diagnose, or invent hidden steps."
          : "Transcribe all visible learning content exactly and provide a concise content description. Preserve visible labels, equations, tables, and uncertainty. Do not invent missing content.";
        const response = await model.invoke([new HumanMessage({ content: [
          { type: "text", text: `${instruction}\nReturn only JSON with string fields transcription and interpretation.` },
          { type: "image_url", image_url: { url: `data:${input.mediaType};base64,${Buffer.from(input.bytes).toString("base64")}`, detail: "high" } },
        ] })]);
        const payload = parseJsonPayload(textContent(response.content));
        const usage = response.usage_metadata;
        return {
          ...payload,
          usage: {
            inputTokens: usage?.input_tokens,
            outputTokens: usage?.output_tokens,
            totalTokens: usage?.total_tokens,
          },
        };
      },
    };
  }
  return visionProvider;
}

export function setIntelligenceProvidersForTests(input: {
  embedding?: EmbeddingProvider | null;
  rerank?: RerankProvider | null;
  vision?: VisionProvider | null;
} | null): void {
  embeddingOverride = input ? input.embedding : undefined;
  rerankOverride = input ? input.rerank : undefined;
  visionOverride = input ? input.vision : undefined;
}
