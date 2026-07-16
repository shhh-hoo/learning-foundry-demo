import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { createHash } from "node:crypto";
import { createCorpusDeliveryPolicyRuntime } from "../src/corpus/delivery-policy.ts";

const roots = ["src", "scripts", "docs", "tests"];
const extensions = new Set([".ts", ".tsx", ".md", ".json", ".html"]);
const forbiddenTerms = [new RegExp(`\\b(?:e${"val"}|e${"valuation"})\\b`, "iu"), new RegExp(`\\b(?:Foundry|Learner|Trainer|Runtime) E${"valuation"}\\b`, "iu")];
const forbiddenProductData = /\b(?:SYNTHETIC_DATA|SEEDED_EVIDENCE|HISTORICAL_FIXTURE|FAKE_REVIEW|PRECOMPUTED_AGENT_RESULT|SIMULATED_DIAGNOSIS|SIMULATED_TOOL_CALL)\b/u;
const violations: string[] = [];

async function files(path: string): Promise<readonly string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]))).flat();
}

for (const file of [...(await Promise.all(roots.map(files))).flat(), "README.md"]) {
  if (!extensions.has(extname(file)) && file !== "README.md") continue;
  const content = await readFile(file, "utf8");
  content.split(/\r?\n/).forEach((line, index) => {
    const terminologyLine = line.replaceAll("AgentEval", "").replaceAll("agent-eval", "");
    if (forbiddenTerms.some((pattern) => pattern.test(terminologyLine))) violations.push(`${file}:${index + 1}: forbidden terminology`);
    if (file.startsWith("src/") && forbiddenProductData.test(line)) violations.push(`${file}:${index + 1}: forbidden product-data origin`);
    if (file.startsWith("src/") && /from\s+["'][^"']*(?:fixtures|mocks)\//u.test(line)) violations.push(`${file}:${index + 1}: production imports test-only data`);
  });
}
if (violations.length) { console.error(violations.join("\n")); process.exitCode = 1; }
else {
  const deliveryPolicyText = await readFile("config/corpus/delivery-policy.json", "utf8");
  const deliveryPolicy = createCorpusDeliveryPolicyRuntime(JSON.parse(deliveryPolicyText), createHash("sha256").update(deliveryPolicyText).digest("hex"));
  const policy = deliveryPolicy.policy;
  if (policy.provider !== "deepseek"
    || !policy.allowedPurposes.includes("PRODUCT")
    || !policy.allowedPurposes.includes("AGENT_EVAL")
    || policy.allowRawPdfBytes
    || policy.allowFullDocument
    || policy.persistDeliveredExcerpt
    || policy.maxExcerptWordsPerResult > 100
    || policy.maxResultsPerRequest > 5) {
    throw new Error("CORPUS_DELIVERY_POLICY_UNSAFE: versioned policy exceeds the owner-approved local delivery scope.");
  }
  console.log("Terminology and data-origin policy audit passed.");
  console.log(`Corpus delivery policy ${policy.version}: ${deliveryPolicy.contentHash}`);
}
