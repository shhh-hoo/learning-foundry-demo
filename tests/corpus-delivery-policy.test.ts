import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createAgentToolExecutor } from "../src/agent/tool-executor";
import { runAgent } from "../src/agent/run-agent";
import { createCorpusDeliveryPolicyRuntime } from "../src/corpus/delivery-policy";
import type { CorpusSearchService } from "../src/corpus/types";
import type { AgentModelClient } from "../src/agent/deepseek-client";

const policyText = await readFile("config/corpus/delivery-policy.json", "utf8");
const deliveryPolicy = createCorpusDeliveryPolicyRuntime(
  JSON.parse(policyText),
  createHash("sha256").update(policyText).digest("hex"),
);

const corpus: CorpusSearchService = {
  search: async (query, filters) => ({
    retrievalTraceId: "retrieval-trace-approved",
    query,
    filters,
    results: [{
      chunkId: "teacher-note::1",
      sourceId: "TN-001-COEFFICIENTS-TO-MOLE-RATIOS",
      sourceType: "TEACHER_NOTE",
      distributionScope: "SCHOOL_INTERNAL",
      title: "Equation coefficients",
      excerpt: "Coefficients define a particle ratio, and scaling by the Avogadro constant preserves that ratio in moles.",
      syllabusCode: "9701",
      learningOutcomeIds: ["2.4.1"],
      calculationFamilyIds: ["CORE-001"],
      score: 12,
    }],
  }),
};

describe("corpus delivery policy", () => {
  it("allows approved DeepSeek PRODUCT delivery with traceable policy metadata", async () => {
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus,
      corpusDeliveryPolicy: deliveryPolicy,
      provider: "deepseek",
      runPurpose: "PRODUCT",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    const result = await tools.execute("search_learning_resources", { query: "coefficient mole ratio" });

    expect(result.data).toMatchObject({
      retrievalTraceId: "retrieval-trace-approved",
      deliveryPolicy: { version: "1.0.0", contentHash: deliveryPolicy.contentHash },
      results: [{ sourceId: "TN-001-COEFFICIENTS-TO-MOLE-RATIOS" }],
    });
  });

  it("allows approved DeepSeek AGENT_EVAL delivery", async () => {
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus,
      corpusDeliveryPolicy: deliveryPolicy,
      provider: "deepseek",
      runPurpose: "AGENT_EVAL",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    await expect(tools.execute("search_learning_resources", { query: "coefficient mole ratio" })).resolves.toMatchObject({
      data: { deliveryPolicy: { version: "1.0.0" } },
    });
  });

  it("fails closed for an unknown provider", async () => {
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus,
      corpusDeliveryPolicy: deliveryPolicy,
      provider: "unknown-provider",
      runPurpose: "PRODUCT",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    await expect(tools.execute("search_learning_resources", { query: "coefficient mole ratio" }))
      .rejects.toThrow("CORPUS_PROVIDER_NOT_APPROVED");
  });

  it("fails closed for an unapproved purpose", async () => {
    const productOnlyPolicy = createCorpusDeliveryPolicyRuntime(
      { ...deliveryPolicy.policy, allowedPurposes: ["PRODUCT"] },
      deliveryPolicy.contentHash,
    );
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus,
      corpusDeliveryPolicy: productOnlyPolicy,
      provider: "deepseek",
      runPurpose: "AGENT_EVAL",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    await expect(tools.execute("search_learning_resources", { query: "coefficient mole ratio" }))
      .rejects.toThrow("CORPUS_PURPOSE_NOT_APPROVED");
  });

  it("fails closed for an unapproved source type", async () => {
    const syllabusOnlyPolicy = createCorpusDeliveryPolicyRuntime(
      { ...deliveryPolicy.policy, allowedSourceTypes: ["OFFICIAL_SYLLABUS"] },
      deliveryPolicy.contentHash,
    );
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus,
      corpusDeliveryPolicy: syllabusOnlyPolicy,
      provider: "deepseek",
      runPurpose: "PRODUCT",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    await expect(tools.execute("search_learning_resources", { query: "coefficient mole ratio" }))
      .rejects.toThrow("CORPUS_SOURCE_TYPE_NOT_APPROVED");
  });

  it("fails closed for an unapproved distribution scope", async () => {
    const publicCorpus: CorpusSearchService = {
      search: async (query, filters) => ({
        ...(await corpus.search(query, filters)),
        results: [{ ...(await corpus.search(query, filters)).results[0]!, distributionScope: "PUBLIC" }],
      }),
    };
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus: publicCorpus,
      corpusDeliveryPolicy: deliveryPolicy,
      provider: "deepseek",
      runPurpose: "PRODUCT",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    await expect(tools.execute("search_learning_resources", { query: "coefficient mole ratio" }))
      .rejects.toThrow("CORPUS_DISTRIBUTION_SCOPE_NOT_APPROVED");
  });

  it("caps delivered results and source references", async () => {
    const manyResultsCorpus: CorpusSearchService = {
      search: async (query, filters) => {
        const base = await corpus.search(query, filters);
        return {
          ...base,
          results: Array.from({ length: 7 }, (_, index) => ({
            ...base.results[0]!,
            chunkId: `teacher-note::${index}`,
            sourceId: `TN-${index}`,
          })),
        };
      },
    };
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus: manyResultsCorpus,
      corpusDeliveryPolicy: deliveryPolicy,
      provider: "deepseek",
      runPurpose: "PRODUCT",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    const result = await tools.execute("search_learning_resources", { query: "coefficient mole ratio" });

    expect((result.data as { results: readonly unknown[] }).results).toHaveLength(5);
    expect(result.sourceRefs).toEqual(["TN-0", "TN-1", "TN-2", "TN-3", "TN-4"]);
  });

  it("caps each delivered excerpt", async () => {
    const longExcerptCorpus: CorpusSearchService = {
      search: async (query, filters) => {
        const base = await corpus.search(query, filters);
        return { ...base, results: [{ ...base.results[0]!, excerpt: Array.from({ length: 140 }, (_, index) => `word${index}`).join(" ") }] };
      },
    };
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus: longExcerptCorpus,
      corpusDeliveryPolicy: deliveryPolicy,
      provider: "deepseek",
      runPurpose: "PRODUCT",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    const result = await tools.execute("search_learning_resources", { query: "coefficient mole ratio" });
    const [delivered] = (result.data as { results: readonly { excerpt: string }[] }).results;

    expect(delivered?.excerpt.split(/\s+/u)).toHaveLength(100);
    expect(delivered?.excerpt).not.toContain("word100");
  });

  it.each([
    ["raw PDF bytes", { pdfBytes: new Uint8Array([37, 80, 68, 70]) }],
    ["a local source path", { localPath: "/Users/shhh/Documents/Learning Foundry/private-sources/source.pdf" }],
  ])("rejects %s before creating provider-visible tool data", async (_label, unsafeFields) => {
    const unsafeCorpus: CorpusSearchService = {
      search: async (query, filters) => {
        const base = await corpus.search(query, filters);
        return { ...base, results: [{ ...base.results[0]!, ...unsafeFields }] };
      },
    };
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus: unsafeCorpus,
      corpusDeliveryPolicy: deliveryPolicy,
      provider: "deepseek",
      runPurpose: "PRODUCT",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    await expect(tools.execute("search_learning_resources", { query: "coefficient mole ratio" }))
      .rejects.toThrow("CORPUS_DELIVERY_PAYLOAD_UNSAFE");
  });

  it.each([
    ["an API key", { apiKey: "sk-private-secret-value" }],
    ["an Authorization header", { Authorization: "Bearer private-secret-value" }],
  ])("rejects %s before it can enter evidence", async (_label, unsafeFields) => {
    const unsafeCorpus: CorpusSearchService = {
      search: async (query, filters) => {
        const base = await corpus.search(query, filters);
        return { ...base, results: [{ ...base.results[0]!, ...unsafeFields }] };
      },
    };
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus: unsafeCorpus,
      corpusDeliveryPolicy: deliveryPolicy,
      provider: "deepseek",
      runPurpose: "PRODUCT",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });

    await expect(tools.execute("search_learning_resources", { query: "coefficient mole ratio" }))
      .rejects.toThrow("CORPUS_DELIVERY_PAYLOAD_UNSAFE");
  });

  it("delivers the excerpt to DeepSeek but persists only policy and retrieval metadata", async () => {
    const tools = createAgentToolExecutor({
      capabilities: [],
      corpus,
      corpusDeliveryPolicy: deliveryPolicy,
      provider: "deepseek",
      runPurpose: "PRODUCT",
      diagnosisUrl: "http://127.0.0.1:4177/diagnose",
    });
    let providerCall = 0;
    const modelClient: AgentModelClient = { call: async ({ messages }) => {
      providerCall += 1;
      if (providerCall === 1) return { message: { role: "assistant", content: null, tool_calls: [{ id: "search-1", type: "function", function: { name: "search_learning_resources", arguments: '{"query":"coefficient mole ratio"}' } }] } };
      expect(messages.at(-1)?.content).toContain("Avogadro constant preserves that ratio");
      expect(messages.at(-1)?.content).toContain(deliveryPolicy.contentHash);
      return { message: { role: "assistant", content: JSON.stringify({ status: "ANSWERED", learnerMessage: "Coefficients give a particle ratio, and scaling by a fixed Avogadro amount preserves the mole ratio.", sourceRefs: ["TN-001-COEFFICIENTS-TO-MOLE-RATIOS"], evidenceRefs: ["retrieval-trace-approved"] }) } };
    } };
    const persistedExecutions: unknown[] = [];

    await runAgent({
      request: { conversationId: "policy-trace-test", inputOrigin: "USER_INPUT", runPurpose: "PRODUCT", messages: [{ role: "user", content: "Why do coefficients give mole ratios?" }] },
      model: "configured-test-model",
      thinkingMode: "disabled",
      systemPrompt: "Use governed retrieval.",
      promptVersion: "test",
      capabilityRegistryVersion: "test",
      toolDefinitions: [{ type: "function", function: { name: "search_learning_resources" } }],
      modelClient,
      tools,
      onToolExecution: (execution) => { persistedExecutions.push(execution); },
    });

    const persisted = JSON.stringify(persistedExecutions);
    expect(persisted).toContain(deliveryPolicy.contentHash);
    expect(persisted).toContain("retrieval-trace-approved");
    expect(persisted).not.toContain("Avogadro constant preserves that ratio");
    expect(persisted).not.toMatch(/api.?key|authorization|Bearer|private-sources/iu);
  });
});
