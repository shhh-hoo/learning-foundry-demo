import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { courseEnrollments, courses, institutionMemberships, users } from "@/db/schema";
import { Role, type Actor } from "@/domain/model";
import { DomainInvariantError } from "@/domain/invariants";

export async function getActor(userId: string, activeInstitutionId: string, authMethod: string, sessionId: string): Promise<Actor> {
  const db = getDb();
  if (!activeInstitutionId) throw new DomainInvariantError("An institution must be selected explicitly", "ACTIVE_INSTITUTION_REQUIRED");
  const [principal] = await db.select({ active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  if (!principal) throw new DomainInvariantError("Authenticated user was not found", "PRINCIPAL_NOT_FOUND");
  if (!principal.active) throw new DomainInvariantError("Authenticated user is disabled", "PRINCIPAL_INACTIVE");
  const memberships = await db.select().from(institutionMemberships).where(and(eq(institutionMemberships.userId, userId), eq(institutionMemberships.institutionId, activeInstitutionId)));
  if (memberships.length === 0) throw new DomainInvariantError("Active institution membership is required", "NO_MEMBERSHIP");
  const roles = [...new Set(memberships.map((item) => Role.parse(item.role)))];
  const enrollments = await db.select({ courseId: courseEnrollments.courseId }).from(courseEnrollments)
    .innerJoin(courses, eq(courses.id, courseEnrollments.courseId))
    .where(and(
      eq(courseEnrollments.userId, userId),
      eq(courseEnrollments.institutionId, activeInstitutionId),
      eq(courses.institutionId, activeInstitutionId),
      eq(courses.active, true),
    ));
  return {
    userId,
    institutionId: activeInstitutionId,
    roles,
    courseIds: [...new Set(enrollments.map((item) => item.courseId))],
    authMethod,
    sessionId,
  };
}
