import type { ReferencePackRegistration } from "../../core/domain/reference-pack";
import capabilityRegistry from "../../../config/capabilities/registry.json";
import { chemistryCaie9701PublishedComponents } from "./components";
import { adaptDiagnosticComponent } from "./adapters/diagnostic-component-adapter";
import {
  adaptLegacyCapability,
  type LegacyAgentCapabilityRecord,
} from "./adapters/legacy-capability-adapter";

const capabilities = capabilityRegistry.capabilities.map((record) =>
  adaptLegacyCapability(record as LegacyAgentCapabilityRecord),
);

const components = chemistryCaie9701PublishedComponents.map(adaptDiagnosticComponent);

export const chemistryCaie9701CapabilityRegistryVersion = capabilityRegistry.version;

export const chemistryCaie9701ReferencePack: ReferencePackRegistration = {
  manifest: {
    schemaVersion: "1.0.0",
    id: "chemistry-caie-9701",
    version: "1.0.0",
    title: "Chemistry CAIE 9701 Reference Pack",
    domains: ["CHEMISTRY"],
    registrationStatus: "REGISTERED",
    ownership: [
      {
        id: "caie-9701-curriculum-and-calculation-taxonomy",
        kind: "CURRICULUM_MAPPING",
        status: "CURRENT_LEGACY",
        legacyPaths: ["src/standards/caie-9701.ts", "src/corpus/types.ts"],
        removalTarget: "Pack-owned curriculum mappings with compatibility readers",
      },
      {
        id: "chemistry-terminology-and-concept-scheme",
        kind: "TERMINOLOGY",
        status: "NOT_EXTRACTED",
        legacyPaths: [],
        removalTarget: "Reviewed Pack terminology and Concept Scheme",
      },
      {
        id: "chemistry-source-registration",
        kind: "SOURCE_REGISTRATION",
        status: "CURRENT_LEGACY",
        legacyPaths: ["scripts/lib/corpus-ingestion.ts", "config/corpus/delivery-policy.json"],
        removalTarget: "Pack-owned source registration preserving Foundry delivery policy",
      },
      {
        id: "chemistry-evidence-parsers",
        kind: "EVIDENCE_PARSER",
        status: "CURRENT_LEGACY",
        legacyPaths: ["scripts/lib/corpus-ingestion.ts"],
        removalTarget: "Pack parser registrations behind Foundry Evidence normalization",
      },
      {
        id: "chemistry-retrieval-enrichers",
        kind: "RETRIEVAL_ENRICHER",
        status: "CURRENT_LEGACY",
        legacyPaths: ["scripts/lib/corpus-repository.ts", "src/agent/tool-executor.ts"],
        removalTarget: "Pack retrieval enrichers behind the Foundry search contract",
      },
      {
        id: "standard-trainer-capability",
        kind: "CAPABILITY",
        status: "REGISTERED",
        legacyPaths: ["src/runtime/capability.ts", "src/runtime/learning-capability-runtime.ts"],
        removalTarget: "Pack registration plus the current Standard Trainer compatibility Adapter",
      },
      {
        id: "chemistry-diagnostic-components",
        kind: "COMPONENT",
        status: "REGISTERED",
        legacyPaths: ["src/components/kp-from-equilibrium-moles.ts", "src/components/stoichiometric-product-mass.ts"],
        removalTarget: "Pack component registration with stable compatibility exports",
      },
      {
        id: "chemistry-domain-evaluators",
        kind: "EVALUATOR",
        status: "CURRENT_LEGACY",
        legacyPaths: ["src/governance/component-contract-checks.ts", "src/runtime/preview-adapter.ts", "agent-eval/cases.jsonl"],
        removalTarget: "Pack-owned evaluator registrations using Foundry Eval infrastructure",
      },
      {
        id: "chemistry-activity-renderers",
        kind: "RENDERER",
        status: "NOT_EXTRACTED",
        legacyPaths: [],
        removalTarget: "Pack renderer registrations after a real cross-surface seam exists",
      },
    ],
  },
  capabilities,
  components,
};
