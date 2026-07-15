import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gradeAgentCase, type AgentEvalCase, type AgentEvalToolResult } from "../src/agent/agenteval.ts";
import type { AgentTrace } from "../src/agent/types.ts";

const gateway = process.env.AGENT_GATEWAY_URL ?? "http://127.0.0.1:4176";
const notExecuted = (message?: string) => { console.error("AgentEval live run not executed"); if (message) console.error(message); process.exitCode = 1; };

try {
  const healthResponse = await fetch(`${gateway}/health`);
  const health = await healthResponse.json() as { configured?: boolean; provider?: string; model?: string | null; thinkingMode?: string };
  if (!healthResponse.ok || !health.configured || !health.model) { notExecuted("Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL, then start the local services."); }
  else {
    const lines = (await readFile(new URL("../agent-eval/cases.jsonl", import.meta.url), "utf8")).trim().split(/\r?\n/);
    const cases = lines.map((line) => JSON.parse(line) as AgentEvalCase);
    const results = [];
    for (const testCase of cases) {
      const response = await fetch(`${gateway}/agent/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: `agenteval-${testCase.caseId}`, inputOrigin: testCase.inputOrigin, messages: [{ role: "user", content: testCase.input }] }) });
      const body = await response.json() as { ok?: boolean; trace?: AgentTrace; toolResults?: readonly AgentEvalToolResult[]; error?: { code?: string; message?: string } };
      if (!response.ok || !body.ok || !body.trace) { results.push({ caseId: testCase.caseId, passed: false, errors: [body.error?.code ?? "AGENT_RUN_FAILED"], raw: body }); continue; }
      const grade = gradeAgentCase(testCase, body.trace, body.toolResults ?? []);
      results.push({ caseId: testCase.caseId, category: testCase.category, ...grade, trace: body.trace, toolResults: body.toolResults ?? [] });
    }
    const output = { executedAt: new Date().toISOString(), provider: health.provider, model: health.model, thinkingMode: health.thinkingMode, cases: results };
    await mkdir(".agent-eval-results", { recursive: true });
    await writeFile(".agent-eval-results/latest.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(`AgentEval live run complete: ${results.filter((item) => item.passed).length}/${results.length} passed.`);
    if (results.some((item) => !item.passed)) process.exitCode = 1;
  }
} catch (error) { notExecuted(error instanceof Error ? error.message : String(error)); }
