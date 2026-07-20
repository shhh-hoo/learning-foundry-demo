# CAP-04 — Asset Stage Runtime

## Bounded package contract

- **Authority:** `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- **Exact base:** `22afe667898b30b99b7ce470c115740bfead74e4`
  (CAP-03 evidence head).
- **Branch:** `codex/cap-04-asset-stage-runtime`.
- **Mapped requirements:** `REL-05`, `REL-09`, `REL-11`, `REL-12`,
  `LEARN-02`, `LEARN-03`, `LEARN-07`, `CAP-02`, `CAP-05`–`CAP-07`,
  `CAP-13`, `DATA-01`, `DATA-02`, `DATA-04`, `DATA-07`, `DATA-09`,
  `DATA-10`, `SEC-01`, `SEC-08`, `SEC-10`, `OPS-02`, `OPS-03`,
  `OPS-05` and `OPS-06`.
- **Product result:** the orchestration Core can execute one current ready exact
  capability stage through the governed Asset Stage and retain an inspectable,
  replay-safe delivery, ordered runtime events and one immutable learner
  Attempt. CAP-04 adds no learner or teacher UI, so this runtime behavior is not
  yet a complete browser journey.

## Canonical object ownership

CAP-03 owns an immutable Class-B `ActivityPlanProposal`. CAP-04 promotes only
the current latest `READY` proposal into one immutable Class-A `ActivityPlan`
when an authorized learner starts that exact stage. The promotion copies, and
does not reinterpret, the proposal's Task/Episode, Context compilation,
Diagnosis Proposal, Capability Resolution, selected CapabilityVersion, stage,
version content hash and runtime handoff.

CAP-04 owns the Class-A execution facts `RuntimeDelivery` and `LearningEvent`.
It upgrades the existing `LearnerAttempt` additively with nullable ActivityPlan,
RuntimeDelivery, CapabilityVersion, content-hash, modality and assistance/
Evidence provenance fields so historical rows remain valid. It does not add a
parallel Plan, Attempt, Event, Evidence, Context, Diagnosis, Registry or Product
State model. Historical `ComponentDelivery` remains untouched and is not used
as current Asset Stage authority.

## Input, output and state invariants

The command accepts an authenticated learner/admin actor, exact Task and
Episode, exact ready proposal ID, bounded learner input/response, stable
idempotency key and deadline/cancellation signal. Caller-supplied versions,
contracts, implementation keys, Context, candidates, output or Evidence
authority are not accepted.

Before any delivery is created, the service revalidates that:

- the proposal is `READY`, has exactly one executable stage and is the latest
  proposal/resolution for the Task/Episode;
- its Context and unsuperseded Diagnosis remain current;
- Task, Episode, learner, course and institution match the actor's server-side
  authorization envelope;
- the planned capability and exact version are still active and available;
- the persisted version content hash, selected candidate contract, stage
  runtime snapshot and current Registry contract still match exactly;
- declared rights, dependency, provider, teacher-policy and tenant/course
  availability remain executable.

`BLOCKED`/`ESCALATED`, stale/superseded, inactive/disabled, cross-tenant,
contract-altered and malformed plans fail closed before ActivityPlan,
RuntimeDelivery, Attempt or LearningEvent persistence.

One ActivityPlan has one stage and therefore at most one RuntimeDelivery and
one LearnerAttempt. A stable replay identity binds actor, Task/Episode, proposal,
learner input and deadline. Reuse with different content fails closed. Runtime
events use delivery-local monotonic sequence numbers and stable event keys.

The bounded delivery lifecycle is:

```text
PENDING → RUNNING → SUCCEEDED
                  ↘ FAILED
                  ↘ TIMED_OUT
                  ↘ CANCELLED
```

Terminal delivery output/error is normalized, version-bound and immutable.
Success means only that the registered adapter returned a valid result and the
runtime facts committed. It never means Teacher approval, Diagnosis acceptance,
mastery, LearningOutcome, effectiveness or Product Owner acceptance.

## Adapter boundary

Core resolves the exact persisted `implementationKey` only through the
Reference Pack's explicit Asset Runtime adapter registry. An adapter must match
the exact declared runtime kind, be executable and replay-safe, and return a
bounded normalized result. The initial scope permits the existing reviewed
Chemistry deterministic adapters only.

Text/support proposals, external links, unknown keys, mismatched runtime kinds,
arbitrary uploaded code and untrusted packages never execute. A current ready
plan whose exact implementation has no allowed adapter produces an honest
failed RuntimeDelivery and Attempt; it is not reported as execution success.

## Deadline, cancellation and recovery

Execution uses the existing bounded execution-control signal/deadline and a new
`ASSET_RUNTIME` graph compiled by the existing LangGraph checkpointer. CAP-04
does not add a workflow engine, queue, scheduler or sandbox product.

The ActivityPlan, RuntimeDelivery start, learner-input events and Attempt commit
before adapter invocation. Terminal result/events commit transactionally after
the adapter returns or fails. Checkpoint replay or retry after an interruption
reuses the same Product State identity. Because the initial registered adapters
are deterministic and replay-safe, an interrupted RUNNING adapter may be
re-invoked; the delivery, Attempt and events remain singletons. Request abort
maps to `CANCELLED`; deadline expiry maps to `TIMED_OUT`; adapter/contract
failure maps to `FAILED`. None is converted to success.

## Authorization and tenant effects

Only the Task learner (or an authorized admin acting inside the same course and
institution) can start the stage. Runtime commands execute under transaction-
local tenant context. Forced RLS and database lineage guards protect new rows,
including exact Task/Episode/plan/version/actor relationships. Runtime roles
receive only the minimum insert/select and constrained transition privileges;
LearningEvents and ActivityPlans are append-only/immutable.

## Files and responsibility boundary

Expected changes are limited to the CAP-04 package/evidence documents, one
additive `0008` migration, current Drizzle schema, a bounded runtime domain and
application service, the existing Reference Pack adapter registry, the existing
workflow catalog/service plus one Asset Runtime graph, and focused unit,
workflow, security, PostgreSQL, tenant and populated-upgrade tests/scripts.

## Required review evidence

Diff-first review must prove:

- READY-only latest-plan execution and refusal of every non-executable state;
- exact version/content-hash/contract/stage pinning and stale-input refusal;
- deterministic registered adapter execution plus unknown/non-executable
  rejection;
- explicit success, failure, timeout and cancellation normalization;
- ordered events, one Attempt and complete plan/runtime/Evidence lineage;
- idempotent replay after start, terminal commit and injected checkpoint/process
  interruption, without duplicate delivery, Attempt or events;
- cross-tenant and wrong-learner denial at application and PostgreSQL borders;
- populated additive upgrade preserving earlier canonical Product State rows;
- proportional diff, lint, type, unit/workflow/security, PostgreSQL integration,
  tenant/role, build and Legacy-boundary checks.

Evidence must bind to the exact CAP-04 implementation SHA. Browser,
accessibility, human-governance, live-provider, preview and Product Owner
dimensions remain unproven.

## Explicit non-scope and prohibited shortcuts

- no Learner Workspace Asset Stage UI or browser journey;
- no Teacher Assignment/Intervention UI, queue or authority change;
- no Retry, Transfer, Retention, LearningOutcome or mastery write;
- no Capability Workshop, parameterization, composition, adaptation,
  generation, optimization, preview, deployment or cutover;
- no generic plugin/runtime framework, arbitrary-code execution, untrusted-code
  sandbox or production infrastructure expansion;
- no PR #27 import, generic CMS/editor/publication workflow, old `COMP-*` map,
  Legacy deletion, `main` change, merge or production-state mutation;
- no seed, fixture, direct database write or hidden script presented as a user
  action or browser acceptance.

The exact next package after an accepted CAP-04 Draft checkpoint is
**CAP-05 — Teacher Assignment and Intervention**.
