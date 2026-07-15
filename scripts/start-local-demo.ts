import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const foundryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trainerRoot = resolve(process.env.TRAINER_REPO ?? resolve(foundryRoot, "../standard-trainer-demo"));
if (!existsSync(resolve(trainerRoot, "package.json"))) {
  console.error(`Standard Trainer sibling checkout was not found at ${trainerRoot}`);
  process.exit(1);
}

const children: ChildProcess[] = [];
let stopping = false;

function start(label: string, cwd: string, args: readonly string[], extraEnvironment: NodeJS.ProcessEnv = {}): void {
  const child = spawn("npm", args, { cwd, env: { ...process.env, ...extraEnvironment }, stdio: "inherit" });
  child.on("error", (error) => { console.error(`${label} failed to start: ${error.message}`); stop(1); });
  child.on("exit", (code, signal) => { if (!stopping) { console.error(`${label} stopped unexpectedly (${signal ?? `exit ${code ?? 1}`}).`); stop(code ?? 1); } });
  children.push(child);
}

function stop(code = 0): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}

async function waitForServices(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const [foundry, trainer, registry, gateway, diagnosis] = await Promise.all([
        fetch("http://127.0.0.1:4173/"), fetch("http://127.0.0.1:4174/"), fetch("http://127.0.0.1:4175/health"), fetch("http://127.0.0.1:4176/health"), fetch("http://127.0.0.1:4177/health"),
      ]);
      if ([foundry, trainer, registry, gateway, diagnosis].every((response) => response.ok)) {
        const reset = await fetch("http://127.0.0.1:4175/session", { method: "DELETE" });
        if (!reset.ok) throw new Error("Registry session reset failed.");
        const gatewayHealth = await gateway.json() as { configured?: boolean; model?: string | null };
        console.log(`DeepSeek Agent configuration: ${gatewayHealth.configured ? `ready (${gatewayHealth.model})` : "not configured; UI remains available and no Agent runs will be created"}`);
        return;
      }
    } catch { /* wait for the child process */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error("One or more local services did not become healthy on ports 4173–4177.");
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("uncaughtException", (error) => { console.error(error); stop(1); });

start("Local Demo Registry", foundryRoot, ["run", "registry:demo"]);
start("DeepSeek Agent Gateway", foundryRoot, ["run", "agent:gateway"]);
start("Trainer Diagnosis API", trainerRoot, ["run", "diagnosis:api"], { COMPONENT_REGISTRY_URL: "http://127.0.0.1:4175" });
start("Learning Foundry", foundryRoot, ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { VITE_TRAINER_URL: "http://127.0.0.1:4174/", VITE_DEMO_REGISTRY_URL: "http://127.0.0.1:4175" });
start("Standard Trainer", trainerRoot, ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4174", "--strictPort"], { VITE_DEMO_REGISTRY_URL: "http://127.0.0.1:4175", VITE_FOUNDRY_ORIGIN: "http://127.0.0.1:4173" });

await waitForServices();
console.log(`\nLearning Foundry local system\n\nDemo Shell:             http://127.0.0.1:4173/?view=demo\nLearner Workspace:      http://127.0.0.1:4173/?view=learner\nFoundry Studio:         http://127.0.0.1:4173/?view=studio\nEngineering Inspector: http://127.0.0.1:4173/?view=inspector\nStandard Trainer:       http://127.0.0.1:4174/\nComponent Registry:     http://127.0.0.1:4175/health\nDeepSeek Agent Gateway: http://127.0.0.1:4176/health\nTrainer Diagnosis API:  http://127.0.0.1:4177/health\n\nPress Ctrl+C to stop all five processes.\n`);
