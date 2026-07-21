# CAP-08A — Evidence-driven Asset Optimization

## Requirement and user-visible result

Mapped authority: current MVP `REL-10`; asset lifecycle `CAP-13` and `CAP-14`; canonical Product State, human-command, authorization, idempotency, exact-version and evidence-lineage contracts.

One persisted successful-but-incorrect learner Attempt from the exact CAP-07 Web ComponentAsset runtime becomes a reviewable Asset-only signal. A Teacher or Expert can inspect the exact ComponentAssetVersion, CapabilityVersion, supply relation, ActivityPlan, RuntimeDelivery, Attempt hashes, runtime output and explicit limitations; create one Class-B Asset Optimization Proposal; and record one append-only next action (`REQUEST_SUCCESSOR` or `KEEP_CURRENT`). The learner sees the incorrect Attempt as an Attempt, explicitly not an Outcome.

The deterministic bounded rule compares the learner's persisted incorrect choice with the immutable exact ComponentAsset package. It proposes human review of distractor-specific retry feedback while preserving the exact prompt, choices and correct answer. One Attempt is not usage success, asset defect proof, causation or effectiveness evidence.

## Stack and responsibility boundary

- Exact base: CAP-07 PR #37 evidence head `ba5afceb14e80d3da60a1c4f4f7dec01db30f792` (implementation `1136f9330002bb1d2d68b38c6bbb3ac8b0f3cdf1`).
- Planned child branch, created only after review and verification: `codex/cap-08a-asset-optimization`.
- Planned stacked Draft PR base: `codex/cap-07-capability-gap-supply`.
- Responsibility ends after the governed next-action record. `REQUEST_SUCCESSOR` creates no ComponentAssetVersion and grants no check, confirmation, availability, preview, release or effectiveness state.

## Expected changes

- `domain/asset-optimization.ts`: bounded actions, non-claims, deterministic identity and exact-package rule.
- `application/asset-optimization.ts`: eligible-lineage loading, proposal/decision commands, replay and teacher/expert query path.
- `app/api/asset-optimization/**`: authenticated command boundaries.
- `components/AssetOptimizationPanel.tsx`, `components/ClientActions.tsx`, Learner/Teacher/Workshop pages: browser-visible evidence and governance.
- `db/schema.ts`, `db/migrations/0012_asset_optimization.sql`, migration journal: append-only canonical proposal/decision records and enforcement.
- focused unit/integration/browser/tenant/upgrade tests and this package record.

No Legacy path is changed. No production, checkpoint, deployment or runtime-authority switch is in scope.

## Product State and authorization effects

- Adds `asset_optimization_proposals` as Class-B evidence-bound suggestions.
- Adds `asset_optimization_decisions` as append-only authenticated human next-action records.
- Both records bind exact institution, course, ComponentAssetVersion/hash, CapabilityVersion/hash, CAP-07 supply relation, RuntimeDelivery and LearnerAttempt lineage.
- PostgreSQL recomputes the complete de-identified evidence snapshot, exact six-reference envelope and SHA-256 evidence hash. It rejects stale versions, fabricated outputs, changed refs and non-applicable choices.
- Only authenticated `TEACHER`, `EXPERT` or `ADMIN` course actors can read or insert these records. Learners cannot read proposal, rationale or actor provenance at the database boundary.
- CAP-08A idempotency reservations are actor-bound and immutable. Proposal/decision rows and reservations are transactionally bound and replay-safe.
- The current active ComponentAssetVersion and CapabilityVersion are required both when proposing and when deciding.

No TeacherReview, LearningOutcome, ComponentAssetVersion, CapabilityVersion, availability, routing or learning-strategy record is created.

## Prohibited shortcuts and CMS scope

- No usage count, completion count or preview is treated as success or effectiveness.
- No seed, fixture, script or direct database write substitutes for the learner Attempt, teacher/expert proposal command or human decision in the browser path.
- No automatic approval, Outcome, successor, publication, availability, routing or learning-strategy mutation.
- No generic optimization framework, CMS, publishing workbench, content entry, article/page model, giant metadata editor or manual field workbench.
- No deletion or import of Legacy paths; no changes to `main`; no merge, deploy, preview approval or cutover.

## Explicit non-goals

- Runtime-failure-driven, TeacherReview-driven and reviewed-Outcome-driven proposal cases beyond this one real Attempt case.
- Routing Optimization and Learning Strategy Optimization.
- Pattern aggregation, threshold selection, causal analysis or effectiveness evaluation.
- Successor authoring, checks, preview, confirmation, publication, enable/disable, rollback or outcome measurement.
- Product completion, release acceptance, online preview approval, migration/cutover authority or Legacy deletion.

## Required verification and review evidence

- lockfile install; lint; type check; complete unit suite; production build; zero-Legacy import scan.
- clean migration and explicitly gated showcase seed.
- focused and full PostgreSQL integration, including concurrency/replay, learner/tenant/role denials, direct evidence/ref/hash tampering, stale/ineligible signals, reservation mutation denial and no fabricated Review/Outcome/version.
- tenant/role matrix with learner-read denial and writable-lineage inventory coverage.
- guarded CAP-07 → `0012` upgrade rehearsal preserving an exact ComponentAssetVersion, CapabilityVersion, supply relation and prior idempotency behavior while fabricating no optimization row.
- desktop browser flow: real learner failed runtime and exact retry → persisted incorrect Attempt → Expert-visible exact proposal evidence → Teacher-recorded next action → SQL proof that no successor, Review or Outcome was created.
- independent diff review and re-review after findings.
- Draft stacked PR CI must pass before the checkpoint is reported to PR #22.

## Honest fixture and limitation statement

The browser uses the repository's explicitly gated synthetic showcase identities and curriculum package, but all user actions and Product State writes in the acceptance path occur through the real authenticated application/runtime boundaries. The first runtime failure is intentionally injected by the test to preserve CAP-07 failure evidence; CAP-08A eligibility uses only the later real successful incorrect Attempt. No provider, pedagogy, safety, effectiveness, preview, release or Product Owner acceptance claim follows from these fixtures or tests.
