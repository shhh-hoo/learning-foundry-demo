import { ingestCorpus } from "./lib/corpus-ingestion.ts";

const manifest = await ingestCorpus();
for (const source of manifest.sources) console.log(`corpus source ${source.status === "REGISTERED" ? "registered" : "missing"}: ${source.sourceId}`);
console.log(`index version: ${manifest.indexVersion}`);
for (const [key, count] of Object.entries(manifest.chunkCounts).sort()) console.log(`chunks ${key}: ${count}`);
console.log(`chunk total: ${manifest.chunkCount}`);
