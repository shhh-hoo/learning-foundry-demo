import { z } from "zod";
import { DomainInvariantError } from "@/domain/invariants";

export const TeacherInterventionType = z.enum(["REQUIRE_CAPABILITY", "EXCLUDE_CAPABILITY"]);
export type TeacherInterventionType = z.infer<typeof TeacherInterventionType>;

export const TeacherAssignmentCommand = z.object({
  courseId: z.string().uuid(),
  learnerId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  goal: z.string().trim().min(5).max(500),
  instructions: z.string().trim().min(5).max(2_000),
  completionRule: z.string().trim().min(5).max(500),
  dueAt: z.string().datetime().optional(),
  requiredCapabilityIds: z.array(z.string().uuid()).max(12).default([]),
  excludedCapabilityIds: z.array(z.string().uuid()).max(12).default([]),
  idempotencyKey: z.string().trim().min(8).max(240),
}).strict();

export const TeacherInterventionCommand = z.object({
  runtimeDeliveryId: z.string().uuid(),
  actionType: TeacherInterventionType,
  capabilityId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1_000),
  idempotencyKey: z.string().trim().min(8).max(240),
}).strict();

export type TeacherAssignmentCommand = z.infer<typeof TeacherAssignmentCommand>;
export type TeacherInterventionCommand = z.infer<typeof TeacherInterventionCommand>;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normalizeTeacherAssignment(input: unknown): TeacherAssignmentCommand {
  const parsed = TeacherAssignmentCommand.parse(input);
  const requiredCapabilityIds = uniqueSorted(parsed.requiredCapabilityIds);
  const excludedCapabilityIds = uniqueSorted(parsed.excludedCapabilityIds);
  if (requiredCapabilityIds.some((id) => excludedCapabilityIds.includes(id))) {
    throw new DomainInvariantError("A Capability cannot be both required and excluded", "TEACHER_CONSTRAINT_CONFLICT");
  }
  return { ...parsed, requiredCapabilityIds, excludedCapabilityIds };
}

export function normalizeTeacherIntervention(input: unknown): TeacherInterventionCommand {
  return TeacherInterventionCommand.parse(input);
}
