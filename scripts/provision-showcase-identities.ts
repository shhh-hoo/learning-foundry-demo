import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { SEED } from "@/db/ids";
import { authIdentities, users } from "@/db/schema";
import { SYNTHETIC_ISSUER, authenticateSyntheticPrincipal } from "@/application/auth-session";

const showcasePrincipals = [SEED.learner, SEED.teacher, SEED.expert, SEED.engineer] as const;

export async function provisionShowcaseIdentities(): Promise<void> {
  if (process.env.SYNTHETIC_SHOWCASE_MODE !== "true") {
    throw new Error("Refusing to provision synthetic identities: SYNTHETIC_SHOWCASE_MODE=true is required.");
  }

  const db = getDb();
  for (const userId of showcasePrincipals) {
    const [user] = await db.select({ id: users.id, active: users.active })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.active, true)))
      .limit(1);
    if (!user) {
      throw new Error(`Synthetic showcase user ${userId} must be seeded before identity provisioning.`);
    }

    await db.insert(authIdentities).values({
      issuer: SYNTHETIC_ISSUER,
      subject: userId,
      userId,
      active: true,
    }).onConflictDoUpdate({
      target: [authIdentities.issuer, authIdentities.subject],
      set: { userId, active: true },
    });
  }

  for (const userId of showcasePrincipals) {
    const principal = await authenticateSyntheticPrincipal({ userId, activeInstitutionId: SEED.institution });
    if (principal.userId !== userId || principal.identityId.length === 0) {
      throw new Error(`Synthetic identity verification failed for ${userId}.`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await provisionShowcaseIdentities();
    console.log(`Provisioned and verified ${showcasePrincipals.length} synthetic showcase identities.`);
  } finally {
    await closeDb();
  }
}
