import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { capabilities, capabilityVersions, courses, learningTasks, subjects } from "@/db/schema";
import { DomainInvariantError } from "@/domain/invariants";
import { executeReferencePackCapability } from "@/reference-packs/capability-runtime";
import { z, ZodError } from "zod";

const CapabilityEvaluationFixture = z.object({
  input: z.record(z.string(), z.unknown()),
  expected: z.object({
    expected: z.number(),
    unit: z.string().min(1),
    status: z.enum(["CORRECT", "INCORRECT"]),
    failureCode: z.string().nullable(),
    firstInvalidStep: z.string().nullable(),
  }),
});

export async function executePersistedCapability(input: { taskId: string; capabilityId: string; structuredInput: Record<string, unknown> }) {
  const [binding] = await getDb().select({
    capability: capabilities,
    version: capabilityVersions,
    subject: subjects,
  }).from(capabilities)
    .innerJoin(capabilityVersions, and(
      eq(capabilityVersions.id, capabilities.activeVersionId),
      eq(capabilityVersions.capabilityId, capabilities.id),
    ))
    .innerJoin(learningTasks, eq(learningTasks.id, input.taskId))
    .innerJoin(courses, eq(courses.id, learningTasks.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .where(and(eq(capabilities.id, input.capabilityId), eq(capabilityVersions.status, "ACTIVE")))
    .limit(1);
  if (!binding) throw new DomainInvariantError("Capability has no active persisted implementation", "CAPABILITY_UNAVAILABLE");
  if (binding.capability.referencePackKey !== binding.subject.referencePackKey) {
    throw new DomainInvariantError("Capability is outside the Task Reference Pack", "CAPABILITY_SCOPE_DENIED");
  }
  let result;
  try {
    result = executeReferencePackCapability(binding.version.implementationKey, input.structuredInput);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    result = {
      status: "INVALID_INPUT",
      failureCode: "CAPABILITY_INPUT_INVALID",
      firstInvalidStep: "INPUT_CONTRACT",
      summary: "The deterministic Capability executed its input contract and rejected the submitted structured input.",
      validationIssues: error.issues,
    };
  }
  return { capability: binding.capability, version: binding.version, result };
}

export async function executePersistedCapabilityFixture(capabilityVersionId: string) {
  const [binding] = await getDb().select({ capability: capabilities, version: capabilityVersions })
    .from(capabilityVersions)
    .innerJoin(capabilities, eq(capabilities.id, capabilityVersions.capabilityId))
    .where(and(
      eq(capabilityVersions.id, capabilityVersionId),
      eq(capabilityVersions.status, "ACTIVE"),
      eq(capabilities.activeVersionId, capabilityVersions.id),
    ))
    .limit(1);
  if (!binding) throw new DomainInvariantError("Capability fixture requires the active persisted version", "CAPABILITY_BINDING_INVALID");
  const parsed = CapabilityEvaluationFixture.safeParse(binding.version.contract.evaluationFixture);
  if (!parsed.success) throw new DomainInvariantError("Active Capability has no versioned input and expected-output fixture", "CAPABILITY_FIXTURE_UNAVAILABLE");
  const fixture = parsed.data;
  const result = executeReferencePackCapability(binding.version.implementationKey, fixture.input);
  return { ...binding, fixture, result };
}
