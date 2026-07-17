# Chemistry CAIE 9701 Reference Pack ownership

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Doc 17: §§1, 3, 4.1, 6–7, 13, 16A, 17–18 and 20. This inventory
records ownership; it does not claim that the listed files have been
physically extracted from their Legacy locations.

## Ownership rule

```text
Chemistry CAIE 9701 Reference Pack → Foundry Core
Foundry Core ✕ Chemistry CAIE 9701 Reference Pack imports
```

Foundry Core owns cross-disciplinary Task, Episode, Event, Evidence,
Capability, Component, Review, Retry and Outcome meaning. The Pack owns
the Chemistry assets, mappings, deterministic diagnosis vocabulary and
compatibility Adapters that supply those capabilities.

## Current inventory

| Pack responsibility | Current production locations | Extraction status | Notes |
|---|---|---|---|
| CAIE 9701 curriculum metadata and calculation taxonomy | `src/standards/caie-9701.ts`, `src/corpus/types.ts`, `config/capabilities/registry.json` | `CURRENT_LEGACY` | The existing corpus contract still requires CAIE/9701 metadata. |
| Chemistry corpus parsers, enrichers and source registration | `scripts/lib/corpus-ingestion.ts`, `scripts/lib/corpus-repository.ts`, `src/corpus/delivery-policy.ts`, `config/corpus/delivery-policy.json` | `CURRENT_LEGACY` | Retrieval remains the governed Legacy lexical path; no engine or delivery-policy change is part of this PR. |
| Chemistry diagnostic Component contracts and schemas | `src/contracts/diagnostic-component.ts`, `src/contracts/published-component.ts`, `src/contracts/expression-ast.ts` | `CURRENT_LEGACY` | These are Pack-specific compatibility contracts, not domain-neutral Core contracts. |
| Chemistry Component definitions | `src/components/kp-from-equilibrium-moles.ts`, `src/components/stoichiometric-product-mass.ts`, `src/components/shared.ts` | `REGISTERED` | Existing bytes, IDs, versions and publication hashes remain unchanged and are registered through the Pack. |
| Standard Trainer capability profile and transport | `src/runtime/capability.ts`, `src/runtime/learning-capability-runtime.ts` | `REGISTERED` | The Pack registers the existing capability. The Legacy Trainer remains the current Adapter and behavior is unchanged. |
| Chemistry Attempt canonicalization and problem provenance | `src/agent/tool-executor.ts`, `src/agent/problem-context-provenance.ts` | `CURRENT_LEGACY` | This coupling remains in the Legacy Agent composition pending controlled extraction after the Control Plane work integrates. |
| Chemistry Component checks and domain graders | `src/governance/component-contract-checks.ts`, `src/runtime/preview-adapter.ts`, Chemistry-tagged AgentEval cases | `CURRENT_LEGACY` | AgentEval case and grader meaning is unchanged. |
| Pack-specific Activity renderers | Standard Trainer and current demo surfaces | `NOT_EXTRACTED` | No new renderer contract is claimed by this PR. |
| Pack terminology and Concept Scheme | Embedded in the files above | `NOT_EXTRACTED` | A reviewed independent Concept Scheme does not yet exist. |

## Compatibility and non-claims

The Pack registration is a real loadable entrypoint over current assets,
not a physical relocation. Existing imports continue through compatibility
exports while component export and the Agent capability entrypoint read the
registered Pack.

This work does not claim:

- full physical Pack extraction;
- cross-disciplinary runtime validation;
- a new curriculum, retrieval or Agent authority;
- a separate Pack product-state machine;
- permission to delete Legacy contracts or Adapters.

