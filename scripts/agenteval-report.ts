import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentEvalRepository, buildAgentEvalReport } from "./lib/agent-eval-repository.ts";

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const pointer = argument("--run") ? null : await readFile(".agent-eval-results/latest.json", "utf8").then((value) => JSON.parse(value) as { evalRunId: string }).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") throw new Error("EVAL_RUN_NOT_FOUND: No live AgentEval run has been persisted. Run agenteval:live with server-side DeepSeek configuration first.");
  throw error;
});
const evalRunId = argument("--run") ?? pointer?.evalRunId;
if (!evalRunId) throw new Error("EVAL_RUN_ID_REQUIRED: Pass --run <evalRunId> or run agenteval:live first.");
const repository = new AgentEvalRepository(path.resolve(process.env.AGENT_EVAL_STORE_DIR ?? ".local-data/agent-eval-runs"));
const run = await repository.get(evalRunId);
if (!run) throw new Error(`EVAL_RUN_NOT_FOUND: ${evalRunId}`);
const report = buildAgentEvalReport(run);
await mkdir(".agent-eval-results", { recursive: true });
await writeFile(`.agent-eval-results/${evalRunId}.report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(".agent-eval-results/report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
