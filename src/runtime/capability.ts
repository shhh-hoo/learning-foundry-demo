import { COMPONENT_SCHEMA_VERSION } from "../contracts/schema-version";
import type { RuntimeCapabilityProfile } from "../contracts/diagnostic-component";

export const standardTrainerCapability: RuntimeCapabilityProfile = {
  runtimeId: "standard-trainer-demo",
  runtimeVersion: "0.3.0",
  supportedSchemaVersions: [COMPONENT_SCHEMA_VERSION],
  supportedTargetKinds: ["KP", "MASS"],
  supportedExpressionNodes: ["NUMBER", "VARIABLE", "BINARY", "FUNCTION:SUM"],
  supportedDiagnosisCategories: [
    "DATA_EXTRACTION", "TARGET_IDENTIFICATION", "STRATEGY", "FORMULA",
    "SUBSTITUTION", "ARITHMETIC", "UNIT", "PRECISION",
  ],
  supportedFailureCodes: [
    "RELEVANT_DATA_OMITTED", "IRRELEVANT_DATA_USED", "TARGET_MISIDENTIFIED",
    "WRONG_METHOD", "MISSING_REASONING_LINK", "WRONG_FORMULA",
    "WRONG_STOICHIOMETRIC_RATIO", "WRONG_VALUE_SUBSTITUTED", "ARITHMETIC_ERROR",
    "UNIT_ERROR", "SIGNIFICANT_FIGURES_ERROR",
  ],
  limitations: [
    "Only KP and MASS target adapters are executable.",
    "Learner evidence must be structured; arbitrary chemistry prose is not parsed.",
    "SUM is the only supported expression function.",
  ],
};

