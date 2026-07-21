import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertE2eDatabaseTarget } from "./scripts/setup-e2e";
import { E2E_STORAGE_ROOT } from "./scripts/setup-e2e";
import { RUNTIME_DATABASE_ROLES, withRuntimeDatabaseRole } from "./db/database-config";

const e2eDatabaseUrl = assertE2eDatabaseTarget(process.env.E2E_DATABASE_URL, false);
const showcasePassword = process.env.E2E_SHOWCASE_PASSWORD;
if (!showcasePassword || showcasePassword.length < 12) throw new Error("E2E_SHOWCASE_PASSWORD must contain at least 12 characters");
const localBaseUrl = "http://localhost:3100";
const productRuntimeUrl = withRuntimeDatabaseRole(e2eDatabaseUrl, RUNTIME_DATABASE_ROLES.product);
const authRuntimeUrl = withRuntimeDatabaseRole(e2eDatabaseUrl, RUNTIME_DATABASE_ROLES.auth);
const workerRuntimeUrl = withRuntimeDatabaseRole(e2eDatabaseUrl, RUNTIME_DATABASE_ROLES.worker);
const checkpointRuntimeUrl = withRuntimeDatabaseRole(e2eDatabaseUrl, RUNTIME_DATABASE_ROLES.checkpoint);
const componentExecutorUrl = "http://127.0.0.1:3202";
const componentExecutorToken = "cap07-e2e-component-executor-internal-token-only";

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
    ignoreHTTPSErrors: true,
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [{
        command: "node --import tsx scripts/oidc-test-provider.ts",
        url: "https://localhost:3201/health",
        ignoreHTTPSErrors: true,
        reuseExistingServer: false,
        timeout: 30_000,
      }, {
        command: "npm run component-executor",
        url: `${componentExecutorUrl}/health`,
        reuseExistingServer: false,
        timeout: 30_000,
        env: {
          COMPONENT_EXECUTOR_PRODUCT_DATABASE_URL: e2eDatabaseUrl,
          COMPONENT_EXECUTOR_DATABASE_URL: e2eDatabaseUrl,
          COMPONENT_EXECUTOR_SERVICE_TOKEN: componentExecutorToken,
          COMPONENT_EXECUTOR_HOST: "127.0.0.1",
          COMPONENT_EXECUTOR_PORT: "3202",
        },
      }, {
        command: "npm run dev -- --hostname localhost --port 3100",
        url: `${localBaseUrl}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          PRODUCT_DATABASE_URL: productRuntimeUrl,
          AUTH_DATABASE_URL: authRuntimeUrl,
          WORKER_DATABASE_URL: workerRuntimeUrl,
          COMPONENT_EXECUTOR_SERVICE_URL: componentExecutorUrl,
          COMPONENT_EXECUTOR_SERVICE_TOKEN: componentExecutorToken,
          CHECKPOINT_DATABASE_URL: checkpointRuntimeUrl,
          AUTH_SECRET: process.env.AUTH_SECRET ?? "test-auth-secret-learning-foundry-only",
          AUTH_URL: localBaseUrl,
          AUTH_TRUST_HOST: "true",
          AUTH_OIDC_ISSUER: "https://localhost:3201",
          AUTH_OIDC_CLIENT_ID: "learning-foundry-e2e",
          AUTH_OIDC_CLIENT_SECRET: "learning-foundry-e2e-secret",
          NODE_EXTRA_CA_CERTS: resolve(tmpdir(), "lf-rw02-oidc-cert.pem"),
          SYNTHETIC_SHOWCASE_MODE: "true",
          SYNTHETIC_ASSET_RUNTIME_DELAY_MS: "5000",
          SHOWCASE_PASSWORD: showcasePassword,
          DEEPSEEK_API_KEY: "",
          OPENAI_API_KEY: "",
          COHERE_API_KEY: "",
          FILE_STORAGE_LOCAL_ROOT: E2E_STORAGE_ROOT,
          LANGSMITH_TRACING: "false",
        },
      }],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
