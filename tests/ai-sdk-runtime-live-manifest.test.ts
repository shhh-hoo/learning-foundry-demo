import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI SDK candidate live evidence manifest", () => {
  it("freezes the candidate, selections and attempt counts without favorable resampling", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "agent-eval/run-manifests/ai-sdk7-candidate-pr5.json"), "utf8")) as {
      status: string;
      candidateHypothesis: string;
      candidate: { adapterId: string; authority: string; packages: Record<string, string> };
      implementationRef: string;
      implementationFiles: Record<string, string>;
      modelConfiguration: { provider: string; model: string; thinkingMode: string; sampling: Record<string, unknown>; aiSdkMaxRetries: number };
      checkpoint: { attempts: readonly { replacementFor: string | null }[]; caseIds: readonly string[] };
      baseline: { attempts: readonly { replacementFor: string | null }[]; caseIds: readonly string[] };
      replacementPolicy: { favorableResampling: boolean; modelQualityFailure: string; preserveOriginalFailure: boolean; preserveReplacementLineage: boolean };
    };

    expect(manifest.status).toBe("PLANNED_NOT_EXECUTED");
    expect(manifest.implementationRef).toBe("CONTENT_HASHED_SNAPSHOT");
    expect(Object.keys(manifest.implementationFiles).length).toBeGreaterThanOrEqual(8);
    for (const [path, expectedHash] of Object.entries(manifest.implementationFiles)) {
      const contents = await readFile(join(process.cwd(), path));
      expect(createHash("sha256").update(contents).digest("hex"), path).toBe(expectedHash);
    }
    expect(manifest.candidateHypothesis).toBe("AI_SDK_DEEPSEEK_MODEL_PROVIDER_TRANSPORT");
    expect(manifest.candidate).toMatchObject({
      adapterId: "ai-sdk7-deepseek-transport",
      authority: "NOT_GRANTED",
      packages: { ai: "7.0.31", "@ai-sdk/deepseek": "3.0.12" },
    });
    expect(manifest.modelConfiguration).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      thinkingMode: "disabled",
      sampling: { temperature: "PROVIDER_DEFAULT_NOT_SENT", topP: "PROVIDER_DEFAULT_NOT_SENT", seed: "UNSUPPORTED_NOT_SENT", maximumOutputTokens: 1800 },
    });
    expect(JSON.stringify(manifest.modelConfiguration)).not.toMatch(/FROM_SERVER_ENVIRONMENT|RECORDED_WITH_RUN/iu);
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
