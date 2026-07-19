import { defineConfig, devices } from "@playwright/test";
import { assertE2eDatabaseTarget } from "./scripts/setup-e2e";
import { E2E_STORAGE_ROOT } from "./scripts/setup-e2e";

const e2eDatabaseUrl = assertE2eDatabaseTarget(process.env.E2E_DATABASE_URL, false);
const showcasePassword = process.env.E2E_SHOWCASE_PASSWORD;
if (!showcasePassword || showcasePassword.length < 12) throw new Error("E2E_SHOWCASE_PASSWORD must contain at least 12 characters");
const localBaseUrl = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "artifacts/playwright/report" }]],
  outputDir: "artifacts/playwright/test-results",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? localBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
        url: `${localBaseUrl}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          DATABASE_URL: e2eDatabaseUrl,
          AUTH_SECRET: process.env.AUTH_SECRET ?? "test-auth-secret-learning-foundry-only",
          AUTH_TRUST_HOST: "true",
          SYNTHETIC_SHOWCASE_MODE: "true",
          SHOWCASE_PASSWORD: showcasePassword,
          DEEPSEEK_API_KEY: "",
          OPENAI_API_KEY: "",
          COHERE_API_KEY: "",
          FILE_STORAGE_LOCAL_ROOT: E2E_STORAGE_ROOT,
          LANGSMITH_TRACING: "false",
        },
      },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
