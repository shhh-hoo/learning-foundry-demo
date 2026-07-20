# CAP-06 — Governed Retry / Transfer / Retention evidence

## Checkpoint identity and verdict

- Authority: `learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`.
- Original accepted local CAP-05 evidence head: `c19d4e5646616a2992f1cea7cd08ddb5950f796f`.
- Remote CAP-05 Draft PR #35 evidence head and stacked PR base: `7234b29676d87b725671cfdcfd909db3c1d34a48`.
- The two CAP-05 heads have the same tree: `f240e403933cb242a13a9055983e92aefa30b763`.
- Pre-rebase accepted CAP-06 implementation SHA: `89852dcf96658a767e1d9314fdee82cf93baa7b0`.
- Remote-base-aligned CAP-06 implementation SHA: `28d1ab58ac8f87a18db845d8180df1cca07c5389`.
- Byte-identical CAP-06 implementation tree for both implementation SHAs: `60fbf68df9e09b2921fe8792eeafed6d1e04f76c`.
- Branch: `codex/cap-06-governed-retry-transfer-retention`.
- Engineering PM verdict: **ACCEPT FOR DRAFT INTEGRATION**. This is not merge, preview, release, human-validation, live-provider-validation, Product Owner acceptance or completion authority.

CAP-06 makes bounded partial contributions to the requirement rows listed in the package contract. No row is claimed complete or accepted by this package.

## Real learner and teacher path evidenced

An authenticated current course teacher can start a formal Retry, Transfer or Retention activity only from an exact current eligible TeacherReview. The command creates one successor Episode inside the existing Task and reuses the canonical Context, Capability Resolution, ActivityPlan, exact CapabilityVersion runtime, Attempt, Diagnosis Proposal and TeacherReview chain.

Transfer records the canonical source signature, a materially different teacher-declared target context, the current structured-runtime boundary, a rationale and the explicit limit that target difference is authenticated teacher declaration rather than machine-proven evidence. Retention records positive delay, due time, assignment-time exposure expectation, content equivalence and assistance policy; learner execution before due time is rejected, and the final teacher separately records actual intervening exposure.

The learner sees the immutable contract and only the exact planned CapabilityVersion. A later active version is not substituted for a stale plan. After execution, both learner and teacher surfaces retain reviewed, escalated, failed-final and cancelled history, terminal reasons and the result TeacherReview support.

Browser command keys remain stable across uncertain responses and rotate only after confirmed success. An exact learner or teacher workflow-resume retry after a committed-but-lost response returns the original RuntimeDelivery, Attempt, Diagnosis Proposal or TeacherReview identities from a persisted workflow receipt before lease acquisition or graph execution. Changed actor, tenant, thread, version, key or payload is rejected, current learner/teacher authority is rechecked, and failed or cancelled lineage cannot be revived.

The path deliberately stops at a human result Review. CAP-06 creates no LearningOutcome, mastery, effectiveness, grade, progression or Task-completion claim.

## Product State, upgrade and database evidence

- Migration `0010` adds exact activity, Episode, ContextItem, source/result lineage, transition, cancellation/failure, type-specific contract and actor-scoped idempotency authority while preserving pre-CAP-06 rows as Legacy facts.
- Exact populated upgrade rehearsal from migrations `0000`–`0009` through `0010` passed with 75 direct PostgreSQL rejection cases and zero LearningOutcome rows.
- Every CAP-06 Transfer or Retention must commit with exactly its matching `CAP06_V1` extension; Retry cannot acquire either typed extension.
- Every governed envelope and `CREATE_GOVERNED_FOLLOWUP` reservation is bound in both directions by tenant, actor, request hash and result identity. Missing, orphan, Legacy-target, mismatched and rewritten reservations fail at deferred commit while reservation-before-activity transaction order remains valid.
- Live activity states require the exact active governed ContextItem. Reviewed, escalated, cancelled and failed-final states require exact terminal Context invalidation provenance, reason and time.
- Result Review author, actor provenance, transition actor, current institution/course TEACHER authority and decision/status alignment are revalidated at deferred commit. Post-commit author, provenance or decision mutation fails.
- Direct generic ConversationEvent, LearnerAttempt and Task-bound file writes cannot bypass the active governed Episode/runtime boundary.
- Tenant/RLS harness passed with 54 authority-catalog rows, 51 tenant-negative tables, 51 worker-negative tables, 37 writable-lineage catalog rows and all 37 direct writable-lineage probes. Retry, Transfer and Retention probes target exact Legacy fixtures and accept only their tenant-lineage denial.

## Verification bound to the implementation tree

- Static: `npm run lint`, `npm run check` and `git diff --check` passed.
- Unit/workflow/security: 41 files, 189 tests passed.
- Focused CAP-06 PostgreSQL integration: 9/9 passed, including exact assignment/runtime/result-review replay and lost-response workflow-resume replay with no duplicate Product State.
- Full PostgreSQL integration ran twice against a clean guarded E2E database; each run passed 63 tests with one intentional skip.
- Production build passed and exposed only the bounded follow-up and existing workflow-resume routes needed by this package.
- Full browser automation passed 21 tests with five intentional mobile skips. The desktop CAP-06 journey authenticated the teacher and learner, created and executed the real successor-Episode Retry path, completed the result TeacherReview, showed durable history on both surfaces and confirmed zero LearningOutcome rows.
- Legacy scan passed: zero Legacy production imports and all six prohibited removed runtime paths remained absent.
- Inherited contract/eval baseline remained exactly 2 pass / 6 fail. CAP-06 does not reinterpret the pre-existing Context/retrieval/historical Component expectations as package failures or successes.
- A fresh independent final release-gate review found no remaining P0 or P1 in the exact implementation diff and returned `ACCEPT FOR DRAFT INTEGRATION`.

## Explicit non-claims and remaining limits

- Browser automation uses explicitly gated synthetic showcase identities and data. It is not `HUMAN_VALIDATED` and does not substitute for Product Owner acceptance.
- No live provider, online preview, deployment, production, merge, `main` change, Legacy deletion or cutover is claimed or authorized.
- Transfer and Retention have browser-visible immutable contracts and denial states, while the end-to-end browser execution evidence is the bounded Retry path. Their complete execution paths are PostgreSQL/application evidence in this package.
- CAP-06 does not add capability adaptation/generation, Capability Workshop, asset/routing/strategy optimization or a complete product journey.

Next package: **CAP-07 — Capability Gap and Supply**, beginning with a real resolver no-match or repeated-failure signal and preserving the orchestration-first, non-CMS authority.
