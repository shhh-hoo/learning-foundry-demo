# CAP-02 — Diagnosis-driven Capability Resolution

## Bounded package contract

- **Authority:** `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- **Exact base:** `cb0c4c8ba54895a3b54d632d597a8682cc758e06` (CAP-01 evidence head).
- **Branch:** `codex/cap-02-diagnosis-capability-resolution`.
- **Mapped requirements:** `REL-03`, `REL-04`, `REL-09`, `REL-11`, `CAP-02`,
  `CAP-03`, `CAP-04`, `CTX-04`, `CTX-05`, `CTX-06`, `CTX-07`, `LEARN-04`,
  `LEARN-06`, `LEARN-07`, `TEACH-08`, `DATA-01`, `DATA-03`, `DATA-07`,
  `DATA-09`, `SEC-01`, `SEC-03`, `SEC-04`, `SEC-08`, `SEC-09`.
- **User-visible orchestration result:** after a current Diagnosis Proposal, the
  product can persist an explainable next-capability decision that pins an exact
  eligible Registry version or honestly records a recommendation/gap and teacher
  escalation. Asset delivery remains a later package.

## Ownership and existing-object boundary

CAP-02 owns deterministic candidate generation, eligibility, exclusions,
ordering, selection rationale, recommendations and the persisted Class-B
resolution assertion. It reuses:

- `CompiledContextSnapshot` from `context_compilations`;
- `DiagnosticObservationProposal` from `diagnostic_observations`;
- Registry identity and exact versions from `capabilities` and
  `capability_versions`;
- Task, Episode, course, learner and authorization state from their canonical
  Product State rows.

The existing `components` / `component_versions` records contain reviewed
teaching-support proposals and draft content. They are not machine-callable
Registry entries and are not resolver candidates. No parallel Context,
Diagnosis, Registry or Product State model is introduced.

## Input invariants

1. The actor is authenticated and authorized for the exact Task/course/tenant.
2. The Episode belongs to that Task and the current Diagnosis Proposal belongs
   to an Attempt in that same Task/Episode and is not superseded.
3. Resolution compiles and consumes an exact persisted Context snapshot with
   consumer `CAPABILITY_RESOLUTION`; caller-supplied Context is not accepted.
4. Structured selected Context supplies teacher requirements/exclusions,
   learner level, Task type, curriculum, language, accessibility, prerequisite
   evidence, contraindications and availability overrides. Free-text support is
   not silently converted into capability authority.
5. Registry candidates come from canonical capability/version rows. Incomplete
   legacy callable contracts remain visible but fail closed as ineligible.

## Output and selection policy

Every meaningful exact version is recorded once with deterministic ordering,
eligibility, compatibility checks and zero or more exclusion reasons. Supported
reasons include `INELIGIBLE`, `CONTRAINDICATED`, `TEACHER_EXCLUDED`,
`RIGHTS_BLOCKED`, `DEPENDENCY_UNAVAILABLE`, `PROVIDER_UNAVAILABLE`,
`VERSION_DISABLED`, `TENANT_DENIED` and `NO_MATCH`.

The resolver applies this order:

1. verified eligible exact existing capability;
2. parameterization recommendation for an eligible existing capability;
3. composition recommendation using eligible exact versions;
4. adaptation recommendation for a reviewed related capability;
5. generated `ComponentAsset` proposal recommendation;
6. explicit no-match and teacher escalation.

Only step 1 creates `selectedCapabilityVersionId`. Steps 2–5 are recommendations,
not execution, mutation, availability or proof that supply occurred. Ties are
resolved by policy priority, compatibility score, capability key, semantic
version and immutable version ID. Teacher exclusions, safety/contraindication,
rights, dependency/provider availability, tenant scope and disabled-version
checks cannot be outscored.

## Persistence, replay and authority

- One tenant-scoped Class-B capability-resolution record stores exact Context
  and Diagnosis lineage, the complete ordered candidate set, rationale,
  selected exact version (if any), recommendations, gap/no-match signal, policy
  version and input hash.
- The deterministic input hash covers the exact snapshot, Diagnosis, Registry
  versions/contracts and interpreted structured constraints.
- Retry/replay returns the same record. Conflicting content for the same replay
  identity fails closed. Historical resolution rows are immutable.
- The write is transactional, RLS/lineage guarded and idempotent. It creates no
  TeacherReview, availability decision, ActivityPlan, RuntimeDelivery,
  LearningEvent, Attempt, ComponentAsset, or LearningOutcome.
- Learner, teacher and admin actors may resolve only Tasks in their authorized
  tenant/course scope under the current Context Compiler role contract; role
  never widens tenant access. Expert/Engineering inspection remains outside this
  write path.

## Expected change boundary

- capability-resolution domain contract and deterministic policy;
- capability-resolution application service and bounded workflow node;
- canonical schema plus one additive populated-safe migration;
- callable Registry metadata for genuine deterministic reference-pack
  capabilities;
- focused unit, workflow, PostgreSQL integration, migration-upgrade, replay,
  authorization and tenant-isolation evidence;
- package evidence bound to exact implementation SHA.

## Verification and review evidence

Required focused proof covers deterministic ordering/rationale, exact-version
pinning, current Diagnosis/Context lineage, every exclusion reason, required and
excluded teacher policy, stale/disabled versions, cross-tenant denial, rights,
dependencies, providers, prerequisites/contraindications, parameterization,
composition, adaptation/generation recommendations, no-match/escalation,
replay/idempotency, populated upgrade preservation and RLS denial.

After diff-first PM review, run lockfile install, lint, typecheck, unit/workflow/
security tests, PostgreSQL migration and integration tests, tenant enforcement,
upgrade rehearsal, production build and Legacy import scan. Browser, human,
live-provider, preview and Product Owner acceptance dimensions remain unproven.

## Explicit non-scope and prohibited shortcuts

- no Component Asset execution, simulation, Asset Stage or RuntimeDelivery;
- no Activity Planning (CAP-03), teacher UI/assignment implementation,
  Capability Workshop, asset supply execution, preview or deployment;
- no parameterization/composition/adaptation/generation execution or false
  success claim;
- no generic CMS, editorial workflow, publication workbench, manual metadata
  editor or static-resource-as-Component classification;
- no first-match SQL, hidden seed decision, direct database write presented as a
  user path, old `COMP-*` acceptance mapping, or PR #27 import;
- no Legacy deletion, `main` change, merge, preview approval, release or cutover.
