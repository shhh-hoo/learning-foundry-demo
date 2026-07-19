import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeServiceAuthority, withServiceTenantContext } from "@/application/service-authority";
import { closeDb, getSql } from "@/db/client";
import { SEED } from "@/db/ids";

describe.sequential("audited worker authority integration", () => {
  afterAll(async () => {
    await closeServiceAuthority();
    await closeDb();
  });

  it("audits one authorized invocation, denies ungranted scope and cannot write Product State", async () => {
    const principal = `rw02-worker-${randomUUID()}`;
    const purpose = "RW02_SERVICE_PROOF";
    process.env.FOUNDRY_SERVICE_GRANTS = JSON.stringify([{ principal, purposes: [purpose], institutionIds: [SEED.institution] }]);

    const identity = await withServiceTenantContext({ principal, purpose, institutionId: SEED.institution }, async (sql) => {
      const [row] = await sql<Array<{ current_user: string; institution_id: string }>>`
        SELECT current_user, current_setting('foundry.institution_id') AS institution_id
      `;
      return row;
    });
    expect(identity).toEqual({ current_user: "foundry_worker", institution_id: SEED.institution });

    const [audited] = await getSql()<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM foundry_operational.security_events
      WHERE principal=${principal} AND purpose=${purpose} AND event_code='SERVICE_INVOCATION'
    `;
    expect(audited.count).toBe(1);

    await expect(withServiceTenantContext({ principal, purpose: "UNGRANTED", institutionId: SEED.institution }, async () => "not-run"))
      .rejects.toMatchObject({ code: "SERVICE_SCOPE_DENIED" });

    await expect(withServiceTenantContext({ principal, purpose, institutionId: SEED.institution }, async (sql) => {
      await sql`
        INSERT INTO foundry_product.learning_tasks (id, institution_id, course_id, learner_id, title, goal)
        VALUES (${randomUUID()}::uuid, ${SEED.institution}::uuid, ${SEED.course}::uuid, ${SEED.learner}::uuid, 'Forbidden worker write', 'Must fail')
      `;
    })).rejects.toThrow();
    const [afterDeniedWrite] = await getSql()<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM foundry_operational.security_events
      WHERE principal=${principal} AND purpose=${purpose} AND event_code='SERVICE_INVOCATION'
    `;
    expect(afterDeniedWrite.count).toBe(1);

    const missingInstitution = randomUUID();
    process.env.FOUNDRY_SERVICE_GRANTS = JSON.stringify([{ principal, purposes: [purpose], institutionIds: [missingInstitution] }]);
    let operationRan = false;
    await expect(withServiceTenantContext({ principal, purpose, institutionId: missingInstitution }, async () => {
      operationRan = true;
    })).rejects.toThrow();
    expect(operationRan).toBe(false);

    await getSql()`DELETE FROM foundry_operational.security_events WHERE principal=${principal}`;
  });
});
