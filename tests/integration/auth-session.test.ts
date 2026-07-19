import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { authenticateOidcSubject, issueAuthSession, revokeAuthSession, verifyAndRotateAuthSession } from "@/application/auth-session";
import { closeDb, getAuthDb } from "@/db/client";
import { authIdentities, authSessions, institutionMemberships, institutions } from "@/db/schema";
import { SEED } from "@/db/ids";

describe.sequential("OIDC identity and revocable session integration", () => {
  afterAll(closeDb);

  it("maps issuer+subject, not email, and invalidates a revoked signed-token reference", async () => {
    const issuer = `https://oidc.test.invalid/${randomUUID()}`;
    const subject = randomUUID();
    await getAuthDb().insert(authIdentities).values({ issuer, subject, userId: SEED.learner });
    const principal = await authenticateOidcSubject({ issuer, subject, trustedInstitution: SEED.institution });
    expect(principal).toMatchObject({ userId: SEED.learner, activeInstitutionId: SEED.institution, authMethod: "oidc" });
    await expect(authenticateOidcSubject({ issuer, subject: randomUUID(), trustedInstitution: SEED.institution })).rejects.toMatchObject({ code: "OIDC_SUBJECT_DENIED" });

    const session = await issueAuthSession(principal);
    const reference = { sessionId: session.sessionId, sessionVersion: session.sessionVersion, userId: session.userId, issuer, subject, activeInstitutionId: session.activeInstitutionId };
    await expect(verifyAndRotateAuthSession(reference)).resolves.toMatchObject({ sessionId: session.sessionId });
    await getAuthDb().update(authSessions).set({ lastVerifiedAt: new Date(Date.now() - 16 * 60 * 1000) }).where(eq(authSessions.id, session.sessionId));
    const rotated = await verifyAndRotateAuthSession(reference);
    expect(rotated).toMatchObject({ sessionId: session.sessionId, sessionVersion: session.sessionVersion + 1 });
    await expect(verifyAndRotateAuthSession(reference)).rejects.toMatchObject({ code: "SESSION_REAUTH_REQUIRED" });
    const rotatedReference = { ...reference, sessionVersion: rotated.sessionVersion };
    expect(await revokeAuthSession(session.sessionId, session.userId)).toBe(true);
    await expect(verifyAndRotateAuthSession(rotatedReference)).rejects.toMatchObject({ code: "SESSION_REAUTH_REQUIRED" });

    const expired = await issueAuthSession(principal);
    await getAuthDb().update(authSessions).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(authSessions.id, expired.sessionId));
    await expect(verifyAndRotateAuthSession({
      sessionId: expired.sessionId,
      sessionVersion: expired.sessionVersion,
      userId: expired.userId,
      issuer,
      subject,
      activeInstitutionId: expired.activeInstitutionId,
    })).rejects.toMatchObject({ code: "SESSION_REAUTH_REQUIRED" });
  });

  it("fails ambiguous multi-institution selection and trusted claims outside membership", async () => {
    const issuer = `https://oidc.test.invalid/${randomUUID()}`;
    const subject = randomUUID();
    const secondInstitutionId = randomUUID();
    await getAuthDb().insert(institutions).values({ id: secondInstitutionId, slug: `second-${randomUUID()}`, name: "Second tenant fixture" });
    await getAuthDb().insert(institutionMemberships).values({ userId: SEED.learner, institutionId: secondInstitutionId, role: "LEARNER" });
    await getAuthDb().insert(authIdentities).values({ issuer, subject, userId: SEED.learner });

    await expect(authenticateOidcSubject({ issuer, subject, trustedInstitution: null }))
      .rejects.toMatchObject({ code: "ACTIVE_INSTITUTION_AMBIGUOUS" });
    await expect(authenticateOidcSubject({ issuer, subject, trustedInstitution: randomUUID() }))
      .rejects.toMatchObject({ code: "OIDC_TENANT_DENIED" });
  });
});
