# CAP-02 — Diagnosis-driven Capability Resolution evidence

## Exact checkpoint

- Documentation authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- Exact stacked base: `cb0c4c8ba54895a3b54d632d597a8682cc758e06`.
- Exact implementation checkpoint: `da82098d9f365ae71745d663a904dceb8328bda6`.
- Branch: `codex/cap-02-diagnosis-capability-resolution`.
- PM verdict at this implementation SHA: **ACCEPT FOR DRAFT INTEGRATION**.
- Mapped current requirements: `REL-03`, `REL-04`, `REL-09`, `REL-11`,
  `CAP-02`, `CAP-03`, `CAP-04`, `CTX-04`, `CTX-05`, `CTX-06`, `CTX-07`,
  `LEARN-04`, `LEARN-06`, `LEARN-07`, `TEACH-08`, `DATA-01`, `DATA-03`,
  `DATA-07`, `DATA-09`, `SEC-01`, `SEC-03`, `SEC-04`, `SEC-08`, `SEC-09`.

This evidence binds only the implementation tree above. This document is an
evidence-only child commit and does not change implementation behavior.

## Orchestration result proved

After the existing Diagnosis graph persists one current
`DiagnosticObservationProposal`, it now:

1. compiles a fresh exact `CAPABILITY_RESOLUTION` Context snapshot;
2. reads the canonical Registry's complete exact-version set;
3. evaluates learner, Task/course/Reference Pack, language, accessibility,
   prerequisite, contraindication, teacher requirement/exclusion, tenant,
   rights, dependency, provider and active-version constraints;
4. persists one immutable, tenant-scoped Class-B resolution with every
   candidate, compatibility result, exclusion reason, deterministic rank and
   rationale;
5. either pins one verified eligible active exact `CapabilityVersion`, or
   records a parameterization/composition/adaptation/generation recommendation,
   or records explicit no-match and teacher escalation; and
6. propagates the resolution ID, decision, selected exact version when present,
   and escalation signal through the existing learner workflow result lineage.

The workflow does not execute the resolved capability or any Component Asset.
It does not create an ActivityPlan, RuntimeDelivery, TeacherReview, capability
availability decision or LearningOutcome.

## Product State, authorization and replay proof

- Migration `0006_diagnosis_capability_resolution.sql` is additive. It creates
  `capability_resolutions` and does not alter or rewrite Registry, Diagnosis or
  Context tables.
- Forced RLS, the canonical writable-lineage trigger, exact Task/Episode,
  Context, current Diagnosis, actor enrollment, complete Registry version,
  candidate-detail, rank and selected-version checks guard inserts.
- Runtime authority is `SELECT, INSERT` only. Update and delete are denied and a
  database trigger makes historical rows immutable.
- The deterministic input hash covers the exact Context snapshot, current
  Diagnosis, interpreted structured constraints, policy and complete Registry
  contracts/versions. Replay returns the same deterministic record; conflicting
  replay fails closed.
- The application entry point requires an actor and executes inside the
  repository's tenant transaction. A deliberately unneeded unscoped read helper
  was removed during PM review.
- The tenant harness directly proved that a tenant-A runtime role cannot insert
  a resolution carrying a tenant-B Task/Episode.

## Verification at the implementation tree

| Dimension | Result | Exact evidence |
| --- | --- | --- |
| Lockfile install | PASS | `npm ci`; 572 packages installed from the lockfile. |
| Diff-first review | PASS | Reviewed the bounded diff before broad tests; hardened current-Diagnosis uniqueness, database candidate/rank/payload enforcement, canonical trigger inventory, unscoped read removal and deterministic test ordering. |
| Lint | PASS | `npm run lint`; zero warnings/errors. |
| Type check | PASS | `npm run check`; TypeScript no-emit passed. |
| Unit/workflow/security | PASS | `npm run test:unit`; 32 files, 147 tests passed. |
| Focused policy/workflow/security | PASS | 5 focused files, 47 tests passed before the broad gate. |
| Focused CAP-02 PostgreSQL | PASS | 2 tests passed: complete candidates/exclusions/exact version/replay and cross-tenant denial. |
| Full PostgreSQL integration | PASS | 8 files passed, 1 explicitly skipped; 49 tests passed, 1 skipped. |
| Tenant/role/checkpoint enforcement | PASS | 47 catalog rows, 44 tenant-negative tables, 44 worker-negative tables, 30 writable-lineage probes, 3 checkpoint tables, 4 production login contracts and all reported auth/session/service denials passed. |
| Populated additive upgrade | PASS | Base migrations `0000-0005` populated; `0006` applied; one Registry, Diagnosis and Context row preserved; incomplete legacy contract failed closed; immutable rewrite denied. |
| Production build | PASS | Next.js production build compiled, typechecked and generated all routes. |
| Legacy boundary | PASS | Zero Legacy production imports; six removed runtime paths absent. |
| Diff hygiene | PASS | `git diff --check`. |

The full integration rerun initially exposed the existing 5 ms deadline-control
test as machine-speed-sensitive. Its test-only timing window was changed to
100/125 ms without changing workflow behavior; the focused test and full suite
then passed. PostgreSQL locale-dependent catalog comparison was likewise made a
deterministic JavaScript set comparison.

## Disposable validation state and observed failures

- PostgreSQL 15 ran only in isolated container `codex-lf-cap02-db` on
  `127.0.0.1:55432`. The occupied user Supabase port/project was not stopped,
  changed or queried.
- Guarded databases were `learning_foundry_cap02`,
  `learning_foundry_rw03_cap02_tenant` and
  `learning_foundry_cap02_upgrade`.
- Synthetic showcase seed mode was explicitly enabled with a disposable test
  password. It did not fabricate capability success, Diagnosis acceptance,
  Review, Outcome or availability.
- The tenant integration database received the same four synthetic auth
  identities that the repository E2E setup normally adds. This was validation
  state only and no configuration or credential was committed.
- Earlier `ECONNREFUSED` results occurred only after Docker Desktop exited and
  removed the former `--rm` container. They are not code failures and are not
  counted as passing evidence.
- Initial clean-database failures identified and closed: missing checkpoint
  schema setup, canonical writable-lineage trigger naming, tenant harness
  fixture ordering/preconditions, and upgrade-fixture native JSON binding.

## Explicit non-claims and remaining gaps

- No browser or complete learner/teacher UI path was run for CAP-02; the result
  remains invisible in current product surfaces except through workflow/Product
  State inspection.
- No teacher UI for constraints, candidate comparison, rationale inspection or
  escalation action is implemented.
- Parameterization, composition, adaptation and generation are recommendations
  only. None was executed, previewed, reviewed, confirmed or made available.
- No Component Asset was executed or simulated. No Asset Stage, ActivityPlan,
  RuntimeDelivery, LearningEvent or exact-version learner delivery was added.
- No live model/provider, human teacher/expert, online preview, Product Owner,
  accessibility-user, production, deployment, merge, release or cutover
  acceptance is claimed.
- Existing `components` / `component_versions` teaching-support proposals remain
  outside the callable Registry and were not imported as Component Assets.
- PR #27 migration/comments/change requests/publication workbench were not used.

## Exact next package

`CAP-03 — Activity Planning`: consume the exact CAP-02 resolution plus current
Task/Episode, Context, Diagnosis and teacher-governance state to persist an
authorized, deterministic `ActivityPlan` that references the selected exact
CapabilityVersion or explicitly interrupts for the recorded recommendation/no-
match path. CAP-03 must not execute Component Assets or claim RuntimeDelivery.
