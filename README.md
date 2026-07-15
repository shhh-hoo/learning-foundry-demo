# Learning Foundry Demo

Learning Foundry is the upstream authority for governed learning components. Standard Trainer is one downstream deterministic runtime.

This repository implements a Foundry-first vertical slice for CAIE 9701 Chemistry. It represents curriculum constraints, authors or deterministically simulates drafts, evaluates component reliability, requires subject-expert approval, publishes immutable versioned snapshots, and exports them for a bounded runtime.

> Automated component evaluation does not replace subject-expert approval. It detects structural, numerical and runtime-compatibility failures before expert review.

## Demo components

- `kp-from-equilibrium-moles@1.0.0`: a simplified migration from `KP_FROM_EQUILIBRIUM_MOLES_V2_GOLD`, with bounded happy-path compatibility and explicit omitted V2 capabilities.
- `stoichiometric-product-mass@1.0.0`: expert-authored mass calculation using `2Mg + O₂ → 2MgO`.
- `deterministic-demo-generator`: emits one valid and one deliberately invalid stoichiometry draft. It is a local simulation, not a model provider.

## Architecture

```text
CAIE 9701 Standard Pack
→ Author / deterministic generation
→ Foundry component evaluation
→ Expert review
→ Immutable published registry
→ Standard Trainer target adapter
→ Learner evidence trace
```

The canonical TypeScript contract and Zod runtime schema live in `src/contracts`. `dist-contract` is generated and is the only cross-repository integration surface. Foundry UI state is ephemeral; publication snapshots are deterministically reconstructed for the static demo.

## Run and verify

```bash
npm ci
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

## Boundaries

The current runtime capability supports `KP` and `MASS`. The schema can describe `KC`, `AMOUNT`, `CONCENTRATION`, `VOLUME`, `PH`, and `OTHER_BOUNDED`, but compatibility fails until a verified adapter exists. The demo does not support arbitrary chemistry questions, arbitrary generated content, OCR, authentication, a database, or server-side model calls. Its stable FNV-based content hash detects demo snapshot mutation; it is not a cryptographic identity or signature.

The broader v0.3 product pack describes a future learner-facing Chat / Library / Schedule system. This repository is the governed component-production infrastructure slice beneath that broader product and does not claim to implement those surfaces.

See [Architecture](docs/ARCHITECTURE.md), [Component Contract](docs/COMPONENT_CONTRACT.md), [Foundry Evaluation](docs/FOUNDRY_EVALUATION.md), [Expert Review](docs/EXPERT_REVIEW.md), [Trainer Integration](docs/TRAINER_INTEGRATION.md), [Demo](docs/DEMO.md), and [Case Study](docs/CASE_STUDY.md).
