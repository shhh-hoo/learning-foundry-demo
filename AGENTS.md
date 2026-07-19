# Learning Foundry Rewrite — Repository Instructions

## 1. Authoritative product documentation

The current product and architecture source of truth is:

```text
shhh-hoo/learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1
```

Read in this order before implementation or review:

1. `docs/00-current-mvp-contract.md` — current Showcase Release contract;
2. `docs/01-product-definition.md` — product definition and North Star;
3. `docs/02-product-surfaces-and-user-journeys.md` — four product surfaces;
4. `docs/03-system-architecture.md` — orchestration architecture;
5. `docs/08-asset-and-component-lifecycle.md` — LearningCapability and ComponentAsset contract;
6. `docs/21-learning-loop-and-outcome-contract.md` — Learning Loop and Outcome;
7. `docs/04-context-architecture.md` — Context Compiler and isolation;
8. `docs/05-evidence-and-retrieval.md` — Evidence intake and retrieval;
9. `docs/06-storage-and-data-lifecycle.md` — semantic objects and authority classes;
10. `docs/07-learner-model-goals-and-pedagogy.md` — learner adaptation and capability eligibility;
11. `docs/09-eval-and-governance.md` — Eval and security;
12. `docs/17-build-buy-partner-and-external-components.md` — mature infrastructure and external-resource boundary;
13. `docs/20-full-framework-rewrite-and-cutover.md` — rewrite and cutover boundary;
14. `docs/15-human-development-handoff.md` — engineering operating protocol;
15. `docs/12-docs-demo-traceability.md` — evidence reset and current requirement inventory.

Authority order:

```text
Current Showcase Release Contract
> Product Definition
> Product Surfaces and User Journeys
> Learning Capability and Component Asset Contract
> Learning Loop and Outcome Contract
> Context / Evidence / Data / Eval owner documents
> accepted ADRs
> operational evidence and implementation status
> historical documents and Git history
> implementation prose
> task prompt
> fixture or seed
```

The CMS-like `COMP-*` contract, the former 113-row ledger, docs PR #14 mapping and any instruction derived from them are superseded.

## 2. Operating model

```text
Shijia Hu = Product Owner
ChatGPT / Work = Engineering PM and docs maintainer
Codex / developers = implementation team
```

The Product Owner has already defined the product. Do not ask the Product Owner to restate requirements, relay logs, manage branches or interpret ordinary engineering evidence.

Engineering work is decomposed into bounded, reviewable child PRs. The Product Owner receives product-visible progress and material decisions, not unmanaged implementation transcripts.

## 3. Product definition

Learning Foundry is an **AI Learning Orchestration Platform**.

```text
Context
+ Diagnosis
+ Capability Registry
+ Matching / Generation
+ Runtime Orchestration
+ Teacher Governance
+ Learning Feedback
```

North Star:

> Do not make learners search, compare and configure learning resources. Deliver the right learning tool to the right learner at the right time.

```text
Chat = entry and guidance
ComponentAsset = executable learning experience
Asset Stage = learner runtime surface
Capability Registry = machine-callable capability directory
Learning orchestration = product core
```

## 4. Component Asset meaning

A `ComponentAsset` is an executable, interactive or otherwise orchestratable learning tool or experience.

Examples:

- calculation trainer;
- particle animation;
- equation-balancing interaction;
- quiz or recall activity;
- simulation;
- visual explorer;
- rubric evaluator;
- diagnostic tool;
- generator;
- reviewed Web learning application;
- composite learning flow.

The following are not Component Assets by default:

- article;
- PDF;
- syllabus page;
- video;
- worksheet;
- static link.

These remain `SourceAsset`, `EvidenceUnit` or `ExternalLearningResource` unless wrapped in a genuine learning activity contract with objective, input, interaction, state, output and learning events.

## 5. Three product loops

### Learning Delivery Loop

```text
learner goal or teacher assignment
→ compile authorized Context
→ determine current learning need
→ retrieve an eligible capability or resource
→ parameterize / compose / adapt / generate when necessary
→ deliver in Asset Stage
→ capture operations, Attempts and completion state
```

### Diagnosis and Teacher Governance Loop

```text
LearnerAttempt
→ DiagnosticObservationProposal
→ confidence / risk / policy gate
→ bounded automatic continuation or TeacherReview
→ teacher correction, requirement, exclusion, override or feedback
→ Retry / Transfer / Retention
→ reviewed LearningOutcome
```

### Capability Supply and Optimization Loop

```text
no-match / repeated failure / improvement request
→ inspect Registry
→ use existing asset
→ parameterize
→ compose
→ adapt
→ generate only when necessary
→ runtime, event, safety, rights and accessibility checks
→ teacher or expert confirmation
→ make exact version available
→ real delivery
→ asset / routing / learning-strategy optimization
```

The third loop serves learning orchestration. It is not a standalone CMS or editorial product.

## 6. Product surfaces

### Learner Workspace

- conversational and teacher-assigned Task entry;
- current goal, due state and next step;
- Chat / Guidance;
- Active Asset Stage;
- Evidence and citations where required;
- text, structured, image and interactive Attempts;
- pause, reset, resume and retry;
- waiting/review states;
- progress, prior Attempts and Outcomes.

### Teacher Workspace

Primary areas:

```text
Assign
+ Monitor and Intervene
+ Learning Evidence
+ Improve
```

Teachers can:

- assign learners, goals, deadline and completion policy;
- define allowed, required and excluded capabilities;
- inspect capability candidates, selection rationale and exact runtime version;
- inspect events, Attempts, Evidence and Diagnosis Proposals;
- confirm, correct, partially accept, reject or escalate;
- override the next activity;
- change language, modality, support intensity or sequence;
- create linked Retry, Transfer and Retention activities;
- request an asset adaptation or routing-policy improvement.

### Capability Workshop

A secondary, need-driven surface for:

- parameterization and composition;
- connecting a reviewed external capability;
- natural-language asset adaptation;
- generation of a new Web learning asset;
- runtime preview;
- concise callable-contract correction;
- checks and teacher/expert confirmation;
- version availability, disable, successor and rollback;
- evidence-driven asset/routing/strategy improvement.

Capability Workshop is not a generic CMS.

### Engineering / Evaluation

- workflow, checkpoint, replay, cancellation and recovery inspection;
- Product State inspection;
- Context and Evidence traces;
- Capability Registry candidates, exclusions and selection;
- ActivityPlan, exact asset runtime and learning events;
- provider, latency, cost and failure evidence;
- authorization and tenant isolation;
- product, retrieval, orchestration, pedagogy and security Eval.

Engineering cannot create TeacherReview or LearningOutcome on behalf of an authorized human.

## 7. Current requirement namespaces

All implementation work maps to current IDs:

```text
REL-*
LEARN-* / TEACH-* / OUTCOME-*
CTX-*
EVID-*
CAP-*
DATA-*
EVAL-* / SEC-*
OPS-*
```

`COMP-*` is superseded. Work whose only purpose is satisfying the former `COMP-01`–`COMP-20` must be removed or repurposed.

## 8. Capability resolution and runtime

Resolution priority:

```text
1. verified eligible existing capability
2. parameterized existing capability
3. composition of eligible capabilities
4. reviewed adaptation of an internal or external capability
5. generated ComponentAsset proposal
6. explicit no-match and teacher escalation
```

The resolver records:

- candidate versions;
- eligibility checks;
- exclusions and reasons;
- teacher requirements and prohibitions;
- selected exact version;
- parameterization or composition;
- fallback or no-match decision.

A first-match SQL query is not Capability Resolution.

Asset Stage validates authorization, eligibility, exact version, dependencies and input contract before launch. It records state transitions, learner operations, support exposure, learning events, Attempt boundary, completion, abandonment and failure.

Runtime completion is not a Diagnosis or LearningOutcome.

## 9. Canonical Product State

Persist formal records for at least:

- `User`, `Institution`, `InstitutionMembership`, `Course`, `Subject`, `Enrollment`;
- `LearningTask`, `LearningEpisode`, `ConversationEvent`;
- `SourceAsset`, `SourceAssetVersion`, rights and delivery decisions;
- `EvidenceUnit` and derivatives;
- `LearnerAttempt`;
- `DiagnosticObservationProposal`;
- append-only `TeacherReview` and successor/conflict history;
- Retry, Transfer and Retention activity lineage;
- `LearningOutcome` and invalidation/supersession;
- `LearningCapability`, `CapabilityVersion`;
- `ComponentAsset`, immutable `ComponentAssetVersion`;
- capability candidate, exclusion and selection records;
- `TeacherAssignment`, capability requirement and exclusion;
- `ActivityPlan`, `RuntimeDelivery`, `LearningEvent`;
- capability gap, adaptation/generation and evaluation proposals;
- authorized confirmation, availability, disable and rollback decisions;
- asset, routing and learning-strategy optimization proposals.

Canonical writes require server-side authorization, transactions and idempotency. Workflow replay or resume must not duplicate Product State.

## 10. Evidence and capability boundaries

```text
Evidence Retrieval
= find trustworthy information or material

Capability Resolution
= decide which callable learning behavior should run

Component Asset Runtime
= execute that behavior and return learning events
```

These may share infrastructure but never share meaning.

External resources require a reviewed adapter to participate in orchestration. A link, iframe or provider completion event is not native Component Asset execution and cannot directly create Diagnosis, TeacherReview or LearningOutcome.

## 11. Technology and Build / Adopt / Partner

Current direction:

- Next.js and React;
- LangGraph JS;
- PostgreSQL canonical Product State;
- separate checkpoint namespace/role;
- Drizzle migrations;
- Zod boundaries;
- mature managed authentication;
- database-enforced tenant isolation;
- mature hybrid retrieval with multilingual and multimodal support;
- managed Object Storage;
- approved provider adapters;
- OpenTelemetry-compatible observability;
- mature Eval infrastructure where useful.

Do not hand-build commodity authentication, organization membership foundations, object storage, vector plumbing, workflow execution or observability without a documented Build / Adopt / Partner reason.

Foundry owns product semantics; providers and frameworks do not.

## 12. Explicit prohibited scope

Do not build or expand:

- article or page authoring;
- generic block editor;
- giant manual Component metadata forms;
- CMS-style field/block editorial comments;
- independent content publication backend;
- editorial calendar or arbitrary content-type system;
- content catalogue or marketplace as the product center;
- manual metadata entry that can be inferred and proposed;
- infrastructure unrelated to a current orchestration requirement;
- compatibility work whose only purpose is preserving the superseded CMS contract.

Retain versioning, checks, confirmation, availability, disable and rollback only where they protect callable learning behavior, source rights, runtime safety or institutional authority.

## 13. Current implementation handling

PR #22 is the umbrella Draft targeting `main`. Child PRs target `rewrite/full-framework` and must remain independently reviewable and revertible.

Preserve valid existing work in:

- Next.js/LangGraph/PostgreSQL foundations;
- workflow replay, interrupt, recovery and cancellation;
- Context and Evidence;
- source intake and multimodal lineage;
- Diagnosis Proposal and TeacherReview;
- Capability Registry and selection evidence;
- exact runtime versioning and events;
- Retry, Transfer, Retention and Outcome;
- tenant/security enforcement;
- version disable and rollback;
- Engineering inspection and Eval.

Remove or repurpose code whose only purpose is:

- generic Component CMS authoring;
- field/block editorial workflow;
- content publication administration;
- former `COMP-*` completeness.

Do not delete reusable runtime, safety, lineage or governance behavior merely because it was originally implemented under the wrong label.

## 14. Work-package contract

Every assignment states:

- current requirement IDs;
- user-visible result;
- exact base SHA and branch;
- files or responsibility boundary;
- Product State impact;
- authorization and tenant boundary;
- runtime/provider/failure behavior;
- prohibited CMS and Legacy scope;
- required tests and real browser/user-path evidence;
- explicit non-goals;
- evidence required for Engineering PM review.

Do not send an uncontrolled “build everything before review” instruction.

## 15. Review rejection conditions

Reject work when:

- no current requirement is mapped;
- a user action is replaced by a seed, fixture, direct database write or hidden script;
- authorization exists only in UI code;
- Evidence Retrieval, Capability Resolution and Asset Runtime are conflated;
- capability selection is an unexplained first-match lookup;
- generated/adapted assets become available without checks and authorized confirmation;
- runtime events or completion fabricate Diagnosis or Outcome;
- exact-version, event or review lineage is absent;
- workflow replay duplicates canonical records;
- provider unavailability is presented as success;
- browser/runtime evidence does not support the claim;
- CMS-only or Legacy-only infrastructure is introduced;
- completion language exceeds evidence.

## 16. Required validation

For relevant work packages, run and retain:

- lockfile installation;
- lint and type check;
- unit/application tests;
- PostgreSQL migration and integration tests;
- checkpoint, interrupt/resume, replay, idempotency and cancellation tests;
- authentication and cross-tenant denial tests;
- Context isolation and contamination tests;
- Evidence hybrid/multilingual/multimodal and citation tests;
- Capability Registry candidate/exclusion/no-match tests;
- Asset Stage input/state/event/failure tests;
- teacher assignment, requirement, exclusion and override tests;
- complete Learning Loop browser E2E;
- one real gap-driven adapt/generate/check/confirm/register/deliver E2E;
- asset/routing/strategy optimization evidence;
- security and adversarial tests;
- production-like preview verification where applicable;
- zero Legacy/CMS-only target import scan.

No old test count or prior audit verdict is current acceptance.

## 17. Reporting and acceptance

Implementation reports include exact commit, diff, commands, database evidence, browser path, failures, shortcuts and non-claims.

Reports to the Product Owner focus on:

- what learners can do;
- what teachers can assign, inspect or change;
- which capabilities are matched, adapted, generated and run;
- which complete online journeys pass;
- which user-visible defects remain;
- which genuine product decision is required.

Current Doc 12 requirements are reset to `NOT_REVIEWED`. Do not claim Showcase, preview, Pilot, production or cutover acceptance without the required evidence and explicit Product Owner decision.
