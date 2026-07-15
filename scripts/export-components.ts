import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { publishedComponents } from "../src/components/published";
import { COMPONENT_SCHEMA_VERSION } from "../src/contracts/schema-version";
import { diagnosticLearningComponentSchema, parsePublishedComponent } from "../src/contracts/published-component";
import { contentHashMatches } from "../src/governance/content-hash";

const generatedNotice = "Generated from learning-foundry-demo. Do not edit manually.";
const outputDirectory = resolve("dist-contract");
await mkdir(outputDirectory, { recursive: true });

publishedComponents.forEach((component) => {
  parsePublishedComponent(component);
  if (!contentHashMatches(component)) throw new Error(`Content hash mismatch for ${component.id}@${component.version}.`);
});

const manifest = {
  _generated: generatedNotice,
  schemaVersion: COMPONENT_SCHEMA_VERSION,
  registryVersion: "2026-07-15.1",
  generatedAt: "2026-07-15T09:00:00.000Z",
  components: publishedComponents.map((component) => ({
    id: component.id,
    version: component.version,
    targetKind: component.target.kind,
    contentHash: component.publication.contentHash,
    file: `${component.id}.json`,
  })),
};

const declaration = `// ${generatedNotice}
export type DiagnosticTargetKind = "KP" | "KC" | "AMOUNT" | "MASS" | "CONCENTRATION" | "VOLUME" | "PH" | "OTHER_BOUNDED";
export type DiagnosisCategory = "DATA_EXTRACTION" | "TARGET_IDENTIFICATION" | "STRATEGY" | "FORMULA" | "SUBSTITUTION" | "ARITHMETIC" | "UNIT" | "PRECISION";
export type DiagnosisFailureCode = "RELEVANT_DATA_OMITTED" | "IRRELEVANT_DATA_USED" | "TARGET_MISIDENTIFIED" | "WRONG_METHOD" | "MISSING_REASONING_LINK" | "WRONG_FORMULA" | "WRONG_STOICHIOMETRIC_RATIO" | "WRONG_VALUE_SUBSTITUTED" | "ARITHMETIC_ERROR" | "UNIT_ERROR" | "SIGNIFICANT_FIGURES_ERROR";
export interface PublishedDiagnosticLearningComponent { readonly schemaVersion: string; readonly id: string; readonly version: string; readonly status: "PUBLISHED"; readonly target: { readonly kind: DiagnosticTargetKind; readonly expectedValue: number; readonly acceptedUnits: readonly string[]; readonly significantFigures: number; readonly absoluteTolerance: number; readonly resultReasoningNodeId: string }; readonly migration?: { readonly fidelity: "LOSSLESS" | "SIMPLIFIED"; readonly sourceContractVersion?: string; readonly omittedCapabilities: readonly string[] }; readonly publication: { readonly publishedAt: string; readonly publishedBy: string; readonly contentHash: string }; readonly [key: string]: unknown; }
`;

const schema = z.toJSONSchema(diagnosticLearningComponentSchema, { target: "draft-2020-12" });
await Promise.all([
  writeFile(resolve(outputDirectory, "diagnostic-learning-component.schema.json"), `${JSON.stringify({ $comment: generatedNotice, ...schema }, null, 2)}\n`),
  writeFile(resolve(outputDirectory, "component-contract.d.ts"), declaration),
  writeFile(resolve(outputDirectory, "published-components.json"), `${JSON.stringify({ _generated: generatedNotice, components: publishedComponents }, null, 2)}\n`),
  writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  ...publishedComponents.map((component) => writeFile(resolve(outputDirectory, `${component.id}.json`), `${JSON.stringify({ _generated: generatedNotice, component }, null, 2)}\n`)),
]);

console.log(`Exported ${publishedComponents.length} immutable components to ${outputDirectory}.`);
