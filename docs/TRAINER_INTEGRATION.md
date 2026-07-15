# Standard Trainer integration

Run `npm run export:components` before syncing. `npm run sync:trainer` copies only:

```text
manifest.json
kp-from-equilibrium-moles.json
stoichiometric-product-mass.json
```

Each JSON wrapper begins with `_generated: "Generated from learning-foundry-demo. Do not edit manually."` The Trainer unwraps, validates schema-required fields, recomputes the content hash, checks manifest identity, resolves internal references, verifies its capability profile, and selects a target adapter. Any mismatch fails closed before learner evidence is evaluated.

The Trainer registry API supports list and version-aware get operations. Active attempts pin component ID, version, and publication hash. Trainer evidence records those values with the runtime version.

The sync is intentionally one-way. Foundry UI, drafts, rejected generated components, and evaluation reports are not copied into Trainer.

