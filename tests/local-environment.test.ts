import { describe, expect, it } from "vitest";
import { parseLocalEnvironment } from "../scripts/lib/local-environment";

describe("safe local environment loading", () => {
  it("loads only allowlisted server variables without overriding shell exports", () => {
    const loaded = parseLocalEnvironment("DEEPSEEK_API_KEY='local-key'\nDEEPSEEK_MODEL=deepseek-chat\nVITE_DEEPSEEK_API_KEY=browser-leak\nTRACE_STORE_DIR=.local-traces\n", { DEEPSEEK_MODEL: "shell-model" });
    expect(loaded).toEqual({ DEEPSEEK_API_KEY: "local-key", DEEPSEEK_MODEL: "shell-model", TRACE_STORE_DIR: ".local-traces" });
    expect(JSON.stringify(loaded)).not.toContain("browser-leak");
  });
});
