import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createBlindPedagogyPacket, createValueBenchmarkPublicationSummary, createValueBenchmarkReport, type BenchmarkReview } from "../src/value-benchmark/index.ts";
import { loadAndVerifyValueBenchmarkExperiment } from "../src/value-benchmark/experiment-manifest.ts";
import { FileBenchmarkEvidenceRepository, FileBenchmarkReviewRepository } from "../src/value-benchmark/file-repository.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const loaded = await loadAndVerifyValueBenchmarkExperiment(root, "config/value-benchmark/run-manifests/pr6-value-benchmark.json");
const evidence = new FileBenchmarkEvidenceRepository(resolve(root, ".value-benchmark-results"));
const custody = new FileBenchmarkReviewRepository(resolve(root, ".value-benchmark-results"), loaded.manifest.runId);
const run = await evidence.getRun(loaded.manifest.runId);
if (!run) throw new Error("BENCHMARK_RUN_NOT_FOUND");
const records = await evidence.listExecutions(run.runId);
const command = process.argv[2];

if (command === "prepare-blind") {
  const salt = process.env.VALUE_BENCHMARK_BLINDING_SALT?.trim();
  if (!salt) throw new Error("BENCHMARK_BLINDING_SALT_REQUIRED");
  const packet = await custody.storeBlindPreparation(createBlindPedagogyPacket(run, loaded.cases, records, salt));
  console.log(JSON.stringify({ phase: "BLIND_PEDAGOGY", packetItems: packet.length, armMappingReleased: false }));
} else if (command === "append-reviews") {
  const inputPath = process.argv[3];
  if (!inputPath) throw new Error("BENCHMARK_REVIEW_INPUT_PATH_REQUIRED");
  const raw = await readFile(resolve(inputPath), "utf8");
  const reviews = raw.trimStart().startsWith("[") ? JSON.parse(raw) as BenchmarkReview[] : raw.trimEnd().split("\n").map((line) => JSON.parse(line) as BenchmarkReview);
  for (const review of reviews) await custody.appendReview(review);
  console.log(JSON.stringify({ appended: reviews.length, phase: reviews[0]?.phase ?? null }));
} else if (command === "lock-pedagogy") {
  const lockedAt = process.argv[3];
  if (!lockedAt) throw new Error("BENCHMARK_LOCK_TIMESTAMP_REQUIRED");
  console.log(JSON.stringify(await custody.lockPedagogy(lockedAt), null, 2));
} else if (command === "prepare-evidence") {
  const packet = await custody.createAndStoreEvidencePacket(loaded.cases, records);
  console.log(JSON.stringify({ phase: "EVIDENCE_AUDIT", packetItems: packet.length, armMappingReleased: false }));
} else if (command === "lock-evidence") {
  const lockedAt = process.argv[3];
  if (!lockedAt) throw new Error("BENCHMARK_LOCK_TIMESTAMP_REQUIRED");
  console.log(JSON.stringify(await custody.lockEvidence(lockedAt), null, 2));
} else if (command === "report") {
  const state = await custody.loadLockedReviewState();
  const report = createValueBenchmarkReport({ run, cases: loaded.cases, records, ...state, generatedAt: new Date().toISOString() });
  const publication = createValueBenchmarkPublicationSummary(report);
  await custody.storeReports(report, publication);
  console.log(JSON.stringify({ runId: run.runId, cases: report.cases.length, publicationSafe: true, demonstratedLearningEffectiveness: report.demonstratedLearningEffectiveness }));
} else if (command === "reveal-mapping") {
  console.log(JSON.stringify(await custody.revealArmMapping(), null, 2));
} else {
  throw new Error("BENCHMARK_REVIEW_COMMAND_REQUIRED: prepare-blind | append-reviews | lock-pedagogy | prepare-evidence | lock-evidence | report | reveal-mapping");
}
