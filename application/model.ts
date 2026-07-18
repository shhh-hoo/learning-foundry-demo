import { ChatDeepSeek } from "@langchain/deepseek";
import type { Citation } from "@/domain/model";
import type { RetrievalHit } from "@/application/retrieval";
import { traced } from "@/application/telemetry";

let model: ChatDeepSeek | null = null;

function getModel(): ChatDeepSeek | null {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  if (!model) {
    model = new ChatDeepSeek({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      temperature: 0.2,
      maxRetries: 2,
      configuration: { baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com" },
    });
  }
  return model;
}

export async function explainWithEvidence(input: { question: string; hits: RetrievalHit[]; citations: Citation[]; context: string[] }) {
  if (!input.hits.length) return { text: "No authorized Evidence matched this request. Model synthesis was not run.", model: null, status: "REVIEW_REQUIRED" as const };
  const activeModel = getModel();
  if (!activeModel) {
    return { text: "Model synthesis is unavailable. Review the separately displayed governed Evidence and citations; no answer was generated.", model: null, status: "UNAVAILABLE" as const };
  }
  return traced("foundry.model.explanation", { "model.name": process.env.DEEPSEEK_MODEL ?? "deepseek-chat", "evidence.count": input.hits.length }, async () => {
    const evidence = input.hits.map((hit, index) => `[${index + 1}] ${hit.content} (${hit.locator})`).join("\n");
    const response = await activeModel.invoke([
      { role: "system", content: "You are Learning Foundry. Answer only from the supplied authorized Evidence. Cite using [1], [2]. State when Evidence is insufficient. Do not claim a tool or Diagnosis was executed." },
      { role: "user", content: `Question: ${input.question}\nScoped context: ${input.context.join(" | ")}\nEvidence:\n${evidence}` },
    ]);
    const text = typeof response.content === "string" ? response.content : response.content.map((part) => "text" in part ? part.text : "").join("");
    return { text, model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat", status: "AVAILABLE" as const };
  });
}
