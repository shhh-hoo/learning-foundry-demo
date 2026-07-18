import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const institutionSlug = "checkpoint-showcase";
const password = process.env.E2E_SHOWCASE_PASSWORD ?? "";
const accounts = {
  learner: { email: "learner@showcase.invalid", route: "/learner", heading: "Learn from a governed evidence chain" },
  teacher: { email: "teacher@showcase.invalid", route: "/teacher", heading: "Inspect, correct and resume" },
  expert: { email: "expert@showcase.invalid", route: "/foundry", heading: "Turn reviewed signals into governed Drafts" },
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
    await expect(page.getByText("Synthetic showcase data").or(page.getByText("Honest service status"))).toBeVisible();
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
});

test("available Learning Loop, Foundry Draft/preflight, and Engineering honesty", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The mobile project runs authentication and route smoke; the stateful loop runs once on desktop.");
  test.setTimeout(180_000);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const taskTitle = `E2E governed reasoning ${suffix}`;
  const taskGoal = "Use authorized Evidence, direct human Review, and a governed Retry to improve the reasoning.";
  const attemptResponse = `Initial E2E reasoning ${suffix}: I checked the units but need human review of the transformation.`;
  const retryPrompt = `Retry ${suffix}: justify the transformation using units and the authorized review path.`;
  const retryResponse = `Retry result ${suffix}: I justified each transformation and verified the units.`;
  const outcomeNarrative = `E2E Outcome ${suffix}: the learner improved after the linked Retry and human Review.`;
  const candidateTitle = `E2E reviewed support ${suffix}`;
  const candidateKey = `e2e-reviewed-support-${suffix}`.toLowerCase();
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
    await attempt.getByLabel("Your Attempt").fill(attemptResponse);
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

    const expert = await openRole(browser, "expert");
    opened.push(expert.context);
    const matchingCandidateSources = expert.page.getByTestId("foundry-candidate-source").filter({ hasText: taskTitle });
    await expect(matchingCandidateSources.first()).toBeVisible();
    const candidateSource = matchingCandidateSources.first();
    const candidate = candidateSource.getByTestId("candidate-form");
    await candidate.getByPlaceholder("candidate-key").fill(candidateKey);
    await candidate.getByPlaceholder("Candidate title").fill(candidateTitle);
    await candidate.getByPlaceholder("Purpose grounded in the reviewed pattern").fill("Reuse support that was grounded in this direct human Review.");
    await candidate.getByPlaceholder("capability-key").fill("reviewed-reasoning-support");
    await candidate.getByPlaceholder("Reference Pack key").fill("chemistry-caie-9701");
    await candidate.getByPlaceholder("Editable teaching support").fill("Require explicit units and justification for each transformation.");
    await candidate.getByRole("button", { name: "Create reviewed Component candidate" }).click();
    await expect(expert.page.getByRole("heading", { level: 2, name: candidateTitle, exact: true })).toBeVisible();

    let component = taskCard(expert.page, candidateTitle);
    const versionForm = component.getByTestId("component-version-form");
    await versionForm.getByLabel("Content JSON").fill(JSON.stringify({ support: "Edited by the expert: verify units and justify every transformation." }, null, 2));
    await versionForm.getByRole("button", { name: "Save draft & reset structural preflight" }).click();
    await expect(versionForm.getByText("Saved", { exact: true })).toBeVisible();
    component = taskCard(expert.page, candidateTitle);
    await component.getByTestId("structural-preflight-button").click();
    component = taskCard(expert.page, candidateTitle);
    await expect(component).toContainText("STRUCTURAL_PREFLIGHT");
    await expect(component).toContainText("publicationEligible");
    await expect(component).toContainText("UNAVAILABLE");
    await expect(expert.page.getByText("No expert decision has been recorded.")).toBeVisible();
    await expect(expert.page.getByRole("button", { name: /publish|approve/i })).toHaveCount(0);

    const engineer = await openRole(browser, "engineer");
    opened.push(engineer.context);
    await expect(engineer.page.getByRole("heading", { name: "Versioned implementation contracts" })).toBeVisible();
    await expect(engineer.page.getByText("These checks cover framework and core implementation contracts only. They are not product, pedagogy or learning-effectiveness Eval.")).toBeVisible();
    await expect(engineer.page.getByText("productEval")).toBeVisible();
    await expect(engineer.page.getByText("learningEffectivenessEval")).toBeVisible();
    await expect(engineer.page.getByText("UNAVAILABLE", { exact: true }).first()).toBeVisible();
  } finally {
    await Promise.all(opened.map((context) => context.close()));
  }
});
