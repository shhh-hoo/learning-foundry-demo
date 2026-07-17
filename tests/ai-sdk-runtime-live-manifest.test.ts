import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI SDK candidate live evidence manifest", () => {
  it("freezes the candidate, selections and attempt counts without favorable resampling", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "agent-eval/run-manifests/ai-sdk7-candidate-pr5.json"), "utf8")) as {
      status: string;
      candidate: { authority: string; packages: Record<string, string> };
      modelConfiguration: { aiSdkMaxRetries: number };
      checkpoint: { attempts: readonly { replacementFor: string | null }[]; caseIds: readonly string[] };
      baseline: { attempts: readonly { replacementFor: string | null }[]; caseIds: readonly string[] };
      replacementPolicy: { favorableResampling: boolean; modelQualityFailure: string; preserveOriginalFailure: boolean; preserveReplacementLineage: boolean };
    };

    expect(manifest.status).toBe("PLANNED_NOT_EXECUTED");
    expect(manifest.candidate).toMatchObject({ authority: "NOT_GRANTED", packages: { ai: "7.0.31", "@ai-sdk/deepseek": "3.0.12" } });
    expect(manifest.modelConfiguration.aiSdkMaxRetries).toBe(0);
    expect(manifest.checkpoint.attempts).toHaveLength(3);
    expect(manifest.checkpoint.caseIds).toHaveLength(6);
    expect(manifest.baseline.attempts).toHaveLength(2);
    expect(manifest.baseline.caseIds).toHaveLength(18);
    expect([...manifest.checkpoint.attempts, ...manifest.baseline.attempts].every((attempt) => attempt.replacementFor === null)).toBe(true);
    expect(manifest.replacementPolicy).toMatchObject({
      favorableResampling: false,
      modelQualityFailure: "NO_REPLACEMENT",
      preserveOriginalFailure: true,
      preserveReplacementLineage: true,
    });
  });
});
