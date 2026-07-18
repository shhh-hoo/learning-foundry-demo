import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Actor, Role } from "@/domain/model";
import { DomainInvariantError, hasRole } from "@/domain/invariants";
import { getActor } from "@/application/actor";

export { getActor } from "@/application/actor";

type ActiveSessionUser = { id: string; activeInstitutionId: string; authMethod: string; sessionId: string };

function activeSessionUser(user: unknown): ActiveSessionUser {
  const value = user as Partial<ActiveSessionUser>;
  if (!value.id || !value.activeInstitutionId || !value.authMethod || !value.sessionId) {
    throw new DomainInvariantError("Authenticated session is missing active institution provenance", "SESSION_PROVENANCE_REQUIRED");
  }
  return value as ActiveSessionUser;
}

export async function getActorFromSessionUser(user: unknown): Promise<Actor> {
  const active = activeSessionUser(user);
  return getActor(active.id, active.activeInstitutionId, active.authMethod, active.sessionId);
}

export async function requireActor(): Promise<Actor> {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return getActorFromSessionUser(session.user);
}

export async function requireWorkspaceActor(allowedRoles: Role[], workspace: string): Promise<Actor> {
  const actor = await requireActor();
  if (!hasRole(actor, allowedRoles)) redirect(`/denied?workspace=${encodeURIComponent(workspace)}`);
  return actor;
}

export async function requireApiActor(): Promise<Actor> {
  const session = await auth();
  if (!session?.user?.id) throw new DomainInvariantError("Authentication required", "UNAUTHENTICATED");
  return getActorFromSessionUser(session.user);
}
