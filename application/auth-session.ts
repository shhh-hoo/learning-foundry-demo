import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getAuthDb } from "@/db/client";
import { authIdentities, authSessions, institutionMemberships, institutions, securityEvents, users } from "@/db/schema";
import { DomainInvariantError } from "@/domain/invariants";

export const AUTH_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const AUTH_SESSION_ROTATION_SECONDS = 15 * 60;
export const SYNTHETIC_ISSUER = "urn:learning-foundry:synthetic-showcase";

export type AuthenticatedPrincipal = {
  userId: string;
  identityId: string;
  issuer: string;
  subject: string;
  name: string;
  email: string;
  activeInstitutionId: string;
  authMethod: "oidc" | "synthetic-credentials";
};

export type VerifiedSession = {
  sessionId: string;
  sessionVersion: number;
  userId: string;
  identityId: string;
  issuer: string;
  subject: string;
  activeInstitutionId: string;
  expiresAt: Date;
};

export function redactedPrincipal(issuer: string, subject: string): string {
  return createHash("sha256").update(`${issuer}\0${subject}`).digest("hex").slice(0, 24);
}

export type SecurityEventInput = {
  eventClass: "AUTHENTICATION" | "AUTHORIZATION" | "SERVICE";
  eventCode: string;
  institutionId?: string;
  actorUserId?: string;
  sessionId?: string;
  principal?: string;
  purpose?: string;
  detail?: Record<string, string | number | boolean | null>;
};

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  await getAuthDb().insert(securityEvents).values({
    institutionId: input.institutionId,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    eventClass: input.eventClass,
    eventCode: input.eventCode,
    principal: input.principal,
    purpose: input.purpose,
    detail: input.detail ?? {},
  });
}

export async function recordSecurityEventBestEffort(input: SecurityEventInput): Promise<void> {
  try {
    await recordSecurityEvent(input);
  } catch (error) {
    console.error("Security audit write failed", error);
  }
}

async function chooseActiveInstitution(userId: string, trustedInstitution: string | null): Promise<string> {
  const rows = await getAuthDb().select({ institutionId: institutionMemberships.institutionId, slug: institutions.slug })
    .from(institutionMemberships)
    .innerJoin(institutions, eq(institutions.id, institutionMemberships.institutionId))
    .where(eq(institutionMemberships.userId, userId));
  const institutionsById = [...new Map(rows.map((row) => [row.institutionId, row])).values()];
  if (trustedInstitution) {
    const selected = institutionsById.find((row) => row.institutionId === trustedInstitution || row.slug === trustedInstitution);
    if (!selected) throw new DomainInvariantError("OIDC institution claim is not an active membership", "OIDC_TENANT_DENIED");
    return selected.institutionId;
  }
  if (institutionsById.length !== 1) {
    throw new DomainInvariantError("OIDC identity requires one unambiguous active institution", "ACTIVE_INSTITUTION_AMBIGUOUS");
  }
  return institutionsById[0].institutionId;
}

export async function authenticateOidcSubject(input: {
  issuer: string;
  subject: string;
  trustedInstitution: string | null;
}): Promise<AuthenticatedPrincipal> {
  const principal = redactedPrincipal(input.issuer, input.subject);
  const [row] = await getAuthDb().select({ identity: authIdentities, user: users })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(and(eq(authIdentities.issuer, input.issuer), eq(authIdentities.subject, input.subject)))
    .limit(1);
  if (!row?.identity.active || !row.user.active) {
    await recordSecurityEvent({ eventClass: "AUTHENTICATION", eventCode: "OIDC_SUBJECT_DENIED", principal });
    throw new DomainInvariantError("OIDC subject is not bound to an active local principal", "OIDC_SUBJECT_DENIED");
  }
  let activeInstitutionId: string;
  try {
    activeInstitutionId = await chooseActiveInstitution(row.user.id, input.trustedInstitution);
  } catch (error) {
    await recordSecurityEventBestEffort({
      eventClass: "AUTHENTICATION",
      eventCode: error instanceof DomainInvariantError ? error.code : "OIDC_TENANT_DENIED",
      principal,
      detail: { trustedInstitutionClaimPresent: input.trustedInstitution !== null },
    });
    throw error;
  }
  return {
    userId: row.user.id,
    identityId: row.identity.id,
    issuer: row.identity.issuer,
    subject: row.identity.subject,
    name: row.user.name,
    email: row.user.email,
    activeInstitutionId,
    authMethod: "oidc",
  };
}

export async function authenticateSyntheticPrincipal(input: { userId: string; activeInstitutionId: string }): Promise<AuthenticatedPrincipal> {
  const db = getAuthDb();
  const [user] = await db.select().from(users).where(and(eq(users.id, input.userId), eq(users.active, true))).limit(1);
  if (!user) throw new DomainInvariantError("Synthetic principal is inactive", "PRINCIPAL_INACTIVE");
  const subject = user.id;
  const [identity] = await db.select().from(authIdentities).where(and(eq(authIdentities.issuer, SYNTHETIC_ISSUER), eq(authIdentities.subject, subject))).limit(1);
  if (!identity || identity.userId !== user.id || !identity.active) throw new DomainInvariantError("Synthetic identity must be pre-provisioned by the local owner", "SYNTHETIC_IDENTITY_DENIED");
  const activeInstitutionId = await chooseActiveInstitution(user.id, input.activeInstitutionId);
  return { userId: user.id, identityId: identity.id, issuer: identity.issuer, subject, name: user.name, email: user.email, activeInstitutionId, authMethod: "synthetic-credentials" };
}

export async function issueAuthSession(principal: AuthenticatedPrincipal): Promise<VerifiedSession> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000);
  const [record] = await getAuthDb().insert(authSessions).values({
    id: sessionId,
    identityId: principal.identityId,
    userId: principal.userId,
    institutionId: principal.activeInstitutionId,
    expiresAt,
  }).returning();
  return {
    sessionId: record.id,
    sessionVersion: record.version,
    userId: principal.userId,
    identityId: principal.identityId,
    issuer: principal.issuer,
    subject: principal.subject,
    activeInstitutionId: principal.activeInstitutionId,
    expiresAt: record.expiresAt,
  };
}

export async function verifyAndRotateAuthSession(input: {
  sessionId: string;
  sessionVersion: number;
  userId: string;
  issuer: string;
  subject: string;
  activeInstitutionId: string;
}): Promise<VerifiedSession> {
  const now = new Date();
  const [row] = await getAuthDb().select({ session: authSessions, identity: authIdentities, user: users })
    .from(authSessions)
    .innerJoin(authIdentities, eq(authIdentities.id, authSessions.identityId))
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(
      eq(authSessions.id, input.sessionId),
      eq(authSessions.version, input.sessionVersion),
      eq(authSessions.userId, input.userId),
      eq(authSessions.institutionId, input.activeInstitutionId),
      gt(authSessions.expiresAt, now),
      isNull(authSessions.revokedAt),
      eq(authIdentities.issuer, input.issuer),
      eq(authIdentities.subject, input.subject),
      eq(authIdentities.active, true),
      eq(users.active, true),
    )).limit(1);
  if (!row) throw new DomainInvariantError("Authentication session is expired, revoked or stale", "SESSION_REAUTH_REQUIRED");
  const rotationDue = row.session.lastVerifiedAt.getTime() <= now.getTime() - AUTH_SESSION_ROTATION_SECONDS * 1000;
  if (!rotationDue) {
    return { sessionId: row.session.id, sessionVersion: row.session.version, userId: row.session.userId, identityId: row.identity.id, issuer: row.identity.issuer, subject: row.identity.subject, activeInstitutionId: row.session.institutionId, expiresAt: row.session.expiresAt };
  }
  const [rotated] = await getAuthDb().update(authSessions).set({ version: row.session.version + 1, lastVerifiedAt: now })
    .where(and(eq(authSessions.id, row.session.id), eq(authSessions.version, row.session.version), isNull(authSessions.revokedAt)))
    .returning();
  if (!rotated) throw new DomainInvariantError("Authentication session changed during rotation", "SESSION_REAUTH_REQUIRED");
  return { sessionId: rotated.id, sessionVersion: rotated.version, userId: rotated.userId, identityId: row.identity.id, issuer: row.identity.issuer, subject: row.identity.subject, activeInstitutionId: rotated.institutionId, expiresAt: rotated.expiresAt };
}

export async function revokeAuthSession(sessionId: string, userId: string): Promise<boolean> {
  const rows = await getAuthDb().update(authSessions).set({ revokedAt: new Date(), version: sql`${authSessions.version} + 1` })
    .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .returning({ id: authSessions.id });
  return rows.length === 1;
}

export async function validateSessionRecord(input: Parameters<typeof verifyAndRotateAuthSession>[0]): Promise<void> {
  await verifyAndRotateAuthSession(input);
}
