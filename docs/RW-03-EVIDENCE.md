# RW-03 canonical identity, Context and Evidence foundation

Date: 2026-07-19

Status: **PM ACCEPTED FOR DRAFT REVIEW — NOT PRODUCT OWNER ACCEPTED — NOT MERGED — NOT PRODUCTION READY**

## Change identity and authority

Current review authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
The evidence below was gathered under the superseded authorities recorded in
this section. Its exact schema, migration and isolation observations remain
historical facts; they have not been rebound to current `CAP-*` or Showcase
completion.

- Implementation repository: `learning-foundry-demo`
- Branch: `codex/rw-03-canonical-identity-context-evidence`
- Exact stacked base: `a85c64a07361dc9a90b82f681edd27e5931c7452` (RW-02 Draft PR #25 checkpoint)
- Exact implementation checkpoint: `df678ed7de439744b6b6f19c73900d499bc90048`
- Architecture authority followed when this checkpoint was produced: `learning-foundry-docs@89c7c21dfb09ecd042070e823b2505f3a73f8169` (superseded)
- Evidence ledger authority followed when this checkpoint was produced: `learning-foundry-docs@c77132314e385308c9a49fd0b5af5ed720d420a3` (superseded). The historical ledger supplies the exact row IDs/status used below; it does not establish current CAP status.
- RW-02 remains an internal, non-production security checkpoint. RW-03 consumes its tenant boundary and does not upgrade its security claim.
- This file records implementation evidence only. The PM independently inspected the complete diff and migration and issued ACCEPT for Draft review; that verdict does not grant Product Owner, merge, preview, deployment, production or cutover acceptance.

## Bounded package contract

| Doc 12 IDs | Schema objects / compatibility | Enforced invariant and evidence | Conservative status |
|---|---|---|---|
| `DATA-01`, `DATA-02` | `learner_profiles`; `learning_tasks.learner_profile_id` | Stable institution-scoped learner identity; deterministic backfill; exact learner/profile Task lineage | foundation evidence only |
| `CTX-01`, `CTX-02`, `CTX-05`, `CTX-07` | `learner_strategy_versions`, `context_items`, `context_carryover_relations` | Required Task/Episode scope on ContextItems; versioned provenance and lifecycle fields; profile/course scope; typed, explicit cross-Task carryover; same-tenant positives and A/B denials | partial schema foundation only; no Context Compiler |
| `EVID-01`, `EVID-02`, `EVID-07`, `DATA-03` | `source_assets`, `source_asset_versions`; compatibility links on `source_records` and `file_assets` | Stable source identity separated from immutable version snapshots; exact rights, locator, storage, hash and provenance lineage; rights review appends and relinks a successor version | foundation evidence only |
| `EVID-08` | `evidence_derivatives`, `source_processing_attempts`; `evidence_units.source_asset_version_id` | Derivatives bind to one exact source version; retryable processing is not canonical source truth; one active storage-repair claim prevents compensation races | foundation evidence only; no multimodal ingestion |
| `DATA-06`, `DATA-07` | migration `0004`; additive authority/writable catalogs, forced RLS and guards | deterministic populated backfill, DB `NOT NULL` links, 47 authority rows, 37 writable rows, 37 attached guards, 8/8 new-table A/B matrix | local implementation evidence |
| `LEARN-02`, `LEARN-03` | existing Task/Episode/Attempt/Review/Retry/Outcome rows | populated upgrade preserves the existing chain and does not redefine learning behavior | compatibility gate only; no row upgrade claim |

Explicit exclusions preserved:

- no RW-04 Review/Component lifecycle schema;
- no RW-05 Context Compiler;
- no RW-06 multimodal intake, extraction, normalization or Retrieval implementation;
- no RW-07 Retry, Transfer or Retention behavior;
- no UI redesign, new route or new product flow;
- no Registry, Inspector, Eval, preview, deployment or cutover work;
- no further production security hardening and no production-ready isolation claim.

## Implemented boundary

The migration adds eight Product State tables and six required compatibility references. Existing legacy-shaped Task, SourceRecord, FileAsset and EvidenceUnit inserts remain accepted through bounded compatibility triggers, but the stored references become non-null and database-enforced. Backfill preflight rejects inconsistent Task membership/course scope, conflicting Source identity, Source/File scope or hash disagreement, cross-scope Evidence, and more than one legacy FileAsset per SourceRecord. Postflight verifies every exact profile, asset, version, storage and derivative link before the migration can commit.

SourceAsset and nullable-tenant processing idempotency use named `UNIQUE NULLS NOT DISTINCT` constraints in both Drizzle and SQL. A SourceAssetVersion may receive exact storage metadata once while `storage_key` is still null; that compatibility rule does not prove transaction co-location. Runtime authority cannot rewrite source-version or carryover identity, and lifecycle tables permit only their bounded forward/terminal fields. Owner/migrator deletion remains possible for rollback and governed retention operations.

`reviewSourceRights` now creates an immutable rights/provenance successor, atomically relinks SourceRecord and FileAsset, and materializes Evidence against that exact version. The application-only storage repair command accepts authenticated Teacher/Admin authority, verifies course scope plus exact hash/size/version lineage, records every attempt, compensates external storage if database finalization fails, and uses a partial unique claim so a competing key cannot touch storage. An abandoned `STARTED` claim intentionally blocks later repair until authorized operational resolution; automatic lease recovery is deferred.

## Evidence ledger

### POPULATED_MIGRATION

The final migration was applied transactionally to a disposable localhost database built from exact migrations `0000` through `0003`, the guarded synthetic seed, a valid Review → Retry → result Review → LearningOutcome chain, and a pre-0004 SourceRecord/FileAsset fixture.

```text
Task / Episode / Attempt / Outcome preserved = 1 / 1 / 2 / 1
LearnerProfile / SourceAsset / SourceAssetVersion / EvidenceDerivative = 1 / 2 / 2 / 2
null required compatibility links = 0
legacy file storage backfill = rw03/preupgrade/file.pdf / application/pdf / 123 bytes
table authority catalog = 47
writable lineage catalog = 37
```

The separately gated populated-upgrade integration case passed `1/1`: a guarded update of the pre-migration FileAsset succeeded, authenticated rights review appended a successor version preserving its storage/hash metadata, SourceRecord and FileAsset relinked atomically, and new Evidence bound to the successor.

### DIRECT_DATABASE

`npm run test:rw03-db` final result:

```text
PASS
catalog writable rows = 37
actual runtime-writable tables = 37
attached authority guards = 37
RW-03 same-tenant positive writes = 8
RW-03 ordinary cross-tenant denials = 8
permitted lifecycle transition = 1
identity/provenance/immutable rewrite denials = 6
exact duplicated Context lineage = true
```

Every negative validates the expected SQLSTATE and RLS/lineage message; unrelated syntax, setup or privilege failures cannot count as denials. The eight positives and negatives cover LearnerProfile, LearnerStrategyVersion, SourceAsset, SourceAssetVersion, SourceProcessingAttempt, EvidenceDerivative, ContextItem and ContextCarryoverRelation.

The accepted RW-02 tenant regression also passed on the final migrated database: 46 policy-required catalog rows, 43 product/worker tenant-negative tables, the historical 29-table RW-02 direct mutation matrix, checkpoint isolation, auth-session role-boundary cases, audited service execution and rollback. RW-03's eight added mutation rows are intentionally proved by the dedicated 37-row harness instead of being relabeled as historical RW-02 coverage.

### AUTOMATED

Final results on the complete implementation checkpoint diff:

| Check | Result | Scope |
|---|---:|---|
| `npm run lint` | PASS | repository ESLint, zero warnings |
| `npm run check` | PASS | TypeScript no-emit check |
| `npm test` | PASS | 30 files, 123 tests |
| `npm run test:integration` | PASS | 6 files, 43 tests; the destructive populated-upgrade case is separately gated and skipped in the general run |
| gated populated-upgrade integration | PASS | 1 file, 1 test |
| `npm run build` | PASS | default Turbopack optimized production build; TypeScript and 12 static page generations completed |
| `npm run build -- --webpack` | PASS | supported alternate production build also completed |
| `npm run legacy:scan` | PASS | zero Legacy production imports; six removed runtime paths remain absent |
| `git diff --check` | PASS | no whitespace errors |

The first Turbopack attempt did not compile code because the disposable worktree's `node_modules` symlink pointed outside Turbopack's filesystem root. That failure is retained below. Dependencies were then materialized locally from the offline package cache, the symlink was removed, and the identical default build passed. No dependency or generated build output is part of the diff. No result in this ledger is treated as product acceptance from tests alone.

### BROWSER_NOT_RUN

RW-03 adds no route or UI flow. Existing product/browser evidence was not regenerated solely for schema work. The integration and direct-database evidence is local only.

### LIVE_PROVIDER_NOT_RUN

No external identity, model, storage, extraction or embedding provider was called. The local embedding-unavailable path remains honest where exercised.

### PREVIEW_HUMAN_PRODUCTION_NOT_RUN

No preview was requested or approved. No human review, production migration, managed-database probe, backup/restore exercise, deployment, merge or cutover occurred.

## Retained failure evidence

Failures were retained and corrected rather than hidden:

1. Initial migration rehearsals exposed unsupported `min(uuid)` aggregation and an invalid target-table reference in `UPDATE ... FROM`; both SQL defects were corrected before the exact populated pass.
2. A stale local RW-02 database lacked the accepted writable catalog and was rejected as migration evidence instead of being treated as the exact baseline.
3. An early populated mapping violated an existing FileAsset status/failure constraint; failed/provider-unavailable legacy states are now mapped conservatively.
4. The first focused test run retained a duplicate trailing import in the new helper and draft-name static assertions; the corrected focused suite passed 15/15 including the migration contract.
5. The first A/B harness used inconsistent SourceAsset/SourceRecord stable keys and failed. After the fixture was corrected, it exposed a real immutable-version conflict caused by compatibility `ON CONFLICT DO UPDATE`; adapters now use `DO NOTHING` plus exact identity selection.
6. The first storage-repair integration run passed 6/7 but exact-key replay failed after success because eligibility was checked too early. Replay/mismatch resolution now precedes current-state eligibility.
7. PM concurrency review found that two repair keys could race and the loser's compensation could delete the winner's object. A database-enforced active claim and concurrent integration proof now prevent the loser from calling storage.
8. The RW-02 tenant cleanup exposed `ON DELETE SET NULL` foreign keys attempting forbidden lifecycle rewrites. Those implicit mutations were removed; disposable cleanup and owner/migrator rollback remain possible.
9. Tenant-regression attempts made before full integration correctly failed on missing tenant-A FileAsset and ContextCompilation fixtures; they are setup failures and are not counted as security passes. The populated rerun passed.
10. The first full integration run was 42/43 because the manual seed omitted the four standard synthetic identity fixtures normally installed by E2E setup. After adding those exact fixtures, full integration passed 43/43.
11. The first full unit run retained the old four-file migration expectation. The migration contract now includes `0004`; the complete unit suite passed 123/123.
12. Default Turbopack build first stopped before compilation because the disposable worktree dependency symlink left its filesystem root. After offline local dependency materialization removed that harness condition, the identical default build passed; the supported webpack build also passed.
13. PM review found that global SourceAsset and nullable-tenant processing uniqueness differed between Drizzle and SQL. Both now use the same named `NULLS NOT DISTINCT` constraints.
14. PM review found that a pre-migration FileAsset's storage metadata was not copied into its canonical version. The migration now fails on ambiguous multiples, backfills exact storage/media/size, verifies them postflight, and passes a post-upgrade mutation plus rights-review test.
15. A later independent offline dependency refresh stopped with an incomplete local package tree and produced setup-only missing-package failures for lint, check and unit tests. No product code was changed in response; the complete known dependency tree was materialized locally and the identical lint, check, unit and build gates passed.

## Rollback boundary

Code rollback is one authorized revert of implementation checkpoint `df678ed7de439744b6b6f19c73900d499bc90048`, with this evidence binding reverted or updated separately. Database rollback is not automatic and was not rehearsed:

1. stop new writes through RW-03 canonical tables and the storage-repair command;
2. preserve Source/Evidence/processing audit exports and database backups;
3. revert application reads/writes to the legacy compatibility shape;
4. remove compatibility and authority triggers, catalog rows and six compatibility foreign-key columns in reverse dependency order;
5. drop the eight additive tables only after exporting any canonical-only rows;
6. restore prior grants/policies through the authorized migration owner.

The migration deliberately does not rewrite or delete the original Task, Episode, Attempt, Outcome, SourceRecord, FileAsset or EvidenceUnit rows. Destructive rollback requires Product Owner authority and operator review.

## Deferred limitations and non-claims

- RW-02 role/tenant hardening remains an internal checkpoint with its documented deployment assumptions.
- A crash after an active storage-repair claim commits but before terminalization leaves a fail-closed `STARTED` claim; lease/administrative recovery is deferred.
- A legacy SourceRecord with multiple FileAssets blocks migration as ambiguous; no automatic winner is selected.
- The one-time null-storage compatibility attachment does not prove the SourceRecord and FileAsset were written in one transaction.
- No Context compilation, multimodal ingestion, extraction, normalization, Retrieval, Review/Component lifecycle or Retry/Transfer/Retention behavior is implemented here.
- No full 113-row ledger implementation claim is made. Only the exact requirement foundations mapped above receive evidence.
- Automated and local database success do not grant product, preview, merge, deployment, production or cutover acceptance.
