# CAP-04 — Asset Stage Runtime evidence checkpoint

## Exact checkpoint

- Documentation authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- Exact stacked base / CAP-03 evidence head: `22afe667898b30b99b7ce470c115740bfead74e4`.
- CAP-03 implementation checkpoint: `832a471c1ec95919f71baba746e0d13bc132b30e`.
- Branch: `codex/cap-04-asset-stage-runtime`.
- CAP-04 implementation SHA: `0500eecd1889563a9faf2119f98f52cf7b05eff2`.
- Evidence head: the commit containing this evidence-only file; report its exact
  SHA with the Draft PR checkpoint.
- Engineering PM verdict: **ACCEPT FOR DRAFT INTEGRATION**.

This verdict accepts only the bounded CAP-04 implementation for one stacked
Draft PR. It is not Product Owner acceptance, merge authority, preview
approval, release acceptance, deployment or cutover authority.

## Requirement and ownership proof

The accepted package maps `REL-05`, `REL-09`, `REL-11`, `REL-12`, `LEARN-02`,
`LEARN-03`, `LEARN-07`, `CAP-02`, `CAP-05`–`CAP-07`, `CAP-13`, `DATA-01`,
`DATA-02`, `DATA-04`, `DATA-07`, `DATA-09`, `DATA-10`, `SEC-01`, `SEC-08`,
`SEC-10`, `OPS-02`, `OPS-03`, `OPS-05` and `OPS-06` to the exact Asset Stage
boundary.

CAP-04 promotes only the latest immutable `READY` CAP-03 proposal into one
immutable Class-A `ActivityPlan`. It creates one bounded `RuntimeDelivery`, one
runtime-linked existing `LearnerAttempt` row and append-only ordered
`LearningEvent` rows. It does not use historical `ComponentDelivery` as Asset
Runtime authority and adds no parallel Plan, Attempt, Event, Evidence,
Registry, Context, Diagnosis or Product State model.

## Proven runtime behavior at the implementation SHA

- The command reloads the actor-authorized Task/Episode and exact latest
  `READY` proposal. `BLOCKED`, `ESCALATED`, superseded, inactive/disabled,
  cross-tenant, wrong-learner and altered contract/stage inputs fail closed
  before a new delivery is persisted.
- The exact selected CapabilityVersion, version content hash, eligible candidate
  contract, Registry runtime contract, implementation key and single planned
  stage are revalidated. The caller cannot supply a replacement version,
  contract, adapter or Evidence authority.
- Only explicit reviewed Chemistry `TRUSTED_DETERMINISTIC_ADAPTER` registry
  entries execute. Unknown or mismatched implementations persist an honest
  `FAILED` delivery and the learner Attempt; arbitrary code, text support and
  external links do not execute.
- The lifecycle is constrained to `PENDING → RUNNING →` one immutable terminal
  state: `SUCCEEDED`, `FAILED`, `TIMED_OUT` or `CANCELLED`. Generic adapter
  exceptions are redacted to a fixed normalized failure message.
- Delivery start, learner interaction and Attempt facts commit before adapter
  invocation. Result and terminal events commit transactionally afterward.
  Delivery-local sequences 1–5 and stable event keys preserve ordering.
- Stable plan/request hashes and IDs make sequential replay and post-start
  checkpoint recovery reuse one ActivityPlan, RuntimeDelivery, Attempt and
  event set. The injected post-start process failure left one `RUNNING`
  delivery, one Attempt and three events; replay completed that same delivery
  with five events and no duplicates.
- The existing bounded execution control maps deadline expiry to `TIMED_OUT`
  and request abort to `CANCELLED`. Neither path is converted to success.
- Forced RLS, canonical writable-lineage inventory triggers, exact-lineage
  guards and least-privilege grants enforce tenant, course, Task/Episode,
  actor, plan and exact-version boundaries. Same-tenant wrong-learner mutation
  is denied in both application code and PostgreSQL.
- Success records only adapter completion/output provenance. It creates no
  TeacherReview, LearningOutcome, mastery, capability availability or Product
  Owner acceptance.

## Automated evidence

All database work used the disposable local PostgreSQL 15 container
`codex-lf-cap04-db` on `127.0.0.1:55434`. Supabase, production and user data
were not queried or changed.

- Lockfile install: `npm ci` passed; 572 packages installed.
- Diff-first review and hygiene: the full tracked/new-file diff was reviewed;
  `git diff --check` passed. Review closed raw adapter-error leakage,
  same-tenant actor enforcement, canonical guard inventory naming and missing
  CAP-04 tenant-harness probes.
- Lint: `npm run lint` passed with zero warnings.
- Type: `npm run check` passed.
- Unit/workflow/security: `npm run test:unit` passed 36 files / 166 tests.
- Focused CAP-04 PostgreSQL: 1 file / 5 tests passed. It proves exact READY
  execution and replay, honest unknown-adapter failure, LangGraph checkpoint
  recovery, timeout/cancellation normalization, altered/disabled/stale refusal,
  cross-tenant denial, same-tenant wrong-learner denial, ordered events and no
  human/outcome/historical-delivery writes.
- Full PostgreSQL integration: 9 files passed, 1 explicitly skipped; 54 tests
  passed and 1 was skipped. The first run's only failure was the existing
  session-recovery test's missing teacher synthetic identity. The four exact
  repository E2E synthetic identities were provisioned only in the disposable
  database; the rerun passed without an implementation change.
- Tenant/role/checkpoint harness: passed 51 catalog rows, 48 tenant-negative
  tables, 48 worker-negative tables, 3 checkpoint tables, 34 writable-lineage
  catalog/probe tables, four production login contracts and explicit
  ActivityPlan, RuntimeDelivery and LearningEvent cross-tenant denial.
- Populated additive upgrade: exact migrations `0000`–`0007` were applied to
  `learning_foundry_cap04_upgrade`; one prior-schema learner Attempt and
  Diagnosis Proposal were populated; `0008` preserved their exact hashes,
  left all six new Attempt fields null, created three authority-catalog rows
  and created zero fabricated runtime facts.
- Fresh migration and guarded synthetic seed passed on disposable databases.
  The current-schema seed was not used as a pre-migration fixture because its
  generated insert correctly references CAP-04 columns that do not exist until
  `0008`; prior-schema rows were therefore inserted with explicit raw SQL.
- Production build: `npm run build` compiled, typechecked and generated all 12
  route pages.
- Legacy boundary: `npm run legacy:scan` passed with zero Legacy production
  imports and all six removed paths absent.

`npm run contract:check` is not claimed as passing: it reported 2 pass / 6
fail both after integration mutation and on a fresh seed. The failures concern
pre-existing Context eval expectations against compiler `3.0.0`, absent
provider-backed retrieval hits and the historical component-human-review
fixture. They do not exercise CAP-04 Asset Runtime and were not changed or
relabelled as success. This inherited eval gap remains visible for its owning
package.

## Explicitly unproven and incomplete

- no Learner Workspace UI, API route or complete browser journey exposes the
  accepted runtime command yet; the proven path is application service → exact
  adapter registry → PostgreSQL Product State, orchestrated by the existing
  LangGraph checkpointer;
- no Teacher Assignment/Intervention UI or teacher action over these runtime
  facts; that is the next package;
- no formal Retry, Transfer, Retention, LearningOutcome or mastery path;
- no Capability Workshop, parameterization, composition, adaptation,
  generation, optimization, preview, provider execution or sandbox product;
- no live-provider, browser, accessibility, human teacher/expert, online
  preview, production-like, Product Owner or release-acceptance evidence;
- no PR #27 CMS/editor/publication scope, Legacy deletion, `main` change, merge,
  deployment, cutover or production-state change.

The next bounded package is **CAP-05 — Teacher Assignment and Intervention**.
It must expose authorized teacher inspection/action over the exact Task,
ActivityPlan, RuntimeDelivery, Attempt, events and provenance without treating
runtime success as a Review or Outcome.
