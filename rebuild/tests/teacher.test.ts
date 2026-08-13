import { describe, expect, it } from "vitest";
import { normalizeTeacherAssignment } from "../src/core/teacher";

describe("teacher MVP contracts", () => {
  it("supports one teacher assigning the same goal to multiple learners", () => {
    const assignment = normalizeTeacherAssignment({
      teacherId: "teacher-1",
      learnerIds: ["student-a", "student-b", "student-a"],
      goal: "Practice mole-ratio reasoning",
      requiredCapabilityIds: [],
      excludedCapabilityIds: [],
    });
    expect(assignment.learnerIds).toEqual(["student-a", "student-b"]);
  });

  it("rejects contradictory teacher capability constraints", () => {
    expect(() => normalizeTeacherAssignment({
      teacherId: "teacher-1",
      learnerIds: ["student-a"],
      goal: "Practice",
      requiredCapabilityIds: ["cap-a"],
      excludedCapabilityIds: ["cap-a"],
    })).toThrow();
  });
});
