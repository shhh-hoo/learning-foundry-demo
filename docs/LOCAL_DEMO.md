# Local-first demo

Localhost is the authoritative acceptance and recording environment. Online static deployment remains compatible but is not required.

## Start

Place both repositories beside each other:

```text
learning-foundry-demo/
standard-trainer-demo/
```

Then run from Learning Foundry:

```bash
npm run demo:local
```

The launcher starts fixed ports and prints:

```text
Foundry Experience: http://localhost:4173/?view=experience
Foundry Governance: http://localhost:4173/?view=governance
Standard Trainer:   http://localhost:4174/
```

It sets `VITE_TRAINER_URL=http://localhost:4174/`, stops both processes when either fails, and handles Ctrl+C cleanup. If the sibling checkout is missing, it exits with the expected location and clone command.

The production build falls back to `https://shhh-hoo.github.io/standard-trainer-demo/`. No iframe or cross-origin dependency is part of the core flow.

## Verify

```bash
npm run check
npm test
npm run build
```

Both views use a query parameter rather than history routing, so they continue to work in static GitHub Pages output.
