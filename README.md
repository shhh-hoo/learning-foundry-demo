# Learning Foundry

Learning Foundry is an **AI Learning Orchestration Platform**.

This repository currently contains an internal stacked Showcase candidate. It is not a public preview, school Pilot, production deployment or learning-effectiveness claim.

Current documentation authority:

```text
shhh-hoo/learning-foundry-docs@05413353c5b4d231878747d307cb8dd3c232eeb1
```

Current local-showcase branch:

```text
agent/local-showcase-one-command
```

It is stacked on CAP-08B Draft PR #39 evidence head:

```text
da3985ca8030d2c18ab86b336927ae931cab9b63
```

## Try the product locally

Requirements:

- Node.js 20.9 or newer;
- Docker Desktop or another working Docker Engine with `docker compose`;
- npm.

Run:

```bash
npm run showcase
```

The launcher creates a dedicated local PostgreSQL database, applies migrations, seeds and verifies the four synthetic authentication identities, starts the separate Component Executor, starts Next.js, waits for health checks and prints the generated credentials.

Open:

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

The password is generated locally, printed in the terminal and stored only in ignored `.env.showcase.local`.

Use separate browser profiles or private windows to keep multiple roles signed in.

Complete instructions and the recommended walkthrough are in [`docs/LOCAL_SHOWCASE.md`](docs/LOCAL_SHOWCASE.md).

## Local-showcase commands

```bash
npm run showcase
npm run showcase:reset
npm run showcase:status
npm run showcase:stop
npm run showcase:destroy
npm run showcase:auth-check
```

`showcase:reset` resets only the dedicated `learning_foundry_showcase` Product State/checkpoint schemas and local uploads.

`showcase:destroy` removes the dedicated Docker volume, uploads and generated local credentials.

## What currently works

The current stacked product includes bounded implementations for:

```text
Task / Goal
→ Context Compiler
→ Diagnosis-driven Capability Resolution
→ Activity Planning
→ Asset Stage Runtime
→ Learning Events and Learner Attempt
→ Teacher Assignment and Intervention
→ Retry / Transfer / Retention
→ Capability Gap and Web ComponentAsset adaptation
→ checks / exact preview / expert confirmation
→ Registry availability and learner delivery
→ Asset Optimization Proposal
→ Routing Optimization Proposal
```

Product surfaces:

- Learner Workspace;
- Teacher Workspace;
- Capability Workshop;
- Engineering / Inspection.

The local showcase uses isolated synthetic data. Missing model-provider credentials remain visibly unavailable instead of being simulated.

## Important limits

The current product does not yet establish:

- an online preview;
- real institutional OIDC configuration;
- managed PostgreSQL or Object Storage;
- production tenant-isolation evidence;
- real learner or teacher validation;
- learning effectiveness;
- complete LearningOutcome evidence;
- launch readiness;
- merge or production-cutover authority.

All CAP packages remain stacked Draft PRs. `main` is not the current product branch.

## Engineering verification

```bash
npm ci
npm run validate
```

Database and browser suites require their isolated PostgreSQL setup. See the individual package evidence files under `docs/`.

## Product authority

Read `AGENTS.md` before implementation or review.

The current product core is:

```text
Context
+ Diagnosis
+ Capability Registry
+ Matching / Generation
+ Runtime Orchestration
+ Teacher Governance
+ Learning Feedback
```

A `ComponentAsset` is an executable, interactive or orchestratable learning tool or experience. It is not an article, PDF, page or CMS content record.

The generic CMS, giant manual Component editor and standalone publishing-workbench directions are superseded and must not be rebuilt.
