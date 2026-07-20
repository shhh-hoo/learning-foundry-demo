import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { SEED } from "@/db/ids";

const password = process.env.E2E_SHOWCASE_PASSWORD ?? "";

test("authorized teacher assigns one canonical learner Task with a governed Capability constraint", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The bounded CAP-05 command path is exercised once on desktop.");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const title = `CAP-05 browser assignment ${suffix}`;
  const instructions = `Show the numerical method and preserve units ${suffix}.`;

  await page.goto("/sign-in");
  await page.getByLabel("Institution").fill("checkpoint-showcase");
  await page.getByLabel("Email").fill("teacher@showcase.invalid");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Enter Learning Foundry" }).click();
  await expect(page).toHaveURL(/\/teacher/);
  await expect(page.getByRole("heading", { level: 1, name: "Assign, inspect and intervene" })).toBeVisible();

  const form = page.getByTestId("teacher-assignment-form");
  await form.getByLabel("Learner").selectOption({ index: 1 });
  await form.getByLabel("Task title").fill(title);
  await form.getByLabel("Goal").fill("Complete one governed concentration activity with explicit units.");
  await form.getByLabel("Teacher instructions").fill(instructions);
  await form.getByLabel("Completion rule").fill("Submit one complete learner Attempt with units.");
  await form.getByLabel("Required Capabilities (optional)").selectOption(SEED.chemistryMolarConcentration);
  await form.getByRole("button", { name: "Assign canonical Task" }).click();

  await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
  const rawUrl = process.env.E2E_DATABASE_URL;
  if (!rawUrl) throw new Error("E2E_DATABASE_URL is required");
  const sql = postgres(rawUrl, { max: 1, prepare: false });
  try {
    const rows = await sql<Array<{
      assignment_id: string;
      task_id: string;
      episode_sequence: number;
      effect: string;
      capability_id: string;
      teacher_id: string;
      actor_user_id: string;
      actor_session_id: string;
      reason: string;
    }>>`
      SELECT assignment.id AS assignment_id, task.id AS task_id, episode.sequence AS episode_sequence,
        constraint_row.effect, constraint_row.capability_id, assignment.teacher_id,
        assignment.actor_provenance->>'userId' AS actor_user_id,
        assignment.actor_provenance->>'sessionId' AS actor_session_id,
        constraint_row.reason
      FROM foundry_product.teacher_assignments assignment
      JOIN foundry_product.learning_tasks task ON task.id=assignment.task_id
      JOIN foundry_product.learning_episodes episode ON episode.task_id=task.id AND episode.sequence=1
      JOIN foundry_product.teacher_capability_constraints constraint_row ON constraint_row.source_assignment_id=assignment.id
      WHERE task.title=${title}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      episode_sequence: 1,
      effect: "REQUIRE",
      capability_id: SEED.chemistryMolarConcentration,
      teacher_id: SEED.teacher,
      actor_user_id: SEED.teacher,
      reason: `Required by teacher assignment: ${instructions}`,
    });
    expect(rows[0]?.actor_session_id).toBeTruthy();
  } finally {
    await sql.end();
  }
});
