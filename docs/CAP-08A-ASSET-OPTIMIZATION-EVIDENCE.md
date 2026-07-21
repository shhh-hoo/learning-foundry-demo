# CAP-08A — Evidence-driven Asset Optimization evidence

## Checkpoint identity and bounded verdict

- Documentation authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- Exact stacked base / CAP-07 Draft PR #37 evidence head: `ba5afceb14e80d3da60a1c4f4f7dec01db30f792`.
- Accepted CAP-07 implementation checkpoint: `1136f9330002bb1d2d68b38c6bbb3ac8b0f3cdf1`.
- Branch: `codex/cap-08a-asset-optimization`.
- CAP-08A implementation SHA: `f660f3bfa481ccf67f86d6b496e53a4804d78b53`.
- Evidence head: the commit containing this evidence-only file; report its exact SHA with the stacked Draft PR checkpoint.
- Engineering verdict: **ACCEPT FOR DRAFT INTEGRATION** for this bounded slice. The final independent re-review reported no PR-blocking finding after all findings were reworked.

This verdict authorizes only a stacked Draft PR. It is not Doc 12 `ACCEPTED`, Product Owner acceptance, human validation, effectiveness validation, merge, deployed preview, release, production deployment, migration/cutover authority or Legacy deletion.

## User-visible result

The learner completes the real CAP-07 exact Web ComponentAsset runtime after one retained injected runtime failure and its bounded retry. The successful retry persists `correct: false` as a real LearnerAttempt and shows **INCORRECT ATTEMPT · NOT AN OUTCOME**. The UI states that the Attempt may be inspected only as a bounded Asset improvement signal and does not prove an asset defect or effectiveness.

Capability Workshop shows one eligible exact-version signal and the full protected lineage: active ComponentAssetVersion/hash, active CapabilityVersion/hash, CAP-07 supply relation, ActivityPlan, RuntimeDelivery/output hash and LearnerAttempt/content hash. An authenticated Expert creates one Class-B proposal. The proposal suggests reviewing distractor-specific retry feedback derived from the immutable exact package and selected incorrect choice; it does not suggest a change already present in the asset.

An independently authenticated Teacher opens the Teacher Workspace, inspects the same proposal and records `REQUEST_SUCCESSOR` with a human rationale. Both workspaces show the deciding actor and time. The decision creates no successor, check, preview, confirmation, availability, TeacherReview, LearningOutcome, routing decision or learning-strategy decision.

## Canonical Product State and fail-closed boundaries

Migration `0012_asset_optimization.sql` and the matching Drizzle schema add:

- `asset_optimization_proposals`: append-only Class-B evidence-bound suggestions for one exact active delivered asset version;
- `asset_optimization_decisions`: append-only authenticated human next-action records;
- role-gated, course-scoped forced RLS and writable/authority catalog entries;
- actor-bound immutable idempotency reservations and exact tenant-result mapping;
- database recomputation of the exact package-derived proposed change, fixed system rationale, complete evidence snapshot, exact six-reference envelope and SHA-256 evidence hash;
- active exact ComponentAssetVersion and CapabilityVersion requirements at both proposal and decision time.

The proposal rule accepts only a successful runtime result whose persisted Attempt selected an incorrect choice declared by the immutable exact ComponentAsset package. Usage, completion, preview, unknown choices, correct choices, failed runtime, missing output hash, stale versions and mismatched package/hash lineage fail closed.

The complete canonical `proposed_change` JSON is compared for exact equality. Extra effectiveness/routing fields, changed rendered descriptions, changed system rationale, changed snapshot fields, changed references or changed evidence hashes are rejected at the database boundary.

Learners cannot read proposal/decision rows at the database boundary, including Attempt identifiers, human rationale or actor/session provenance. Authenticated current-course `TEACHER`, `EXPERT` and `ADMIN` actors can read and insert through the bounded command path. Neither table grants update/delete authority, and mutation triggers preserve append-only behavior if grants ever widen.

## Independent review and rework

The first independent review found five PR-blocking issues:

1. course-only RLS exposed optimization evidence to enrolled learners;
2. an over-generic rule proposed a pause-and-predict change even though the exact asset already used that pattern;
3. the database checked only a partial evidence envelope;
4. stale versions could contradict `CURRENT_VERSION_REMAINS_ACTIVE`;
5. CAP-08A idempotency reservations were not actor-bound and immutable.

Rework added role-gated RLS and direct learner visibility proof; exact-package distractor feedback derivation; full snapshot/ref/hash recomputation and tamper tests; active exact-version requirements; actor-bound immutable reservations; and the missing CAP-07→CAP-08A upgrade rehearsal.

The second review found one remaining boundary gap: the rendered description and system rationale were not exact-object checked. Rework made PostgreSQL reconstruct the entire proposal JSON and fixed rationale, added direct effectiveness/routing/rationale tampering, and added a stale-version decision probe. The final targeted re-review reported **no PR-blocking findings** and no Legacy, CMS, routing/strategy optimization, automatic Outcome or successor-write regression.

## Verification bound to the implementation checkpoint

- Lockfile install: `npm ci` passed; 572 packages installed. No dependency or lockfile changed.
- Diff hygiene: `git diff --check` and staged `git diff --cached --check` passed; the implementation commit contains 20 bounded files and no generated `next-env.d.ts` change.
- Full static/unit/build validation: `npm run validate` passed — lint, type check, 46 files / 213 tests, Next.js 16.2.10 production build and zero Legacy production imports across all scanned runtime directories.
- Clean migration and seed: migrations `0000`–`0012` applied to a disposable local PostgreSQL database and the explicitly gated showcase seed completed. The seed states that it fabricated no capability, Diagnosis, Eval, Review, Outcome or publication success.
- Focused CAP-07/CAP-08A integration: 1 file / 3 tests passed, including exact package derivation, concurrent proposal replay, actor/tenant/role denial, direct learner invisibility, evidence/ref/hash tampering, effectiveness/routing/rationale tampering, idempotency update/delete denial, stale-version decision denial and no fabricated Review/Outcome/version.
- Full PostgreSQL integration: 12 files passed and 1 was intentionally skipped; 67 tests passed and 1 was intentionally skipped.
- Tenant/RLS matrix: `PASS` with 59 authority-catalog rows, 58 tenant-negative tables, 58 worker-negative tables, 39 writable-lineage catalog rows, all 39 direct probes, five production login contracts, clean role teardown and the trusted Component Executor boundary unchanged.
- Forward-only upgrade: `CAP08A_UPGRADE_VERIFIED` applied exact migrations through `0011`, snapshotted an exact CAP-07 ComponentAssetVersion, CapabilityVersion, supply relation and old `CREATE_TASK` reservation, applied only `0012`, preserved those rows and prior idempotency behavior, added two guarded tables, and created zero optimization rows.
- Browser: 1/1 desktop journey passed in 28.1 seconds. It covers real learner CAP-07 delivery/failure/retry, persisted incorrect Attempt, Expert proposal creation and evidence inspection, Teacher decision, actor/time rendering, and SQL proof of unchanged ComponentAssetVersion, TeacherReview and LearningOutcome counts.
- Final independent targeted re-review: no PR-blocking findings remain.

## Fixture statement and explicit non-claims

The browser uses explicitly gated synthetic showcase identities and a synthetic reviewed Chemistry package. The actions themselves use real authenticated application, database and CAP-07 runtime boundaries. The first runtime failure is deliberately injected to retain honest CAP-07 failure evidence; CAP-08A does not use that failure as its eligible signal. The eligible signal is the subsequent real successful incorrect Attempt.

The upgrade fixture is inserted under `session_replication_role=replica`; it proves forward-only byte/state preservation, not a live CAP-07 user path. The full integration and browser journeys provide the complementary live-path evidence.

This package does not claim:

- usage, completion, one Attempt or one human next action proves asset quality or effectiveness;
- causal attribution, pattern aggregation, threshold validity or generalized optimization;
- Routing Optimization or Learning Strategy Optimization;
- runtime-failure-, TeacherReview- or reviewed-Outcome-driven proposal cases beyond this one Attempt case;
- successor authoring, checks, preview, confirmation, publication, availability change, disable or rollback;
- live-provider validation, real learner data, human pedagogy/accessibility validation, production-like online preview or performance thresholds;
- any complete Doc 12 requirement row, `HUMAN_VALIDATED`, `PREVIEW_VALIDATED`, `ACCEPTED`, merge, deployment, release or cutover authority.

The next package may independently add another eligible evidence source or the governed successor path. Routing Optimization and Learning Strategy Optimization remain separate later packages.
