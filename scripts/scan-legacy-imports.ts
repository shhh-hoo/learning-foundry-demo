import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const productionRoots = ["app", "application", "components", "db", "domain", "evals", "workflows"];
const removedPaths = [
  "src/agent/run-agent.ts",
  "src/agent/gateway.ts",
  "src/runtime/runtime-shadow.ts",
  "src/runtime/runtime-parity.ts",
  "scripts/agent-gateway-server.ts",
  "src/demo/DemoShell.tsx",
];
const bannedImport = /(?:from\s+|import\s*\()["'][^"']*(?:src\/agent|run-agent|runtime-shadow|runtime-parity|agent-gateway|DemoShell)[^"']*["']/;

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }));
  return nested.flat();
}

const failures: string[] = [];
for (const removed of removedPaths) {
  try { await access(join(root, removed), constants.F_OK); failures.push(`Removed Legacy file still exists: ${removed}`); }
  catch { /* expected */ }
}
for (const directory of productionRoots) {
  for (const path of await files(join(root, directory))) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    if (bannedImport.test(await readFile(path, "utf8"))) failures.push(`Legacy production import: ${relative(root, path)}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Zero Legacy production imports across ${productionRoots.join(", ")}; ${removedPaths.length} removed runtime paths are absent.`);
}
