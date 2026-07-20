import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CAP-05 schema, authority and replay boundary", () => {
  const migration = readFileSync("db/migrations/0009_teacher_assignment_intervention.sql", "utf8");
  const service = readFileSync("application/teacher-governance.ts", "utf8");
  const context = readFileSync("application/context-service.ts", "utf8");

  it("adds tenant-scoped append-only human records without globally unique keys", () => {
    expect(migration).toContain('CREATE TABLE "foundry_product"."teacher_assignments"');
    expect(migration).toContain('CREATE TABLE "foundry_product"."teacher_interventions"');
    expect(migration).toContain('CREATE TABLE "foundry_product"."teacher_capability_constraints"');
    expect(migration).toContain('("institution_id","teacher_id","idempotency_key")');
    expect(migration).not.toMatch(/UNIQUE\s*\(\s*"idempotency_key"\s*\)/);
    expect(migration.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(3);
    expect(migration).toContain("CAP-05 human governance rows are immutable");
  });

  it("requires current teacher-course authority and exact Assignment Episode lineage beneath the app", () => {
    expect(migration).toContain("membership.role='TEACHER'");
    expect(migration).toContain("enrollment.role='TEACHER'");
    expect(migration).toContain("episode.sequence=1 AND episode.id=NEW.episode_id");
    expect(migration).toContain("constraint current teacher/course authority denied");
    expect(service).toContain('requireHumanCommand(actor, ["TEACHER"])');
  });

  it("authorizes before replay and replays before mutable eligibility checks", () => {
    expect(service).toMatch(/requireCourseAccess\(actor, actor\.institutionId, input\.courseId\);[\s\S]*requireCurrentTeacherCourseAuthority\(actor, input\.courseId\);[\s\S]*existingReplayId[\s\S]*ASSIGNMENT_DEADLINE_INVALID/);
    expect(service).toMatch(/authorizedTarget[\s\S]*requireCourseAccess\(actor, authorizedTarget\.institutionId, authorizedTarget\.courseId\);[\s\S]*requireCurrentTeacherCourseAuthority\(actor, authorizedTarget\.courseId\);[\s\S]*existingReplayId[\s\S]*INTERVENTION_DELIVERY_NOT_TERMINAL/);
    expect(service).toContain('const reservationKey = `${actor.userId}:${input.idempotencyKey}`');
  });

  it("emits only Episode-local current CAP-05 constraints into the next orchestration input", () => {
    expect(context).toContain("eq(teacherCapabilityConstraints.episodeId, input.episodeId)");
    expect(context).toContain("hasCap05TeacherCourseAuthority");
    expect(context).toContain('scope: "EPISODE"');
    expect(context).toContain('provenance("CAPABILITY_CONSTRAINT"');
    expect(migration).toContain('cap05_context_items_in_tenant');
    expect(migration).toContain("WHEN 'TEACHER_INTERVENTION'");
  });
});
