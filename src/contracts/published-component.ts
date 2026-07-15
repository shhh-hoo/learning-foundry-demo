import { z } from "zod";
import { COMPONENT_SCHEMA_VERSION } from "./schema-version";
import type { PublishedDiagnosticLearningComponent } from "./diagnostic-component";

const variableReferenceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("AUTHORED_FACT"), factId: z.string().min(1), symbol: z.string().min(1) }),
  z.object({ source: z.literal("REASONING_QUANTITY"), reasoningNodeId: z.string().min(1), symbol: z.string().min(1) }),
]);

const expressionSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("NUMBER"), value: z.number().finite(), raw: z.string().min(1) }),
    z.object({ kind: z.literal("VARIABLE"), reference: variableReferenceSchema }),
    z.object({
      kind: z.literal("BINARY"),
      operator: z.enum(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "POWER"]),
      left: expressionSchema,
      right: expressionSchema,
    }),
    z.object({ kind: z.literal("FUNCTION"), name: z.literal("SUM"), arguments: z.array(expressionSchema).min(1) }),
  ]),
);

const categorySchema = z.enum([
  "DATA_EXTRACTION", "TARGET_IDENTIFICATION", "STRATEGY", "FORMULA",
  "SUBSTITUTION", "ARITHMETIC", "UNIT", "PRECISION",
]);
const failureCodeSchema = z.enum([
  "RELEVANT_DATA_OMITTED", "IRRELEVANT_DATA_USED", "TARGET_MISIDENTIFIED",
  "WRONG_METHOD", "MISSING_REASONING_LINK", "WRONG_FORMULA",
  "WRONG_STOICHIOMETRIC_RATIO", "WRONG_VALUE_SUBSTITUTED", "ARITHMETIC_ERROR",
  "UNIT_ERROR", "SIGNIFICANT_FIGURES_ERROR",
]);
const evidenceKindSchema = z.enum([
  "EXPLICIT_STEP", "FORMULA_AST", "EQUATION", "DECLARED_RESULT", "FACT_USE",
  "TARGET_STATEMENT", "EMBEDDED_CALCULATION",
]);

export const diagnosticLearningComponentSchema = z.object({
  schemaVersion: z.literal(COMPONENT_SCHEMA_VERSION),
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(["DRAFT", "APPROVED", "PUBLISHED"]),
  curriculum: z.object({
    board: z.literal("CAIE"),
    syllabusCode: z.literal("9701"),
    subject: z.literal("Chemistry"),
    topic: z.string().min(1),
    learningObjectiveId: z.string().min(1),
    learningObjectiveText: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).min(1),
  }),
  presentation: z.object({
    title: z.string().min(1), prompt: z.string().min(1), reaction: z.string().min(1).optional(), marks: z.number().int().positive(),
  }),
  authoredFacts: z.array(z.object({
    id: z.string().min(1), label: z.string().min(1), value: z.union([z.number().finite(), z.string().min(1)]),
    unit: z.string().min(1).optional(), relevance: z.enum(["REQUIRED", "IRRELEVANT"]),
  })).min(1),
  target: z.object({
    kind: z.enum(["KP", "KC", "AMOUNT", "MASS", "CONCENTRATION", "VOLUME", "PH", "OTHER_BOUNDED"]),
    expectedValue: z.number().finite(), acceptedUnits: z.array(z.string().min(1)).min(1),
    significantFigures: z.number().int().positive(), absoluteTolerance: z.number().positive(), resultReasoningNodeId: z.string().min(1),
  }),
  formulaDefinitions: z.array(z.object({ id: z.string().min(1), targetReasoningNodeId: z.string().min(1), expression: expressionSchema })).min(1),
  reasoningGraph: z.object({
    version: z.string().min(1), pedagogicalOrder: z.array(z.string().min(1)).min(1),
    nodes: z.record(z.string(), z.object({
      id: z.string().min(1), label: z.string().min(1), category: categorySchema, concept: z.string().nullable(),
      dependencies: z.array(z.string().min(1)), solutionEvidenceKinds: z.array(evidenceKindSchema).min(1),
    })),
    acceptedStrategies: z.array(z.object({
      id: z.string().min(1), label: z.string().min(1), nodeRequirements: z.array(z.object({
        nodeId: z.string().min(1), requirement: z.enum(["REQUIRED", "OPTIONAL"]), allowedEvidenceKinds: z.array(evidenceKindSchema).min(1),
      })).min(1),
    })).min(1),
  }),
  diagnosisPolicy: z.object({ version: z.string().min(1), categoryOrder: z.array(categorySchema).min(1), supportedFailureCodes: z.array(failureCodeSchema).min(1) }),
  hintPolicy: z.object({
    version: z.string().min(1), automaticEscalationAfterConsecutiveFailures: z.number().int().positive(),
    hints: z.array(z.object({ id: z.string().min(1), stage: categorySchema, level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), text: z.string().min(1), revealedReasoningNodeIds: z.array(z.string().min(1)) })),
  }),
  markScheme: z.array(z.object({ id: z.string().min(1), reasoningNodeId: z.string().min(1), description: z.string().min(1), marks: z.number().int().positive() })).min(1),
  provenance: z.discriminatedUnion("origin", [
    z.object({
      origin: z.literal("AI_GENERATED"),
      generatorId: z.string().min(1),
      promptVersion: z.string().min(1),
      generatedAt: z.string().datetime(),
    }),
    z.object({
      origin: z.literal("MIGRATED"),
      sourceComponentId: z.string().min(1),
    }),
    z.object({ origin: z.literal("EXPERT_AUTHORED") }),
  ]),
  migration: z.object({
    fidelity: z.enum(["LOSSLESS", "SIMPLIFIED"]),
    sourceContractVersion: z.string().min(1).optional(),
    omittedCapabilities: z.array(z.string().min(1)),
  }).optional(),
  review: z.object({ reviewer: z.string().min(1), reviewedAt: z.string().datetime(), notes: z.string().min(1) }).optional(),
  publication: z.object({ publishedAt: z.string().datetime(), publishedBy: z.string().min(1), contentHash: z.string().min(1) }).optional(),
}).superRefine((value, context) => {
  if (value.provenance.origin === "MIGRATED" && !value.migration) {
    context.addIssue({
      code: "custom",
      path: ["migration"],
      message: "Migrated components must declare migration fidelity and omitted capabilities.",
    });
  }
});

export const publishedDiagnosticLearningComponentSchema = diagnosticLearningComponentSchema.superRefine((value, context) => {
  if (value.status !== "PUBLISHED") context.addIssue({ code: "custom", path: ["status"], message: "Published snapshot must have PUBLISHED status." });
  if (!value.review) context.addIssue({ code: "custom", path: ["review"], message: "Published snapshot requires expert review." });
  if (!value.publication?.contentHash) context.addIssue({ code: "custom", path: ["publication", "contentHash"], message: "Published snapshot requires a content hash." });
});

export function parsePublishedComponent(value: unknown): PublishedDiagnosticLearningComponent {
  return publishedDiagnosticLearningComponentSchema.parse(value) as PublishedDiagnosticLearningComponent;
}
