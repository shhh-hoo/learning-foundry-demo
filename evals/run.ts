import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { evaluateFrameworkContractCase, type EvalResult } from "@/evals/evaluators/core";
import { retrieveEvidence } from "@/application/retrieval";
import { getDb, closeDb } from "@/db/client";
import { evalRuns } from "@/db/schema";
import { SEED } from "@/db/ids";
import type { Actor } from "@/domain/model";

async function readJsonl(path: string) {
  return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

export async function runFrameworkContractChecks(actor?: Actor): Promise<{ passed: number; failed: number; results: EvalResult[] }> {
  const root = resolve(process.cwd(), "evals");
  const coreCases = await readJsonl(`${root}/datasets/core-v1.jsonl`);
  const results: EvalResult[] = [];
  for (const testCase of coreCases) results.push(await evaluateFrameworkContractCase(testCase));
  const evalActor = actor ?? { userId: SEED.engineer, institutionId: SEED.institution, roles: ["ENGINEER"], courseIds: [SEED.course], authMethod: "eval-runner", sessionId: `eval:${Date.now()}` };
  const retrievalCases = await readJsonl(`${root}/datasets/retrieval-v1.jsonl`);
  for (const testCase of retrievalCases) {
    const response = await retrieveEvidence({ actor: evalActor, taskId: SEED.task, query: String(testCase.query), purpose: "EVAL", limit: 3 });
    const hit = response.hits.some((item) => item.locator === testCase.expectedLocator || item.modality === testCase.expectedModality);
    results.push({ id: String(testCase.id), passed: hit, details: { hits: response.hits.map((item) => ({ locator: item.locator, modality: item.modality, score: item.score })) } });
  }
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  await getDb().insert(evalRuns).values({ institutionId: evalActor.institutionId, dataset: "framework-core-contract-checks", datasetVersion: "1.0.0", status: failed ? "FAIL" : "PASS", passed, failed, results });
  return { passed, failed, results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await runFrameworkContractChecks();
  console.log(JSON.stringify(report, null, 2));
  await closeDb();
  process.exitCode = report.failed ? 1 : 0;
}
