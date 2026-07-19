# CAP-01 Context Compiler evidence checkpoint

Docs authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`

- Exact implementation base: `learning-foundry-demo@cc95d432d5406a1f50d7f7de061b1b7bdccadb99`
- Reviewed implementation checkpoint: `learning-foundry-demo@4ba70900a4d6838958e47be9a734702e4700db11`
- PM disposition: **ACCEPT for one Draft implementation checkpoint only**

The evidence-binding follow-up changes this ledger only. It does not change the
reviewed compiler, migration, workflow or test behavior.

## Accepted product result

The existing Context Compiler is now the single authorized Task/Episode-scoped
boundary for Evidence Retrieval, Diagnosis and the later Capability Resolution
and Runtime consumers. It compiles the canonical Task, Episode, LearnerProfile,
learner strategy versions, Context Items, explicit carryover relations,
Source/Evidence lineage and current authorized teacher constraints. Diagnosis
records the exact snapshot identity before Attempt capture.

The snapshot is deterministic and versioned, carries stable input/snapshot
hashes and exact provenance, and records an inclusion or exclusion decision for
every candidate. Replays within the same governed validity state reuse one row;
crossing an actual validity boundary changes the eligibility resolution and
hash. Required current Task/Episode/profile and teacher-constraint inputs fail
closed rather than being silently truncated.

The compiler enforces current tenant, learner/course and learner/teacher/admin
boundaries. The additive database guard accepts canonical provenance types,
rejects missing or foreign lineage under the actual product runtime role, and
keeps pre-CAP Event/Attempt item compatibility. Historical snapshots retain
their facts and are labeled `LEGACY_COMPATIBILITY`; they are not rebound as CAP
evidence. Snapshot updates are blocked while existing Task deletion cascades are
preserved.

## Evidence bound to the implementation checkpoint

- Focused Context Compiler PostgreSQL suite: `4/4` passed. It covers exact
  provenance, explicit carryover, deterministic replay with one persisted row,
  runtime-role positive writes, tampered-lineage denial, rights exclusions for
  canonical and compatibility inputs, learner/teacher/forbidden-role checks,
  tenant isolation, missing Task/Episode, conflicting learner-strategy and
  Source versions, course-unassigned teacher denial and budget failure.
- Complete unit/workflow/security suite: `30` files and `127/127` tests passed.
- Complete PostgreSQL integration suite: `7` files and `47/47` executed tests
  passed. One existing RW-03 upgrade fixture remained conditionally skipped by
  its own environment gate; CAP-01 upgrade compatibility was executed
  separately below.
- Exact populated upgrade rehearsal: migrations `0000`–`0004` applied first,
  one populated pre-CAP snapshot inserted, then migration `0005` applied. Result:
  `PASS`; one historical row preserved, no historical facts rebound, and an
  in-place rewrite denied.
- Tenant/role regression harness: `PASS`; all `46` authority-catalog rows,
  `43` product/worker tenant-negative tables, `29` writable-lineage probes,
  checkpoint isolation, runtime-role startup assumptions and auth/service
  rollback checks remained green.
- Lint, typecheck, the default production build (`12/12` pages), Legacy scan and
  `git diff --check` passed. No production dependency changed.

No live external-model, browser or production run was performed: CAP-01 adds no
model-provider behavior or user interface, and deployment/preview/cutover are
explicitly outside this package. Repository PR automation runs verification for
pull requests; its deployment job is disabled for pull-request events.

## Non-claims and next boundary

This checkpoint does **not** establish CAP completion, Showcase acceptance,
production readiness or release authority. It does not implement Capability
candidate selection/ranking/no-match, executable ComponentAsset runtime,
Retry/Transfer/Retention behavior, teacher/learner UI, Workshop/CMS behavior,
PR #27 code, deployment, preview approval or cutover.

The next separately bounded package may consume this exact compiler interface
for Diagnosis and Capability Resolution policy. It must not reinterpret this
test evidence as completion of those later requirements.

Rollback is one authorized revert of implementation checkpoint
`4ba70900a4d6838958e47be9a734702e4700db11`, with this evidence binding reverted
or updated separately. Database rollback is not automatic: application use must
be reverted first, then migration-owner review may remove the CAP-01 triggers,
index and additive columns without deleting or rebinding historical rows.
