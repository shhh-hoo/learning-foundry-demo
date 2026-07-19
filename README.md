# Learning Foundry · full-framework rewrite

This branch contains the Next.js App Router, LangGraph JS and PostgreSQL replacement baseline. It is an internal engineering checkpoint, not a completed product, accepted Showcase or cutover claim.

## Product authority

Current documentation authority:

```text
shhh-hoo/learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1
```

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

A `ComponentAsset` is an executable, interactive or orchestratable learning tool or experience. It is not an article, PDF, page or generic CMS content record.

Repository instructions are in [`AGENTS.md`](AGENTS.md).

## Product surfaces

1. **Learner Workspace** — Task, Chat / Guidance, Active Asset Stage, Attempts, progress and next step.
2. **Teacher Workspace** — Assign, Monitor and Intervene, Learning Evidence, and Improve.
3. **Capability Workshop** — need-driven parameterization, composition, adaptation, generation, checks and confirmation.
4. **Engineering / Evaluation** — workflow, Product State, Context, retrieval, capability resolution, runtime, security and Eval inspection.

Capability Workshop is not a CMS. Generic article/page authoring, giant manual Component forms, field/block editorial workflows and a standalone content-publishing backend are not current product scope.

## Three orchestration loops

```text
Learning Delivery
Task / Goal
→ Context
→ current learning need
→ capability resolution
→ Asset Stage
→ learner operations and Attempt

Diagnosis and Teacher Governance
Attempt
→ DiagnosticObservationProposal
→ confidence/risk gate
→ teacher review or bounded continuation
→ Retry / Transfer / Retention
→ reviewed Outcome

Capability Supply and Optimization
no-match / failure / improvement signal
→ existing asset
→ parameterize
→ compose
→ adapt
→ generate only when necessary
→ checks and teacher confirmation
→ Registry availability
→ real delivery
→ asset / routing / learning-strategy optimization
```

## Repository and PR status

```text
main
  Legacy/current baseline; unchanged by the rewrite

rewrite/full-framework
  umbrella implementation branch

PR #22
  Draft umbrella PR to main

child PRs
  target rewrite/full-framework
```

The independently audited implementation checkpoint is:

```text
b6f023fe995e44e714bf5da2c2096128e1def9fe
```

Historical audit result at that exact head:

- browser validated: 10 historical rows;
- automated verified: 3 historical rows;
- rework: 15 historical rows;
- not implemented: 14 historical rows;
- human, live-provider and preview validation: none.

The former 42-row/113-row mappings and `COMP-*` authority are superseded. Current implementation evidence must be remapped to `REL`, `LEARN`, `TEACH`, `OUTCOME`, `CTX`, `EVID`, `CAP`, `DATA`, `SEC`, `EVAL` and `OPS` requirements.

## Current technical foundation

The rewrite currently includes substantial foundations for:

- Next.js product surfaces;
- PostgreSQL Product State;
- separate LangGraph checkpoint state;
- workflow interrupt/resume and persisted execution;
- source/PDF/image intake and Evidence lineage;
- lexical/vector retrieval and optional reranking/provider adapters;
- deterministic Chemistry capabilities;
- Attempts, TeacherReview and partial Retry/Outcome paths;
- version-pinned capability/asset delivery;
- Engineering inspection;
- synthetic-role browser flows.

These foundations do not constitute corrected-contract acceptance.

## State and authority boundaries

- `foundry_product` stores canonical Product State.
- `foundry_operational` stores workflow, retrieval and Eval inspection records.
- `langgraph_checkpoint` is the separate checkpoint store.
- Authenticated actor provenance, not caller-supplied identity text, authorizes human decisions.
- LangGraph checkpoint state is not canonical Product State.
- Runtime completion is not Diagnosis, TeacherReview or LearningOutcome.
- Evidence Retrieval, Capability Resolution and Component Asset Runtime are separate operations.

## Known blockers at the audited checkpoint

- production authentication is not integrated; synthetic credentials remain Showcase/test-only;
- database-level tenant enforcement/RLS is not complete;
- canonical orchestration Product State is incomplete;
- Context Compiler is partial;
- Capability Resolution is not yet a complete candidate/exclusion/rationale resolver;
- Transfer and Retention behavior is incomplete;
- live multimodal/provider success is not independently validated;
- online preview is unavailable;
- replay/recovery/cancellation safety requires further work;
- generic CMS-like code must be reviewed and removed or repurposed where it does not support callable learning assets.

Do not convert these blockers into optimistic completion language.

## Build / Adopt / Partner

Use mature infrastructure for non-differentiating foundations:

- managed authentication;
- organization and membership foundations;
- database-enforced tenant isolation;
- Object Storage;
- durable workflow mechanics;
- hybrid retrieval/vector infrastructure;
- provider adapters;
- observability;
- queues, email and deployment.

Foundry retains Task, Context, Evidence, Diagnosis, capability selection, ActivityPlan, runtime semantics, teacher authority, Outcomes and optimization policy.

## Optional live integrations

- `OPENAI_API_KEY` — configured OpenAI model, embedding or multimodal paths;
- `COHERE_API_KEY` — configured Cohere reranking;
- `DEEPSEEK_API_KEY` — configured synthesis path where selected;
- `FILE_STORAGE_LOCAL_ROOT` — explicit local object root for local verification.

Missing providers must return honest unavailable/failed states. They must never synthesize success.

Provider presence is not provider validation or permanent selection evidence.

## Local verification

```bash
npm ci
npm run check
npm run lint
npm test
npm run build
npm run legacy:scan
```

Database verification requires an isolated PostgreSQL database:

```bash
export DATABASE_URL=postgresql://...
npm run db:migrate
npm run db:checkpoint
SYNTHETIC_SHOWCASE_MODE=true SHOWCASE_PASSWORD='<unique local secret>' npm run db:seed
npm run test:integration
npm run test:integration:rerun
```

Synthetic credential authentication is disabled unless `SYNTHETIC_SHOWCASE_MODE=true`. The Showcase password has no repository default and must be supplied through the environment.

## Current engineering priority

```text
repository guidance alignment
→ replay / recovery / cancellation safety
→ mature auth and database tenant enforcement
→ canonical orchestration Product State
→ Context and Evidence
→ Capability Registry / Resolution / Asset Stage
→ teacher assignment and intervention
→ Retry / Transfer / Retention / Outcome
→ one real gap-driven asset adaptation or generation path
→ asset / routing / strategy optimization
→ Product Eval and online preview
```

PR #22 remains Draft until corrected requirements are independently reviewed and the Product Owner explicitly accepts the release. No implementation merge, preview, Pilot, production or cutover authority is implied by this README.
