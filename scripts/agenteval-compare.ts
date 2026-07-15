import path from "node:path";
import { AgentEvalRepository, buildAgentEvalReport, compareAgentEvalReports } from "./lib/agent-eval-repository.ts";

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const baselineId = argument("--baseline"); const candidateId = argument("--candidate");
if (!baselineId || !candidateId) throw new Error("EVAL_RUN_IDS_REQUIRED: Pass --baseline <evalRunId> --candidate <evalRunId>.");
const repository = new AgentEvalRepository(path.resolve(process.env.AGENT_EVAL_STORE_DIR ?? ".local-data/agent-eval-runs"));
const baseline = await repository.get(baselineId); const candidate = await repository.get(candidateId);
if (!baseline || !candidate) throw new Error(`EVAL_RUN_NOT_FOUND: ${!baseline ? baselineId : candidateId}`);
console.log(JSON.stringify(compareAgentEvalReports(buildAgentEvalReport(baseline), buildAgentEvalReport(candidate)), null, 2));
