# Local demo

Keep `learning-foundry-demo` and `standard-trainer-demo` as sibling checkouts. Then run:

```bash
npm run demo:local
```

The launcher uses strict ports 4173, 4174 and 4175, checks the sibling checkout, waits for registry health, resets the registry session, prints every route and terminates all child processes if one exits or Ctrl+C is received.

The localhost demo is authoritative because it can demonstrate dynamic publication across repositories. Learning Foundry POSTs a canonical immutable snapshot to port 4175; Standard Trainer fetches and revalidates it before selection. The online GitHub Pages builds remain static and cannot perform this dynamic bridge.

Generate the product story after startup:

```bash
npm run storyboard
```

Verification remains:

```bash
npm test
npm run check
npm run build
```
