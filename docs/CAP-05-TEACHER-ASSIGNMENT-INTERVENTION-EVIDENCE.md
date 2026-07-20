# CAP-05 — Teacher Assignment and Intervention evidence

## Checkpoint identity and verdict

- Authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- Exact base / CAP-04 evidence head: `7e460ed55127fa4a57eada821ea776ce2ccfb88e`.
- Accepted local implementation SHA: `bcbc26ef0de4292f7f2de8227adc7c52c615167f`.
- Remote implementation SHA: `a7b87163af741702a9e0c8fc85c9b9d26cdeec7f`.
- Byte-identical implementation tree: `bb919a0965f4164c48897f2392277c6ce448148e` for both SHAs. The SHAs differ only because the connected Git-data path created the remote commit object after workstation SSH push failed; the accepted file tree is identical.
- Branch: `codex/cap-05-teacher-assignment-intervention`.
- Engineering PM verdict: **ACCEPT for one stacked Draft PR checkpoint**. This is not merge, preview, release, human-validation or completion authority.

CAP-05 makes bounded partial contributions to `REL-02`, `REL-06`, `TEACH-02`, `TEACH-08`, `CAP-08`, `CTX-05`, `DATA-02`, `DATA-07`, `DATA-09`, `SEC-01` and `OPS-01`. No requirement row is claimed complete by this package, and `OPS-05` is not claimed.

## Real path evidenced

An authenticated institution and course `TEACHER` can use `/teacher` to create one existing canonical `LearningTask` and sequence-1 `LearningEpisode`, with goal, instructions, completion rule, optional deadline and active Registry-backed required/excluded Capability constraints. The same Workspace reads complete terminal `RuntimeDelivery` lineage with its `ActivityPlan`, exact Capability version, runtime `LearnerAttempt`, ordered `LearningEvent` rows, Evidence/provenance references and current planning Diagnosis proposal. It offers only `REQUIRE_CAPABILITY` or `EXCLUDE_CAPABILITY` for the latest eligible runtime.

Assignment and Intervention rows retain immutable actor, institution, session, command time/reason and target lineage. Constraints enter only the same Episode's next Context compilation, carry their exact Assignment/Intervention source, Capability/effect/reason payload, and are consumed by the existing resolver/planner. Historical Context, Resolution, Plan, Delivery, Event, Attempt and Diagnosis rows are not updated.

## Verification bound to the accepted implementation tree

- Lockfile install: `npm ci` passed (572 packages).
- Static: `npm run lint`, `npm run check` and `git diff --check` passed.
- Unit/workflow/security: 39 files, 174 tests passed. This includes form-local immediate in-flight locks and stable idempotency-key retry behavior.
- Fresh PostgreSQL 15 migration plus explicit synthetic seed: passed from an empty database.
- Focused CAP-05 integration: 5/5 passed. Coverage includes actor/tenant-scoped replay, replay after deadline/terminal mutation, request mismatch, actual cross-tenant denial, revoked assignment and intervention replay denial, admin parity, direct revoked-teacher denial, wrong-Episode Assignment source denial, forged cross-Episode/source and forged human-reason Context provenance denial, non-empty Assignment constraints through Context/Resolver, both intervention effects through Context/Resolver/Plan, immutable history and non-terminal delivery rejection.
- Tenant/RLS harness: PASS; 54 catalog rows, 51 tenant-negative tables, all 37 writable-lineage tables directly probed, three checkpoint tables isolated, and runtime login-role cleanup passed.
- Additive upgrade rehearsal: PASS from exact migrations `0000-0008` through `0009`; two populated Task/Episode rows remained byte-equivalent, zero Assignment/Intervention/constraint rows were fabricated, and all three new authority-catalog rows were present.
- Full integration under the intended E2E auth setup: 10 files passed, 59 tests passed and one test was intentionally skipped.
- Focused browser automation: 1/1 desktop test passed. It authenticated as the seeded teacher, submitted the real `/teacher` form with a required Capability, observed the assignment audit, and verified the canonical Assignment/Task/Episode/constraint and actor/session provenance in PostgreSQL.
- Production build passed and exposed only the two new bounded routes, `/api/teacher/assignments` and `/api/teacher/interventions`.
- Legacy scan passed: zero Legacy production imports and all six removed runtime paths remained absent.
- Inherited contract/eval baseline remained exactly 2 pass / 6 fail. The failures are the pre-existing stale Context/retrieval/historical component expectations; CAP-05 does not reinterpret or rewrite that suite.

During verification, the first strengthened provenance run rejected two valid compilations because aggregate provenance had been subjected to single-item payload parity. The database predicate was corrected so each Context item retains exact Episode/source/effect/Capability/reason validation while aggregate provenance must match the validated candidate refs. A later clean migration and all final focused tests passed. A broad integration run against a plain seed produced the known missing synthetic-auth-identity fixture; the same full suite passed under its intended guarded E2E setup.

## Explicit non-claims and remaining limits

- The focused browser run covers Assignment, not a complete runtime inspection/intervention journey. Runtime inspection, both Intervention types and downstream orchestration effects are integration evidence only. Browser automation is not human validation.
- Teacher instructions are immutable Assignment audit data. The Task goal enters Context, and instructions affect Context when they justify a required/excluded Assignment constraint; an unconstrained Assignment does not create a second free-form instruction Context model.
- CAP-05 is Episode-local. No constraint is carried into a later Episode; CAP-06 must define governed carry-forward with Retry/Transfer/Retention.
- No confirm/modify Diagnosis, pause, escalate, continue, Retry, Transfer, Retention, LearningOutcome/mastery, Workshop generation/adaptation, optimization, complete browser program, provider validation, preview, deployment, Legacy deletion, merge, `main` change or cutover is claimed.
- Synthetic fixtures remain synthetic and never become `HUMAN_VALIDATED` evidence. No seed or automation created a TeacherAssignment or TeacherIntervention as a human substitute.

Next package: **CAP-06 — Governed Retry/Transfer/Retention loop**.
