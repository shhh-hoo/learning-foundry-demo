# CAP-03 — Activity Planning evidence checkpoint

## Exact checkpoint

- Documentation authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- Exact stacked base / CAP-02 evidence head: `9c373a6236ac81624bee9a843a3d7893a7cc2b49`.
- CAP-02 implementation checkpoint: `da82098d9f365ae71745d663a904dceb8328bda6`.
- Branch: `codex/cap-03-activity-planning`.
- CAP-03 implementation SHA: `832a471c1ec95919f71baba746e0d13bc132b30e`.
- Evidence head: the commit containing this evidence-only file; report its exact
  SHA with the Draft PR checkpoint.
- Engineering PM verdict: **ACCEPT FOR DRAFT INTEGRATION**.

This verdict accepts the bounded CAP-03 implementation for one stacked Draft
PR. It is not Product Owner acceptance, merge authority, preview approval,
release acceptance, deployment or cutover authority.

## Requirement and ownership proof

The accepted package maps `REL-03`, `REL-11`, `LEARN-02`, `LEARN-06`,
`LEARN-07`, `TEACH-01`, `TEACH-04`, `TEACH-08`, `CAP-03`, `CAP-04`,
`CTX-05`–`CTX-07`, `DATA-01`, `DATA-03`, `DATA-07`, `DATA-09`, `SEC-01`,
`SEC-08`, `SEC-09`, `OPS-03` and `OPS-05` to the Class-B planning boundary.
Doc 06 reserves Class-A `ActivityPlan` for an authoritative execution fact, so
this package persists an immutable `ActivityPlanProposal` and a non-executing
handoff contract. CAP-04 remains responsible for Asset Stage Runtime and
`RuntimeDelivery`.

The implementation consumes the exact persisted CAP-02 resolution, candidate
set and decision, exact Context compilation, current unsuperseded Diagnosis
Proposal, Task/Episode/course/tenant, selected Registry version and structured
teacher constraints. It accepts no caller-supplied Context, candidates,
ranking or Registry version.

## Proven behavior at the implementation SHA

- `EXISTING` becomes `READY` only while the selected candidate remains eligible
  and exclusion-free, its exact version and content hash remain active, its
  Registry contract matches the CAP-02 candidate snapshot, required Context
  items remain current, and no structured pre-runtime teacher gate applies.
- A ready proposal contains one deterministically ordered stage with purpose,
  exact inputs, parameters, expected output/events/evidence, success, stop and
  transition conditions, teacher constraints, retry intent and CAP-04
  revalidation requirements.
- `PARAMETERIZE`, `COMPOSE`, `ADAPT` and `GENERATE` remain honest `BLOCKED`
  recommendations. `NO_MATCH` remains `ESCALATED`. They persist no selected
  runtime version, no stage and no executable handoff.
- Stale/superseded resolution, Context or Diagnosis input, inactive/ineligible
  exact versions and required teacher pre-runtime gates fail closed.
- Proposal ID and input hash are deterministic. One immutable record is allowed
  per exact resolution; replay returns it, conflicting replay fails closed, and
  PostgreSQL denies update/delete.
- Forced RLS, insert-only runtime grants and database lineage checks preserve
  tenant, course, Task/Episode, actor, exact-resolution, exact-version and
  canonical Context/Diagnosis boundaries.
- Retry intent explicitly records `formalRetryCreated: false`; planning creates
  no `RetryAttempt`, Review, Outcome, capability confirmation or availability
  decision.
- The diagnosis workflow now persists resolution before planning and returns
  the proposal ID/state. It does not execute or simulate a ComponentAsset.

## Automated evidence

All database work used the disposable local PostgreSQL 15 container
`codex-lf-cap03-db` on `127.0.0.1:55433`. The existing Supabase project and its
ports were not touched.

- Lockfile install: `npm ci` passed; 572 packages installed.
- Diff integrity: `git diff --check` passed before each broad/final gate.
- Type: `npm run check` passed.
- Lint: `npm run lint` passed with zero warnings.
- Unit/workflow/security: `npm run test:unit` passed 34 files / 160 tests.
- Clean PostgreSQL integration on migrations `0000`–`0007`:
  `npm run test:integration` passed 8 files with 1 explicitly skipped;
  49 tests passed and 1 was skipped.
- CAP-03 integration proves ready exact-version/content-hash lineage, ordered
  stage/handoff, replay without duplication, immutable denial and cross-tenant
  denial.
- Dedicated tenant/role harness passed with 48 catalog rows, 45 tenant-negative
  tables, 45 worker-negative tables, 31 writable-lineage probes, four runtime
  roles, direct ActivityPlanProposal cross-tenant denial and valid same-tenant
  authorization evidence.
- Populated additive upgrade: the existing CAP-02 rehearsal passed for exact
  migrations `0000`–`0005` plus `0006`, preserving one Registry, Diagnosis and
  Context row and denying CAP-02 rewrites. Applying `0007` then preserved those
  rows and the resolution, persisted one exact `NO_MATCH → ESCALATED` Class-B
  proposal with zero stages, `executable: false` and
  `formalRetryCreated: false`, and denied proposal mutation.
- Production build: `npm run build` passed, including TypeScript and all 12
  generated route pages.
- Legacy boundary: `npm run legacy:scan` passed with zero Legacy production
  imports across the scanned runtime paths and all six removed paths absent.

The first disposable full-integration attempt exposed missing pre-provisioned
synthetic auth identities, not an application defect. Four repository-defined
synthetic identities were provisioned only in the isolated database and the
suite passed. A later clean seed attempt initially omitted the required local
showcase password; it was rerun with the required disposable-only setting and
passed. Neither environment correction changed implementation code.

## Explicitly unproven and unimplemented

- no ComponentAsset execution or simulation, Asset Stage, `RuntimeDelivery`,
  `LearningEvent`, learner delivery UI or complete learner browser path;
- no Teacher Workspace UI, teacher interrupt/resume for this plan, formal Retry
  creation, authorized Review or human-governance validation;
- no Capability Workshop, parameterization, composition, adaptation,
  generation, optimization, preview or exact asset runtime;
- no live-provider, browser, accessibility, online preview, production-like,
  Product Owner or release-acceptance evidence;
- no PR #27 CMS/editor/publication scope, Legacy deletion, `main` change, merge,
  deployment, cutover or production-state change.

The next bounded package is **CAP-04 — Asset Stage Runtime**. It must consume the
ready handoff, revalidate the recorded conditions and create exact-version
runtime evidence without rewriting this proposal.
