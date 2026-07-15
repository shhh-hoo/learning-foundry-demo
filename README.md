# Learning Foundry

Learning Foundry is a small, runnable product system for improving governed learning tools from real learner evidence.

- **Learner Workspace** helps an individual learner ask for a bounded diagnosis, save a correction and schedule delayed practice.
- **Foundry Studio** helps teachers and learning-product teams turn repeated evidence into an evaluated, expert-approved component revision.
- **Standard Trainer** executes immutable learning contracts and returns the first pedagogical error.
- **Demo Shell** explains the relationship without contaminating any product interface with portfolio narration.

The canonical demo is the localhost, event-driven product story. The previous MP4 remains in `demo-recording/` as an archived walkthrough.

## Run the product story

Place `learning-foundry-demo` and `standard-trainer-demo` beside each other, then run:

```bash
npm install
npm run demo:local
```

The launcher starts and monitors:

- Demo Shell — `http://127.0.0.1:4173/?view=demo`
- Learner Workspace — `http://127.0.0.1:4173/?view=learner`
- Foundry Studio — `http://127.0.0.1:4173/?view=studio`
- Engineering Inspector — `http://127.0.0.1:4173/?view=inspector`
- Standard Trainer — `http://127.0.0.1:4174/`
- Local Demo Registry — `http://127.0.0.1:4175/health`

`npm run storyboard` drives the complete six-scene flow with Playwright and refreshes the seven 1920×1080 images in [`demo-storyboard/`](demo-storyboard/storyboard.md).

## Product causality

The initial repository contains exactly two historical ratio-error fixtures and no candidate. The current learner diagnosis persists `evidence-mgo-ratio-current`; aggregation then reaches three matching traces, emits `PATTERN_THRESHOLD_REACHED`, and enables explicit candidate creation.

After evaluation and expert approval, publishing creates an immutable v1.1.0 snapshot. The localhost registry validates its schema, status and content hash before accepting it. Standard Trainer independently fetches and validates that snapshot, merges it with bundled components, selects the highest compatible version and renders its strengthened hint after a deterministic diagnosis.

## Verification

```bash
npm test
npm run check
npm run build
```

The static build remains compatible with GitHub Pages and does not require the local registry. Dynamic cross-repository publication is intentionally localhost-only.

## Documentation

- [Product surfaces](docs/PRODUCT_SURFACES.md)
- [Demo Shell](docs/DEMO_SHELL.md)
- [Typed event protocol](docs/DEMO_EVENT_PROTOCOL.md)
- [Local registry bridge](docs/LOCAL_REGISTRY_BRIDGE.md)
- [Storyboard](docs/STORYBOARD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Case study](docs/CASE_STUDY.md)
- [Local demo operations](docs/LOCAL_DEMO.md)
