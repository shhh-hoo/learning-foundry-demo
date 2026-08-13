import { z } from "zod";

export const TeacherAssignmentCommand = z.object({
  teacherId: z.string().min(1),
  learnerIds: z.array(z.string().min(1)).min(1),
  goal: z.string().trim().min(3).max(1_000),
  instructions: z.string().trim().max(4_000).default(""),
  completionRule: z.string().trim().max(1_000).default(""),
  requiredCapabilityIds: z.array(z.string().min(1)).default([]),
  excludedCapabilityIds: z.array(z.string().min(1)).default([]),
}).superRefine((value, context) => {
  const excluded = new Set(value.excludedCapabilityIds);
  if (value.requiredCapabilityIds.some((id) => excluded.has(id))) {
    context.addIssue({ code: "custom", message: "A capability cannot be both required and excluded" });
  }
});

export type TeacherAssignmentCommand = z.infer<typeof TeacherAssignmentCommand>;

export const TeacherInterventionCommand = z.object({
  teacherId: z.string().min(1),
  taskId: z.string().min(1),
  actionType: z.enum(["REQUIRE_CAPABILITY", "EXCLUDE_CAPABILITY"]),
  capabilityId: z.string().min(1),
  reason: z.string().trim().min(3).max(1_000),
});

export type TeacherInterventionCommand = z.infer<typeof TeacherInterventionCommand>;

export const TeacherDiagnosisDecision = z.object({
  teacherId: z.string().min(1),
  proposalId: z.string().min(1),
  decision: z.enum(["ACCEPT", "CORRECT", "ESCALATE"]),
  rationale: z.string().trim().min(3).max(2_000),
  correction: z.unknown().optional(),
});

export type TeacherDiagnosisDecision = z.infer<typeof TeacherDiagnosisDecision>;

export function normalizeTeacherAssignment(input: unknown): TeacherAssignmentCommand {
  const parsed = TeacherAssignmentCommand.parse(input);
  return {
    ...parsed,
    learnerIds: [...new Set(parsed.learnerIds)],
    requiredCapabilityIds: [...new Set(parsed.requiredCapabilityIds)],
    excludedCapabilityIds: [...new Set(parsed.excludedCapabilityIds)],
  };
}
