# CAP-08B — Evidence-driven Routing Optimization

## Requirement and user-visible result

Mapped authority: current MVP `REL-10`; capability selection and optimization `CAP-03`, `CAP-08` and `CAP-14`; canonical Product State `DATA-03`, `DATA-07` and `DATA-09`; server authorization `SEC-01`; honest surface state `OPS-01`.

One authenticated teacher `EXCLUDE_CAPABILITY` Intervention becomes a Routing-only signal only when it targets the exact Capability selected by the recorded Capability Resolution. A Teacher or Expert can inspect the exact Context snapshot, Diagnosis Proposal, complete candidate/exclusion set, selected CapabilityVersion/hash, ActivityPlan, RuntimeDelivery, LearnerAttempt, TeacherIntervention, and any linked TeacherReview or LearningOutcome identifiers; create one Class-B Routing Optimization Proposal; and record one append-only next action (`REQUEST_POLICY_REVIEW` or `KEEP_CURRENT_POLICY`).

The teacher Intervention is the independent governed signal. The LearnerAttempt is downstream lineage only. Its correctness, completion and usage are not interpreted as routing quality, an asset defect or effectiveness.

## Stack and responsibility boundary

- Exact base: CAP-08A Draft PR #38 evidence head `91e59eeb2b158c16080f3f2c3057ac8ca3fdfc47` (implementation `f660f3bfa481ccf67f86d6b496e53a4804d78b53`).
- Child branch: `codex/cap-08b-routing-optimization`.
- Stacked Draft PR base: `codex/cap-08a-asset-optimization`.
- Responsibility ends after the human next-action record. `REQUEST_POLICY_REVIEW` creates no policy successor and changes no rank, eligibility rule, CapabilityVersion, ActivityPlan or route.

## Product State and authorization effects

- Adds `routing_optimization_proposals` as append-only Class-B evidence-bound suggestions.
- Adds `routing_optimization_decisions` as append-only authenticated human next-action records.
- Both bind exact institution/course, Task/Episode, Context, Diagnosis, CapabilityResolution and candidate set, selected exact CapabilityVersion, ActivityPlan, RuntimeDelivery, LearnerAttempt and TeacherIntervention lineage.
- PostgreSQL recomputes the complete evidence snapshot, reference envelope, hashes and deterministic proposed policy-review description.
- Only current course `TEACHER`, `EXPERT` or `ADMIN` actors can read or insert. Learners cannot read human rationale, learner lineage or actor/session provenance at the database boundary.
- Actor-bound reservations, transactional writes and deterministic IDs make proposal and decision replay idempotent.
- A closed Task, inactive Episode, superseded Diagnosis or teacher constraint, inactive selected CapabilityVersion, non-terminal delivery or incomplete lineage fails closed. A proposal remains inspectable if its source later becomes stale, but no current-policy decision can be recorded from it.

No Capability Resolution, ranking, policy, ComponentAssetVersion, CapabilityVersion, TeacherReview, LearningOutcome, Asset Optimization or Learning Strategy record is created or changed.

## Expected changes

- `domain/routing-optimization.ts`: bounded actions, deterministic identity, rule and non-claims.
- `application/routing-optimization.ts`: eligible lineage loading, proposal/decision commands, replay and teacher/expert workspace query.
- `app/api/routing-optimization/**`: authenticated command boundaries.
- `components/RoutingOptimizationPanel.tsx`, `components/ClientActions.tsx`, Teacher Workspace and Capability Workshop: browser-visible inspection and governance.
- `db/schema.ts`, `db/migrations/0013_routing_optimization.sql`, migration journal: append-only Product State and database enforcement.
- focused unit/integration/browser/tenant/upgrade tests and exact-head evidence.

No Legacy path, runtime authority, deployment or production setting changes.

## Prohibited shortcuts and CMS scope

- No usage, click, completion, one incorrect Attempt or one Outcome is treated as routing success or failure.
- No seed, fixture, direct database write or hidden script substitutes for the TeacherIntervention, proposal command or human decision in the browser path.
- No automatic rank, eligibility, route or policy change; no automatic approval or LearningOutcome.
- No reuse of the incorrect Attempt as both Asset and Routing evidence without the independent explicit teacher exclusion.
- No generic optimization framework, CMS, publishing workbench, content entry, article/page model, giant metadata editor or manual field workbench.
- No Legacy deletion/import, `main` change, merge, deploy, preview approval or cutover.

## Explicit non-goals

- Asset Optimization and Learning Strategy Optimization.
- Policy successor authoring, Eval, rollout, ranking update or selection-rule activation.
- Pattern aggregation, override-rate thresholding, causal analysis or effectiveness evaluation.
- Outcome-driven routing cases beyond exact optional lineage inspection.
- Product completion, release acceptance, online preview approval, migration/cutover authority or Legacy deletion.

## Required verification and review evidence

- lockfile install; lint; type check; complete unit suite; production build; zero-Legacy import scan.
- clean migration and explicitly gated showcase seed.
- focused/full PostgreSQL integration covering exact selected-candidate binding, teacher-signal independence from Attempt correctness, concurrency/replay, learner/tenant/role denial, evidence/ref/hash tampering, stale source, append-only rows/reservations and no automatic policy/Review/Outcome/version writes.
- tenant/role matrix and writable-lineage inventory coverage.
- guarded CAP-08A → `0013` upgrade rehearsal preserving prior exact Product State and idempotency behavior while fabricating no Routing Optimization row.
- desktop browser flow: real learner runtime → authenticated teacher exact-capability exclusion → Expert proposal with full route inspection → Teacher next action → SQL proof of unchanged policy/ranking/version/Review/Outcome state.
- independent diff review and re-review after findings.
- stacked Draft PR CI must pass before the checkpoint is reported to PR #22.

## Honest fixture and limitation statement

Browser verification may use the explicitly gated synthetic showcase identities and curriculum package, but all acceptance-path actions and Product State writes must cross the real authenticated application/database boundaries. One explicit teacher exclusion supports only a bounded policy-review proposal. It does not prove a routing defect, better alternative, causal learner effect or educational effectiveness.
