# CAP-07 — Capability Gap and Supply evidence

## Checkpoint identity and verdict

- Documentation authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- Exact stacked base / CAP-06 Draft PR #36 evidence head: `f6af67bbf0ffafc9cc5e1671266cdb97cd474af0`.
- Accepted CAP-06 implementation checkpoint: `28d1ab58ac8f87a18db845d8180df1cca07c5389`.
- Branch: `codex/cap-07-capability-gap-supply`.
- CAP-07 implementation SHA: `1136f9330002bb1d2d68b38c6bbb3ac8b0f3cdf1`.
- CAP-07 implementation tree: `4cb3e745d088b9d313f5776e68730f859e73f4e8`.
- Evidence head: the commit containing this evidence-only file; report its exact SHA and tree with the stacked Draft PR checkpoint.
- Engineering PM verdict: **ACCEPT FOR DRAFT INTEGRATION**. Three independent final product, database and runtime gates reported no current P0 or P1 against the accepted diff.

This verdict authorizes only a bounded stacked Draft PR. It is not a merge, deployed or production-like preview, Product Owner acceptance, human validation, live-provider validation, release acceptance, production deployment or cutover decision.

## Exact requirement contribution

CAP-07 makes bounded partial contributions to `REL-04`, `REL-05`, `REL-08`, `REL-09`, `REL-11`, `REL-12`, `REL-14`; `LEARN-02`, `LEARN-03`, `LEARN-07`, `LEARN-08`; `CAP-01`–`CAP-07`, `CAP-09`–`CAP-11`, `CAP-13`, `CAP-15`, `CAP-16`; `DATA-01`, `DATA-02`, `DATA-04`, `DATA-07`, `DATA-09`, `DATA-10`; `SEC-01`, `SEC-06`–`SEC-10`, `SEC-12`; `EVAL-01`, `EVAL-02`, `EVAL-05`, `EVAL-08`; and `OPS-01`–`OPS-03`, `OPS-05`–`OPS-08`.

No requirement row is claimed complete or accepted by this package. In particular, the asset is deliberately stateless and one-shot: CAP-07 proves bounded retry, cancel, timeout and honest failure behavior but makes no pause, reset or resume claim.

## Learner- and expert-visible product result

The browser journey begins with a real persisted CAP-02 `ADAPT` decision and `ADAPTATION_REQUIRED` gap signal plus the matching latest CAP-03 `BLOCKED` plan. It does not reinterpret a generation-forbidden `NO_MATCH` decision as permission to generate.

Capability Workshop shows that exact need and creates one canonical course-private Web `ComponentAsset` proposal. The authenticated expert runs canonical checks, executes one exact learner preview with an intentionally incorrect choice, reloads the Workshop and still sees the persisted selected choice and label, `correct: false`, retry feedback, shared-executor receipt identity and ordered event trace. The UI states that this one persisted exact preview is the approval gate. An authenticated expert then makes an explicit confirmation; no workflow, model, seed or browser script auto-approves it.

The confirmation transaction publishes and registers the exact version only after checks, preview, current course authority, source-gap freshness, bounded eligibility, privacy validation and exact lineage pass. It then re-resolves the protected source need and persists the exact selected version plus a `READY` plan before availability can commit. The learner receives that exact version through the existing CAP-04 `ActivityPlan → RuntimeDelivery → LearnerAttempt → LearningEvent` path.

The browser aborts the real Asset Runtime API request, reloads durable `CANCELLED` and normalized failure evidence, and uses the one bounded ordinary-form retry. The successful retry uses the same exact incorrect input as the preview; persisted preview and delivery outputs match, including the same retry feedback and event semantics. Only the successful delivery displays completion evidence. Neither preview nor delivery creates a Diagnosis, TeacherReview, LearningOutcome, mastery or effectiveness claim.

## Genuine source Web ComponentAsset and de-identified lineage

The source is not merely a callable adapter label. The synthetic Reference Pack contains a reviewed, published, course-private Web `ComponentAssetVersion@1.0.0` named **Percentage yield source check**, with an immutable declarative executable package, three real choices, reviewed correct relation, retry feedback, event contract, runtime contract and exact content hash. Its linked active `CapabilityVersion` is the exact eligible CAP-02 adaptation candidate.

The adapted package embeds and executes that exact source contract/package behavior, verifies its source content hash, retains the exact source Capability, CapabilityVersion, ComponentAssetVersion and both content hashes, and adds only the declared `SOURCE_BEHAVIOR_WITH_DIAGNOSTIC_SCAFFOLD` feedback transformation. A changed, inactive, ineligible, wrong-course or hash-mismatched source fails closed.

Learner-specific `capabilityResolutionId`, `activityPlanProposalId` and `diagnosticObservationId` remain in protected supply-lineage Product State. They are absent from the registered `CapabilityVersion` contract and matching metadata. Privacy/de-identification checks run after the complete registry contract is assembled. The final eligibility is bounded to the authorized institution, course, Reference Pack, task type, learner level, curriculum, English language, interaction mode and declared accessibility contract; no wildcard eligibility is registered. Re-resolution uses the protected `capability_supply_relations` row rather than embedding learner diagnosis identity in the reusable Registry contract.

## Product State, transaction and replay behavior

Migration `0011_capability_gap_supply.sql` and matching Drizzle schema:

- add course scope and exact `ComponentAssetVersion` linkage to Capability Registry state;
- add immutable Component source/supply/adaptation/registration lineage;
- add bounded retry lineage and attempt number to `runtime_deliveries`;
- add canonical `component_asset_previews`, `capability_availability_decisions` and protected `capability_supply_relations`;
- bind evaluation, exact preview, publication, registration, availability, targeted re-resolution and `READY` planning at the database boundary;
- keep LangGraph checkpoints as Class C workflow mechanics rather than canonical Product State.

The database enforces one proposal per exact source `capabilityResolutionId`. Proposal, preview, component lifecycle and Asset Runtime commands use stable actor-scoped keys, request hashes and in-flight locks. Concurrent same-key preview calls reserve or reread one canonical result rather than surfacing a uniqueness race. Replays validate actor, tenant, course, thread, expected version, payload/hash and current authority.

Component lifecycle reconciliation checks canonical receipts before and after graph execution. A crash or lost response after evaluation, preview, publication, registration or replan returns the existing canonical identities; it cannot checkpoint past rolled-back Product State. Failed or cancelled runs do not revive. Source freshness is rechecked under lock against the latest Task/Episode resolution and plan immediately before confirmation.

Publication completeness is deferred to transaction end. A Web ComponentAsset `APPROVE` decision or `DRAFT → PUBLISHED` transition cannot commit without its exact authenticated preview, evaluation, Registry version, availability decision, protected supply relation, fresh selected resolution and `READY` plan. Failure injection proved the transaction rolls back rather than leaving a stranded available version. Registry availability alone is never rendered as `READY`.

Asset Runtime cancellation and timeout are reconciled after the workflow stop so the terminal `RuntimeDelivery`, `LearnerAttempt` and ordered events commit before the API returns its post-commit error. Reload shows `FAILED`, `TIMED_OUT` or `CANCELLED` honestly. A delivery permits at most one bounded retry; stable replay does not create another delivery or attempt.

## Three-process executor authority boundary

The local/browser proof runs three separately started application processes: the synthetic OIDC identity provider, the Next.js product web process, and the bounded Component Executor service. PostgreSQL remains the canonical Product State service behind distinct runtime roles.

The product web process receives only the executor endpoint and internal request token. Its configuration rejects `COMPONENT_EXECUTOR_DATABASE_URL`; it neither loads the executor database credential nor exports a raw privileged SQL callback. Product code may send only canonical actor, course, component/version/hash, selected-choice and idempotency facts. Strict endpoint schemas reject caller-supplied checks, output, trace, status or receipt.

The separate executor process alone receives the dedicated database credential. It reloads institution membership, course enrollment, immutable ComponentAssetVersion, exact hash and package; runs the shared hash-bound executor and fixed checks; constructs checks/output/trace/receipt itself; and appends through the narrowly scoped `foundry_component_executor` role. That `NOLOGIN NOINHERIT` role is not a member of `foundry_product_runtime`, has no generic table-write grant and can execute only the two bounded Web Component evaluation/preview append functions with their exact purpose setting. The ordinary product role cannot call either function even with structurally valid fabricated evidence.

Preview and CAP-04 delivery use `cap-07.shared-web-executor.v1`, the same package parser, content-hash verification, input validation, learner behavior, feedback and ordered event semantics. The executor service does not provide generic RPC, queue, arbitrary package or caller-defined evidence behavior.

## Authorization, course privacy and database negatives

Application commands and resume paths require current institution membership, `TEACHER`/`EXPERT` role where applicable and exact `component.courseId` access. An expert authorized for course A cannot preview, resume, confirm, register or read a course-B private component even when they know its component, version or workflow identifiers.

`INSTITUTION_COURSE_PRIVATE` RLS follows the complete Capability, CapabilityVersion, Component, ComponentVersion, evaluation, preview, availability and supply parent chain and requires current-user course enrollment. Separately scoped global Registry rows remain readable. Correlated parent checks qualify the outer row explicitly; malformed cross-course parent/child chains remain invisible and unwritable. Current session user, institution, session, auth method, roles and course IDs are bound to actor provenance.

Focused clean-install negatives under `SET LOCAL ROLE foundry_product_runtime` prove:

- an enrolled course reads all 7/7 private chain row classes, another course reads 0/7, and global Registry rows remain readable;
- direct or service-function forged `PASSED` evaluation and `SUCCEEDED` preview evidence are rejected;
- the trusted executor positive path succeeds while product-role evaluation/preview execute privileges are both false and executor privileges are true;
- direct partial publication rolls back and the version remains `DRAFT`;
- direct lineage rewrites, registration swaps, stale source confirmation, cross-course confirmation and malformed parent writes fail;
- both tested course views read 0/3 malformed parent rows.

## Verification bound to the implementation tree

- Diff hygiene: the full tracked/new-file inventory was reviewed; `git diff --check` and staged `git diff --cached --check` passed. `next-env.d.ts`, Supabase generated markers, Graphify output and temporary pointer diagnostics were absent.
- Exact-checkpoint static rerun: `npm run check` and `npm run lint` passed after implementation commit creation.
- Unit/workflow/security: 45 files / 209 tests passed after implementation commit creation.
- Focused CAP-07 authority boundary: 4 files / 27 tests passed.
- Focused CAP-07 supply plus Asset Runtime PostgreSQL integration: 2 files / 9 tests passed.
- Full PostgreSQL integration on the clean guarded fixture: 12 files passed and 1 was intentionally skipped; 67 tests passed and 1 was intentionally skipped. One inherited CAP-06 retention database-clock assertion failed once in an earlier full invocation, passed its isolated 9/9 rerun, and the subsequent clean full rerun passed 67/1; no CAP-07 change was hidden by that rerun.
- Clean install and schema parity: migrations `0000`–`0011` plus Drizzle parity passed. The CAP-07 harness reported 13 direct negative cases, 7/7 authorized private reads, 0/7 wrong-course reads, global readability, forged-evidence rejection, partial-publication rollback, product-role evaluation/preview execute `false/false`, executor execute `true/true`, and malformed-parent visibility `0/3` for both courses.
- Tenant/RLS harness: 57 authority-catalog rows, 56 tenant-negative tables, 56 worker-negative tables, 37 writable-lineage catalog rows, all 37 direct probes, 5 production-login contracts, clean role teardown, product-role evaluation/preview execute `false/false`, executor execute `true/true`, and executor generic table write `false`.
- RW-03 canonical database regression: 37 catalog / 37 actual / 37 guarded writable tables, 8 same-tenant positives, 8 cross-tenant denials, 1 lifecycle case, 6 immutable-rewrite denials and exact Context lineage passed.
- Production build: `npm run build` passed with Next.js 16.2.10.
- Focused browser: 1/1 desktop CAP-07 journey passed.
- Full browser: 22 passed and 6 intentional mobile duplicates were skipped. Those skips are the explicitly desktop-only OIDC callback, two stateful checkpoint journeys, CAP-05 teacher command, CAP-06 follow-up and CAP-07 supply journey; mobile authenticated-surface coverage remains in the suite.
- Browser CAP-07 evidence includes the real gap, real source adaptation, exact evaluation, persisted incorrect preview after reload, normal accessible clicks, expert confirmation, Registry/replan, actual API cancellation, reload-visible terminal evidence, one retry, exact preview/delivery input-output parity and unchanged TeacherReview/LearningOutcome counts.
- Legacy boundary: `npm run legacy:scan` passed after adding the separate executor directory to the production-import scan.
- Final review: independent product, database and runtime reviewers each returned no current P0/P1; the Engineering PM then issued `ACCEPT FOR DRAFT INTEGRATION`.

No dependency version or lockfile changed. The existing lockfile-backed installation was used; `npm ci` was not rerun for this package and is not claimed as new CAP-07 evidence. The inherited framework contract/eval baseline remains 2 pass / 6 fail and was not reclassified or used to claim CAP-07 failure or success.

## Disposable Graphify evaluation

The repository-local disposable Graphify evaluation produced 1,222 nodes, 2,922 retained edges and 78 communities, but also 306 dangling semantic edges, one self-loop and 28 same-endpoint collapses. Broad queries expanded to 147–396 nodes and still required 13 direct source-file reads plus additional graph calls.

| Required criterion | Result | Evidence |
|---|---|---|
| 1. True entrypoints | Pass | It identified real application entrypoints. |
| 2. ComponentAsset recognition | Pass | It recognized the repository's Component Asset concepts. |
| 3. Complete conversation-to-component chain | Fail | It did not recover the complete production chain. |
| 4. Correct React / Supabase-or-Edge-if-present / database connections | Fail | Cross-stack relationships were incomplete and could not be trusted as authority. |
| 5. Materially more accurate Codex modification planning | Fail | It did not improve the active plan and increased graph calls plus raw-file reads. |

Score: **2/5 — REJECT**. Graphify and its disposable `uv` tool installation were removed, `graphify-out/` is absent and ignored, and no generated index is committed. Graphify was never treated as product or architecture authority.

## Intentional skips, non-claims and remaining limits

- The source, users, identities, expert confirmation and learner journey are synthetic showcase evidence. The authenticated expert command proves the authority boundary but is not `HUMAN_VALIDATED`.
- One exact incorrect-choice preview is the bounded approval gate. This package does not add a generic preview lab, arbitrary input runner or CMS editor.
- The Web ComponentAsset is declarative, trusted, English and `STATELESS_ONE_SHOT`. It makes no pause, reset, resume, multilingual, arbitrary-code sandbox or provider-execution claim.
- The package proves `ADAPT` only. It does not claim parameterization, composition, generation or automatic strategy selection beyond the persisted CAP-02 priority decision.
- No live provider, non-Chemistry generalization, production-like online preview, accessibility audit by a human, performance threshold, real learner data, pilot effectiveness or production-hardening evidence is claimed.
- The internal exact preview is browser-validated product behavior; it is not the Doc 12 `PREVIEW_VALIDATED` dimension for an online deployed environment.
- No disable/rollback user journey or database down migration was rehearsed. Exact-version history is preserved; before merge, code rollback would require an authorized revert of the implementation commit and separate evidence correction.
- No generic CMS, giant metadata editor, standalone publishing workbench, Legacy deletion, `main` change, merge, deployment, preview approval, production-state change or cutover occurred or is authorized.

The next dependency is a separately bounded capability/asset, routing or learning-strategy optimization package driven by exact governed runtime and eligible reviewed Outcome evidence. CAP-07 itself does not make that optimization decision.
