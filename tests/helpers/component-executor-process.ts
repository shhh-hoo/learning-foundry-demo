import { spawn } from "node:child_process";

export type ComponentExecutorTestProcess = {
  endpoint: string;
  token: string;
  stop: () => Promise<void>;
};

export async function startComponentExecutorTestProcess(databaseUrl: string): Promise<ComponentExecutorTestProcess> {
  const token = `cap07-integration-executor-${crypto.randomUUID()}`;
  const child = spawn(process.execPath, ["--import", "tsx", "component-executor/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      COMPONENT_EXECUTOR_PRODUCT_DATABASE_URL: databaseUrl,
      COMPONENT_EXECUTOR_DATABASE_URL: databaseUrl,
      COMPONENT_EXECUTOR_SERVICE_TOKEN: token,
      COMPONENT_EXECUTOR_HOST: "127.0.0.1",
      COMPONENT_EXECUTOR_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const port = await new Promise<number>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`Component Executor did not start: ${stderr}`)), 15_000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      for (const line of stdout.split("\n")) {
        try {
          const event = JSON.parse(line) as { service?: string; status?: string; port?: number };
          if (event.service === "component-executor" && event.status === "listening" && typeof event.port === "number") {
            clearTimeout(timeout);
            resolve(event.port);
            return;
          }
        } catch {
          // Wait for the complete JSON readiness line.
        }
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Component Executor exited before readiness with ${code}: ${stderr}`));
    });
  });
  const endpoint = `http://127.0.0.1:${port}`;
  process.env.COMPONENT_EXECUTOR_SERVICE_URL = endpoint;
  process.env.COMPONENT_EXECUTOR_SERVICE_TOKEN = token;
  delete process.env.COMPONENT_EXECUTOR_DATABASE_URL;

  return {
    endpoint,
    token,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    },
  };
}
