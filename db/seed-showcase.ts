import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { closeDb, getDb } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  capabilities,
  capabilityVersions,
  conversationEvents,
  courseEnrollments,
  courses,
  diagnosticObservations,
  evidenceUnits,
  institutionMemberships,
  institutions,
  learnerAttempts,
  learningEpisodes,
  learningTasks,
  sourceRecords,
  subjects,
  users,
} from "@/db/schema";
import { CHEMISTRY_CAPABILITIES } from "@/reference-packs/chemistry/capabilities";
import { startWorkflow } from "@/application/workflow-service";
import { closeWorkflowCheckpointer } from "@/workflows/checkpointer";

if (process.env.SYNTHETIC_SHOWCASE_MODE !== "true") {
  throw new Error("Refusing to seed: SYNTHETIC_SHOWCASE_MODE=true is required.");
}
const showcasePassword = process.env.SHOWCASE_PASSWORD;
if (!showcasePassword || showcasePassword.length < 12) {
  throw new Error("Refusing to seed: SHOWCASE_PASSWORD must contain at least 12 characters.");
}

const db = getDb();
const passwordHash = await hash(showcasePassword, 10);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

await db.insert(institutions).values({
  id: SEED.institution,
  slug: "checkpoint-showcase",
  name: "Checkpoint A Synthetic Institution",
}).onConflictDoUpdate({ target: institutions.id, set: { name: "Checkpoint A Synthetic Institution" } });

const people = [
  [SEED.learner, "learner@showcase.invalid", "Lina Learner", "LEARNER"],
  [SEED.teacher, "teacher@showcase.invalid", "Theo Teacher", "TEACHER"],
  [SEED.expert, "expert@showcase.invalid", "Esha Expert", "EXPERT"],
  [SEED.engineer, "engineer@showcase.invalid", "Emil Engineer", "ENGINEER"],
] as const;

for (const [userId, email, name, role] of people) {
  await db.insert(users).values({ id: userId, email, name, passwordHash }).onConflictDoUpdate({
    target: users.id,
    set: { email, name, passwordHash, active: true },
  });
  await db.insert(institutionMemberships).values({ userId, institutionId: SEED.institution, role }).onConflictDoNothing();
}

await db.insert(subjects).values({
  id: SEED.subject,
  institutionId: SEED.institution,
  key: "chemistry-reasoning-showcase",
  name: "Chemistry reasoning · synthetic showcase",
  referencePackKey: "chemistry-caie-9701",
}).onConflictDoNothing();
await db.insert(courses).values({
  id: SEED.course,
  institutionId: SEED.institution,
  subjectId: SEED.subject,
  code: "SYNTH-A",
  name: "Synthetic reasoning studio",
}).onConflictDoNothing();
for (const [userId, , , role] of people) {
  await db.insert(courseEnrollments).values({ institutionId: SEED.institution, courseId: SEED.course, userId, role }).onConflictDoNothing();
}

const capabilityIds = [
  [SEED.chemistryMolarConcentration, SEED.chemistryMolarConcentrationVersion],
  [SEED.chemistrySolutionDilution, SEED.chemistrySolutionDilutionVersion],
  [SEED.chemistryIdealGasMoles, SEED.chemistryIdealGasMolesVersion],
  [SEED.chemistryPh, SEED.chemistryPhVersion],
  [SEED.chemistryAmountFromMass, SEED.chemistryAmountFromMassVersion],
  [SEED.chemistryTitrationConcentration, SEED.chemistryTitrationConcentrationVersion],
  [SEED.chemistryLimitingReagentProduct, SEED.chemistryLimitingReagentProductVersion],
  [SEED.chemistryPercentageYield, SEED.chemistryPercentageYieldVersion],
  [SEED.chemistryCellPotential, SEED.chemistryCellPotentialVersion],
  [SEED.chemistryWeakAcidKa, SEED.chemistryWeakAcidKaVersion],
] as const;
for (const [index, definition] of CHEMISTRY_CAPABILITIES.entries()) {
  const [capabilityId, versionId] = capabilityIds[index];
  await db.insert(capabilities).values({
    id: capabilityId,
    key: definition.key,
    name: definition.name,
    referencePackKey: "chemistry-caie-9701",
    kind: "DETERMINISTIC_ADAPTER",
    activeVersionId: versionId,
  }).onConflictDoUpdate({ target: capabilities.id, set: { name: definition.name, activeVersionId: versionId } });
  await db.insert(capabilityVersions).values({
    id: versionId,
    capabilityId,
    version: "1.0.0",
    contract: { ...definition.contract, evaluationFixture: definition.evaluationFixture },
    implementationKey: definition.implementationKey,
    status: "ACTIVE",
    contentHash: digest(JSON.stringify(definition)),
  }).onConflictDoNothing();
}

await db.insert(sourceRecords).values({
  id: SEED.publicSource,
  institutionId: SEED.institution,
  courseId: SEED.course,
  sourceKey: "reviewed-teacher-note-synthetic",
  title: "Reviewed synthetic teacher note",
  sourceType: "TEACHER_NOTE",
  version: "checkpoint-a",
  authority: "SYNTHETIC_SHOWCASE_REVIEW",
  rights: "PUBLIC_SYNTHETIC",
  rightsAuthorizationStatus: "APPROVED",
  distributionScope: "PUBLIC",
  allowedPurposes: ["LEARNING", "TEACHING", "EVAL"],
  contentHash: digest("reviewed-teacher-note-synthetic-checkpoint-a"),
}).onConflictDoNothing();

await db.insert(evidenceUnits).values([
  {
    id: SEED.textEvidence,
    sourceId: SEED.publicSource,
    institutionId: SEED.institution,
    modality: "TEXT",
    locator: "synthetic-note#reasoning-route",
    title: "Check a calculation route",
    content: "Inspect units, identify the quantity represented at each step, and verify that a transformation is justified before accepting a numerical result.",
    structuredContent: null,
    searchDocument: "calculation route units quantity transformation numerical result",
    metadata: { syntheticShowcase: true, reviewed: true, courseIds: [SEED.course], referencePackKey: "chemistry-caie-9701" },
    contentHash: digest("check-calculation-route"),
    embeddingStatus: "PROVIDER_UNAVAILABLE",
    embeddingFailure: "Synthetic showcase seed does not call an external embedding provider.",
  },
  {
    id: SEED.structuredEvidence,
    sourceId: SEED.publicSource,
    institutionId: SEED.institution,
    modality: "TABLE",
    locator: "synthetic-note#review-table",
    title: "Reasoning review table",
    content: "A structured review path for inspecting a learner calculation without asserting an automated Diagnosis.",
    structuredContent: { columns: ["stage", "question"], rows: [["input", "What is known?"], ["transformation", "Why is this operation valid?"], ["result", "Do units and scale remain plausible?"]] },
    searchDocument: "structured review path input transformation result units scale",
    metadata: { syntheticShowcase: true, reviewed: true, courseIds: [SEED.course], referencePackKey: "chemistry-caie-9701" },
    contentHash: digest("reasoning-review-table"),
    embeddingStatus: "PROVIDER_UNAVAILABLE",
    embeddingFailure: "Synthetic showcase seed does not call an external embedding provider.",
  },
]).onConflictDoNothing();

await db.insert(learningTasks).values({
  id: SEED.task,
  institutionId: SEED.institution,
  courseId: SEED.course,
  learnerId: SEED.learner,
  title: "Inspect my calculation reasoning",
  goal: "Identify the first unsupported transformation and verify it through a reviewed retry.",
}).onConflictDoNothing();
await db.insert(learningEpisodes).values({ id: SEED.episode, taskId: SEED.task, sequence: 1 }).onConflictDoNothing();
await db.insert(conversationEvents).values({
  id: SEED.event,
  taskId: SEED.task,
  episodeId: SEED.episode,
  actorUserId: SEED.learner,
  actorType: "LEARNER",
  kind: "MESSAGE",
  content: "Synthetic showcase: please help me inspect which transformation in my calculation needs evidence.",
}).onConflictDoNothing();
await db.insert(learnerAttempts).values({
  id: SEED.attempt,
  taskId: SEED.task,
  episodeId: SEED.episode,
  learnerId: SEED.learner,
  capabilityId: null,
  prompt: "Describe how you would verify a multi-step calculation.",
  response: "I would check the units and justify each transformation before comparing the result with the expected scale.",
  structuredInput: { responseType: "FREE_TEXT", syntheticShowcase: true },
  sourceRefs: [{ sourceId: SEED.publicSource, sourceVersion: "checkpoint-a", locator: "synthetic-note#reasoning-route" }],
}).onConflictDoNothing();
await db.insert(diagnosticObservations).values({
  id: SEED.observation,
  attemptId: SEED.attempt,
  capabilityVersionId: null,
  observationSource: "CAPABILITY_UNAVAILABLE",
  status: "REVIEW_REQUIRED",
  failureCode: null,
  firstInvalidStep: null,
  summary: "Automated Diagnosis is unavailable; this synthetic Attempt is queued for direct teacher inspection.",
  structuredResult: { serviceStatus: "UNAVAILABLE", diagnosticClaim: false, syntheticShowcase: true },
  inputLineage: { attemptId: SEED.attempt },
  outputLineage: { capabilityExecuted: false },
}).onConflictDoNothing();

const existingInterrupted = await db.query.workflowRuns.findFirst({
  where: (run, { and, eq }) => and(eq(run.workflowKind, "TEACHER_REVIEW"), eq(run.status, "INTERRUPTED"), eq(run.taskId, SEED.task)),
});
if (!existingInterrupted) {
  await startWorkflow({
    kind: "TEACHER_REVIEW",
    actor: { userId: SEED.learner, institutionId: SEED.institution, roles: ["LEARNER"], courseIds: [SEED.course], authMethod: "synthetic-seed", sessionId: "synthetic-seed" },
    state: { observationId: SEED.observation },
    taskId: SEED.task,
    episodeId: SEED.episode,
  });
}

await closeWorkflowCheckpointer();
await closeDb();
console.log("Seeded explicitly gated synthetic showcase data. No capability, Diagnosis, Eval, Review, Outcome, or publication success was fabricated.");
