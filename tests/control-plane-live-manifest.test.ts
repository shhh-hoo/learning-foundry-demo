import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Control Plane live evidence manifest", () => {
  it("freezes three checkpoint and two baseline attempts without favorable resampling", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "agent-eval/run-manifests/control-plane-pr1.json"), "utf8")) as {
      checkpoint: { attempts: readonly unknown[]; caseIds: readonly string[] };
      baseline: { attempts: readonly unknown[]; caseIds: readonly string[] };
      replacementPolicy: { favorableResampling: boolean; modelQualityFailure: string; preserveOriginalFailure: boolean; preserveReplacementLineage: boolean };
    };

    expect(manifest.checkpoint.attempts).toHaveLength(3);
    expect(manifest.checkpoint.caseIds).toHaveLength(6);
    expect(manifest.baseline.attempts).toHaveLength(2);
    expect(manifest.baseline.caseIds).toHaveLength(18);
    expect(manifest.replacementPolicy).toMatchObject({
      favorableResampling: false,
      modelQualityFailure: "NO_REPLACEMENT",
      preserveOriginalFailure: true,
      preserveReplacementLineage: true,
    });
  });
});
