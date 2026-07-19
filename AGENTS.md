# Learning Foundry Rewrite — Repository Instructions

## 1. Authoritative documentation

The product and architecture source of truth is:

`learning-foundry-docs@fb5446b7934366a416d03ee28449faa5468c37bd`

Read in this order before implementation or review:

1. `docs/00-current-mvp-contract.md`
2. `docs/01-product-definition.md`
3. `docs/02-product-surfaces-and-user-journeys.md`
4. `docs/08-asset-and-component-lifecycle.md`
5. `docs/20-full-framework-rewrite-and-cutover.md`
6. `docs/03-system-architecture.md`
7. `docs/04-context-architecture.md`
8. `docs/05-evidence-and-retrieval.md`
9. `docs/06-storage-and-data-lifecycle.md`
10. `docs/07-learner-model-goals-and-pedagogy.md`
11. `docs/09-eval-and-governance.md`
12. `docs/17-build-buy-partner-and-external-components.md`
13. `docs/15-human-development-handoff.md`
14. `docs/12-docs-demo-traceability.md`
15. `docs/22-document-audit-cleanup-register.md`

Authority order:

```text
Current MVP Contract
> Learning Component Platform Contract
> Complete Rewrite and Cutover Contract
> accepted ADR
> active normative domain document
> operational status / traceability / handoff
> historical or superseded document
> implementation prose
> task prompt
> fixture or seed
```

Historical Docs 13, 14, 16, 18 and 19 do not control current implementation.

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

## 3. Complete product versus internal decomposition

The target remains one complete replacement product on:

`rewrite/full-framework`

The Legacy reference remains:

`archive/legacy-wave1-6734b2f`

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

Do not change `main`, production deployment or canonical user data without explicit Product Owner authorization.

## 4. Product core

Learning Foundry is an expert-governed AI learning product and Learning Component Platform.

It must connect:

```text
Learning Loop
Task and authorized Context
→ Evidence Retrieval
→ Component Retrieval / Capability Resolution
→ Activity and Learner Attempt
→ Diagnostic Observation
→ Teacher Review
→ Retry / Transfer / Retention
→ Learning Outcome

Learning Component Supply Loop
Manual create / Upload / Import / Conversation Evidence
→ SourceAsset and ComponentDraft
→ Authoring, Contract Checks and Eval
→ comments, requested changes and human approval
→ immutable ComponentVersion publication
→ Registry and Component Retrieval
→ exact-version RuntimeDelivery
→ Outcome Evidence
→ maintenance / revision / deprecation / rollback
```

Never collapse these distinct concepts:

```text
SourceAsset
≠ EvidenceUnit
≠ ExternalLearningResource
≠ LearningComponent

Evidence Retrieval
≠ Component Retrieval
≠ Capability Resolution

LangGraph checkpoint state
≠ canonical Product State
```

## 5. Required product surfaces

### Learner Workspace

- authenticate and access authorized courses;
- create, continue, switch and close Learning Tasks;
- hold Task-scoped continuous conversations;
- submit text, images, diagrams, charts, questions and learner work;
- receive context-aware, Evidence-grounded support with citations;
- execute published Components and governed Capabilities;
- submit Learner Attempts;
- receive explainable Diagnostic Observations and feedback;
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

### Foundry Studio

- manually create a Component Draft;
- upload/import a real asset while preserving original SourceAsset and processing lineage;
- create a Draft from governed Conversation/Attempt/Review/Outcome Evidence;
- edit contract, content, attachments, Evidence, eligibility, dependencies and runtime behavior;
- preview the learner experience;
- run Contract Checks and versioned Eval;
- assign reviewers;
- create field/block review comments;
- request changes, revise and resubmit;
- approve/reject an exact candidate through authorized human action;
- publish an immutable ComponentVersion;
- search and inspect the Registry;
- retrieve eligible Components with inclusion/exclusion reasons;
- deliver the exact selected version in a Learning Episode;
- link delivery to Attempt, Review, Retry and Outcome Evidence;
- create successor revisions;
- deprecate, retire, emergency-disable and roll back without rewriting history.

### Engineering / Evaluation

- inspect LangGraph execution, interrupts, checkpoints and resume;
- inspect Product State separately from runtime state;
- inspect Context inclusion/exclusion;
- inspect Evidence and Component retrieval candidates and decisions;
- inspect model, tool, Capability and exact ComponentVersion execution;
- inspect token, latency, cost, retry and failures;
- run product, retrieval, Diagnosis, pedagogy, Component and security Eval;
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
- DiagnosticObservation;
- TeacherReview and correction history;
- RetryAttempt, TransferActivity and RetentionReview;
- LearningOutcome;
- Capability and CapabilityVersion;
- Component and ComponentDraft;
- Component attachment/dependency records;
- Component evaluation and review assignment/comment/decision records;
- ComponentVersion and PublicationDecision;
- Registry state;
- Component selection/exclusion and RuntimeDelivery;
- maintenance, deprecation, disable and rollback decisions.

TeacherReview, LearningOutcome and PublicationDecision require authorized human commands. Model or workflow output may propose but cannot create them.

Canonical writes require authorization, transactions and idempotency. Workflow replay must not duplicate product records.

## 8. Context, Evidence and selection

The Context Compiler must record active Task/Episode, candidates, selections, exclusions, reasons, carryover relations, stale/superseded handling and token/modality budgets.

Concrete prior-Task entities and values are excluded unless a valid explicit relation permits carryover.

Evidence intake must preserve original source identity, content hash, version, locator, rights, ownership, institution scope and processing lineage.

Evidence Retrieval must support lexical and vector candidate generation, fusion/reranking, multilingual behavior and a genuine visual/multimodal path.

Component Retrieval must consider learner eligibility, Task, curriculum, language, modality, permissions, publication scope, required Capabilities and exact active version. Record candidates, exclusions, rationale and selected version.

External resource launch is not native Component execution and cannot directly create Diagnosis, TeacherReview, LearningOutcome or PublicationDecision.

## 9. Legacy deletion boundary

Do not preserve or reintroduce as target requirements:

- handwritten `runAgent` and old gateway;
- custom Legacy provider/tool loop;
- runtime shadow and parity;
- authoritative/candidate dual-run machinery;
- candidate-authority migration;
- file-backed formal Product State;
- Legacy trace/recorder schema compatibility;
- fixed-port multi-service orchestration;
- old AgentEval runner infrastructure;
- tests protecting only Legacy round counts, tool order or terminal reasons;
- old Demo Shell as the product UI.

Migrate only reviewed product requirements, domain assets, deterministic capabilities, valid Eval/failure cases and rights/privacy/authorization invariants.

## 10. Work-package contract

Every Codex assignment must state:

- mapped product requirement and user-visible result;
- exact branch and responsibility boundary;
- files/services expected to change;
- Product State and authorization effects;
- prohibited Legacy paths and shortcuts;
- required tests and browser/user-path evidence;
- explicit non-goals;
- evidence required for Engineering PM review.

Codex must report exact changes, failures, shortcuts, seeds/fixtures and limitations. Do not use optimistic completion language.

## 11. Review and acceptance

The Engineering PM rejects work when:

- no product requirement is mapped;
- UI is disconnected from canonical Product State;
- a user action is replaced by seed, fixture, direct database write or hidden script;
- Component Retrieval is confused with Evidence Retrieval;
- exact-version lineage is absent;
- authorization exists only in UI;
- human governance state is created by model/workflow output;
- browser/runtime evidence does not support the claim;
- Legacy infrastructure is reintroduced;
- the Product Owner would need to inspect code to know whether the product works.

Implementation status must use row-level proof from Doc 12. Never report a single “complete Asset Loop” result.

## 12. Required validation before product completion

- install from lockfile;
- lint and type check;
- unit/application tests;
- PostgreSQL migration and integration tests;
- LangGraph graph, interrupt/resume and replay tests;
- authorization and tenant-isolation tests;
- Context contamination tests;
- Evidence hybrid/multimodal retrieval and citation tests;
- Component create/upload/author/review/publish/retrieve/deliver/maintain tests;
- Standard Trainer and other Capability integration tests;
- complete Learning Loop browser E2E;
- complete Component Platform browser E2E;
- all four product surfaces;
- product/pedagogy/security Eval;
- production-like online preview verification;
- asset/data migration rehearsal;
- rollback rehearsal;
- zero Legacy production-import scan.

The old 286-test result is historical evidence only.

## 13. Reporting

Internal work-package reports go to the Engineering PM and include exact commit/diff/test/user-path evidence.

Reports to the Product Owner focus on what learners, teachers, experts and operators can do, which complete online flows pass, and which genuine product decision remains.

Do not report the complete product as ready until all required rows are independently accepted. The final positive verdict is `CUTOVER_READY`; otherwise use `REWORK` with explicit missing product paths.
