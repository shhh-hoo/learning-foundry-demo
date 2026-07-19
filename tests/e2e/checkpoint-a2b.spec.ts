import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { SEED } from "@/db/ids";
import { minimalPng, simplePdf } from "@/tests/helpers/files";

const institutionSlug = "checkpoint-showcase";
const password = process.env.E2E_SHOWCASE_PASSWORD ?? "";
const accounts = {
  learner: { email: "learner@showcase.invalid", route: "/learner", heading: "Learn from a governed evidence chain" },
  teacher: { email: "teacher@showcase.invalid", route: "/teacher", heading: "Inspect, correct and resume" },
  expert: { email: "expert@showcase.invalid", route: "/foundry", heading: "Author, evaluate, publish, reuse and roll back Components" },
  engineer: { email: "engineer@showcase.invalid", route: "/engineering", heading: "Inspect what actually ran" },
} as const;

type Account = keyof typeof accounts;

async function signIn(page: Page, account: Account): Promise<void> {
  const identity = accounts[account];
  await page.goto("/sign-in");
  await page.getByLabel("Institution").fill(institutionSlug);
  await page.getByLabel("Email").fill(identity.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Enter Learning Foundry" }).click();
  await expect(page).toHaveURL(new RegExp(`${identity.route}(?:\\?.*)?$`));
  await expect(page.getByRole("heading", { level: 1, name: identity.heading })).toBeVisible();
}

async function openRole(browser: Browser, account: Account): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await signIn(page, account);
  return { context, page };
}

function taskCard(page: Page, title: string) {
  return page.locator("section.card").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });
}

test.describe.configure({ mode: "serial" });

for (const account of Object.keys(accounts) as Account[]) {
  test(`${account} authenticates and sees only the authorized surface`, async ({ page }) => {
    await signIn(page, account);
    await expect(page.getByText(/Synthetic|Honest service status/).first()).toBeVisible();
  });
}

test("wrong-role navigation redirects to a data-free denied page", async ({ page }) => {
  await signIn(page, "learner");
  await page.goto("/teacher");
  await expect(page).toHaveURL(/\/denied\?workspace=Teacher(?:%20|\+)Workspace$/);
  await expect(page.getByRole("heading", { level: 1, name: "Access denied" })).toBeVisible();
  await expect(page.getByText("No workspace query was executed and no workspace data is shown.")).toBeVisible();
  await expect(page.getByText("CAPABILITY_UNAVAILABLE")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Course-scoped failure codes" })).toHaveCount(0);
  const rawUrl = process.env.E2E_DATABASE_URL;
  if (!rawUrl) throw new Error("E2E_DATABASE_URL is required");
  const sql = postgres(rawUrl, { max: 1, prepare: false });
  try {
    await expect.poll(async () => {
      const [row] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM foundry_operational.security_events
        WHERE event_class = 'AUTHORIZATION' AND event_code = 'ROLE_DENIED'
          AND institution_id = ${SEED.institution}::uuid AND actor_user_id = ${SEED.learner}::uuid
          AND detail->>'workspace' = 'Teacher Workspace'
      `;
      return row?.count ?? 0;
    }).toBeGreaterThan(0);
  } finally {
    await sql.end();
  }
});

test("complete Learning Loop and governed Component Asset Loop", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The mobile project runs authentication and route smoke; the stateful loop runs once on desktop.");
  test.setTimeout(240_000);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const taskTitle = `E2E governed reasoning ${suffix}`;
  const taskGoal = "Use authorized Evidence, direct human Review, and a governed Retry to improve the reasoning.";
  const attemptResponse = `Initial E2E reasoning ${suffix}: I checked the units but need human review of the transformation.`;
  const retryPrompt = `Retry ${suffix}: justify the transformation using units and the authorized review path.`;
  const retryResponse = `Retry result ${suffix}: I justified each transformation and verified the units.`;
  const outcomeNarrative = `E2E Outcome ${suffix}: the learner improved after the linked Retry and human Review.`;
  const candidateTitle = `E2E reviewed support ${suffix}`;
  const successorTitle = `${candidateTitle} concise`;
  const candidateKey = `e2e-reviewed-support-${suffix}`.toLowerCase();
  const capabilityResponses = [
    `Capability signal one ${suffix}: I did not convert the volume before dividing.`,
    `Capability signal two ${suffix}: I repeated the same volume-unit error.`,
  ];
  const opened: BrowserContext[] = [];

  try {
    const learner = await openRole(browser, "learner");
    opened.push(learner.context);
    const createTask = learner.page.getByTestId("create-task-form");
    await createTask.getByLabel("Task title").fill(taskTitle);
    await createTask.getByLabel("Learning goal").fill(taskGoal);
    await createTask.getByRole("button", { name: "Create Learning Task" }).click();
    await expect(learner.page.getByRole("heading", { level: 2, name: taskTitle, exact: true })).toBeVisible();

    const message = learner.page.getByTestId("message-form");
    await message.getByLabel("Ask with active Task context").fill("calculation route units quantity transformation");
    await message.getByRole("button", { name: "Run explain" }).click();
    const unavailableAnswer = learner.page.getByTestId("conversation-event").filter({ hasText: "Model synthesis is unavailable" });
    await expect(unavailableAnswer).toBeVisible();
    await expect(unavailableAnswer.getByTestId("event-evidence-refs")).toContainText("References attached to this event");

    const attempt = learner.page.getByTestId("attempt-form");
    await attempt.getByLabel("Problem or question").fill("How should I handle the volume units before calculating concentration?");
    await attempt.getByLabel("Your working and answer").fill(attemptResponse);
    await attempt.getByRole("button", { name: "Capture Attempt" }).click();
    await expect(learner.page.getByText(attemptResponse, { exact: true })).toBeVisible();
    await expect(learner.page.getByText("REVIEW_REQUIRED", { exact: true })).toBeVisible();

    const teacher = await openRole(browser, "teacher");
    opened.push(teacher.context);
    let reviewedTask = taskCard(teacher.page, taskTitle);
    const review = reviewedTask.getByTestId("teacher-review-form");
    await expect(reviewedTask.getByText("CAPABILITY_UNAVAILABLE", { exact: true })).toBeVisible();
    await review.getByPlaceholder("Teaching support").fill("Inspect the learner's units and require an explicit justification for each transformation.");
    await review.getByRole("button", { name: "Review & resume" }).click();
    reviewedTask = taskCard(teacher.page, taskTitle);
    await expect(reviewedTask.getByTestId("retry-form")).toBeVisible();

    const retry = reviewedTask.getByTestId("retry-form");
    await retry.getByPlaceholder("Reviewed retry prompt").fill(retryPrompt);
    await retry.getByRole("button", { name: "Assign reviewed Retry" }).click();
    await expect(retry.getByText("Saved", { exact: true })).toBeVisible();

    await learner.page.reload();
    await learner.page.getByRole("link", { name: new RegExp(taskTitle) }).click();
    const retryAttempt = learner.page.getByTestId("retry-attempt-form");
    await expect(retryAttempt).toContainText(retryPrompt);
    await retryAttempt.getByPlaceholder("Submit your retry reasoning").fill(retryResponse);
    await retryAttempt.getByRole("button", { name: "Submit retry Attempt" }).click();
    await expect(learner.page.getByText(retryResponse, { exact: true })).toBeVisible();

    await teacher.page.reload();
    const retryReview = teacher.page.getByTestId("retry-review-form");
    await retryReview.getByPlaceholder("Human teaching support").fill("The retry now justifies the transformation and verifies its units.");
    await retryReview.getByPlaceholder("Governed Outcome narrative").fill(outcomeNarrative);
    await retryReview.getByRole("button", { name: "Review result & record Outcome" }).click();
    await expect(retryReview).toHaveCount(0);

    await learner.page.reload();
    await learner.page.getByRole("link", { name: new RegExp(taskTitle) }).click();
    await expect(learner.page.getByText(outcomeNarrative, { exact: true })).toBeVisible();
    await expect(learner.page.getByText("IMPROVED", { exact: true })).toBeVisible();

    for (const capabilityResponse of capabilityResponses) {
      const capabilityAttempt = learner.page.getByTestId("attempt-form");
      await capabilityAttempt.getByLabel("Calculation activity hint (optional)").selectOption({ label: "Molar concentration" });
      await capabilityAttempt.getByLabel("Enter calculation values myself").check();
      await capabilityAttempt.getByLabel("Amount of substance", { exact: true }).fill("1");
      await capabilityAttempt.getByLabel("Amount of substance unit").selectOption("mol");
      await capabilityAttempt.getByLabel("Solution volume", { exact: true }).fill("2");
      await capabilityAttempt.getByLabel("Solution volume unit").selectOption("L");
      await capabilityAttempt.getByLabel("Your final numerical answer").fill("2");
      await capabilityAttempt.getByLabel("Problem or question").fill("Calculate the molar concentration of 1 mol in 2 L of solution.");
      await capabilityAttempt.getByLabel("Your working and answer").fill(capabilityResponse);
      await capabilityAttempt.getByRole("button", { name: "Capture Attempt" }).click();
      await expect(learner.page.getByText(capabilityResponse, { exact: true })).toBeVisible();
    }

    await teacher.page.reload();
    for (const capabilityResponse of capabilityResponses) {
      let signalCard = teacher.page.locator("section.card").filter({ hasText: capabilityResponse });
      const signalReview = signalCard.getByTestId("teacher-review-form");
      await signalReview.locator('select[name="decision"]').selectOption("CORRECT");
      await signalReview.getByPlaceholder("Required correction").fill("Convert the volume to the target unit before calculating concentration.");
      await signalReview.getByPlaceholder("Teaching support").fill("Use a unit ledger and state the target concentration unit before substitution.");
      await signalReview.getByRole("button", { name: "Review & resume" }).click();
      signalCard = teacher.page.locator("section.card").filter({ hasText: capabilityResponse });
      await expect(signalCard.getByTestId("retry-form")).toBeVisible();
    }

    const expert = await openRole(browser, "expert");
    opened.push(expert.context);
    const matchingCandidateSources = expert.page.getByTestId("foundry-candidate-source").filter({ hasText: taskTitle });
    await expect(matchingCandidateSources.first()).toBeVisible();
    const candidateSource = matchingCandidateSources.first();
    const candidate = candidateSource.getByTestId("candidate-form");
    await candidate.getByPlaceholder("candidate-key").fill(candidateKey);
    await candidate.getByPlaceholder("Candidate title").fill(candidateTitle);
    await candidate.getByPlaceholder("Purpose grounded in the reviewed pattern").fill("Reuse support grounded in two reviewed concentration unit-conversion failures.");
    await candidate.getByPlaceholder("Teaching support").fill("Require explicit units and justification for each concentration transformation.");
    await candidate.getByPlaceholder("Scaffold or hint").fill("Write the target unit first.");
    await candidate.getByPlaceholder("Worked example").fill("Convert 500 mL to 0.500 L before dividing amount by volume.");
    await candidate.getByPlaceholder("Learner action").fill("Annotate and justify every unit conversion.");
    await candidate.getByRole("button", { name: "Create reviewed Component candidate" }).click();
    await expect(expert.page.getByRole("heading", { level: 2, name: candidateTitle, exact: true })).toBeVisible();

    let component = taskCard(expert.page, candidateTitle);
    let versionForm = component.getByTestId("component-version-form").first();
    await versionForm.getByLabel("Teaching support").fill("Expert-edited support: verify units and justify every concentration transformation.");
    await versionForm.getByRole("button", { name: "Save Draft and reset Component evaluation" }).click();
    await expect(versionForm.getByText("Saved", { exact: true })).toBeVisible();
    component = taskCard(expert.page, candidateTitle);
    await component.getByTestId("component-evaluation-button").click();
    component = taskCard(expert.page, candidateTitle);
    await expect(component).toContainText("repeated-pattern-distinct-attempts");
    await expect(component).toContainText("deterministic-capability-fixture");
    await expect(component).toContainText("NOT_REQUIRED");
    const publicationReview = component.getByTestId("publication-review-form");
    await publicationReview.getByLabel("Expert rubric notes").fill("Expert verified domain correctness, pedagogy, safety and reuse readiness.");
    await publicationReview.getByLabel("Immutable decision rationale").fill("Two reviewed Attempts and every deterministic system gate support publication.");
    await publicationReview.getByRole("button", { name: "Approve and publish immutable version" }).click();
    component = taskCard(expert.page, candidateTitle);
    await expect(component.getByText("ACTIVE", { exact: true })).toBeVisible();

    await teacher.page.reload();
    let firstSignalCard = teacher.page.locator("section.card").filter({ hasText: capabilityResponses[0] });
    await expect(firstSignalCard.getByTestId("active-component-support")).toContainText(candidateTitle);
    await firstSignalCard.getByTestId("component-delivery-button").click();
    firstSignalCard = teacher.page.locator("section.card").filter({ hasText: capabilityResponses[0] });
    await expect(firstSignalCard.getByTestId("active-component-support")).toContainText("Delivered to the learner");
    await learner.page.reload();
    await learner.page.getByRole("link", { name: new RegExp(taskTitle) }).click();
    await expect(learner.page.getByTestId("learner-component-support").filter({ hasText: candidateTitle })).toContainText("v0.1.0");

    await expert.page.reload();
    component = taskCard(expert.page, candidateTitle);
    const publishedV1 = component.getByTestId("component-version-card").filter({ has: expert.page.getByText(`${candidateTitle} · v0.1.0`, { exact: true }) });
    await expect(publishedV1.getByText("PUBLISHED", { exact: true })).toBeVisible();
    const successorDetails = publishedV1.locator("details").filter({ hasText: "Create a semantic successor from this immutable version" });
    const successorSummary = successorDetails.getByText("Create a semantic successor from this immutable version", { exact: true });
    await expect(successorSummary).toBeVisible();
    await successorSummary.click();
    versionForm = successorDetails.getByTestId("component-version-form");
    await expect(versionForm).toBeVisible();
    await versionForm.getByLabel("Title").fill(successorTitle);
    await versionForm.getByLabel("Purpose").fill("Reuse a concise successor while preserving the same reviewed failure lineage.");
    await versionForm.getByLabel("Scaffold or hint").fill("Write target units first, then convert.");
    await versionForm.getByRole("button", { name: "Save Draft and reset Component evaluation" }).click();
    await expect(versionForm.getByText("Saved", { exact: true })).toBeVisible();
    component = taskCard(expert.page, candidateTitle);
    const immutableV1 = component.getByTestId("component-version-card").filter({ has: expert.page.getByText(`${candidateTitle} · v0.1.0`, { exact: true }) });
    await expect(immutableV1.getByText("PUBLISHED", { exact: true })).toBeVisible();
    const successorCard = component.getByTestId("component-version-card").filter({ has: expert.page.getByText(`${successorTitle} · v0.2.0`, { exact: true }) });
    await expect(successorCard.getByText("DRAFT", { exact: true })).toBeVisible();
    await successorCard.getByTestId("component-evaluation-button").click();
    const successorReview = taskCard(expert.page, candidateTitle).getByTestId("component-version-card").filter({ hasText: successorTitle }).getByTestId("publication-review-form");
    await successorReview.getByLabel("Expert rubric notes").fill("Expert completed the successor rubric independently.");
    await successorReview.getByLabel("Immutable decision rationale").fill("The successor preserves lineage and passes all current gates.");
    await successorReview.getByRole("button", { name: "Approve and publish immutable version" }).click();
    await expect(expert.page.getByRole("heading", { level: 2, name: successorTitle, exact: true })).toBeVisible();

    await teacher.page.reload();
    let secondSignalCard = teacher.page.locator("section.card").filter({ hasText: capabilityResponses[1] });
    await expect(secondSignalCard.getByTestId("active-component-support")).toContainText("v0.2.0");
    await secondSignalCard.getByTestId("component-delivery-button").click();
    secondSignalCard = teacher.page.locator("section.card").filter({ hasText: capabilityResponses[1] });
    await expect(secondSignalCard.getByTestId("active-component-support")).toContainText("Delivered to the learner");

    await expert.page.reload();
    component = taskCard(expert.page, successorTitle);
    const rollback = component.getByTestId("component-rollback-form");
    await rollback.locator('select[name="targetVersionId"]').selectOption({ label: "0.1.0" });
    await rollback.getByPlaceholder("Rollback rationale").fill("Restore the earlier expert-reviewed scaffold after comparing both published versions.");
    await rollback.getByRole("button", { name: "Activate earlier published version" }).click();
    await expect(expert.page.getByRole("heading", { level: 2, name: candidateTitle, exact: true })).toBeVisible();
    await expect(taskCard(expert.page, candidateTitle).getByText("ACTIVE", { exact: true })).toBeVisible();

    await teacher.page.reload();
    secondSignalCard = teacher.page.locator("section.card").filter({ hasText: capabilityResponses[1] });
    await expect(secondSignalCard.getByTestId("active-component-support")).toContainText("v0.1.0");
    await secondSignalCard.getByTestId("component-delivery-button").click();
    secondSignalCard = teacher.page.locator("section.card").filter({ hasText: capabilityResponses[1] });
    await expect(secondSignalCard.getByTestId("active-component-support")).toContainText("Delivered to the learner");
    await learner.page.reload();
    await learner.page.getByRole("link", { name: new RegExp(taskTitle) }).click();
    const deliveredSupport = learner.page.getByTestId("learner-component-support");
    await expect(deliveredSupport.filter({ hasText: "v0.2.0" })).toBeVisible();
    await expect(deliveredSupport.filter({ hasText: "v0.1.0" }).first()).toBeVisible();

    const engineer = await openRole(browser, "engineer");
    opened.push(engineer.context);
    await expect(engineer.page.getByRole("heading", { name: "Versioned implementation contracts" })).toBeVisible();
    await expect(engineer.page.getByText("These checks cover framework and core implementation contracts only. They are not product, pedagogy or learning-effectiveness Eval.")).toBeVisible();
    await expect(engineer.page.getByText("productEval")).toBeVisible();
    await expect(engineer.page.getByText("learningEffectivenessEval")).toBeVisible();
    await expect(engineer.page.getByText("UNAVAILABLE", { exact: true }).first()).toBeVisible();
    await expect(engineer.page.getByRole("heading", { name: "Component evaluations, human decisions and reuse" })).toBeVisible();
    await expect(engineer.page.getByText(candidateTitle, { exact: false }).first()).toBeVisible();
  } finally {
    await Promise.all(opened.map((context) => context.close()));
  }
});

test("real PDF Evidence intake and image Attempt reach governed Learner and Teacher surfaces", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The mobile project covers authenticated surfaces; the file-backed governed loop runs once on desktop.");
  test.setTimeout(180_000);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const taskTitle = `E2E real evidence ${suffix}`;
  const materialTitle = `E2E uploaded kinetics note ${suffix}`;
  const uniqueEvidence = `activation energy catalyst pathway ${suffix}`;
  const imagePrompt = `Inspect handwritten equilibrium work ${suffix}`;
  const opened: BrowserContext[] = [];

  try {
    const learner = await openRole(browser, "learner");
    opened.push(learner.context);
    const createTask = learner.page.getByTestId("create-task-form");
    await createTask.getByLabel("Task title").fill(taskTitle);
    await createTask.getByLabel("Learning goal").fill("Use an uploaded governed source and preserve an image Attempt for Teacher review.");
    await createTask.getByRole("button", { name: "Create Learning Task" }).click();
    await expect(learner.page.getByRole("heading", { level: 2, name: taskTitle, exact: true })).toBeVisible();

    const material = learner.page.getByTestId("material-upload-form");
    await material.getByLabel("PDF or image").setInputFiles({ name: "kinetics-note.pdf", mimeType: "application/pdf", buffer: Buffer.from(simplePdf(uniqueEvidence)) });
    await material.getByLabel("Source title").fill(materialTitle);
    await material.getByLabel("Rights/license statement").fill("Synthetic E2E material supplied for institution course use and explicit teacher review.");
    await material.getByRole("button", { name: "Upload for ingestion and rights review" }).click();
    await expect(learner.page.getByText("Ingestion · EXTRACTED", { exact: true })).toBeVisible();
    await expect(learner.page.getByText(/Setting up fake worker failed/)).toHaveCount(0);
    await expect(learner.page.getByText("Rights · REVIEW_REQUIRED", { exact: true })).toBeVisible();
    await expect(learner.page.getByText(uniqueEvidence, { exact: false })).toHaveCount(0);

    const teacher = await openRole(browser, "teacher");
    opened.push(teacher.context);
    let sourceCard = teacher.page.locator("article.evidence-card").filter({ hasText: materialTitle });
    await expect(sourceCard).toBeVisible();
    await expect(sourceCard.getByRole("link", { name: "Inspect original upload" })).toBeVisible();
    const rights = sourceCard.getByTestId("source-rights-form");
    await rights.getByLabel("Final rights statement").fill("Authenticated teacher approved this synthetic E2E source for institution course delivery.");
    await rights.getByRole("button", { name: "Record human rights decision" }).click();
    sourceCard = teacher.page.locator("article.evidence-card").filter({ hasText: materialTitle });
    await expect(sourceCard.getByText("Rights · APPROVED", { exact: true })).toBeVisible();

    await learner.page.reload();
    await learner.page.getByRole("link", { name: new RegExp(taskTitle) }).click();
    await expect(learner.page.getByRole("heading", { level: 2, name: "Authorized Evidence catalog" })).toBeVisible();
    await expect(learner.page.getByText(uniqueEvidence, { exact: false })).toBeVisible();
    const message = learner.page.getByTestId("message-form");
    await message.getByLabel("Ask with active Task context").fill(uniqueEvidence);
    await message.getByRole("button", { name: "Run explain" }).click();
    const unavailableAnswer = learner.page.getByTestId("conversation-event").filter({ hasText: "Model synthesis is unavailable" }).last();
    await expect(unavailableAnswer).toBeVisible();
    await expect(unavailableAnswer.getByTestId("event-evidence-refs")).toContainText("References attached to this event");

    const imageAttempt = learner.page.getByTestId("image-attempt-form");
    await imageAttempt.getByLabel("Attempt image").setInputFiles({ name: "equilibrium.png", mimeType: "image/png", buffer: Buffer.from(minimalPng) });
    await imageAttempt.getByLabel("Activity prompt").fill(imagePrompt);
    await imageAttempt.getByLabel("Learner note (optional)").fill("The original handwritten work is the canonical Attempt artifact.");
    await imageAttempt.getByRole("button", { name: "Capture image Attempt" }).click();
    await expect(learner.page.getByText(imagePrompt, { exact: true })).toBeVisible();
    await expect(learner.page.getByText("Multimodal interpretation · PROVIDER_UNAVAILABLE", { exact: true })).toBeVisible();

    await teacher.page.reload();
    const attemptCard = taskCard(teacher.page, taskTitle).filter({ hasText: imagePrompt });
    await expect(attemptCard.getByRole("link", { name: /Open equilibrium.png/ })).toBeVisible();
    await expect(attemptCard.getByAltText("Original learner Attempt: equilibrium.png")).toBeVisible();
    await expect(attemptCard.getByText("PROVIDER_UNAVAILABLE", { exact: true })).toBeVisible();
    await expect(attemptCard.getByText("The original upload and derived interpretation are separate.", { exact: false })).toBeVisible();
    const review = attemptCard.getByTestId("teacher-review-form");
    await review.getByPlaceholder("Teaching support").fill("Inspect the original image directly because multimodal interpretation is unavailable.");
    await review.getByRole("button", { name: "Review & resume" }).click();
    await expect(taskCard(teacher.page, taskTitle).filter({ hasText: imagePrompt }).getByTestId("retry-form")).toBeVisible();
  } finally {
    await Promise.all(opened.map((context) => context.close()));
  }
});
