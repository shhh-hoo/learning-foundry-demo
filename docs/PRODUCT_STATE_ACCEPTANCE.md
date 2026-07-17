# Canonical Product State Vertical Slice

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Implementation lane: product-critical architecture, Wave 2 PR 4.

Applicable authority: Doc 17 §§4.1, 5.3, 6, 16A and 17–20; ADR-002
and ADR-004.

## Authority effect

This change makes a Postgres-backed canonical Product State implementation
available. It does not switch any environment merely by merging code.

```text
code merged
≠ environment cut over
```

The public showcase remains `LEGACY_SHOWCASE` until a separate, explicit
environment acceptance exists. A `POSTGRES_CANONICAL` process refuses to
start without current migrations and a matching cutover acceptance record.
It never falls back to browser storage and it never dual-writes.

External-component review authority remains the Git-versioned registry.
This change does not move external review decisions into Postgres.

## Canonical and derived records

The bounded context implements:

```text
LearningTask
→ LearningEpisode
→ append-only ConversationEvent
→ LearnerAttempt
→ DiagnosticObservation envelope
→ append-only TeacherReview / correction
→ linked RetryAttempt
→ retry DiagnosticObservation
→ LearningOutcome
```

Task and Episode identity/status/linkage, raw Conversation Event payloads,
Attempts, Observation provenance/correction chains, Teacher decisions,
Retry linkage and Outcomes are canonical. Episode summaries, diagnosis
payloads, runtime traces, retrieval traces, Agent messages/checkpoints and
model memory are derived and do not become Product State authority.

Every governed mutation writes an append-only decision and an outbox message
in the same transaction. Postgres triggers reject update/delete on canonical
Events, Observations, corrections, Reviews, Outcomes, governance decisions,
import receipts and cutover records. Explicit transition triggers protect
Task, Episode and Retry current state.

## Permissions and API

`ProductStateService` owns permissions and lifecycle policy. The repository
owns atomic persistence, constraints and queries. The Postgres Adapter does
not own the domain model.

- Learners can create and mutate only their own Task.
- Teachers create Tasks for an explicit learner and own Review, correction,
  Retry planning and Outcome decisions.
- Foundry service actors may record derived Observation envelopes and retry
  results, but cannot create TeacherReview or LearningOutcome.
- System actors own import/cutover administration only.

The loopback-only API is started with `npm run product-state:server` after an
environment has been explicitly accepted. It exposes health and the complete
Task/Episode/Event/Attempt/Observation/Review/Retry/Outcome application path
under `/v1/product-state/`. Actor headers are an integration boundary, not a
production authentication claim.

## Migrations and cutover

Versioned migrations live under `migrations/product-state/`:

1. `0001_canonical_learning_loop.sql` creates the learning tables,
   append-only decisions, transactional outbox, indexes and transition
   guards.
2. `0002_import_and_cutover_acceptance.sql` creates Legacy import receipts,
   import/no-import decisions and environment cutover acceptance.

The migration runner verifies immutable migration hashes and serializes
concurrent migration attempts with a Postgres advisory lock.

The required operational order is:

```text
npm run product-state:migrate
→ npm run product-state:import-legacy (or explicit NO_IMPORT_REQUIRED)
→ npm run product-state:cutover
→ npm run product-state:server
```

Cutover requires migration `0002`, database readiness, one explicit
`IMPORT_COMPLETED` or `NO_IMPORT_REQUIRED` decision, `dualWrite = false` and
an append-only acceptance record for the configured environment.

## Legacy importer

The importer reads one explicitly supplied Legacy snapshot. It preserves raw
message content as canonical Conversation Events and records a content hash,
source key, learner, operator and import receipt. Repeating identical input
returns `ALREADY_IMPORTED`; changed input under the same source key fails.

Agent traces, model Diagnosis records and Demo event logs are counted in the
receipt but never promoted to canonical Product State. Legacy Library,
Schedule and Capability Gap records are reported as deferred rather than
silently fabricated into this bounded slice.

## Validation evidence

Automated tests cover lifecycle order, human authority, learner ownership,
lineage, migration contents, mode selection, no fallback, idempotent import,
cutover prerequisites, API wiring and append-only enforcement.

A temporary local PostgreSQL 15 database was used to run the real migrations
and the repository integration suite. The suite completed the full ten-step
Task-to-Outcome chain, verified ten matching decision/outbox writes, rejected
a Review update, repeated a Legacy import idempotently, recorded explicit
cutover acceptance and rejected import-receipt deletion.

No public showcase, shared sandbox or production environment was cut over.

## Rollback and limitations

Before cutover, rollback is a revert of this PR and continued
`LEGACY_SHOWCASE` operation. After an environment is cut over, canonical
history is retained and corrected forward; records are not deleted to
simulate rollback. Silent localStorage fallback is prohibited.

Known limitations:

- production identity/authentication and institution-level authorization are
  not implemented; the API binds to loopback and exposes the required actor
  contract only;
- controlled read-only degradation is not implemented, so database failure
  is explicit;
- Legacy Library, Schedule and Capability Gap migration remains deferred;
- outbox dispatch workers and retention policy are follow-up operational
  work;
- no automatic TeacherReview, LearningOutcome, Component publication,
  runtime authority change or Legacy deletion is granted.
