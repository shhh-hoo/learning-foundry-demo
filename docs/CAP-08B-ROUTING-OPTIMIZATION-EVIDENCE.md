# CAP-08B — Evidence-driven Routing Optimization evidence

## Checkpoint identity and bounded verdict

- Documentation authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- Exact stacked base / CAP-08A Draft PR #38 evidence head: `91e59eeb2b158c16080f3f2c3057ac8ca3fdfc47`.
- Accepted CAP-08A implementation checkpoint: `f660f3bfa481ccf67f86d6b496e53a4804d78b53`.
- Branch: `codex/cap-08b-routing-optimization`.
- CAP-08B implementation SHA: `87f175d126aa47c997a3116b7ae792e05e1e32f0`.
- Implementation tree: `918f6fcd1962217f2193c913e008023189f6cb11`.
- Evidence head: the commit containing this evidence-only file; report its exact SHA with the stacked Draft PR checkpoint.
- Engineering verdict: **ACCEPT FOR DRAFT INTEGRATION** for this bounded slice. The final independent re-review reported no PR-blocking finding after both findings were reworked.

This verdict authorizes only a stacked Draft PR. It is not Doc 12 `ACCEPTED`, Product Owner acceptance, human validation, effectiveness validation, merge, deployed preview, release, production deployment, migration/cutover authority or Legacy deletion.

## User-visible result

After the real CAP-07 exact Web ComponentAsset runtime and the separate CAP-08A Asset Optimization decision, an independently authenticated Teacher opens the exact RuntimeDelivery inspection and records `EXCLUDE_CAPABILITY` against the Capability selected by the recorded Resolution. That explicit teacher Intervention—not usage, completion or Attempt correctness—is the CAP-08B signal.

Teacher Workspace and Capability Workshop show one eligible Routing-only signal and the complete questioned route: Context snapshot and selections/exclusions, Diagnosis Proposal, full Capability Resolution candidate/exclusion set and selection rationale, exact selected CapabilityVersion/hash, ActivityPlan, RuntimeDelivery, LearnerAttempt and TeacherIntervention. The Attempt is visibly and canonically labelled lineage only, not a routing verdict.

An authenticated Expert creates one Class-B Routing Optimization Proposal. An authenticated Teacher inspects why the route is questioned and records `REQUEST_POLICY_REVIEW` with a human rationale. Both surfaces retain the exact evidence and human action. No policy successor, ranking change, eligibility-rule change, CapabilityVersion, Capability Resolution, ActivityPlan, route, TeacherReview, LearningOutcome, Asset Optimization or Learning Strategy record is created or changed.

## Canonical Product State and fail-closed boundaries

Migration `0013_routing_optimization.sql` and the matching Drizzle schema add:

- `routing_optimization_proposals`: append-only Class-B suggestions bound to one exact questioned route;
- `routing_optimization_decisions`: append-only authenticated human next-action records;
- role-gated, course-scoped forced RLS and writable/authority catalog entries;
- actor-bound immutable idempotency reservations and exact tenant-result mapping;
- database recomputation of the fixed Routing-only proposed change, rationale, complete evidence snapshot, ordered reference envelope and SHA-256 evidence hash;
- current Task/Episode, current Diagnosis, current exact selected CapabilityVersion, terminal delivery and non-superseded teacher constraint requirements at proposal time;
- the same current-source requirements at decision time, while stale proposals and historical decisions remain inspectable and visibly stale.

The proposal rule accepts only an explicit `EXCLUDE_CAPABILITY` TeacherIntervention whose constraint targets the exact eligible Capability and CapabilityVersion selected by the recorded Resolution. A different-capability exclusion, no-match, raw usage, Attempt correctness, closed Task, inactive Episode, superseded Diagnosis or constraint, inactive selected version, non-terminal delivery, missing Attempt hash, mismatched target lineage, changed evidence or widened optimization claim fails closed.

Learners cannot read proposal/decision rows at the PostgreSQL boundary, including Attempt identifiers, human rationale or actor/session provenance. Authenticated current-course `TEACHER`, `EXPERT` and `ADMIN` actors can read and insert through the bounded command path. Neither table grants update/delete authority, and mutation triggers preserve append-only behavior if grants ever widen.

## Independent review and rework

The independent review found two PR-blocking issues:

1. a decided proposal hid a later stale-source state because the historical decision badge displaced the stale warning;
2. unchanged ComponentAssetVersion counts did not prove that CapabilityVersions, the selected Capability active version, Resolution policy or candidate set remained unchanged.

Rework made stale state a separate visible badge and explanation for both pending and decided proposals, added a focused render test, and retained the historical decision. Integration and browser evidence now snapshot CapabilityVersion counts, the selected Capability active version and the exact Resolution policy/input/candidate-set/selection state before and after the human Routing decision. The final re-review reported **no remaining PR-blocking finding**.

An engineering self-review also corrected ordered optional Review/Outcome evidence refs, added direct evidence-snapshot tampering and cross-tenant denial, and extended the tenant writable-lineage matrix to both new tables.

## Verification bound to the implementation checkpoint

- Lockfile install: `npm ci` passed; 572 packages installed. No dependency or lockfile changed.
- Diff hygiene: `git diff --check` and staged `git diff --cached --check` passed; the implementation commit contains 20 bounded files and no generated `next-env.d.ts` change.
- Full static/unit/build validation: `npm run validate` passed — lint, type check, 48 files / 218 tests, Next.js 16.2.10 production build and zero Legacy production imports across all scanned runtime directories.
- Focused Routing unit/migration/UI validation: 3 files / 19 tests passed, including rule ineligibility, deterministic identity, explicit non-claims, migration authority and decided-but-stale rendering.
- Clean migration and seed: migrations `0000`–`0013` applied to a disposable local PostgreSQL database and the explicitly gated showcase seed completed. The seed states that it fabricated no capability, Diagnosis, Eval, Review, Outcome or publication success.
- Focused CAP-08B integration: 1 file / 3 tests passed, including correct-Attempt independence, exact candidate/version binding, concurrent proposal replay, decision replay, role/tenant denial, direct learner invisibility, evidence tampering, append-only rows/reservations, superseded-constraint stale denial and unchanged Resolution/Plan/ComponentVersion/CapabilityVersion/active-version/Review/Outcome/Asset state.
- Full PostgreSQL integration: 13 files passed and 1 was intentionally skipped; 70 tests passed and 1 was intentionally skipped.
- Tenant/RLS matrix: `PASS` with 61 authority-catalog rows, 60 tenant-negative tables, 60 worker-negative tables, 41 writable-lineage catalog rows, all 41 direct probes, five production login contracts, clean role teardown and the trusted Component Executor boundary unchanged.
- Forward-only upgrade: `CAP08B_UPGRADE_VERIFIED` applied exact migrations through `0012`, snapshotted a real CAP-08A proposal, decision, actor-bound reservation and both Asset Optimization table schemas, applied only `0013`, preserved those rows/schema/prior idempotency behavior, added two guarded and immutable tables, and created zero Routing Optimization rows.
- Focused browser during development: the authenticated CAP-07→CAP-08A→CAP-08B desktop journey passed after selector rework.
- Final full browser: 22 passed and 6 intentional mobile duplicates were skipped. The stateful desktop CAP-08B journey passed in 25.0 seconds and covers the real learner runtime, separate Asset proposal/decision, authenticated Teacher exact-capability exclusion, Expert Routing proposal with exact route inspection, Teacher next action, reload persistence and SQL proof of unchanged CapabilityVersion/active-version/Resolution policy/candidate set/Plan/Review/Outcome/Asset state.
- Final independent targeted re-review: no PR-blocking findings remain.

## Validation history, fixtures and explicit non-claims

Early focused validation exposed and corrected a SQL JSON concatenation-precedence error, two ambiguous browser form selectors, and missing tenant-harness inventory probes for the new tables. These were test/development failures, not hidden passes; the clean final matrix above was rerun after all fixes. No product action is substituted by a seed, direct database write or hidden script in the browser acceptance path.

The browser uses explicitly gated synthetic showcase identities and a synthetic reviewed Chemistry package. The actions themselves use real authenticated application, database, TeacherIntervention, proposal and decision boundaries. CAP-08A may use the incorrect Attempt as an Asset-only signal; CAP-08B uses the later independent teacher exclusion. The same incorrect Attempt is not reinterpreted as a routing failure.

The upgrade fixture is inserted under `session_replication_role=replica`; it proves forward-only exact-state and schema preservation, not a live CAP-08A user path. The full integration and browser journeys provide the complementary live-path evidence.

This package does not claim:

- one teacher override proves a routing defect, a better alternative, causation, learning success or effectiveness;
- usage count, completion, Attempt correctness or one Outcome is a Routing Optimization signal;
- Asset Optimization or Learning Strategy Optimization;
- policy successor authoring, ranking change, eligibility-rule change, Eval, rollout or activation;
- automatic approval, automatic route change, automatic TeacherReview or automatic LearningOutcome;
- pattern aggregation, override-rate thresholds or generalized optimization;
- live-provider validation, real learner data, human pedagogy/accessibility validation, production-like online preview or performance thresholds;
- any complete Doc 12 requirement row, `HUMAN_VALIDATED`, `PREVIEW_VALIDATED`, `ACCEPTED`, merge, deployment, release or cutover authority.
