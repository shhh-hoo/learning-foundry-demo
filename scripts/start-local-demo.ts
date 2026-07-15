import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const foundryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trainerRoot = resolve(foundryRoot, "../standard-trainer-demo");
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

async function waitForRegistry(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const health = await fetch("http://127.0.0.1:4175/health");
      if (health.ok) {
        const reset = await fetch("http://127.0.0.1:4175/session", { method: "DELETE" });
        if (!reset.ok) throw new Error("Registry session reset failed.");
        return;
      }
    } catch { /* wait for the child process */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error("Local Demo Registry did not become healthy on port 4175.");
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("uncaughtException", (error) => { console.error(error); stop(1); });

start("Local Demo Registry", foundryRoot, ["run", "registry:demo"]);
start("Learning Foundry", foundryRoot, ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { VITE_TRAINER_URL: "http://127.0.0.1:4174/", VITE_DEMO_REGISTRY_URL: "http://127.0.0.1:4175" });
start("Standard Trainer", trainerRoot, ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4174", "--strictPort"], { VITE_DEMO_REGISTRY_URL: "http://127.0.0.1:4175", VITE_FOUNDRY_ORIGIN: "http://127.0.0.1:4173" });

await waitForRegistry();
console.log(`\nLearning Foundry local product story\n\nDemo Shell:             http://127.0.0.1:4173/?view=demo\nLearner Workspace:      http://127.0.0.1:4173/?view=learner\nFoundry Studio:         http://127.0.0.1:4173/?view=studio\nEngineering Inspector: http://127.0.0.1:4173/?view=inspector\nStandard Trainer:       http://127.0.0.1:4174/\nLocal Demo Registry:    http://127.0.0.1:4175/health\n\nPress Ctrl+C to stop all three processes.\n`);
