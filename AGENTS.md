# Learning Foundry Big-Bang Rewrite Instructions

## Authoritative documentation

The product and architecture source of truth is:

`learning-foundry-docs@db168abdbad231304007e4d57a3addd734eff24c`

Required reading:

1. `docs/00-current-mvp-contract.md`
2. `docs/20-full-framework-rewrite-and-cutover.md`
3. `docs/03-system-architecture.md`
4. `docs/15-human-development-handoff.md`
5. `docs/12-docs-demo-traceability.md`
6. `docs/01-product-definition.md`
7. `docs/09-eval-and-governance.md`
8. `docs/16-engineering-history-and-decision-rationale.md`

When instructions conflict:

`Current MVP Contract > Big-Bang Rewrite Contract > accepted ADR > active normative domain document > historical docs > implementation prose > task prompt > fixtures`

## One active implementation program

This branch is the sole active replacement product:

`rewrite/full-framework`

The Legacy baseline is preserved at:

`archive/legacy-wave1-6734b2f`

Do not treat this work as:

- a framework spike;
- a scaffold-only task;
- a vertical slice;
- a Learner-only MVP;
- a Product State-only migration;
- a wrapper around the old runtime;
- a gradual parity migration;
- a sequence of product phases;
- an opportunity to preserve old code “temporarily”.

The required result is one integrated, complete replacement of Learning Foundry. Internal commits and worktrees are allowed only for dependency management. They are not deliverables or stopping points.

Do not stop after planning, auditing, scaffolding, one graph, one workspace, one database slice or one successful demo flow.

Stop only before the destructive replacement of `main` and the production deployment.

## Required technology direction

Use:

- Next.js and React for the product application;
- LangGraph JS for the complete workflow runtime;
- PostgreSQL for canonical Product State;
- a separate LangGraph checkpoint schema/store;
- Drizzle for relational schema and migrations unless a concrete blocker is proved;
- Zod for boundary validation;
- a mature authentication provider behind Foundry authorization policy;
- mature hybrid retrieval selected through Eval;
- OpenTelemetry-compatible tracing, with LangSmith optional under approved redaction;
- framework-native or mature-platform Eval execution.

AI SDK is not the orchestration framework. It may be added only for a concrete UI streaming or provider-adapter requirement.

## Framework ownership

LangGraph owns:

- graph and subgraph execution;
- branches and loops;
- tool-call lifecycle;
- retry, timeout and cancellation;
- durable checkpointing;
- interrupt, pause and resume;
- human-in-the-loop execution;
- streaming;
- workflow execution state;
- fault recovery;
- runtime tracing;
- provider-model invocation through supported adapters.

Do not wrap LangGraph around the old `runAgent`. The replacement product must not contain or import the old execution loop.

Foundry domain/application code owns:

- Learning Task, Attempt, Observation, Review, Retry and Outcome meaning;
- Evidence authority, rights and provenance;
- institutional and role authorization;
- mandatory human-review rules;
- canonical Product State write authority;
- Curriculum and Reference Pack semantics;
- Capability identity and domain validation;
- Component review, versioning and publication policy;
- product and learning Eval definitions;
- checkpoint/Product State separation.

Framework state is not Product State.

## Complete product obligation

The same integrated product must implement all of the following.

### Learner Workspace

- authentication and authorized course access;
- create, continue, switch and close Learning Tasks;
- database-backed conversation and scoped Context;
- course explanation and problem support;
- governed Evidence retrieval and citations;
- text plus at least one visual or structured Evidence path;
- activity and deterministic Capability execution;
- Learner Attempt capture;
- Diagnosis and feedback;
- Library and resource recommendations;
- Schedule;
- Retry, Transfer and delayed review;
- learning history and Outcome records.

### Teacher Workspace

- inspect source Evidence, Attempt and Diagnostic Observation;
- accept, correct, supplement or escalate Diagnosis;
- modify teaching support;
- LangGraph interrupt, human decision and resume;
- create linked Retry, Transfer or delayed review;
- inspect and review retry results;
- write governed Learning Outcome;
- inspect common error patterns;
- submit effective support as a Component candidate.

### Foundry Studio

- governed pattern discovery;
- Component candidate generation and editing;
- contract and domain validation;
- Core and Pack Eval;
- expert interrupt and review;
- PublicationDecision;
- versioning and rollback;
- Reference Pack and Capability management;
- published Capability reuse in a new Episode.

### Engineering / Evaluation

- LangGraph execution and checkpoint inspection;
- model, Context, tool, token, latency and failure analysis;
- retrieval evaluation;
- Diagnosis fidelity;
- pedagogy and Evidence review;
- framework-native datasets and evaluators;
- security and tenant-isolation inspection;
- complete product regression and E2E evidence.

## Canonical Product State

Implement PostgreSQL records and relationships for:

- User;
- InstitutionMembership;
- Course;
- Subject;
- LearningTask;
- LearningEpisode;
- ConversationEvent;
- EvidenceUnit and source records;
- LearnerAttempt;
- DiagnosticObservation;
- TeacherReview;
- RetryAttempt;
- TransferActivity;
- RetentionReview;
- LearningOutcome;
- Capability and CapabilityVersion;
- Component and ComponentVersion;
- PublicationDecision.

TeacherReview, LearningOutcome and PublicationDecision require explicit authorized human commands. They cannot be created directly from model or tool output.

Use transactions, idempotency keys and append-only governance history where required.

## Required workflow graphs

Implement explicit graphs or subgraphs for:

1. learner task and product action routing;
2. Evidence-grounded explanation;
3. Attempt and deterministic Diagnosis;
4. Teacher Review interrupt and resume;
5. Retry / Transfer / Retention and Outcome;
6. Component candidate, validation, expert review, publication and rollback.

Graph state must be typed and inspectable. Canonical writes must be routed through application services rather than hidden inside prompts.

## Context requirements

Implement a real Context Compiler that records:

- active Task and Episode;
- candidate Context Items;
- selected items;
- excluded items and reasons;
- stale and superseded decisions;
- explicit carryover relations;
- token and modality budget;
- compiler version.

Do not replay complete conversation history by default.

## Evidence and Retrieval requirements

Migrate governed corpus and source metadata after re-review.

Retrieval must return:

- source identity;
- source version and locator;
- rights and delivery decision;
- relevant projection;
- relevance/reranking evidence;
- citation-ready reference;
- missing/conflicting Evidence signals.

Do not invent citations. Do not treat runtime trace IDs as source references.

## Standard Trainer integration

Integrate Standard Trainer as a deterministic Capability tool.

A Diagnosis must reference a real LearnerAttempt and retain Capability identity, input lineage, output lineage and error boundaries.

The model may explain the Diagnosis. It may not claim a Diagnosis that was not executed.

## Component lifecycle requirements

Implement:

```text
governed signal
→ candidate
→ editor
→ contract/domain validation
→ Eval
→ expert review
→ publication decision
→ version activation
→ reuse
→ rollback
```

External resource launch remains noncanonical and cannot become LearningOutcome or native Component publication.

## Delete and replace

Remove from the replacement product tree:

- `src/agent/run-agent.ts` and the handwritten Agent loop;
- old gateway runtime;
- DeepSeek-specific custom message/tool translation where replaced by supported adapters;
- runtime shadow;
- runtime parity;
- authoritative/candidate dual-run infrastructure;
- candidate authority machinery;
- file-backed Agent runtime state and recorders;
- old AgentEval runner infrastructure;
- fixed-port multi-service orchestration;
- old terminal-reason and recorder-schema compatibility;
- old Demo Shell;
- tests and contracts that exist only to protect those implementations.

Migrate only reviewed product assets, valid domain content, valid Eval cases and policy invariants.

Provide a deletion inventory and an automated zero-production-import scan for all removed Legacy runtime areas.

## Test system

Do not require the old 286 tests to pass.

Build a new suite containing:

- domain invariant tests;
- application command/query tests;
- PostgreSQL migration and integration tests;
- LangGraph graph tests;
- interrupt/resume tests;
- cancellation and idempotency tests;
- authorization and tenant-isolation tests;
- Context contamination tests;
- retrieval and citation tests;
- Standard Trainer integration tests;
- complete Learning Loop E2E;
- complete Asset Loop E2E;
- browser E2E for all four product surfaces;
- versioned Eval datasets and human review protocols.

Migrate these product invariants from Legacy evidence:

- no invented source, citation, tool or Capability execution;
- Diagnosis requires a real Attempt;
- model output cannot become TeacherReview;
- retry result must be reviewed before Outcome;
- Transfer and Retention require type-specific Evidence;
- external launch cannot become Outcome;
- private Evidence obeys rights and purpose policy;
- Context excludes stale, superseded and unrelated Task facts;
- checkpoint state is not Product State.

## Deployment and cutover evidence

Maintain one production-like preview of the complete rewrite branch.

Before reporting completion, run:

- install from lockfile;
- lint and type check;
- unit tests;
- database migration and integration tests;
- graph and interrupt/resume tests;
- security and isolation tests;
- complete browser E2E;
- Eval datasets;
- preview deployment verification;
- asset/data migration rehearsal;
- rollback rehearsal;
- full cutover rehearsal;
- zero Legacy production import scan.

Do not change `main`, the current production deployment or canonical user data.

## Final report

Return one final integrated report containing:

- exact head SHA of `rewrite/full-framework`;
- complete route and Workspace inventory;
- domain/application architecture map;
- PostgreSQL schema and migration inventory;
- LangGraph graph and state inventory;
- authentication and authorization model;
- Context Compiler evidence;
- retrieval/citation evidence;
- Standard Trainer integration evidence;
- Teacher interrupt/resume evidence;
- Learning Loop and Asset Loop E2E evidence;
- retained product-asset inventory;
- deleted Legacy inventory;
- tests and exact results;
- preview deployment and browser verification;
- Eval results;
- migration, rollback and cutover rehearsal results;
- unresolved limitations;
- final `CUTOVER_READY` or `REWORK` verdict.

Do not return `READY` because scaffolding or a subset works. The only acceptable positive verdict is based on the complete replacement product.
