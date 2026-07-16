import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runSelection(selection: { readonly AGENT_EVAL_LAYER?: string; readonly AGENT_EVAL_DIMENSION?: string }) {
  const environment = { ...process.env };
  delete environment.AGENT_EVAL_LAYER;
  delete environment.AGENT_EVAL_DIMENSION;
  delete environment.DEEPSEEK_API_KEY;
  delete environment.DEEPSEEK_MODEL;
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/agenteval-live.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...environment, ...selection },
  });
}

describe("AgentEval CLI selection", () => {
  it("exits non-zero for an explicitly selected empty layer", () => {
    const result = runSelection({ AGENT_EVAL_LAYER: "LEARNING_LOOP" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AGENT_EVAL_SELECTION_EMPTY: LAYER LEARNING_LOOP selected 0 cases");
  });

  it("exits non-zero for an explicitly selected empty dimension", () => {
    const result = runSelection({ AGENT_EVAL_DIMENSION: "PEDAGOGY" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AGENT_EVAL_SELECTION_EMPTY: DIMENSION PEDAGOGY selected 0 cases");
  });
});
