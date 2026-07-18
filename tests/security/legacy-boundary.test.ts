import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Legacy replacement boundary", () => {
  it.each(["src/agent/run-agent.ts", "src/agent/gateway.ts", "src/runtime/runtime-shadow.ts", "src/runtime/runtime-parity.ts"])("keeps %s deleted", async (path) => {
    await expect(access(new URL(`../../${path}`, import.meta.url))).rejects.toBeTruthy();
  });

  it("contains no character-code vectors or fake Standard Trainer adapter", async () => {
    const retrieval = await readFile(new URL("../../application/retrieval.ts", import.meta.url), "utf8");
    const providers = await readFile(new URL("../../application/intelligence-providers.ts", import.meta.url), "utf8");
    await expect(access(new URL("../../tools/standard-trainer.ts", import.meta.url))).rejects.toBeTruthy();
    expect(retrieval).not.toMatch(/charCodeAt|queryVector\s*=\s*\[/);
    expect(providers).toContain("new OpenAIEmbeddings");
    expect(retrieval).toContain("RECIPROCAL_RANK_FUSION");
  });
});
