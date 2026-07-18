import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { capabilities, capabilityVersions, courses, learningTasks, subjects } from "@/db/schema";
import { DomainInvariantError } from "@/domain/invariants";
import { executeChemistryCapability } from "@/reference-packs/chemistry/capabilities";
import { ZodError } from "zod";

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
  if (!binding.version.implementationKey.startsWith("chemistry.")) {
    throw new DomainInvariantError("Capability implementation adapter is unavailable", "CAPABILITY_UNAVAILABLE");
  }
  let result;
  try {
    result = executeChemistryCapability(binding.version.implementationKey, input.structuredInput);
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
