import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { SEED } from "@/db/ids";

const password = process.env.E2E_SHOWCASE_PASSWORD ?? "";

async function signInLearner(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Institution").fill("checkpoint-showcase");
  await page.getByLabel("Email").fill("learner@showcase.invalid");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Enter Learning Foundry" }).click();
  await expect(page).toHaveURL(/\/learner/);
}

test.describe.configure({ mode: "serial" });

test("actual Auth.js OIDC redirect and callback maps immutable subject to the local learner", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The non-synthetic OIDC callback path is executed once on desktop.");
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue with institution sign-in" }).click();
  await expect(page).toHaveURL(/\/learner/);
  await expect(page.getByRole("heading", { name: "Learn from a governed evidence chain" })).toBeVisible();
  const rawUrl = process.env.E2E_DATABASE_URL;
  if (!rawUrl) throw new Error("E2E_DATABASE_URL is required");
  const sql = postgres(rawUrl, { max: 1, prepare: false });
  try {
    const sessions = await sql`
      SELECT s.id
      FROM foundry_product.auth_sessions s
      JOIN foundry_product.auth_identities i ON i.id = s.identity_id
      WHERE i.issuer = 'https://localhost:3201' AND i.subject = 'oidc-e2e-learner'
        AND s.user_id = ${SEED.learner}::uuid AND s.revoked_at IS NULL
    `;
    expect(sessions.length).toBeGreaterThan(0);
  } finally {
    await sql.end();
  }
});

test("unauthenticated protected page and API access fail closed", async ({ page, request }) => {
  const startedAt = new Date();
  await page.goto("/learner");
  await expect(page).toHaveURL(/\/sign-in/);
  const response = await request.post("/api/tasks", { data: { courseId: SEED.course, title: "Denied", goal: "No session", idempotencyKey: "denied-no-session" }, maxRedirects: 0 });
  expect([302, 303, 307, 401]).toContain(response.status());
  const rawUrl = process.env.E2E_DATABASE_URL;
  if (!rawUrl) throw new Error("E2E_DATABASE_URL is required");
  const sql = postgres(rawUrl, { max: 1, prepare: false });
  try {
    await expect.poll(async () => {
      const [row] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM foundry_operational.security_events
        WHERE event_class = 'AUTHENTICATION'
          AND event_code = 'UNAUTHENTICATED_PROTECTED_ACCESS'
          AND created_at >= ${startedAt}
      `;
      return row?.count ?? 0;
    }).toBeGreaterThan(0);
  } finally {
    await sql.end();
  }
});

test("revoking the server-side session invalidates the browser token", async ({ page }) => {
  await signInLearner(page);
  const rawUrl = process.env.E2E_DATABASE_URL;
  if (!rawUrl) throw new Error("E2E_DATABASE_URL is required");
  const sql = postgres(rawUrl, { max: 1, prepare: false });
  try {
    const revoked = await sql`
      UPDATE foundry_product.auth_sessions
      SET revoked_at = now(), version = version + 1
      WHERE user_id = ${SEED.learner}::uuid AND revoked_at IS NULL
      RETURNING id
    `;
    expect(revoked.length).toBeGreaterThan(0);
  } finally {
    await sql.end();
  }
  await page.reload();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in to a workspace" })).toBeVisible();
  const audit = postgres(rawUrl, { max: 1, prepare: false });
  try {
    await expect.poll(async () => {
      const [row] = await audit<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM foundry_operational.security_events
        WHERE event_class = 'AUTHENTICATION' AND event_code = 'SESSION_REAUTH_REQUIRED'
      `;
      return row?.count ?? 0;
    }).toBeGreaterThan(0);
  } finally {
    await audit.end();
  }
});

test("actual Auth.js sign-out revokes its DB-backed session and records the event", async ({ page }) => {
  await signInLearner(page);
  const rawUrl = process.env.E2E_DATABASE_URL;
  if (!rawUrl) throw new Error("E2E_DATABASE_URL is required");
  const sql = postgres(rawUrl, { max: 1, prepare: false });
  try {
    const [session] = await sql<Array<{ id: string }>>`
      SELECT id FROM foundry_product.auth_sessions
      WHERE user_id = ${SEED.learner}::uuid AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(session?.id).toBeTruthy();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect.poll(async () => {
      const [row] = await sql<Array<{ revoked: boolean; audited: boolean }>>`
        SELECT s.revoked_at IS NOT NULL AS revoked,
          EXISTS (
            SELECT 1 FROM foundry_operational.security_events e
            WHERE e.session_id = s.id AND e.event_code = 'SIGN_OUT_REVOKED'
          ) AS audited
        FROM foundry_product.auth_sessions s WHERE s.id = ${session.id}::uuid
      `;
      return row;
    }).toEqual({ revoked: true, audited: true });
  } finally {
    await sql.end();
  }
});
