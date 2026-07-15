# Learning Foundry Demo

Learning Foundry connects learner-facing product experience to governed learning components. Standard Trainer is one downstream deterministic runtime.

This repository implements two query-routed surfaces for a CAIE 9701 Chemistry vertical slice:

- `?view=experience`: Chat, Library, Schedule, learning evidence, and Conversation-to-Component promotion.
- `?view=governance`: standard packs, deterministic authoring, Foundry evaluation, expert review, immutable publication, and runtime preview.

> Automated component evaluation does not replace subject-expert approval. It detects structural, numerical and runtime-compatibility failures before expert review.

## Demo components

- `kp-from-equilibrium-moles@1.0.0`: a simplified migration from `KP_FROM_EQUILIBRIUM_MOLES_V2_GOLD`, with bounded happy-path compatibility and explicit omitted V2 capabilities.
- `stoichiometric-product-mass@1.0.0`: expert-authored mass calculation using `2Mg + O₂ → 2MgO`.
- `deterministic-demo-generator`: emits one valid and one deliberately invalid stoichiometry draft. It is a local simulation, not a model provider.

## Architecture

```text
Product Experience (Chat / Library / Schedule / Evidence)
→ capability routing through trusted standards and published components
→ Conversation-to-Component candidate
→ Governance (evaluation / expert review / publication)
→ Standard Trainer deterministic runtime
```

The canonical TypeScript contract and Zod runtime schema live in `src/contracts`. `dist-contract` is generated and is the only cross-repository integration surface. Experience session state uses browser `localStorage`; no database or identity claim is introduced.

## Run and verify

```bash
npm ci
npm run demo:local
```

The local demo starts:

```text
Foundry Experience: http://localhost:4173/?view=experience
Foundry Governance: http://localhost:4173/?view=governance
Standard Trainer:   http://localhost:4174/
```

The sibling `../standard-trainer-demo` checkout is required. The launcher reports an explicit clone instruction when it is absent and shuts both processes down together.

Verification commands:

```bash
npm run check
npm test
npm run build
npm run export:components
```

To sync only published artifacts into a sibling Trainer checkout:

```bash
npm run sync:trainer
```

Set `TRAINER_REPO=/path/to/checkout` when the sibling checkout is not at `../standard-trainer-demo`.

## Product boundaries

Chat is deterministic orchestration, not a general assistant and not an external model call. The three similar learner traces are seeded fixtures, not production analytics. The demo has no multi-user backend, authentication, student database, or production identity. The current runtime supports `KP` and `MASS`; other target kinds fail compatibility until a verified adapter exists.

Conversation-derived provenance is draft-only metadata. Published components retain the existing `EXPERT_AUTHORED` contract origin and require the existing evaluation, approval, versioning, and publication path.

See [Product Experience](docs/PRODUCT_EXPERIENCE.md), [Conversation to Component](docs/CONVERSATION_TO_COMPONENT.md), [Local Demo](docs/LOCAL_DEMO.md), [Architecture](docs/ARCHITECTURE.md), [Demo](docs/DEMO.md), and [Case Study](docs/CASE_STUDY.md).
