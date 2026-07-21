import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { SEED } from "@/db/ids";

const password = process.env.E2E_SHOWCASE_PASSWORD ?? "";

async function openRole(browser: Browser, account: "learner" | "teacher" | "expert"): Promise<{ context: BrowserContext; page: Page }> {
  const identity = account === "learner"
    ? { email: "learner@showcase.invalid", route: "/learner", heading: "Learn from a governed evidence chain" }
    : account === "teacher"
      ? { email: "teacher@showcase.invalid", route: "/teacher", heading: "Assign, inspect and intervene" }
      : { email: "expert@showcase.invalid", route: "/foundry", heading: "Resolve real gaps into governed exact-version assets" };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Institution").fill("checkpoint-showcase");
  await page.getByLabel("Email").fill(identity.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Enter Learning Foundry" }).click();
  await expect(page).toHaveURL(new RegExp(`${identity.route}(?:\\?.*)?$`));
  await expect(page.getByRole("heading", { level: 1, name: identity.heading })).toBeVisible();
  return { context, page };
}

test("CAP-07 supplies a real exact Web ComponentAsset and CAP-08A governs one Attempt-driven Asset proposal", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The bounded stateless CAP-07 path runs once on desktop.");
  test.setTimeout(180_000);
  const opened: BrowserContext[] = [];
  const rawUrl = process.env.E2E_DATABASE_URL;
  if (!rawUrl) throw new Error("E2E_DATABASE_URL is required");
  const sql = postgres(rawUrl, { max: 1, prepare: false });

  try {
    const [baselineHumanRows] = await sql<Array<{ review_count: number; outcome_count: number }>>`
      SELECT (SELECT count(*)::int FROM foundry_product.teacher_reviews) AS review_count,
        (SELECT count(*)::int FROM foundry_product.learning_outcomes) AS outcome_count
    `;
    if (!baselineHumanRows) throw new Error("CAP-07 human-governance baseline is unavailable");
    const learner = await openRole(browser, "learner");
    opened.push(learner.context);
    await learner.page.goto(`/learner?task=${SEED.task}`);
    const sourceAttempt = learner.page.locator("article.evidence-card").filter({ hasText: "Describe how you would verify a multi-step calculation." });
    const resolveButton = sourceAttempt.getByTestId("capability-resolution-button");
    await expect(resolveButton).toHaveCount(1);
    await resolveButton.click();
    await expect(learner.page.getByText("Saved", { exact: true })).toBeVisible();

    const expert = await openRole(browser, "expert");
    opened.push(expert.context);
    const gap = expert.page.getByTestId("capability-gap-signal");
    await expect(gap).toHaveCount(1);
    await expect(gap).toContainText("ADAPT");
    await expect(gap).toContainText("BLOCKED");
    await gap.getByTestId("gap-supply-button").click();

    const version = expert.page.getByTestId("component-version-card").filter({ hasText: "guided source interaction" });
    await expect(version).toHaveCount(1);
    await expect(expert.page.getByText("WEB COMPONENT ASSET", { exact: true }).first()).toBeVisible();
    await expect(version).toContainText("arbitrary code prohibited");
    await version.getByTestId("component-evaluation-button").click();
    await expect(version).toContainText("PASSED");
    await expect(version).toContainText("PROVIDER CHECKS · UNAVAILABLE");

    const [exactPreviewInput] = await sql<Array<{ choice_id: string; choice_label: string; retry_feedback: string }>>`
      SELECT choice->>'id' AS choice_id,choice->>'label' AS choice_label,version.content->>'retryFeedback' AS retry_feedback
      FROM foundry_product.component_versions version
      JOIN foundry_product.components component ON component.id=version.component_id
      CROSS JOIN LATERAL jsonb_array_elements(version.content->'choices') choice
      WHERE component.asset_type='WEB_COMPONENT_ASSET' AND version.status='DRAFT'
        AND choice->>'id'<>version.content->>'correctChoiceId'
      ORDER BY version.created_at DESC LIMIT 1
    `;
    if (!exactPreviewInput) throw new Error("An incorrect exact-package preview choice is required");

    const preview = version.getByTestId("web-component-preview-form");
    const previewButton = preview.getByRole("button", { name: "Run exact learner preview" });
    await expect(previewButton).toHaveAttribute("data-hydrated", "true");
    const previewChoice = preview.locator(`input[type="radio"][value="${exactPreviewInput.choice_id}"]`);
    await previewChoice.check();
    await expect(previewChoice).toBeChecked();
    await expect(previewButton).toBeEnabled();
    await previewButton.click();
    await expect(version).toContainText("PREVIEW PASSED");

    await expert.page.reload();
    const persistedPreview = version.getByTestId("persisted-web-component-preview");
    await expect(persistedPreview).toHaveAttribute("role", "status");
    await expect(persistedPreview).toHaveAttribute("aria-live", "polite");
    await expect(persistedPreview).toContainText("one persisted exact preview is the approval gate");
    await expect(persistedPreview).toContainText(exactPreviewInput.choice_label);
    await expect(persistedPreview).toContainText(`(${exactPreviewInput.choice_id})`);
    await expect(persistedPreview).toContainText("Correct: false");
    await expect(persistedPreview).toContainText(exactPreviewInput.retry_feedback);
    await expect(persistedPreview).toContainText("cap-07.shared-web-executor.v1");
    await expect(persistedPreview).toContainText("COMPONENT_STARTED");
    await expect(persistedPreview).toContainText("LEARNER_RESPONSE_SUBMITTED");
    await expect(persistedPreview).toContainText("COMPONENT_COMPLETED");

    const confirmation = version.getByTestId("publication-review-form");
    await confirmation.getByLabel("Expert rubric notes").fill("Exact interaction, checks and non-claims reviewed by the authenticated expert.");
    await confirmation.getByLabel("Immutable decision rationale").fill("Authorize this exact version only for the source institution and course.");
    const confirmationButton = confirmation.getByRole("button", { name: "Approve and publish immutable version" });
    await expect(confirmationButton).toHaveAttribute("data-hydrated", "true");
    await confirmationButton.click();
    await expect(version).toContainText("REGISTERED · EXACT VERSION");
    await expect(version).toContainText("ACTIVE");

    await learner.page.reload();
    const delivery = learner.page.getByTestId("learner-web-component-activity");
    await expect(delivery).toContainText("READY");
    const runtime = delivery.getByTestId("learner-web-component-asset");
    await expect(runtime.getByRole("button", { name: "Submit through exact learner runtime" })).toHaveAttribute("data-hydrated", "true");
    const selectedChoiceId = exactPreviewInput.choice_id;
    const [runtimeBinding] = await sql<Array<{ task_id: string; episode_id: string; proposal_id: string }>>`
      SELECT proposal.task_id,proposal.episode_id,proposal.id AS proposal_id
      FROM foundry_product.activity_plan_proposals proposal
      JOIN foundry_product.components component ON component.registered_capability_version_id=proposal.selected_capability_version_id
      WHERE component.asset_type='WEB_COMPONENT_ASSET' AND component.status='PUBLISHED' AND proposal.state='READY'
      ORDER BY proposal.created_at DESC,proposal.id DESC LIMIT 1
    `;
    if (!runtimeBinding) throw new Error("Exact READY Web ComponentAsset runtime binding is unavailable");
    const cancelledCommandKey = `cap07-browser-cancel:${crypto.randomUUID()}`;
    const cancelledFetch = await learner.page.evaluate(async ({ body }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_000);
      try {
        const response = await fetch("/api/asset-runtime", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        return { aborted: false, status: response.status };
      } catch (error) {
        return { aborted: controller.signal.aborted, message: String(error) };
      } finally {
        clearTimeout(timer);
      }
    }, { body: {
      taskId: runtimeBinding.task_id,
      episodeId: runtimeBinding.episode_id,
      activityPlanProposalId: runtimeBinding.proposal_id,
      selectedChoiceId,
      idempotencyKey: cancelledCommandKey,
    } });
    expect(cancelledFetch.aborted).toBe(true);
    await expect.poll(async () => (await sql<Array<{ status: string }>>`SELECT status FROM foundry_product.runtime_deliveries WHERE idempotency_key=${cancelledCommandKey}`)[0]?.status ?? null, { timeout: 20_000 }).toBe("CANCELLED");

    await learner.page.reload();
    const failedDelivery = learner.page.getByTestId("learner-web-component-activity");
    await expect(failedDelivery).toContainText("CANCELLED");
    const announcedFailure = failedDelivery.getByTestId("learner-web-component-runtime-failure");
    await expect(announcedFailure).toHaveAttribute("role", "status");
    await expect(announcedFailure).toHaveAttribute("aria-live", "polite");
    await expect(announcedFailure).toContainText("ASSET_RUNTIME_CANCELLED");
    await expect(failedDelivery).toContainText("attempt 1 of 2");
    await expect(failedDelivery).toContainText("failure evidence retained");
    const retry = failedDelivery.getByTestId("learner-web-component-asset-retry");
    const retryButton = retry.getByRole("button", { name: "Retry exact learner runtime" });
    await expect(retryButton).toHaveAttribute("data-hydrated", "true");
    const retryChoice = retry.locator(`input[type="radio"][value="${selectedChoiceId}"]`);
    await retryChoice.check();
    await expect(retryChoice).toBeChecked();
    await retryButton.click();
    await expect(delivery).toContainText("SUCCEEDED", { timeout: 15_000 });
    await expect(delivery).toContainText("RuntimeDelivery");
    const announcedSuccess = delivery.getByTestId("learner-web-component-runtime-success");
    await expect(announcedSuccess).toHaveAttribute("role", "status");
    await expect(announcedSuccess).toHaveAttribute("aria-live", "polite");
    await expect(announcedSuccess).toContainText(exactPreviewInput.retry_feedback);
    await expect(delivery).toContainText("No delivery creates a Diagnosis, TeacherReview or LearningOutcome.");

    const [previewDeliverySemantics] = await sql<Array<{ same_input: boolean; same_output: boolean; preview_correct: boolean; delivery_correct: boolean }>>`
      SELECT preview.learner_input->>'selectedChoiceId'=attempt.structured_input->'assetRuntimeInput'->>'selectedChoiceId' AS same_input,
        preview.runtime_output=delivery.normalized_output AS same_output,
        (preview.runtime_output->>'correct')::boolean AS preview_correct,
        (delivery.normalized_output->>'correct')::boolean AS delivery_correct
      FROM foundry_product.component_asset_previews preview
      JOIN foundry_product.capability_versions capability_version ON capability_version.component_asset_version_id=preview.component_version_id
      JOIN foundry_product.runtime_deliveries delivery ON delivery.capability_version_id=capability_version.id AND delivery.status='SUCCEEDED'
      JOIN foundry_product.learner_attempts attempt ON attempt.runtime_delivery_id=delivery.id
      ORDER BY delivery.finished_at DESC LIMIT 1
    `;
    expect(previewDeliverySemantics).toEqual({ same_input: true, same_output: true, preview_correct: false, delivery_correct: false });

      const [proof] = await sql<Array<{
        component_status: string;
        exact_registry_link: boolean;
        private_scope: boolean;
        preview_count: number;
        availability_count: number;
        ready_plan_count: number;
        successful_delivery_count: number;
        cancelled_delivery_count: number;
        runtime_attempt_count: number;
        learning_event_count: number;
        review_count: number;
        outcome_count: number;
      }>>`
        SELECT component.status AS component_status,
          registry_version.component_asset_version_id=component.active_version_id AS exact_registry_link,
          registry.institution_id=component.institution_id AND registry.course_id=component.course_id AS private_scope,
          (SELECT count(*)::int FROM foundry_product.component_asset_previews preview WHERE preview.component_version_id=component.active_version_id AND preview.status='SUCCEEDED') AS preview_count,
          (SELECT count(*)::int FROM foundry_product.capability_availability_decisions decision WHERE decision.component_version_id=component.active_version_id AND decision.availability_status='AVAILABLE') AS availability_count,
          (SELECT count(*)::int FROM foundry_product.activity_plan_proposals proposal WHERE proposal.selected_capability_version_id=registry_version.id AND proposal.state='READY') AS ready_plan_count,
          (SELECT count(*)::int FROM foundry_product.runtime_deliveries delivery WHERE delivery.capability_version_id=registry_version.id AND delivery.status='SUCCEEDED') AS successful_delivery_count,
          (SELECT count(*)::int FROM foundry_product.runtime_deliveries delivery WHERE delivery.capability_version_id=registry_version.id AND delivery.status='CANCELLED') AS cancelled_delivery_count,
          (SELECT count(*)::int FROM foundry_product.learner_attempts attempt JOIN foundry_product.runtime_deliveries delivery ON delivery.id=attempt.runtime_delivery_id WHERE delivery.capability_version_id=registry_version.id) AS runtime_attempt_count,
          (SELECT count(*)::int FROM foundry_product.learning_events event JOIN foundry_product.runtime_deliveries delivery ON delivery.id=event.runtime_delivery_id WHERE delivery.capability_version_id=registry_version.id) AS learning_event_count,
          (SELECT count(*)::int FROM foundry_product.teacher_reviews) AS review_count,
          (SELECT count(*)::int FROM foundry_product.learning_outcomes) AS outcome_count
        FROM foundry_product.components component
        JOIN foundry_product.capabilities registry ON registry.id=component.registered_capability_id
        JOIN foundry_product.capability_versions registry_version ON registry_version.id=component.registered_capability_version_id
        WHERE component.asset_type='WEB_COMPONENT_ASSET'
          AND component.supply_strategy='ADAPT'
          AND component.source_capability_resolution_id IS NOT NULL
      `;
      expect(proof).toMatchObject({
        component_status: "PUBLISHED",
        exact_registry_link: true,
        private_scope: true,
        preview_count: 1,
        availability_count: 1,
        ready_plan_count: 1,
        successful_delivery_count: 1,
        cancelled_delivery_count: 1,
        runtime_attempt_count: 2,
        review_count: baselineHumanRows.review_count,
        outcome_count: baselineHumanRows.outcome_count,
      });
      expect(proof?.learning_event_count).toBeGreaterThanOrEqual(10);

      const [versionBaseline] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM foundry_product.component_versions version
        JOIN foundry_product.components component ON component.id=version.component_id
        WHERE component.asset_type='WEB_COMPONENT_ASSET' AND component.supply_strategy='ADAPT'
      `;
      await expert.page.reload();
      const optimizationCandidate = expert.page.getByTestId("asset-optimization-candidate");
      await expect(optimizationCandidate).toHaveCount(1);
      await expect(optimizationCandidate).toContainText("INCORRECT ATTEMPT · REVIEWABLE SIGNAL");
      await expect(optimizationCandidate).toContainText("correct: false");
      await expect(optimizationCandidate).toContainText("One Attempt can support only a bounded proposal");
      await optimizationCandidate.getByTestId("asset-optimization-proposal-button").click();

      const optimizationProposal = expert.page.getByTestId("asset-optimization-proposal");
      await expect(optimizationProposal).toHaveCount(1);
      await expect(optimizationProposal).toContainText("PENDING GOVERNANCE");
      await expect(optimizationProposal).toContainText("ASSET · NOT ROUTING · NOT STRATEGY");
      await expect(optimizationProposal).toContainText("adding bounded retry feedback specific to the selected incorrect choice");
      await expect(optimizationProposal).toContainText("does not establish an asset defect");
      await expect(optimizationProposal.getByText("Exact delivered-version and Attempt lineage")).toBeVisible();

      const teacher = await openRole(browser, "teacher");
      opened.push(teacher.context);
      const teacherProposal = teacher.page.getByTestId("asset-optimization-proposal");
      await expect(teacherProposal).toHaveCount(1);
      await expect(teacherProposal).toContainText("PENDING GOVERNANCE");
      const decisionForm = teacherProposal.getByTestId("asset-optimization-decision-form");
      await expect(decisionForm).toHaveAttribute("data-hydrated", "true");
      await decisionForm.getByLabel("Human rationale").fill("Request bounded successor exploration from this exact Attempt while retaining the current version and all non-claims.");
      await decisionForm.getByRole("button", { name: "Record append-only decision" }).click();
      const teacherDecision = teacherProposal.getByTestId("asset-optimization-decision");
      await expect(teacherDecision).toContainText("REQUEST_SUCCESSOR");
      await expert.page.reload();
      const governedProposal = expert.page.getByTestId("asset-optimization-proposal");
      const optimizationDecision = governedProposal.getByTestId("asset-optimization-decision");
      await expect(optimizationDecision).toContainText("REQUEST_SUCCESSOR");
      await expect(optimizationDecision).toContainText("Recorded by");
      await expect(optimizationDecision).toContainText("current exact version remains active");
      await expect(optimizationDecision).toContainText("No successor, check, confirmation, availability, Outcome, routing or strategy record was created");

      const [optimizationProof] = await sql<Array<{
        proposal_type: string;
        signal_kind: string;
        correct: string;
        exact_component_version: boolean;
        exact_capability_version: boolean;
        decision_action: string;
        version_count: number;
        review_count: number;
        outcome_count: number;
      }>>`
        SELECT proposal.proposal_type, proposal.signal_kind,
          proposal.evidence_snapshot->>'correct' AS correct,
          proposal.component_version_id=capability_version.component_asset_version_id
            AND proposal.component_version_content_hash=component_version.content_hash AS exact_component_version,
          proposal.capability_version_id=delivery.capability_version_id
            AND proposal.capability_version_content_hash=delivery.capability_version_content_hash AS exact_capability_version,
          decision.action AS decision_action,
          (SELECT count(*)::int FROM foundry_product.component_versions version_count
            JOIN foundry_product.components component_count ON component_count.id=version_count.component_id
            WHERE component_count.asset_type='WEB_COMPONENT_ASSET' AND component_count.supply_strategy='ADAPT') AS version_count,
          (SELECT count(*)::int FROM foundry_product.teacher_reviews) AS review_count,
          (SELECT count(*)::int FROM foundry_product.learning_outcomes) AS outcome_count
        FROM foundry_product.asset_optimization_proposals proposal
        JOIN foundry_product.asset_optimization_decisions decision ON decision.proposal_id=proposal.id
        JOIN foundry_product.runtime_deliveries delivery ON delivery.id=proposal.runtime_delivery_id
        JOIN foundry_product.capability_versions capability_version ON capability_version.id=proposal.capability_version_id
        JOIN foundry_product.component_versions component_version ON component_version.id=proposal.component_version_id
      `;
      expect(optimizationProof).toMatchObject({
        proposal_type: "ASSET",
        signal_kind: "INCORRECT_ATTEMPT",
        correct: "false",
        exact_component_version: true,
        exact_capability_version: true,
        decision_action: "REQUEST_SUCCESSOR",
        version_count: versionBaseline?.count,
        review_count: baselineHumanRows.review_count,
        outcome_count: baselineHumanRows.outcome_count,
      });
  } finally {
    await sql.end();
    await Promise.allSettled(opened.map((context) => context.close()));
  }
});
