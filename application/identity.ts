import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Actor, Role } from "@/domain/model";
import { DomainInvariantError, hasRole } from "@/domain/invariants";
import { getActor } from "@/application/actor";
import { assertProtectedAuthConfigured } from "@/application/auth-contract";
import { recordSecurityEventBestEffort } from "@/application/auth-session";
import { withTenantDatabase } from "@/db/client";

export { getActor } from "@/application/actor";

type ActiveSessionUser = {
  id: string;
  activeInstitutionId: string;
  authMethod: string;
  authIssuer: string;
  authSubject: string;
  sessionId: string;
  sessionVersion: number;
};

function activeSessionUser(user: unknown): ActiveSessionUser {
  const value = user as Partial<ActiveSessionUser>;
  if (!value.id || !value.activeInstitutionId || !value.authMethod || !value.authIssuer || !value.authSubject || !value.sessionId || !value.sessionVersion) {
    throw new DomainInvariantError("Authenticated session is missing active institution provenance", "SESSION_PROVENANCE_REQUIRED");
  }
  return value as ActiveSessionUser;
}

export async function getActorFromSessionUser(user: unknown): Promise<Actor> {
  const active = activeSessionUser(user);
  if (process.env.NODE_ENV === "production" && active.authMethod !== "oidc") {
    throw new DomainInvariantError("Production protected access requires OIDC provenance", "PRODUCTION_OIDC_REQUIRED");
  }
  return getActor(active.id, active.activeInstitutionId, active.authMethod, active.sessionId, {
    sessionVersion: active.sessionVersion,
    issuer: active.authIssuer,
    subject: active.authSubject,
  });
}

export async function requireActor(): Promise<Actor> {
  assertProtectedAuthConfigured();
  const session = await auth();
  if (!session?.user?.id) {
    await recordSecurityEventBestEffort({ eventClass: "AUTHENTICATION", eventCode: "UNAUTHENTICATED_PROTECTED_ACCESS", detail: { boundary: "server-component" } });
    redirect("/sign-in");
  }
  try {
    return await getActorFromSessionUser(session.user);
  } catch (error) {
    await recordSecurityEventBestEffort({
      eventClass: "AUTHENTICATION",
      eventCode: error instanceof DomainInvariantError ? error.code : "SESSION_REAUTH_REQUIRED",
      detail: { boundary: "server-component" },
    });
    redirect("/sign-in");
  }
}

export async function requireWorkspaceActor(allowedRoles: Role[], workspace: string): Promise<Actor> {
  const actor = await requireActor();
  if (!hasRole(actor, allowedRoles)) {
    await recordSecurityEventBestEffort({
      eventClass: "AUTHORIZATION",
      eventCode: "ROLE_DENIED",
      institutionId: actor.institutionId,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      detail: { boundary: "workspace", workspace },
    });
    redirect(`/denied?workspace=${encodeURIComponent(workspace)}`);
  }
  return actor;
}

export async function requireApiActor(): Promise<Actor> {
  assertProtectedAuthConfigured();
  const session = await auth();
  if (!session?.user?.id) {
    await recordSecurityEventBestEffort({ eventClass: "AUTHENTICATION", eventCode: "UNAUTHENTICATED_PROTECTED_ACCESS", detail: { boundary: "api" } });
    throw new DomainInvariantError("Authentication required", "UNAUTHENTICATED");
  }
  try {
    return await getActorFromSessionUser(session.user);
  } catch (error) {
    await recordSecurityEventBestEffort({
      eventClass: "AUTHENTICATION",
      eventCode: error instanceof DomainInvariantError ? error.code : "SESSION_REAUTH_REQUIRED",
      detail: { boundary: "api" },
    });
    throw error;
  }
}

async function auditProtectedFailure(actor: Actor, error: unknown): Promise<void> {
  const code = error instanceof DomainInvariantError ? error.code : "PROTECTED_OPERATION_FAILED";
  await recordSecurityEventBestEffort({
    eventClass: "AUTHORIZATION",
    eventCode: code,
    institutionId: actor.institutionId,
    actorUserId: actor.userId,
    sessionId: actor.sessionId,
  });
}

export async function withApiActor<T>(operation: (actor: Actor) => Promise<T>): Promise<T> {
  const actor = await requireApiActor();
  try {
    return await withTenantDatabase(actor, () => operation(actor));
  } catch (error) {
    await auditProtectedFailure(actor, error);
    throw error;
  }
}

export async function withWorkspaceActor<T>(allowedRoles: Role[], workspace: string, operation: (actor: Actor) => Promise<T>): Promise<T> {
  const actor = await requireWorkspaceActor(allowedRoles, workspace);
  try {
    return await withTenantDatabase(actor, () => operation(actor));
  } catch (error) {
    await auditProtectedFailure(actor, error);
    throw error;
  }
}
