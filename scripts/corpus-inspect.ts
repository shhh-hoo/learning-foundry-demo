import { inspectCorpus } from "./lib/corpus-repository.ts";

const report = await inspectCorpus();
for (const source of report.sources) console.log(`corpus source ${source.status === "REGISTERED" ? "registered" : "missing"}: ${source.sourceId}`);
console.log(`index version: ${report.indexVersion ?? "missing"}`);
for (const [key, count] of Object.entries(report.chunkCounts).sort()) console.log(`chunks ${key}: ${count}`);
console.log(`chunk total: ${report.chunkCount}`);
