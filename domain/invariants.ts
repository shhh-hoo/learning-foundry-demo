import type { Actor, Role } from "@/domain/model";

export class DomainInvariantError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}

export function hasRole(actor: Actor, roles: Role[]): boolean {
  return actor.roles.some((role) => roles.includes(role));
}

export function requireRole(actor: Actor, roles: Role[]): void {
  if (!hasRole(actor, roles)) {
    throw new DomainInvariantError(`Role ${roles.join(" or ")} is required`, "FORBIDDEN_ROLE");
  }
}

export function requireCourseAccess(actor: Actor, institutionId: string, courseId: string): void {
  if (actor.institutionId !== institutionId || !actor.courseIds.includes(courseId)) {
    throw new DomainInvariantError("Course is outside the actor's authorized institution scope", "TENANT_ISOLATION");
  }
}

export function requireHumanCommand(actor: Actor, roles: Role[]): void {
  requireRole(actor, roles);
  if (!actor.userId || !actor.sessionId || !actor.authMethod) {
    throw new DomainInvariantError("Governance records require authenticated actor provenance", "HUMAN_AUTHORITY_REQUIRED");
  }
}

export function requireReviewBeforeOutcome(reviewId?: string | null): asserts reviewId is string {
  if (!reviewId) {
    throw new DomainInvariantError("A reviewed retry result is required before LearningOutcome", "REVIEW_REQUIRED");
  }
}
