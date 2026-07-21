# Learning Foundry

Learning Foundry is an **AI Learning Orchestration Platform** that turns live learning evidence into the next governed learning activity.

The current trial stack is based on Draft PR #39 at exact head:

```text
da3985ca8030d2c18ab86b336927ae931cab9b63
```

It is an internal local Showcase candidate, not a public preview, school Pilot, production release or learning-effectiveness claim.

Current product authority:

```text
learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1
```

## Try the product locally

Requirements:

- Node.js 20.9 or newer;
- npm;
- Docker Desktop or another working Docker Engine with `docker compose`.

From this branch:

```bash
npm run showcase
```

That single command:

1. creates ignored local-only credentials;
2. starts a dedicated PostgreSQL 16 container;
3. installs locked dependencies when needed;
4. applies Product State and LangGraph checkpoint migrations;
5. seeds learner, teacher, expert and engineer accounts;
6. starts the separate Component Executor;
7. starts Next.js;
8. waits for both health endpoints;
9. prints the generated password and opens the sign-in page.

Default URL:

```text
http://127.0.0.1:3100/sign-in
```

Institution:

```text
checkpoint-showcase
```

Accounts:

```text
learner@showcase.invalid
teacher@showcase.invalid
expert@showcase.invalid
engineer@showcase.invalid
```

The generated password is printed at startup and stored only in ignored `.env.showcase.local`.

No model API key is required for the core deterministic product flow. Missing providers remain visibly unavailable rather than being simulated.

Detailed walkthrough, reset and troubleshooting instructions:

- [Local Showcase](docs/LOCAL_SHOWCASE.md)

Useful commands:

```bash
npm run showcase:status
npm run showcase:reset
npm run showcase:stop
npm run showcase:destroy
```

Press Ctrl+C to stop Next.js and Component Executor. The dedicated PostgreSQL data persists until reset or destroy.

## What currently works

The current stacked Draft product includes:

```text
Task / Goal
→ Context Compiler
→ Diagnosis Proposal
→ Capability Resolution
→ Activity Planning
→ exact ComponentAsset runtime
→ LearningEvents and LearnerAttempt
→ Teacher assignment and intervention
→ governed Retry / Transfer / Retention
→ real Capability Gap
→ Web ComponentAsset adaptation
→ checks and exact learner preview
→ authenticated expert confirmation
→ Registry availability and learner delivery
→ Asset Optimization Proposal
→ Routing Optimization Proposal
```

### Learner Workspace

Learners can:

- create and inspect database-backed Tasks and Episodes;
- converse inside Task-scoped Context;
- inspect selected and excluded Context;
- upload governed PDF/image learning materials;
- submit text or image/handwritten Attempts;
- trigger diagnosis-driven Capability Resolution;
- use an exact-version Web ComponentAsset;
- inspect honest cancellation, failure and bounded retry states;
- complete governed Retry / Transfer / Retention activities.

### Teacher Workspace

Teachers can:

- assign a Task to an enrolled learner;
- inspect exact Context, Diagnosis, Capability Resolution, ActivityPlan, RuntimeDelivery, Attempt and ordered LearningEvents;
- record explicit required/excluded Capability interventions;
- review governed follow-up results;
- inspect Asset and Routing Optimization proposals;
- record append-only human next actions without automatically changing policy or claiming Outcome.

### Capability Workshop

Experts can:

- inspect real persisted no-match / adaptation signals;
- create a bounded course-private Web ComponentAsset proposal;
- run deterministic checks;
- execute and reload an exact learner preview;
- confirm an immutable exact version;
- register it for scoped Capability Resolution;
- inspect exact-version delivery evidence;
- create evidence-bound Asset and Routing Optimization proposals.

The Workshop remains need-driven. It is not a generic CMS, giant editor or standalone publishing product.

### Engineering / Inspection

Engineers can inspect:

- LangGraph workflows, interrupts and checkpoints;
- Product State separately from operational/checkpoint state;
- retrieval and provider status;
- model calls and unavailable states;
- framework contract checks;
- Component evaluation, decision and delivery lineage;
- recoverable expired resume claims.

## Architecture

```text
Next.js App Router + React
        │
        ├── Learner Workspace
        ├── Teacher Workspace
        ├── Capability Workshop
        └── Engineering / Inspection
        │
        ▼
Application and domain services
        │
        ├── Context / Evidence / Diagnosis
        ├── Capability Resolution / Activity Planning
        ├── Asset Runtime / Follow-up / Governance
        └── Optimization proposals
        │
        ├───────────────┐
        ▼               ▼
LangGraph           Component Executor
checkpoints          bounded exact asset checks/preview
        │               │
        └───────┬───────┘
                ▼
PostgreSQL
  ├── foundry_product
  ├── foundry_operational
  └── langgraph_checkpoint
```

Canonical Product State, workflow checkpoint state and operational inspection records remain semantically separate even when the local Showcase uses one PostgreSQL instance.

## Standard development commands

```bash
npm ci
npm run check
npm run lint
npm test
npm run build
npm run legacy:scan
```

Database-backed verification requires an isolated PostgreSQL database. The guarded E2E path uses the exact local database name `learning_foundry_e2e` and refuses remote/reset-unsafe targets.

```bash
export E2E_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/learning_foundry_e2e'
export E2E_RESET_ALLOWED=true
export E2E_SHOWCASE_PASSWORD='a-unique-password-of-at-least-12-characters'

npm run test:e2e
```

## Optional providers

Provider-backed features are optional for the local synthetic Showcase:

- `DEEPSEEK_API_KEY` — grounded synthesis;
- `OPENAI_API_KEY` — embeddings and image/handwriting interpretation, optionally synthesis;
- `COHERE_API_KEY` — reranking;
- `LANGSMITH_API_KEY` — optional external tracing when explicitly enabled.

Unavailable providers must remain unavailable. Do not fabricate retrieval, synthesis, multimodal interpretation or evaluation success.

## Current boundaries

This repository does not currently claim:

- public online preview validation;
- live institutional OIDC validation;
- managed PostgreSQL or Object Storage provisioning;
- production tenant-isolation approval;
- real learner consent or school operations readiness;
- human-governance validation;
- learning effectiveness;
- accepted Doc 12 requirement completion;
- merge to `main`;
- production deployment or cutover.

The current goal is to make the real product inspectable and usable enough for Product Owner evaluation before adding more platform complexity.
