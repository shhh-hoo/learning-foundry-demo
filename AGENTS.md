# Learning Foundry Rewrite — Repository Instructions

## 1. Authoritative documentation

The product and architecture source of truth is:

`learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1`

Read in this order before implementation or review:

1. `docs/00-current-mvp-contract.md`
2. `docs/21-learning-loop-and-outcome-contract.md`
3. `docs/08-asset-and-component-lifecycle.md`
4. `docs/06-storage-and-data-lifecycle.md`
5. `docs/01-product-definition.md`
6. `docs/02-product-surfaces-and-user-journeys.md`
7. `docs/03-system-architecture.md`
8. `docs/04-context-architecture.md`
9. `docs/05-evidence-and-retrieval.md`
10. `docs/07-learner-model-goals-and-pedagogy.md`
11. `docs/09-eval-and-governance.md`
12. `docs/17-build-buy-partner-and-external-components.md`
13. `docs/20-full-framework-rewrite-and-cutover.md`
14. `docs/15-human-development-handoff.md`

After normative authority, use these operational records without allowing them
to redefine product scope:

15. `docs/11-demo-and-implementation-status.md`
16. `docs/12-docs-demo-traceability.md`
17. `OPEN_QUESTIONS.md`

Authority order:

```text
Current Showcase Release Contract
> Product Definition
> Product Surfaces and User Journeys
> Learning Capability and Component Asset Contract
> Learning Loop and Outcome Contract
> Context, Evidence, Data and Eval contracts
> accepted ADR
> operational evidence / decision document
> historical or superseded document
> implementation prose, prompt or fixture
```

Historical Docs 13 and 16 and superseded Docs 14, 18 and 19 do not control
current implementation.

The completed PR #22 audit is historical exact-head evidence at
`b6f023fe995e44e714bf5da2c2096128e1def9fe`. Its retained artifacts preserve
the observations and requirement interpretation that existed when the audit
ran. The superseded 113-row ledger and `COMP-*` evidence do not map
mechanically to current `CAP-*` requirements and grant no current completion,
acceptance, authority switch, Legacy deletion, merge, preview, release,
production or cutover.

## 2. Operating model

```text
Shijia Hu
= Product Owner

ChatGPT / Work
= Engineering Project Manager and docs maintainer

Codex
= implementation team
```

The Product Owner has already defined the product. Do not ask the Product Owner to restate requirements, forward diffs or logs, manage branches, interpret tests or coordinate ordinary engineering work.

The Engineering PM owns work decomposition, sequencing, diff review, testing, rework, integration and product-status reporting.

Codex implements bounded work packages issued by the Engineering PM.

## 3. Historical checkpoint versus current work packages

The audited PR #22 checkpoint is preserved on:

`rewrite/full-framework`

Its historical base is preserved as:

`archive/legacy-wave1-6734b2f`

Neither branch name is current product authority. The current Engineering PM
must issue separately bounded, reviewable and independently revertible work
packages against the accepted documentation authority.

Important distinction:

```text
internal engineering decomposition
= required

partial Product Owner delivery presented as completion
= prohibited
```

Do not independently interpret this repository instruction as “build everything before review.” Each assignment must be bounded, reviewed and integrated by the Engineering PM.

A technically narrow work package is valid only when it maps to a complete-product requirement and does not redefine product scope.

Do not claim product completion from scaffolding, one graph, one Workspace, a schema, a seed flow, test count or a partial E2E path.

Do not change `main`, delete Legacy, merge, grant preview approval, deploy,
alter production or cut over without explicit Product Owner authorization.

## 4. Product core

Learning Foundry is an AI Learning Orchestration Platform.

It must connect:

```text
Task / Goal and authorized Context
→ Context Compiler
→ Evidence Retrieval
→ Diagnosis Proposal
→ Capability Resolution
→ ActivityPlan
→ exact Capability / Component Asset runtime
→ LearningEvent and LearnerAttempt
→ Teacher intervention where required
→ Retry / Transfer / Retention
→ governed LearningOutcome
→ asset, routing and learning-strategy optimization

Capability Supply / Optimization Loop (subordinate)
need or no-match
→ reuse
→ parameterize
→ compose
→ adapt
→ generate
→ checks and Eval
→ authorized teacher/expert confirmation
→ scoped availability
→ exact-version runtime evidence
→ improve, disable or roll back
```

`ComponentAsset` means an executable, interactive or orchestratable learning
tool or experience. A document, article, page, PDF, video or content entry is
not a Component Asset merely because it is stored or published.

Never collapse these distinct concepts:

```text
SourceAsset
≠ EvidenceUnit
≠ ExternalLearningResource
≠ ComponentAsset

Evidence Retrieval
≠ Capability Resolution
≠ Component Asset Runtime

LangGraph checkpoint state
≠ canonical Product State
```

The generic CMS, giant manual field editor, standalone publishing workbench and
CMS-style editorial workflow are superseded directions and must not be rebuilt.

## 5. Required product surfaces

### Learner Workspace

- authenticate and access authorized courses;
- create, continue, switch and close Learning Tasks;
- hold Task-scoped continuous conversations;
- submit text, images, diagrams, charts, questions and learner work;
- receive context-aware, Evidence-grounded support with citations;
- execute published Components and governed Capabilities;
- submit Learner Attempts;
- receive explainable DiagnosticObservationProposals and feedback;
- use Library and Schedule;
- complete Retry, Transfer and Retention activities;
- inspect learning history and Outcomes.

### Teacher Workspace

- inspect Task, original Evidence, Attempt and Observation;
- accept, correct, supplement, reject or escalate Diagnosis;
- edit learner support;
- interrupt and resume workflows through authorized human action;
- create linked Retry, Transfer and Retention activities;
- review new results before Outcome;
- inspect learner/class patterns;
- submit effective support or maintenance signals to Foundry.

### Capability Workshop

- inspect demand, no-match and weak-outcome signals;
- search and inspect machine-callable Capability Registry entries;
- compare candidate eligibility, exclusions, rationale and evidence maturity;
- reuse, parameterize, compose, adapt or generate a bounded capability proposal;
- preview the exact learner runtime behavior;
- run contract, safety, rights, accessibility and versioned Eval checks;
- require authorized teacher/expert confirmation before scoped availability;
- inspect exact-version runtime, Attempt, Review and Outcome evidence;
- improve, supersede, deprecate, disable and roll back without rewriting history.

The Workshop is need-driven and AI-assisted. It is not a generic CMS or a
complete manual metadata workbench.

### Engineering / Evaluation

- inspect LangGraph execution, interrupts, checkpoints and resume;
- inspect Product State separately from runtime state;
- inspect Context inclusion/exclusion;
- inspect Evidence retrieval and Capability Resolution candidates and decisions;
- inspect model, tool, Capability and exact ComponentAssetVersion execution;
- inspect token, latency, cost, retry and failures;
- run product, retrieval, Diagnosis, pedagogy, capability and security Eval;
- inspect authorization and tenant isolation;
- retain failure evidence and explicit non-claims.

## 6. Technology and ownership

Use the approved direction unless an assigned work package proves a concrete blocker:

- Next.js and React;
- LangGraph JS;
- PostgreSQL canonical Product State;
- separate LangGraph checkpoint namespace;
- Drizzle migrations;
- Zod boundaries;
- mature authentication behind Foundry authorization;
- mature lexical/vector hybrid retrieval with fusion/reranking;
- at least one genuine multimodal Evidence path;
- Object Storage for original files;
- OpenTelemetry-compatible observability;
- mature Eval infrastructure where useful.

LangGraph owns workflow mechanics. Foundry application/domain code owns learning semantics, authorization, Evidence authority, human governance, Component policy and canonical writes.

Do not recreate commodity orchestration, provider translation, vector plumbing, auth, object storage or observability without a documented Build / Adopt / Partner reason.

## 7. Canonical Product State

Persist formal records for at least:

- User and InstitutionMembership;
- Course and Subject;
- LearnerProfile and relevant assessment/context records;
- LearningTask and LearningEpisode;
- ConversationEvent;
- SourceAsset and derived processing records;
- EvidenceUnit and source/version/rights records;
- LearnerAttempt;
- DiagnosticObservationProposal;
- TeacherReview and correction history;
- RetryAttempt, TransferActivity and RetentionReview;
- LearningOutcome;
- LearningCapability, CapabilityVersion and RegistryEntry;
- capability candidates, exclusions, selection and no-match records;
- ComponentAsset proposals and immutable ComponentAssetVersion runtime contracts;
- capability checks, Eval, confirmation and scoped-availability decisions;
- ActivityPlan, RuntimeDelivery, LearningEvent and exact-version lineage;
- adaptation, generation, supersession, disable and rollback decisions.

TeacherReview, LearningOutcome and capability confirmation/availability
decisions require authorized human commands. Model or workflow output may
propose but cannot create them.

Canonical writes require authorization, transactions and idempotency. Workflow replay must not duplicate product records.

## 8. Context, Evidence and selection

The Context Compiler must record active Task/Episode, candidates, selections, exclusions, reasons, carryover relations, stale/superseded handling and token/modality budgets.

Concrete prior-Task entities and values are excluded unless a valid explicit relation permits carryover.

Evidence intake must preserve original source identity, content hash, version, locator, rights, ownership, institution scope and processing lineage.

Evidence Retrieval must support lexical and vector candidate generation, fusion/reranking, multilingual behavior and a genuine visual/multimodal path.

Capability Resolution must consider learner eligibility, Task, curriculum,
language, modality, permissions, availability scope, contraindications,
teacher requirements/exclusions and exact active version. Record candidates,
exclusions, rationale, selected version or explicit no-match.

External resource launch is not native Component Asset execution and cannot
directly create Diagnosis, TeacherReview, LearningOutcome or a capability
confirmation/availability decision.

## 9. Legacy and migration authority boundary

PR #22's exact-head audit records historical implementation and deletion facts;
it is not permission to delete or replace Legacy. No current work package may
delete Legacy paths, perform canonical schema/data migration, switch runtime
authority, merge or cut over unless the Product Owner grants that boundary after
the applicable documentation decision and evidence review.

Preserve PR #22 head `b6f023fe995e44e714bf5da2c2096128e1def9fe`
as immutable historical evidence. Changes after it must be separately bounded
and revertible; do not rewrite the checkpoint or use a passing scan/test as an
authority decision.

## 10. Work-package contract

Every Codex assignment must state:

- mapped product requirement and user-visible result;
- exact branch and responsibility boundary;
- files/services expected to change;
- Product State and authorization effects;
- prohibited Legacy paths and shortcuts;
- required tests and browser/user-path evidence;
- explicit prohibited CMS scope;
- explicit non-goals;
- evidence required for Engineering PM review.

Codex must report exact changes, failures, shortcuts, seeds/fixtures and limitations. Do not use optimistic completion language.

## 11. Review and acceptance

The Engineering PM rejects work when:

- no product requirement is mapped;
- UI is disconnected from canonical Product State;
- a user action is replaced by seed, fixture, direct database write or hidden script;
- Capability Resolution is confused with Evidence Retrieval or Asset Runtime;
- exact-version lineage is absent;
- authorization exists only in UI;
- human governance state is created by model/workflow output;
- browser/runtime evidence does not support the claim;
- Legacy infrastructure is reintroduced;
- the Product Owner would need to inspect code to know whether the product works.

Implementation status must use row-level proof from Doc 12. Never report a single “complete Asset Loop” result.

## 12. Required evidence before product completion

- install from lockfile;
- lint and type check;
- unit/application tests;
- PostgreSQL migration and integration tests;
- LangGraph graph, interrupt/resume and replay tests;
- authorization and tenant-isolation tests;
- Context contamination tests;
- Evidence hybrid/multimodal retrieval and citation tests;
- Capability Registry candidate/exclusion/no-match and exact-version tests;
- Component Asset preview/check/confirmation/runtime/disable/rollback tests;
- Standard Trainer and other Capability integration tests;
- complete Learning Loop browser E2E;
- need-driven capability reuse/adapt/generate browser E2E;
- all four product surfaces;
- product/pedagogy/security Eval;
- production-like online preview verification;
- asset/data migration rehearsal;
- rollback rehearsal;
- zero Legacy production-import scan.

The retained PR #22 automated and browser results are historical exact-head
evidence only. Tests do not confer human validation, live-provider validation,
preview approval, Product Owner acceptance, merge authority or cutover authority.

## 13. Reporting

Internal work-package reports go to the Engineering PM and include exact commit/diff/test/user-path evidence.

Reports to the Product Owner focus on what learners, teachers, experts and operators can do, which complete online flows pass, and which genuine product decision remains.

Do not report the complete product as ready until every applicable Doc 12
dimension is independently evidenced, every blocker is closed and one explicit
Product Owner release-acceptance event references the accepted ledger
snapshot/head. Use the Doc 12 verdict vocabulary; tests alone never create
`ACCEPTED`.
