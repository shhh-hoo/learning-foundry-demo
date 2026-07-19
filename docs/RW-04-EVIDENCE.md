# RW-04 evidence — canonical review and Component lifecycle foundation

Status: **PM ACCEPTED FOR DRAFT REVIEW — UNMERGED — NOT PRODUCT OWNER ACCEPTED — NOT PRODUCTION READY**

## Authority and exact boundary

- Implementation base: `learning-foundry-demo@b981f88cf2bf93fc9d1c0b1e7cdf34ef6c74984d`.
- Implementation checkpoint: `learning-foundry-demo@9040fbe34d6c5de96a859af6cbea5e42d4578e4a`.
- Current product/architecture authority and 113-row ledger binding: `learning-foundry-docs@c77132314e385308c9a49fd0b5af5ed720d420a3`.
- Package contract: `docs/RW-04-PACKAGE.md`.
- This evidence binds exact implementation checkpoint `learning-foundry-demo@9040fbe34d6c5de96a859af6cbea5e42d4578e4a`, PM accepted for Draft review only; it remains unmerged, not Product Owner accepted, and not production ready.

## Requirement-scoped implementation evidence

| Doc 12 IDs | Local implementation evidence | Conservative status |
|---|---|---|
| `COMP-09`–`COMP-12` | Class A assignment, field/block comment, change request and exact-revision human decision tables; immutable/allowed-transition triggers; existing private publication command writes assignment/review decision facts explicitly after an `EXPERT`/`ADMIN` application check | database proves tenant/exact lineage, not reviewer-role policy; reviewer policy remains private/fail-closed under open `DEC-002`; no review UI or human validation |
| `COMP-13`, `COMP-18` | immutable `ComponentDraftRevision`; existing pre-publication `component_versions` retained only as an exact-revision compatibility shell; published version binds private scope, publisher/time and exact PublicationDecision; edits append a Component-wide monotonic revision | local schema/application/migration evidence only; no public/organisation publication claim |
| `COMP-19`, `COMP-20` | exact deprecate/retire/disable/rollback decisions; private maintenance commands require `EXPERT`/`ADMIN`; active summary changes only for active target; maintained versions are denied future delivery/rollback; historical versions/deliveries remain unchanged | database proves tenant/exact lineage and history protection, not a maintenance-role policy or human acceptance; no maintenance UI, Registry selection, deployment rollback or cutover claim |
| `DATA-01`, `DATA-02`, `DATA-06`, `DATA-07` | eight new Class A mappings, exact actor/scope/time/revision hashes, migration-only `MIGRATED_COMPATIBILITY` assignments, replay-safe evaluation binding, deterministic backfill | partial RW-04 evidence only; schema presence does not complete any Doc 12 row |

## Focused local results

Fresh populated rehearsal database: `learning_foundry_rw04_topology`, cloned read-only from exact pre-`0005` `learning_foundry_rw03_accept` on the local isolated PostgreSQL service and migrated atomically with only pending `0005`. The source remained pre-`0005` with 10 ComponentVersions and no `component_draft_revisions` table.

- Atomic populated migration: **PASS**.
- Equal-timestamp branch proof: **PASS**. The governed fixture copied one existing published leaf into one parent and two exact child DRAFT successors sharing the same transaction-stable timestamp. Timestamp/ID ordering would place both children before the parent; canonical revisions are parent `5`, children `6` and `7`, with both child predecessor links bound to revision `5` and zero global predecessor-order violations.
- Preserved/migrated rows after upgrade: 13 ComponentVersions (10 source + 3 adverse branch fixtures), 13 exact draft revisions, 10 ComponentEvaluationRuns, 8 terminal publication review decisions, 2 rollback decisions and 6 RuntimeDeliveries.
- Evaluated legacy DRAFT compatibility: 2/2 exact evaluated DRAFT revisions are `READY_FOR_REVIEW`; no evaluation row was fabricated by migration.
- Evidence reference binding: 0 mismatches between legacy `content.evidenceRefs[*].evidenceUnitId` and canonical `evidence_unit_ids`; current populated fixtures contain zero non-empty Component Evidence references, so invalid-shape/scope and exact extraction are additionally held by executable preflight/postflight and targeted contract tests, not claimed as a non-empty migration demonstration.
- Writable inventory: 45 catalog rows = 45 grant-derived runtime-writable tables = 45 attached authority guards.
- New RW-04 coverage: 8/8 rollback-safe same-tenant direct writes and 8/8 ordinary cross-tenant denials. Live review positives use rollback-only eligible DRAFT → READY/IN_REVIEW revisions and `DECLARED_NONE` assignments; they do not attach new live review facts to an already-approved published revision and never persist.
- Lifecycle/history DB probes: 3 legal lifecycle paths passed; 3 illegal transitions were denied; 1 authored-payload rewrite, 1 stale exact-hash assignment, and 5 append-only fact rewrites were denied. All fixtures and attempted writes were rollback-only.
- Authority inventory: 55/55 tables classified; no worker, auth-bootstrap or checkpoint grant was added for RW-04.
- `npm run check`: **PASS** after rework.
- `git diff --check`: **PASS** after rework.
- Targeted contracts: 12/12 passed across `rw04-schema-contract` and `migration-contract`.
- Focused Component Asset Loop integration: 1 file / 6 tests **PASS**, including authorized deprecation/emergency-disable decisions, same-key replay/no duplicate, active summary transitions, future-delivery denial, deprecated rollback-target exclusion, ordinary learner-role denial, and unchanged historical ComponentVersion/RuntimeDelivery rows.

The focused Component Asset Loop also covers a non-latest terminal edit: Component-wide `max + 1` allocation, monotonic predecessor lineage, exact `derivedFromVersionId`, coexisting branches, and immutability of the historical revision.

## Retained failures and bounded corrections

1. Initial compiler attempt failed because this disposable worktree had no dependencies (`tsc: command not found`). A copied ignored dependency tree restored local tooling; it is not part of the diff.
2. The first populated clone lacked Drizzle journal history, so the generic migrator attempted `0000` and failed on existing `capabilities`. Later rehearsals applied only pending `0005` atomically.
3. The first `0005` preflight rejected preserved historical successor branches. Rework now preserves explicit branching from any exact terminal source while the Component-wide unique revision number supplies deterministic ordering without inventing a winner.
4. Two rehearsals exposed existing terminal/published ComponentVersion guards during additive link backfill. Migration now suspends only the named immutability triggers for the bounded link attachment and restores them before postflight.
5. One rehearsal exposed early re-enabling of the PublicationDecision immutability trigger. Re-enabling now occurs after the exact review-decision link is attached.
6. The first post-rework compiler run failed because a harness callback returned a query result instead of `Promise<void>`. The callback now awaits the query; the rerun passed.
7. Independent review found evaluated-DRAFT replay dead-end, local predecessor `+1` collision, and dropped RW-03 Evidence IDs. The accepted bounded rework now maps/replays evaluated drafts to `READY_FOR_REVIEW`, allocates Component-wide `max + 1` while retaining the exact source predecessor, and validates/extracts/postflights exact EvidenceUnit IDs.
8. Final review found that the migration's `created_at,id` backfill order could number a child before its predecessor when transaction-stable timestamps are equal. The backfill is now graph-topological with deterministic UUID-path sibling ordering and a fail-closed postflight assertion. The corrected deliberately adverse populated rehearsal passed on the preserved exact-RW-03 source clone.
9. Restarting this worktree's local Supabase project failed safely because port `54322` was already allocated by another project. That project was not stopped or modified. The already-running PostgreSQL service was used only for a named disposable `learning_foundry_rw04*` database.
10. Exact-RW-03 synthetic fixture seeding first failed closed without `SYNTHETIC_SHOWCASE_MODE`; the flagged retry then stopped because its workflow checkpointer could not set `foundry_checkpoint_runtime`. Product fixture rows written before that checkpoint failure included no existing Component or ComponentVersion.
11. A fixture-only approach that manufactured a Component by suspending `component_active_version_guard` produced a local graph-ordering pass, but PM review rejected that setup as outside the governed safety boundary. It has been removed from the rehearsal script and is not accepted evidence. The retained script requires an existing populated published ComponentVersion and inserts only three governed DRAFT successors without disabling any trigger.
12. PM located the preserved populated exact-RW-03 service at port `55439`. A fresh clone of `learning_foundry_rw03_accept` resolved the fixture blocker without altering the source; the corrected topology rehearsal, 8/8 same-tenant and 8/8 cross-tenant DB harness, compiler and 12 targeted contracts all passed there.
13. PM full-diff review found that the maintenance commands were unexecuted and the first DB harness proved inserts/cross-tenant denial without the promised transition and immutability matrix; it also reused approved publication history for nominal live-review positives. Bounded rework added focused command integration, rollback-only eligible review fixtures, exact legal/illegal lifecycle probes, stale-hash denial and append-only rewrite denials. No schema or product scope was added.
14. PM's first independent Node replay attempts could not reach `127.0.0.1:55439` inside the sandbox (`EPERM`). The approved local-database reruns then passed: focused integration 6/6, targeted contracts 12/12, and the exact RW-04 DB JSON recorded above. This was an environment permission failure, not a product or database denial.
15. The first broad tenant-regression run on a fresh migrated clone failed because its legacy Tenant-B fixture inserted a pre-RW-04 ComponentVersion shell without a canonical `draft_revision_id`; the exact-binding guard correctly denied it. The fixture now creates one exact DraftRevision first, with matching contract/content/hash/source arrays, and binds the compatibility shell. It does not disable a trigger or delete the resulting immutable Class A chain from the explicitly disposable database.
16. The next fresh tenant rerun reached its direct-probe inventory check and failed because the legacy global matrix counted RW-04's eight new writable tables without probing them. Those tables are now explicitly delegated to `test:rw04-db`, just as RW-03's eight canonical tables already were. A third fresh tenant clone passed the corrected legacy matrix; the separate RW-04 harness passed all eight new tables.
17. PM's combined-schema RW-03 replay completed its eight RW-03 probes but failed the final hardcoded `37/37/37` inventory assertion after RW-04 raised the exact grant-derived totals to `45/45/45`. Only those final totals/reporting fields changed; `rw03DirectTables` remains 8. A fresh migrated clone then passed with catalog/grant/guard `45/45/45`, RW-03 positives 8/8, negatives 8/8, one legal lifecycle transition and six immutable rewrites denied.

All failed attempts remain listed; no favorable rerun replaces them.

## Evidence limits and remaining gates

- Local automated closeout results after final bounded rework:
  - `npm run lint`: **PASS**; the subsequently changed tenant fixture file also passed a focused zero-warning ESLint rerun.
  - `npm run check`: **PASS** after the final tenant fixture correction.
  - `npm test`: **PASS**, 31 files / 128 tests.
  - full `npm run test:integration`: **PASS**, 6 files passed + 1 skipped, 44 tests passed + 1 skipped, on fresh `learning_foundry_rw04_broad`.
  - `npm run test:tenant-db`: **PASS** on third fresh migrated clone: 54 catalog rows, 51 tenant-negative tables, 51 worker-negative tables, 29 delegated legacy direct-writable probes, all auth/worker/checkpoint/audit controls reported passing. RW-04's eight tables remain separately covered by the exact harness above.
  - `npm run test:rw03-db`: **PASS** on a fresh migrated compatibility clone: catalog/grant/guard 45/45/45, RW-03 direct tables 8, 8/8 same-tenant, 8/8 cross-tenant, 1 lifecycle positive, 6 immutable rewrites denied. This proves the RW-03 subset remains intact inside the combined inventory; it is not substituted for RW-04 evidence.
  - `npm run test:rw04-db`: **PASS** again on fresh `learning_foundry_rw04_broad_harness`, with the exact 45/45/45 and lifecycle/history matrix recorded above.
  - guarded `npm run test:migration-upgrade`: **PASS** on exact-name disposable database; valid old `0000` shape backfilled and only the non-bindable shell was quarantined. This is the existing `0000` → `0001` compatibility rehearsal, not the reused `0005` topological proof.
  - `npm run legacy:scan`: **PASS**, zero Legacy production imports and all six removed runtime paths absent.
  - plain default `npm run build`: **PASS**, optimized production build and 12/12 static pages generated.
  - `git diff --check`: **PASS** after final rework.
- The corrected populated equal-timestamp `0005` migration proof was reused rather than repeated because its migration/script inputs did not change during broad closeout. The rejected trigger-suspension result remains excluded.
- No browser path was added or validated because RW-04 excludes RW-08/RW-09 UI/editor/review behavior.
- No live provider, managed database, preview, human-governance, production, deployment or cutover evidence exists.
- Open decisions remain private/fail-closed; no public or organisation scope is inferred.
- Database role predicates are not claimed: database guards enforce tenant/user identity and exact lineage; current private application commands enforce `EXPERT`/`ADMIN`. No human acceptance exists under `DEC-002`.
- No Doc 12 row is marked complete or accepted from this foundation or its tests.

## Rollback boundary

Revert application/schema use first. Before any operator-reviewed destructive database reversal, export all new canonical review, revision and maintenance records. Then remove only the additive compatibility links, triggers, policies, grants, catalog rows and eight RW-04 tables in reverse dependency order. Never rewrite historical versions, reviews, decisions, deliveries or outcomes.
