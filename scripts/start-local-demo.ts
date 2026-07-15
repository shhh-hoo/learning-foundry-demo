import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const foundryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trainerRoot = resolve(foundryRoot, "../standard-trainer-demo");
const trainerPackage = resolve(trainerRoot, "package.json");

if (!existsSync(trainerPackage)) {
  console.error(`Standard Trainer sibling checkout was not found at:\n${trainerRoot}\n\nClone it beside this repository:\ngit clone https://github.com/shhh-hoo/standard-trainer-demo.git "${trainerRoot}"`);
  process.exit(1);
}

const children: ChildProcess[] = [];
let stopping = false;

function start(label: string, cwd: string, port: string, extraEnvironment: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", port, "--strictPort"], {
    cwd,
    env: { ...process.env, ...extraEnvironment },
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(`${label} failed to start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`${label} stopped unexpectedly (${signal ?? `exit ${code ?? 1}`}).`);
    stop(code ?? 1);
  });
  children.push(child);
  return child;
}

function stop(code = 0): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 250);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("uncaughtException", (error) => {
  console.error(error);
  stop(1);
});

start("Learning Foundry", foundryRoot, "4173", { VITE_TRAINER_URL: "http://localhost:4174/" });
start("Standard Trainer", trainerRoot, "4174");

console.log(`\nLocal Learning Foundry product demo\n\nFoundry Experience:  http://localhost:4173/?view=experience\nFoundry Governance:  http://localhost:4173/?view=governance\nStandard Trainer:    http://localhost:4174/\n\nPress Ctrl+C to stop both applications.\n`);
