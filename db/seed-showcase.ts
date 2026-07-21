import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { SEED } from "@/db/ids";
import {
  capabilities,
  capabilityVersions,
  componentVersions,
  components,
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
import {
  SourceWebComponentAssetContract,
  SourceWebComponentAssetPackage,
  WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
  WEB_COMPONENT_ASSET_RUNTIME_KIND,
  webComponentAssetHash,
} from "@/domain/web-component-asset";

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
  if (capabilityId === SEED.chemistryPercentageYield) continue;
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
  }).onConflictDoUpdate({
    target: capabilityVersions.id,
    set: {
      contract: { ...definition.contract, evaluationFixture: definition.evaluationFixture },
      implementationKey: definition.implementationKey,
      status: "ACTIVE",
      contentHash: digest(JSON.stringify(definition)),
    },
  });
}

const percentageYieldDefinition = CHEMISTRY_CAPABILITIES.find((definition) => definition.key === "chemistry-percentage-yield");
if (!percentageYieldDefinition) throw new Error("Percentage yield Registry fixture is missing");
const percentageYieldSourceContract = SourceWebComponentAssetContract.parse({
  contractType: "WEB_COMPONENT_ASSET",
  contractVersion: "cap-07.1",
  title: "Percentage yield source check",
  purpose: "Execute the reviewed percentage-yield relation as a bounded interactive source Web ComponentAsset.",
  referencePackKey: "chemistry-caie-9701",
  origin: "REVIEWED_REFERENCE_PACK",
  templateKey: "foundry.web.pause-predict.v1",
  implementationKey: WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
  runtimeKind: WEB_COMPONENT_ASSET_RUNTIME_KIND,
  arbitraryCodeAllowed: false,
  availabilityScope: "INSTITUTION_COURSE_PRIVATE",
});
const percentageYieldSourcePackage = SourceWebComponentAssetPackage.parse({
  packageType: "DECLARATIVE_WEB_COMPONENT_ASSET",
  packageRole: "SOURCE",
  templateKey: "foundry.web.pause-predict.v1",
  title: "Percentage yield source check",
  purpose: "Check which relation correctly calculates percentage yield from actual and theoretical product masses.",
  instructions: "Choose the reviewed relation that uses actual and theoretical product masses in the correct order.",
  prompt: "Which relation calculates percentage yield from actual and theoretical product masses?",
  choices: [
    { id: "actual-over-theoretical", label: "actual yield ÷ theoretical yield × 100" },
    { id: "theoretical-over-actual", label: "theoretical yield ÷ actual yield × 100" },
    { id: "difference-only", label: "theoretical yield − actual yield" },
  ],
  correctChoiceId: "actual-over-theoretical",
  correctFeedback: "Correct. Percentage yield uses actual yield divided by theoretical yield, multiplied by 100.",
  retryFeedback: "Use the reviewed relation with actual yield in the numerator and theoretical yield in the denominator.",
  language: "en",
  interactionMode: "STATELESS_ONE_SHOT",
  accessibility: { keyboardOperable: true, visibleLabels: true, statusAnnouncement: true, reducedMotionSafe: true },
  eventContract: ["COMPONENT_STARTED", "LEARNER_RESPONSE_SUBMITTED", "COMPONENT_COMPLETED"],
  rights: { basis: "FOUNDRY_INTERNAL_TEMPLATE", status: "NOT_REQUIRED" },
  externalDependencies: [],
  provider: null,
});
const percentageYieldComponentHash = webComponentAssetHash(percentageYieldSourceContract, percentageYieldSourcePackage);
const percentageYieldResolution = {
  ...(percentageYieldDefinition.contract as Record<string, unknown>).resolution as Record<string, unknown>,
  availability: { status: "AVAILABLE", institutionIds: [SEED.institution], courseIds: [SEED.course], rights: "NOT_REQUIRED", dependencies: [], provider: null },
  runtime: {
    kind: WEB_COMPONENT_ASSET_RUNTIME_KIND,
    input: { type: "object", required: ["selectedChoiceId"], properties: { selectedChoiceId: { type: "string" } } },
    parameters: { componentAssetVersionId: SEED.chemistryPercentageYieldComponentVersion, templateKey: percentageYieldSourcePackage.templateKey },
    state: { mode: "STATELESS_ONE_SHOT" },
    output: { type: "object", required: ["componentCompleted", "correct", "feedback", "events"] },
    events: percentageYieldSourcePackage.eventContract,
  },
};
const percentageYieldCapabilityContract = {
  resolution: percentageYieldResolution,
  componentAsset: {
    componentId: SEED.chemistryPercentageYieldComponent,
    versionId: SEED.chemistryPercentageYieldComponentVersion,
    version: "1.0.0",
    contentHash: percentageYieldComponentHash,
    contract: percentageYieldSourceContract,
    package: percentageYieldSourcePackage,
  },
};
await db.execute(sql`SET session_replication_role = replica`);
try {
  await db.insert(capabilities).values({
    id: SEED.chemistryPercentageYield,
    institutionId: SEED.institution,
    courseId: SEED.course,
    key: percentageYieldDefinition.key,
    name: percentageYieldDefinition.name,
    referencePackKey: "chemistry-caie-9701",
    kind: "WEB_COMPONENT_ASSET",
    activeVersionId: null,
  }).onConflictDoUpdate({ target: capabilities.id, set: { name: percentageYieldDefinition.name, activeVersionId: null } });
  await db.insert(components).values({
    id: SEED.chemistryPercentageYieldComponent,
    institutionId: SEED.institution,
    courseId: SEED.course,
    capabilityId: SEED.chemistryPercentageYield,
    assetType: "WEB_COMPONENT_ASSET",
    registeredCapabilityId: SEED.chemistryPercentageYield,
    registeredCapabilityVersionId: null,
    referencePackKey: "chemistry-caie-9701",
    key: "reference-pack.percentage-yield-source",
    title: percentageYieldSourceContract.title,
    status: "PUBLISHED",
    sourceSignal: { kind: "REVIEWED_REFERENCE_PACK_COMPONENT", referencePackKey: "chemistry-caie-9701" },
    activeVersionId: SEED.chemistryPercentageYieldComponentVersion,
    createdBy: SEED.expert,
  }).onConflictDoNothing();
  await db.insert(componentVersions).values({
    id: SEED.chemistryPercentageYieldComponentVersion,
    componentId: SEED.chemistryPercentageYieldComponent,
    version: "1.0.0",
    contract: percentageYieldSourceContract,
    content: percentageYieldSourcePackage,
    sourceObservationIds: [],
    sourceReviewIds: [],
    validation: { status: "REVIEWED_REFERENCE_PACK_SOURCE" },
    evalResult: { status: "PASSED", provenance: "SYNTHETIC_SHOWCASE_REFERENCE_PACK" },
    status: "PUBLISHED",
    contentHash: percentageYieldComponentHash,
    createdBy: SEED.expert,
  }).onConflictDoUpdate({ target: componentVersions.id, set: { contract: percentageYieldSourceContract, content: percentageYieldSourcePackage, contentHash: percentageYieldComponentHash } });
  const percentageYieldCapabilityHash = digest(JSON.stringify(percentageYieldCapabilityContract));
  await db.insert(capabilityVersions).values({
    id: SEED.chemistryPercentageYieldVersion,
    capabilityId: SEED.chemistryPercentageYield,
    institutionId: SEED.institution,
    courseId: SEED.course,
    componentAssetVersionId: SEED.chemistryPercentageYieldComponentVersion,
    version: "1.0.0",
    contract: percentageYieldCapabilityContract,
    implementationKey: WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY,
    status: "ACTIVE",
    contentHash: percentageYieldCapabilityHash,
  }).onConflictDoUpdate({ target: capabilityVersions.id, set: { contract: percentageYieldCapabilityContract, implementationKey: WEB_COMPONENT_ASSET_IMPLEMENTATION_KEY, status: "ACTIVE", contentHash: percentageYieldCapabilityHash } });
  await db.update(components).set({ registeredCapabilityVersionId: SEED.chemistryPercentageYieldVersion }).where(sql`${components.id}=${SEED.chemistryPercentageYieldComponent}`);
  await db.update(capabilities).set({ activeVersionId: SEED.chemistryPercentageYieldVersion }).where(sql`${capabilities.id}=${SEED.chemistryPercentageYield}`);
} finally {
  await db.execute(sql`SET session_replication_role = origin`);
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
