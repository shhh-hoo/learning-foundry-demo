import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const trainerRoot = resolve(process.env.TRAINER_REPO ?? "../standard-trainer-demo");
const sourceRoot = resolve("dist-contract");
const targetRoot = resolve(trainerRoot, "src/published-components");
await mkdir(targetRoot, { recursive: true });

for (const file of ["manifest.json", "kp-from-equilibrium-moles.json", "stoichiometric-product-mass.json"]) {
  await cp(resolve(sourceRoot, file), resolve(targetRoot, file));
}

console.log(`Synced published snapshots to ${targetRoot}. Drafts, review notes and Foundry evaluation reports were excluded.`);

