import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

const password = process.env.E2E_SHOWCASE_PASSWORD ?? "";

async function signIn(page: Page, account: "learner" | "teacher"): Promise<void> {
  const identity = account === "learner"
    ? { email: "learner@showcase.invalid", route: "/learner", heading: "Learn from a governed evidence chain" }
    : { email: "teacher@showcase.invalid", route: "/teacher", heading: "Assign, inspect and intervene" };
  await page.goto("/sign-in");
  await page.getByLabel("Institution").fill("checkpoint-showcase");
  await page.getByLabel("Email").fill(identity.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Enter Learning Foundry" }).click();
  await expect(page).toHaveURL(new RegExp(`${identity.route}(?:\\?.*)?$`));
  await expect(page.getByRole("heading", { level: 1, name: identity.heading })).toBeVisible();
}

async function openRole(browser: Browser, account: "learner" | "teacher"): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await signIn(page, account);
  return { context, page };
}

function taskCard(page: Page, title: string) {
  return page.locator("section.card").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });
}

test("CAP-06 Retry ends at a reviewed successor-Episode chain with no Outcome", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The bounded CAP-06 stateful path runs once on desktop.");
  test.setTimeout(120_000);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const taskTitle = `CAP-06 browser Retry ${suffix}`;
  const sourceResponse = `CAP-06 source reasoning ${suffix}: I used 2 instead of dividing 1 mol by 2 L.`;
  const retryPrompt = `CAP-06 Retry ${suffix}: revisit the reviewed numerical mismatch with explicit units.`;
  const retryResponse = `CAP-06 Retry result ${suffix}: 1 mol divided by 2 L is 0.5 mol/L.`;
  const opened: BrowserContext[] = [];

  try {
    const learner = await openRole(browser, "learner");
    opened.push(learner.context);
    const createTask = learner.page.getByTestId("create-task-form");
    await createTask.getByLabel("Task title").fill(taskTitle);
    await createTask.getByLabel("Learning goal").fill("Revisit one exact reviewed Capability issue through a governed Retry.");
    await createTask.getByRole("button", { name: "Create Learning Task" }).click();
    await expect(learner.page.getByRole("heading", { level: 2, name: taskTitle, exact: true })).toBeVisible();

    const sourceAttempt = learner.page.getByTestId("attempt-form");
    await sourceAttempt.getByLabel("Calculation activity hint (optional)").selectOption({ label: "Molar concentration" });
    await sourceAttempt.getByLabel("Enter calculation values myself").check();
    await sourceAttempt.getByLabel("Amount of substance", { exact: true }).fill("1");
    await sourceAttempt.getByLabel("Amount of substance unit").selectOption("mol");
    await sourceAttempt.getByLabel("Solution volume", { exact: true }).fill("2");
    await sourceAttempt.getByLabel("Solution volume unit").selectOption("L");
    await sourceAttempt.getByLabel("Your final numerical answer").fill("2");
    await sourceAttempt.getByLabel("Problem or question").fill("Calculate the molar concentration of 1 mol in 2 L of solution.");
    await sourceAttempt.getByLabel("Your working and answer").fill(sourceResponse);
    await sourceAttempt.getByRole("button", { name: "Capture Attempt" }).click();
    await expect(learner.page.getByText(sourceResponse, { exact: true })).toBeVisible();
    await expect(learner.page.getByText("NEEDS_REVIEW", { exact: true })).toBeVisible();

    const teacher = await openRole(browser, "teacher");
    opened.push(teacher.context);
    let reviewedTask = taskCard(teacher.page, taskTitle);
    const sourceReview = reviewedTask.getByTestId("teacher-review-form");
    await expect(reviewedTask.getByText("The learner answer does not agree with the deterministic calculation within the declared tolerance.", { exact: true })).toBeVisible();
    await sourceReview.locator('select[name="decision"]').selectOption("CORRECT");
    await sourceReview.getByPlaceholder("Required correction").fill("Divide 1 mol by 2 L and correct the final numerical answer.");
    await sourceReview.getByPlaceholder("Teaching support").fill("Show the ratio and retain mol/L in the reviewed Retry.");
    await sourceReview.getByRole("button", { name: "Review & resume" }).click();

    reviewedTask = taskCard(teacher.page, taskTitle);
    const assignment = reviewedTask.getByTestId("governed-followup-form");
    await assignment.getByLabel("Follow-up type").selectOption("TRANSFER");
    await expect(assignment.getByLabel("Target representation")).toHaveValue("STRUCTURED");
    await expect(assignment.getByLabel("Target representation")).toHaveAttribute("readonly", "");
    await expect(assignment.getByText(/current runtime can honestly vary only the context/i)).toBeVisible();
    await assignment.getByLabel("Follow-up type").selectOption("RETENTION");
    await expect(assignment.getByText("Retention schedule and exposure contract", { exact: true })).toBeVisible();
    await assignment.getByLabel("Follow-up type").selectOption("RETRY");
    await assignment.getByLabel("Learner activity prompt").fill(retryPrompt);
    await assignment.getByRole("button", { name: "Assign governed RETRY" }).click();
    await expect(assignment.getByText("Saved", { exact: true })).toBeVisible();

    await learner.page.reload();
    await learner.page.getByRole("link", { name: new RegExp(taskTitle) }).click();
    const retryAttempt = learner.page.getByTestId("followup-attempt-form");
    await expect(retryAttempt).toContainText(retryPrompt);
    await expect(retryAttempt).toContainText("Exact planned activity: Molar concentration");
    await expect(retryAttempt).toContainText("Retry preserves the reviewed issue while creating a new exact runtime and review chain.");
    await expect(retryAttempt.getByLabel("Calculation activity hint (optional)")).toHaveCount(0);
    await retryAttempt.getByLabel("Amount of substance", { exact: true }).fill("1");
    await retryAttempt.getByLabel("Amount of substance unit").selectOption("mol");
    await retryAttempt.getByLabel("Solution volume", { exact: true }).fill("2");
    await retryAttempt.getByLabel("Solution volume unit").selectOption("L");
    await retryAttempt.getByLabel("Your final numerical answer", { exact: true }).fill("0.5");
    await retryAttempt.getByPlaceholder("Complete the governed follow-up activity").fill(retryResponse);
    await retryAttempt.getByRole("button", { name: "Submit RETRY Attempt" }).click();
    await expect(learner.page.getByText(retryResponse, { exact: true })).toBeVisible();

    await teacher.page.reload();
    const resultReview = teacher.page.getByTestId("followup-review-form");
    await expect(resultReview).toContainText("CAP-06 does not create a LearningOutcome, mastery decision, or effectiveness claim.");
    await resultReview.getByPlaceholder("Human teaching support").fill("The new response is linked and reviewed; no Outcome decision is made.");
    await resultReview.getByRole("button", { name: "Review follow-up result" }).click();
    await expect(resultReview).toHaveCount(0);
    const teacherHistory = teacher.page.getByTestId("teacher-followup-history").filter({ hasText: retryPrompt });
    await expect(teacherHistory).toContainText("REVIEWED");
    await expect(teacherHistory).toContainText("The new response is linked and reviewed; no Outcome decision is made.");
    await expect(teacherHistory).toContainText("CAP-06 creates no LearningOutcome");

    await learner.page.reload();
    await learner.page.getByRole("link", { name: new RegExp(taskTitle) }).click();
    const learnerHistory = learner.page.getByTestId("governed-followup-history").filter({ hasText: retryPrompt });
    await expect(learnerHistory).toContainText("REVIEWED");
    await expect(learnerHistory).toContainText("The new response is linked and reviewed; no Outcome decision is made.");
    await expect(learnerHistory).toContainText("CAP-06 creates no LearningOutcome");

    const rawUrl = process.env.E2E_DATABASE_URL;
    if (!rawUrl) throw new Error("E2E_DATABASE_URL is required");
    const sql = postgres(rawUrl, { max: 1, prepare: false });
    try {
      const [chain] = await sql<Array<{
        id: string;
        latest_transition_event_id: string;
        status: string;
        activity_type: string;
        source_episode_sequence: number;
        target_episode_sequence: number;
        proposal_episode_matches: boolean;
        plan_episode_matches: boolean;
        runtime_episode_matches: boolean;
        result_attempt_episode_matches: boolean;
        result_attempt_capability_matches: boolean;
        result_observation_matches: boolean;
        result_observation_version_matches: boolean;
        result_review_matches: boolean;
        outcomes: number;
      }>>`
        SELECT followup.id,followup.latest_transition_event_id,followup.status,followup.activity_type,
          source_episode.sequence AS source_episode_sequence,target_episode.sequence AS target_episode_sequence,
          proposal.episode_id=followup.target_episode_id AS proposal_episode_matches,
          plan.episode_id=followup.target_episode_id AS plan_episode_matches,
          runtime.episode_id=followup.target_episode_id AND runtime.activity_plan_id=plan.id AS runtime_episode_matches,
          result_attempt.episode_id=followup.target_episode_id AND result_attempt.task_id=followup.task_id AS result_attempt_episode_matches,
          result_attempt.capability_id=source_attempt.capability_id AS result_attempt_capability_matches,
          result_observation.attempt_id=result_attempt.id AS result_observation_matches,
          result_observation.capability_version_id=source_observation.capability_version_id AS result_observation_version_matches,
          result_review.observation_id=result_observation.id AS result_review_matches,
          (SELECT count(*)::int FROM foundry_product.learning_outcomes outcome WHERE outcome.task_id=task.id) AS outcomes
        FROM foundry_product.retry_attempts followup
        JOIN foundry_product.learning_tasks task ON task.id=followup.task_id
        JOIN foundry_product.learning_episodes source_episode ON source_episode.id=followup.source_episode_id
        JOIN foundry_product.learning_episodes target_episode ON target_episode.id=followup.target_episode_id
        JOIN foundry_product.activity_plan_proposals proposal ON proposal.id=followup.activity_plan_proposal_id
        JOIN foundry_product.activity_plans plan ON plan.id=followup.activity_plan_id
        JOIN foundry_product.runtime_deliveries runtime ON runtime.id=followup.runtime_delivery_id
        JOIN foundry_product.learner_attempts source_attempt ON source_attempt.id=followup.original_attempt_id
        JOIN foundry_product.diagnostic_observations source_observation ON source_observation.id=followup.reviewed_observation_id
        JOIN foundry_product.learner_attempts result_attempt ON result_attempt.id=followup.result_attempt_id
        JOIN foundry_product.diagnostic_observations result_observation ON result_observation.id=followup.result_observation_id
        JOIN foundry_product.teacher_reviews result_review ON result_review.id=followup.result_review_id
        WHERE task.title=${taskTitle} AND followup.prompt=${retryPrompt}
      `;
      expect(chain).toMatchObject({
        status: "REVIEWED",
        activity_type: "RETRY",
        source_episode_sequence: 1,
        target_episode_sequence: 2,
        proposal_episode_matches: true,
        plan_episode_matches: true,
        runtime_episode_matches: true,
        result_attempt_episode_matches: true,
        result_attempt_capability_matches: true,
        result_observation_matches: true,
        result_observation_version_matches: true,
        result_review_matches: true,
        outcomes: 0,
      });
      if (!chain) throw new Error("CAP-06 browser chain was not persisted");
      const [events] = await sql<Array<{ count: number; statuses: string[]; ends_at_latest: boolean }>>`
        WITH RECURSIVE transition_chain AS (
          SELECT event.id,event.previous_event_id,event.payload->>'toStatus' AS to_status,1 AS depth
          FROM foundry_product.governance_events event WHERE event.id=${chain.latest_transition_event_id}::uuid
          UNION ALL
          SELECT predecessor.id,predecessor.previous_event_id,predecessor.payload->>'toStatus',chain_row.depth+1
          FROM foundry_product.governance_events predecessor
          JOIN transition_chain chain_row ON predecessor.id=chain_row.previous_event_id
        )
        SELECT count(*)::int AS count,array_agg(to_status ORDER BY depth DESC) AS statuses,
          bool_or(id=${chain.latest_transition_event_id}::uuid AND depth=1) AS ends_at_latest
        FROM transition_chain
      `;
      expect(events).toEqual({
        count: 4,
        statuses: ["ASSIGNED", "IN_PROGRESS", "WAITING_FOR_REVIEW", "REVIEWED"],
        ends_at_latest: true,
      });
    } finally {
      await sql.end();
    }
  } finally {
    await Promise.allSettled(opened.map((context) => context.close()));
  }
});
