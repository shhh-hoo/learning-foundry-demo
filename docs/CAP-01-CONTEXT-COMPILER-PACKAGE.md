# CAP-01 Context Compiler package contract

Docs authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`

Exact implementation base: `learning-foundry-demo@cc95d432d5406a1f50d7f7de061b1b7bdccadb99`

Package boundary: one authoritative, Task/Episode-scoped Context Compiler. This
package extends the existing `ContextItem` and `context_compilations` contracts;
it does not introduce another context model.

## Requirement map

| Authority | CAP-01 contract |
|---|---|
| `CTX-01`, `CTX-04`, `SEC-01` | Resolve one canonical Task/Episode and learner profile, then enforce institution, course, learner ownership and permitted learner/teacher/admin roles before compilation. |
| `CTX-02` | Admit a prior-Task item only through an exact persisted carryover relation with its source Task, target Task, relation type and actor-or-policy authority. |
| `CTX-03` | Persist candidates, selections, exclusions and reasons, compiler/policy versions, token/modality budgets and exact usage. |
| `CTX-05`, `DATA-03` | Exclude stale, superseded, invalidated, expired and rights-revoked inputs; fail closed on conflicting current versions or broken lineage. |
| `CTX-06`, `DATA-09` | Expose one callable boundary parameterized by consumer (`EVIDENCE_RETRIEVAL`, `DIAGNOSIS`, `CAPABILITY_RESOLUTION`, `RUNTIME_ORCHESTRATION`) so consumers receive the same governed snapshot rather than reading context source tables independently. |
| `CTX-07`, `DATA-01` | Persist a Class B compiled snapshot with exact Class A/B source references. The snapshot is derived and is never promoted to learner, teacher, Evidence or Outcome authority. |
| `DATA-07` | Derive stable input/snapshot hashes and a deterministic snapshot ID; replaying the same authorized inputs and policy creates no duplicate row. |
| `DATA-10`, `EVID-08` | Compilation never manufactures TeacherReview, teacher constraints, EvidenceUnit, Diagnosis or LearningOutcome records. |
| `EVID-01`, `EVID-02`, `EVID-06`, `EVID-09` | Context items that cite Evidence/Source records retain exact source/version/content-hash lineage and fail closed on inconsistent lineage; unavailable or unauthorized rights are excluded before consumers. |

`CTX-08` browser and complete Eval coverage remains release-level evidence and is
not claimed by this package. The targeted contamination, carryover, correction,
authorization and replay cases below are package evidence only.

## Inputs and ownership

The compiler resolves existing owners rather than copying their facts:

- `LearningTask`, `LearningEpisode`, `LearnerProfile` and the current authorized
  `LearnerStrategyVersion` remain their canonical records;
- persisted `ContextItem` rows are the primary selectable units;
- `ContextCarryoverRelation` is the only cross-Task admission authority;
- `EvidenceUnit`, `SourceRecord`, `SourceAssetVersion` and derivative records
  remain Evidence/Source lineage authorities;
- teacher requirements, exclusions and corrections are consumed only when they
  already exist as authorized canonical Context Items.

Until canonical ContextItem projection is available at every current write path,
the existing ConversationEvent/LearnerAttempt compiler input is retained through
one explicit `LEGACY_COMPATIBILITY` adapter. Each adapted item carries its exact
record ID and is Task/Episode scoped. It grants no CAP completion and cannot
create or mutate canonical Context Items.

## Output contract

`CompiledContext` contains:

- active Task/Episode, consumer, compiler version and policy version;
- deterministic input and snapshot SHA-256 hashes plus a stable snapshot ID;
- ordered candidate, selected and excluded items;
- an inclusion or exclusion reason for every candidate, including explicit
  budget truncation reasons;
- exact provenance references and referenced prior Task IDs;
- configured token/modality budgets, measured usage and tokenizer identity.

Required Task/Episode/profile or authorized teacher-constraint items cannot be
silently truncated. A budget that cannot contain them fails closed.

## Consumers and compatibility

- Explanation/Evidence Retrieval continues through the existing wrapper, now
  backed by the authoritative compiler.
- Diagnosis records the exact compiled snapshot lineage before Attempt capture;
  CAP-01 does not change Capability candidate selection or Diagnosis semantics.
- Capability Resolution and Runtime orchestration receive the same callable
  interface for their separately bounded packages.
- Existing `context_compilations` rows are retained as historical compatibility
  snapshots. The additive migration labels them without rebinding them as CAP
  evidence.

## Package verification

Targeted unit and PostgreSQL integration evidence must cover:

- deterministic ordering, hashes and budget/truncation decisions;
- exact provenance and explicit carryover;
- learner, teacher and forbidden-role authorization;
- tenant/course isolation;
- missing Task/Episode/profile/lineage inputs;
- conflicting current learner-strategy versions;
- stale/superseded/rights-revoked exclusions;
- replay/idempotent persistence.

Proportionate regression evidence includes lint, typecheck, unit/workflow tests,
PostgreSQL integration, exact-base populated upgrade compatibility, default
production build, Legacy scan and `git diff --check`.

## Explicit exclusions

- Capability candidate selection, ranking, exclusions or no-match behavior;
- executable ComponentAsset/Asset Stage runtime;
- Retry, Transfer or Retention behavior;
- learner, teacher or Workshop UI;
- generic CMS/editor, authoring comments or publication workflow;
- PR #27 migration, commands or CMS-only structures;
- multimodal extraction beyond consuming existing canonical Evidence;
- deployment, preview approval, production security hardening or cutover.

CAP completion, Product Owner acceptance, merge authority and release authority
are not claimed by this package or by passing tests.
