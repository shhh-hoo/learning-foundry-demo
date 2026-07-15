# Standard Trainer integration

Run `npm run export:components` before syncing. `npm run sync:trainer` copies only:

```text
manifest.json
diagnostic-learning-component.schema.json
kp-from-equilibrium-moles.json
stoichiometric-product-mass.json
```

Each component JSON wrapper begins with `_generated: "Generated from learning-foundry-demo. Do not edit manually."` The Trainer unwraps it, validates the complete nested value against the generated canonical JSON Schema, recomputes the content hash, enforces an exact manifest-to-file bijection, resolves internal references, verifies its capability profile, and selects a target adapter. Any mismatch fails closed before learner evidence is evaluated.

The Kp snapshot is a simplified migration with bounded happy-path compatibility. The legacy V2 reasoning graph, both accepted strategies, recognition gating, independent-stage evidence, assistance provenance, and full V2 failure taxonomy remain outside this published contract version.

The Trainer registry API supports list and version-aware get operations. Active attempts pin component ID, version, and publication hash. Trainer evidence records those values with the runtime version.

The sync is intentionally one-way. Foundry UI, drafts, rejected generated components, and evaluation reports are not copied into Trainer.
