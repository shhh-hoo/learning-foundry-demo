# Component contract

`DiagnosticLearningComponent` is target-generic and schema-versioned. It includes curriculum provenance, presentation, authored facts, a bounded target, formula ASTs, a dependency graph, accepted strategies, diagnosis and hint policies, a mark scheme, origin provenance, review metadata, and publication metadata.

Supported AST nodes are `NUMBER`, `VARIABLE`, `BINARY`, and `FUNCTION:SUM`. Variables resolve by authored fact ID or reasoning-node ID; display symbols carry no authority.

`PublishedDiagnosticLearningComponent` additionally requires:

- `status: PUBLISHED`;
- expert review metadata;
- publisher and timestamp;
- a stable content hash;
- a schema version supported by the downstream runtime;
- an executable target kind and expression node set.

`KP` and `MASS` are executable in this release. Other declared target kinds remain schema-valid but runtime-incompatible. This is an intentional distinction, not a hidden fallback.

The generated artifacts are:

- `diagnostic-learning-component.schema.json`;
- `component-contract.d.ts`;
- `published-components.json`;
- `manifest.json`;
- one immutable JSON snapshot per published component.

