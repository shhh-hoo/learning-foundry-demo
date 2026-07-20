import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeTeacherAssignment, normalizeTeacherIntervention } from "@/domain/teacher-governance";

describe("CAP-05 teacher command boundaries", () => {
  it("normalizes Capability sets deterministically and rejects contradictory constraints", () => {
    const first = randomUUID();
    const second = randomUUID();
    const base = {
      courseId: randomUUID(), learnerId: randomUUID(), title: "Assigned task",
      goal: "Complete the assigned learning goal.", instructions: "Follow the teacher instructions.",
      completionRule: "Submit one completed learner Attempt.", idempotencyKey: "teacher-assignment:test",
    };
    expect(normalizeTeacherAssignment({ ...base, requiredCapabilityIds: [second, first, second] }).requiredCapabilityIds).toEqual([first, second].sort());
    expect(() => normalizeTeacherAssignment({ ...base, requiredCapabilityIds: [first], excludedCapabilityIds: [first] }))
      .toThrowError(expect.objectContaining({ code: "TEACHER_CONSTRAINT_CONFLICT" }));
  });

  it("accepts only the two bounded intervention types", () => {
    const command = { runtimeDeliveryId: randomUUID(), capabilityId: randomUUID(), reason: "Require this next cycle.", idempotencyKey: "teacher-intervention:test" };
    expect(normalizeTeacherIntervention({ ...command, actionType: "REQUIRE_CAPABILITY" }).actionType).toBe("REQUIRE_CAPABILITY");
    expect(normalizeTeacherIntervention({ ...command, actionType: "EXCLUDE_CAPABILITY" }).actionType).toBe("EXCLUDE_CAPABILITY");
    expect(() => normalizeTeacherIntervention({ ...command, actionType: "PAUSE" })).toThrow();
  });
});
