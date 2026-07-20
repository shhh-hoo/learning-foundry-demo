# CAP-06 — Governed Retry / Transfer / Retention package

## Authority and bounded product result

- Immutable authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- Exact starting local evidence head: `c19d4e5646616a2992f1cea7cd08ddb5950f796f`.
- Exact starting local tree: `f240e403933cb242a13a9055983e92aefa30b763`.
- Remote CAP-05 Draft PR #35 evidence head: `7234b29676d87b725671cfdcfd909db3c1d34a48`, recorded by that Draft as the same final tree.
- Branch: `codex/cap-06-governed-retry-transfer-retention`, stacked on the local CAP-05 evidence head and never on stale or dirty `main`.

This package makes bounded partial contributions to `REL-07`, `LEARN-02`, `LEARN-03`, `LEARN-06`, `LEARN-07`, `LEARN-08`, `TEACH-01`, `TEACH-02`, `TEACH-03`, `TEACH-04`, `TEACH-05`, `OUTCOME-01`, `OUTCOME-02`, `OUTCOME-03`, `OUTCOME-07`, `CTX-05`, `CTX-06`, `DATA-02`, `DATA-03`, `DATA-07`, `DATA-09`, `DATA-10`, `SEC-01`, `SEC-05`, `SEC-12`, `OPS-01`, `OPS-03`, `OPS-04`, `OPS-05`, and `OPS-06`. No requirement row is claimed complete or accepted by this package.

The user-visible result is the smallest real Teacher/Learner path in which an authorized course teacher assigns a governed Retry, Transfer, or Retention activity from an exact current TeacherReview; the learner completes the exact planned Capability runtime in a new Episode; and an authorized teacher reviews the resulting DiagnosticObservationProposal. The path records lineage and eligibility evidence only. It does not create a LearningOutcome or make an effectiveness or mastery claim.

## Episode and orchestration decision

Each formal follow-up creates exactly one successor `LearningEpisode` inside the existing `LearningTask`.

- Retry retains the same reviewed issue and Task while creating a distinct planning, runtime, Attempt, proposal, and review chain.
- Transfer keeps the governed issue lineage but requires at least one changed structured discriminator among context, representation, item family, or problem structure. The source signature is visible to the teacher and derived from the exact Task, Attempt modality, Capability key, and implementation key; case and whitespace changes are normalized away. The target remains an authenticated teacher declaration bound through Context, Plan, and runtime, not a machine-proven claim that the learning context was materially different. Prompt wording is not a discriminator and cannot satisfy the contract.
- Retention keeps the governed issue lineage and records a positive declared delay, schedule, assignment-time expected/known intervening exposure, content-equivalence declaration, and assistance policy. Submission before the recorded schedule is rejected. At result review, the course teacher must separately confirm what exposure actually occurred during the delay; that completion-time fact and its actor/time provenance cannot be rewritten.

The successor Episode reuses the existing canonical chain:

```text
source LearnerAttempt
→ source DiagnosticObservationProposal
→ current authorized TeacherReview
→ governed Retry / Transfer / Retention record
→ successor LearningEpisode
→ ContextCompilation
→ CapabilityResolution
→ ActivityPlanProposal
→ ActivityPlan
→ RuntimeDelivery
→ result LearnerAttempt
→ result DiagnosticObservationProposal
→ result TeacherReview
```

The existing `retry_attempts`, `transfer_activities`, and `retention_reviews` Product State are hardened and linked to the canonical objects above. LangGraph owns interrupt/resume mechanics only. No generic follow-up engine, second planner, simulated runtime, seeded decision, or direct-database user substitute is introduced.

## Responsibility and expected change boundary

Expected changes are limited to:

- `domain/` validation for type-specific Retry / Transfer / Retention declarations;
- `application/` authorized activity creation, canonical planning/runtime/result-review linkage, queries, and workflow authorization;
- `workflows/` one governed follow-up graph using the existing Context, Resolution, ActivityPlan, Asset Runtime, Attempt, Diagnosis, and Review services;
- `db/schema.ts` and one additive `0010` migration for exact lineage, authority, idempotency, status, cancellation, and type-specific records;
- bounded `/api/retries` and workflow-resume behavior plus the smallest Learner and Teacher Workspace controls;
- focused unit, workflow, security, PostgreSQL, tenant, upgrade, browser, build, and Legacy evidence;
- this package contract and a later exact-head evidence report.

## Product State and authorization effects

- Only a currently authenticated institution/course `TEACHER` may assign a formal follow-up from a current, eligible, provenance-valid TeacherReview.
- Only an actor carrying the `LEARNER` role whose authenticated user identity is the exact Task learner may submit the assigned successor Episode activity. `ADMIN` alone cannot author or impersonate a formal learner Attempt.
- Only a currently authorized institution/course `TEACHER` may review the result proposal.
- Commands are transactional, actor/tenant scoped, and idempotent. Replay must return the same Product State identities and must not duplicate an Episode, Context, Resolution, Plan, Delivery, Attempt, proposal, or Review.
- An open Task cannot be closed while a governed follow-up is assigned, running, waiting for review, or recoverable. It may close only after that follow-up reaches an allowed terminal state.
- Cancellation is append-only truth on the governed activity and states whether external work may still finish. Cancelling an assigned interrupt is replayable only with the exact immutable reason and also terminalizes its WorkflowRun/product links; runtime cancellation remains the exact RuntimeDelivery terminal fact. An explicit planner/runtime `EXECUTION_ABORTED` is recorded as `CANCELLED`, never as a generic failure.
- Recovery resumes the existing checkpoint and validates the still-current Product State and authorization before any new write.

Database guards independently preserve the same boundary: governed Episode Task/sequence/purpose/predecessor identity is immutable, predecessors must belong to the same Task, status changes follow the bounded state machine, transition actors must be the exact learner or current course teacher for the relevant edge, Legacy rows cannot acquire CAP-06 authority fields, and governed Attempts must carry the exact ActivityPlan/RuntimeDelivery/ActivityPlanProposal chain. Generic learner ConversationEvent, Attempt, and Task-bound file writes cannot be redirected into governed Episodes.

## Hard prohibitions and non-goals

- No `LearningOutcome`, mastery, effectiveness, progression, grade, or task-completion decision.
- No Capability Workshop, capability generation/adaptation, optimization, generic CMS/editor, resource catalogue, preview, deployment, production, cutover, merge, or `main` change.
- No new Task per follow-up and no parallel Context, Resolution, planning, runtime, Attempt, Diagnosis, or Review model.
- No wording-only Transfer, zero/undeclared Retention delay, hidden auto-approval, model-created TeacherReview, fabricated runtime success, or unavailable provider represented as execution.
- No Legacy deletion or new production import from the prohibited Legacy paths guarded by the existing scan.
- No synthetic or browser evidence may be called `HUMAN_VALIDATED`; the inherited `2 pass / 6 fail` contract/eval baseline remains an explicit unrelated non-claim.

## Required Engineering PM evidence

- Diff-first review against `c19d4e5646616a2992f1cea7cd08ddb5950f796f`, including generated or migration changes and absence of unrelated edits.
- Unit/domain proof for type-specific contracts, wording-only Transfer rejection, Retention schedule/assistance declarations, idempotency, cancellation, and no-Outcome behavior.
- Workflow proof for interrupt/resume/replay/recovery and one canonical successor Episode chain per type.
- PostgreSQL proof for exact source/target lineage, immutable target Plan/Delivery/Attempt/proposal/Review binding, cross-tenant and cross-course denial, stale/revoked actor denial, and no fabricated rows.
- Fresh migration and additive `0000`–`0009` → `0010` rehearsal preserving populated historical rows without fabricating formal activities or human decisions.
- Tenant/RLS inventory and direct writable-lineage probes for all new or changed Product State.
- Browser-visible authenticated Teacher assignment → Learner runtime Attempt → Teacher result Review for at least the bounded Retry path, plus visible type-specific Transfer/Retention declaration and denial states justified by risk.
- Lint, type check, production build, Legacy-import scan, and inherited contract/eval result reported without reinterpretation.
- One exact local commit/tree and, if Git-data publishing is required, byte-identical remote tree with both SHAs recorded before one stacked Draft PR is opened against the CAP-05 branch.
