# RW-04 package contract — canonical review and Component lifecycle foundation

Status: **PM ACCEPTED FOR DRAFT REVIEW — UNMERGED — NOT PRODUCT OWNER ACCEPTED — NOT PRODUCTION READY**

## Authority and stack

- Exact implementation base: `learning-foundry-demo@b981f88cf2bf93fc9d1c0b1e7cdf34ef6c74984d` (RW-03 Draft PR #26 head).
- Product/architecture authority and current 113-row Doc 12 evidence binding: `learning-foundry-docs@c77132314e385308c9a49fd0b5af5ed720d420a3`.
- Doc 06 exclusively owns canonical names and authority classes; Doc 08 owns Component lifecycle semantics. Open `DEC-001`, `DEC-002`, `DEC-006`, `DEC-007`, and `DEC-012` remain fail-closed. RW-04 grants no public, organisation, cross-institution, or implicit approval authority.

## Exact requirement binding

| Doc 12 IDs | RW-04 schema/compatibility foundation | Required invariant and evidence | Non-claim |
|---|---|---|---|
| `COMP-09` | `ComponentReviewAssignment` | exact Component + draft revision/hash, assigned actor/reviewer/scope/time/conflict state; database tenant/user lineage; append-only subject identity | current private application command requires `EXPERT`/`ADMIN`, but no completed database reviewer-role policy or reviewer-policy acceptance while `DEC-002` is open |
| `COMP-10` | `ComponentReviewComment` | exact revision and field/block target, author/time, reply/resolution lineage; immutable discussion records | no review UI/editor flow |
| `COMP-11` | `ComponentChangeRequest` + immutable successor `ComponentDraftRevision` | requested change binds exact revision/hash; response creates a deterministic successor revision; stale approvals do not apply | no full resubmission UI/workflow |
| `COMP-12` | `ComponentReviewDecision` | current private `EXPERT`/`ADMIN` application command binds an exact assignment, revision and content hash with actor/time/reason/idempotency; database enforces tenant/exact lineage and append-only history | no database reviewer-role or unresolved approver/separation policy claim; no human acceptance evidence |
| `COMP-13` | existing `PublicationDecision` and published `ComponentVersion`, canonically linked to the exact draft revision/review decision | publication remains human-command-only, exact-hash bound and fail-closed; published snapshots immutable | private internal checkpoint only; no public/organisation publication acceptance |
| `COMP-18` | `ComponentDraftRevision` and existing `ComponentVersion.successorOfVersionId` | stable IDs, monotonic revision lineage, same-Component predecessors, immutable prior content, deterministic backfill | no editor UX |
| `COMP-19` | `ComponentDeprecationDecision` and `ComponentDisableDecision` | private application command requires `EXPERT`/`ADMIN`; database binds actor/time/reason, legal transition and exact target/successor where required without history rewrite | no database maintenance-role policy, human acceptance, maintenance UI or Registry-selection implementation |
| `COMP-20` | `ComponentRollbackDecision` plus existing active-version pointer behavior | exact previous/target published versions, actor/time/reason/idempotency; future pointer changes only; versions/reviews/deliveries remain unchanged | no deployment rollback or operational cutover |
| `DATA-01`, `DATA-02`, `DATA-06`, `DATA-07` | explicit physical-name mapping for existing `components`, `component_evaluations`, `component_versions`, `publication_decisions`, and `component_deliveries`, plus the new canonical objects | Class A/B ownership, exact actor/scope/version lineage, append-only/immutable facts, canonical glossary mapping, deterministic replay/backfill | schema presence does not complete any ledger row |

Authority classes are fixed by Doc 06: `Component`, `ComponentDraftRevision`, review assignment/comment/change request/decision, immutable published `ComponentVersion`, publication/deprecation/disable/rollback decisions, and `RuntimeDelivery` are Class A. Existing `component_evaluations` is the physical `ComponentEvaluationRun` Class B record. Registry search/index and Component selection are outside RW-04.

Database enforcement in RW-04 is limited to tenant/user identity, exact object lineage, lifecycle legality and immutability. Current private application commands separately require `EXPERT`/`ADMIN` for publication and maintenance. That application gate is not evidence of an accepted database reviewer-role policy or human-governance acceptance under open `DEC-002`.

## Implementation boundary

1. Add only the canonical review/lifecycle tables and the smallest compatibility columns/guards required to bind current Component candidate, evaluation, publication, successor, delivery, and rollback behavior to them.
2. Preserve current table identities and existing product behavior. Pre-publication `component_versions` rows may remain compatibility shells, but every authored content state must be represented by an immutable `ComponentDraftRevision`; published rows are immutable `ComponentVersion` snapshots.
3. Reuse RW-03 IDs (`SourceAssetVersion`, `EvidenceUnit`, `ContextItem`) by reference where current content/lineage supplies them. Do not copy those objects or create a second Evidence/Context model.
4. Existing create/update/evaluate/decide/rollback/deliver commands may receive narrow compatibility changes. Internal lifecycle commands are allowed only if required to make deprecate/retire/disable transitions executable and testable; add no route or UI.
5. Extend RW-02 authority and writable-lineage catalogs only for new runtime-writable tables. Product runtime may receive only required grants; worker/auth/checkpoint authority must not widen.
6. Migration `0005` must preflight inconsistent legacy rows, deterministically backfill exact current draft/evaluation/publication/rollback lineage, preserve original rows, and fail closed rather than invent a winner or approver.

## Acceptance and required evidence

- Diff-first PM review of every changed file, migration, trigger, grant, lifecycle transition, and compatibility path.
- Populated `0000`–`0004` → `0005` upgrade rehearsal from the exact RW-03 base, including current component candidate/evaluation/publication/delivery/rollback rows.
- Direct database same-tenant positives and ordinary A/B negatives for every new runtime-writable table; grant-derived writable inventory must exactly equal catalog entries and attached guards.
- Exact tests for immutable revision/comment/decision/history, legal and illegal lifecycle transitions, stale-hash approval denial, deterministic successor lineage, replay/idempotency, and rollback/history preservation.
- Existing Component Asset Loop compatibility plus proportionate full unit, integration, security/tenant, lint, typecheck, default production build, and `git diff --check`.
- Retain failed attempts. Evidence must distinguish local database/tests from browser, live-provider, preview, human, managed-database, and production evidence and bind only the exact implementation SHA after PM review.

## Explicit exclusions and rollback

No RW-05 Context Compiler, RW-06 multimodal processing, RW-07 learning-loop behavior, RW-08 UI/editor, RW-09 review UI/workflow beyond compatibility, RW-10 Registry/Retrieval/selection, Inspector/Eval UI, Graphify, production security hardening, preview, deployment, merge, or cutover.

Rollback is one authorized revert of the bounded RW-04 implementation plus an operator-reviewed reversal of additive tables, compatibility columns, triggers, policies, grants, and catalog rows. Export new canonical-only records before any destructive database rollback; never rewrite historical versions, reviews, decisions, deliveries, or outcomes.
