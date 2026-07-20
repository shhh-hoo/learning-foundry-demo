# CAP-03 — Activity Planning

## Bounded package contract

- **Authority:** `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- **Exact base:** `9c373a6236ac81624bee9a843a3d7893a7cc2b49` (CAP-02 evidence head).
- **Branch:** `codex/cap-03-activity-planning`.
- **Mapped requirements:** `REL-03`, `REL-11`, `LEARN-02`, `LEARN-06`,
  `LEARN-07`, `TEACH-01`, `TEACH-04`, `TEACH-08`, `CAP-03`, `CAP-04`,
  `CTX-05`–`CTX-07`, `DATA-01`, `DATA-03`, `DATA-07`, `DATA-09`,
  `SEC-01`, `SEC-08`, `SEC-09`, `OPS-03` and `OPS-05`.
- **Product result:** after CAP-02, the orchestration Core can persist an
  explainable ordered next-activity proposal pinned to the selected eligible
  exact Registry version, or an honest blocked/escalated proposal with no
  executable stage. Learner delivery remains CAP-04.

## Authority and ownership

Doc 06 defines a system-generated `ActivityPlanProposal` as Class B and reserves
`ActivityPlan` for Class-A Product State. CAP-03 therefore owns the immutable
Class-B proposal and later-runtime handoff contract. It does not create a
Class-A execution fact, `RuntimeDelivery`, `LearningEvent`, Attempt, Review,
Retry assignment or Outcome.

Inputs are the exact persisted CAP-02 `CapabilityResolution`, its exact
`CompiledContextSnapshot`, the current unsuperseded Diagnosis Proposal, exact
Task/Episode/course/tenant, selected Registry version and structured teacher
constraints. Caller-supplied Context, candidates, ranking and versions are not
accepted.

## States and stages

- `READY`: only CAP-02 `EXISTING`, with the selected candidate still eligible
  and its exact version active; no structured pre-runtime teacher gate applies.
- `BLOCKED`: CAP-02 recommends parameterization, composition, adaptation or
  generation. The recommendation is retained but not executed.
- `ESCALATED`: explicit no-match, stale/non-current exact input, inactive exact
  version, or a structured pre-runtime teacher gate.

A ready proposal contains one deterministically ordered capability stage with
purpose, exact Context/Diagnosis/version inputs, parameter contract, expected
output/events/evidence, success/stop/transition conditions, teacher constraints,
formal-Retry intent and revalidation requirements for CAP-04. Blocked or
escalated proposals contain no executable stage or selected runtime version.

## Persistence and authorization

The additive `0007` migration creates one tenant-scoped immutable proposal per
exact CAP-02 resolution. Its deterministic input hash covers resolution,
Context, Diagnosis, exact Registry contract/version, structured constraints,
freshness checks and proposed handoff. Replay returns the same row; conflicting
content fails closed. Forced RLS, insert-only grants and a database lineage
trigger validate Task/Episode/course/tenant, exact resolution/Context/current
Diagnosis, actor enrollment and ready-plan exact-version eligibility.

Learner, teacher and admin actors retain the existing authorized Task/course
envelope. No role widens tenant access and free text is not converted into
teacher authority.

## Verification and evidence

Focused proof must cover deterministic ordering and rationale, every CAP-02
decision path, selected exact version and content hash, empty blocked/escalated
stages, structured teacher gates, Retry non-creation, stale/superseded inputs,
replay/idempotency, cross-tenant denial, immutable rows and populated additive
upgrade. After diff-first PM review, run proportional lint, type, unit/workflow/
security, PostgreSQL integration, tenant, upgrade, build and Legacy gates.

Browser, human-governance, live-provider, preview and Product Owner acceptance
remain unproven.

## Explicit non-scope

- no Component Asset execution/simulation, Asset Stage or RuntimeDelivery;
- no learner delivery UI, Teacher Workspace UI or Capability Workshop;
- no parameterization, composition, adaptation or generation execution;
- no generic CMS/editor/publication workflow, PR #27 import or old `COMP-*` map;
- no Legacy deletion, `main` change, merge, deployment, preview approval,
  release or cutover.
