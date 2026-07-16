import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPublicSafeExport } from "./lib/corpus-ingestion.ts";

const outputPath = resolve("dist-corpus/public-safe-corpus.json");
await mkdir(resolve("dist-corpus"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(await buildPublicSafeExport(), null, 2)}\n`, "utf8");
console.log(`public-safe corpus export: ${outputPath}`);
