# CAP-05 — Teacher Assignment and Intervention

## Bounded package contract

- **Authority:** `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- **Exact base:** `7e460ed55127fa4a57eada821ea776ce2ccfb88e` (CAP-04 evidence head).
- **Branch:** `codex/cap-05-teacher-assignment-intervention`.
- **Bounded contributions:** `REL-02`, `REL-06`, `TEACH-02`, `TEACH-08`, `CAP-08`, `CTX-05`, `DATA-02`, `DATA-07`, `DATA-09`, `SEC-01` and `OPS-01`. These are bounded partial contributions only; this package does not claim any row complete by itself.
- **User result:** an authorized course teacher can create a real learner Task from `/teacher`, inspect the exact terminal Asset Stage lineage, and append a required/excluded Capability intervention that changes the next compiled Context and resolver/planner input.

## Canonical ownership and invariants

CAP-05 adds Class-A `TeacherAssignment`, `TeacherCapabilityConstraint` (typed `REQUIRE` or `EXCLUDE`) and `TeacherIntervention` records. Assignment creates the existing `LearningTask` and first `LearningEpisode` transactionally. It does not create a second Task, Context, Diagnosis, Plan, Runtime, Attempt, Evidence or teacher-review model.

Assignment accepts an authorized course/learner, title, goal, instructions, completion rule, optional due time, Registry-backed required/excluded Capability IDs and one idempotency key. Required and excluded sets must be disjoint. The learner must hold same-institution course enrollment; the actor must be an authenticated institution TEACHER enrolled as TEACHER in that course. Admin visibility does not grant CAP-05 command authority.

The bounded intervention types are only `REQUIRE_CAPABILITY` and `EXCLUDE_CAPABILITY`. Each targets the latest terminal `RuntimeDelivery` for an open Task/active Episode and records the exact ActivityPlan, Attempt, planning Diagnosis, Context compilation, Capability Resolution and exact CapabilityVersion lineage, actor/session/time and reason. A newer action may supersede a prior constraint by reference; no historical row is edited.

The Context compiler maps canonical constraints into Episode-scoped selected/excluded `ContextItem` representations with exact provenance. Existing snapshots, resolutions, plans, deliveries, events, Attempts and Diagnosis proposals remain immutable. The next normal compilation in that Episode therefore receives the latest constraint, and existing Capability Resolution/Activity Planning consume it without a new orchestration model. Cross-Episode carry-forward is deferred to CAP-06.

Replay with the same tenant, actor, command and key returns the original record; key reuse with changed content fails. CAP-05 record uniqueness is scoped by institution and teacher, and the shared reservation key is actor-namespaced so tenants and teachers cannot collide. Cross-tenant/course/learner, inactive capability, non-terminal or stale delivery, closed Task, inactive Episode and incomplete lineage fail before persistence. PostgreSQL RLS, lineage guards and immutability enforce the same boundary beneath application checks.

## Surface, evidence and non-scope

Changes are limited to one additive migration/schema update, a bounded teacher-governance service, `/api/teacher/assignments`, `/api/teacher/interventions`, the existing Teacher Workspace/query, Context provenance input, and focused tests/evidence. Review must prove assignment and intervention idempotency, same-tenant authority, cross-tenant denial, immutable provenance/history, exact ordered runtime inspection, stale/terminal rejection, and next-cycle required/excluded effects.

This package does not add groups, assignment editing, diagnosis successor policy, Retry/Transfer/Retention, LearningOutcome/mastery, Capability Workshop/supply/optimization, generic CMS/editor/admin scope, full browser-journey coverage, provider/preview/deployment/cutover, Legacy deletion, `main` change or merge. Synthetic/browser automation remains explicitly non-human evidence. The inherited `contract:check` 2-pass/6-fail baseline stays visible and is not reinterpreted.

The next package is **CAP-06 — Governed Retry/Transfer/Retention loop**.
