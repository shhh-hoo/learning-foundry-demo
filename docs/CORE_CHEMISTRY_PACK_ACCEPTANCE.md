# Core / Chemistry Pack acceptance

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Doc 17: §§1, 3, 4.1, 6–7, 13, 16A, 17–18 and 20. The contracts
preserve accepted ADR-002 and ADR-004: append-only Conversation Events,
canonical source/human records and derived representations remain distinct.

Implementation lane: product-critical Core / Reference Pack.

## Purpose and scope

This change establishes a loadable Chemistry CAIE 9701 Reference Pack,
domain-neutral Core contracts and a one-way dependency rule while
preserving the current learner path.

Included:

- a truthful Chemistry ownership inventory;
- `ReferencePackManifest` with `CURRENT_LEGACY`, `REGISTERED` and
  `NOT_EXTRACTED` status at asset level;
- a registry Module that rejects duplicate Pack, Capability and Component
  identities;
- Core Task, Episode, Event, Evidence, Capability, Component, Attempt,
  Observation, Review, Retry and Outcome contracts;
- distinct source and internal Evidence reference classes;
- a Core Capability Runtime port with the current Trainer as its Legacy
  Adapter;
- Chemistry compatibility Adapters for current Components and Agent
  capability records;
- real Component export, Registry seed and Agent capability entrypoint
  wiring through the registered Pack;
- scoped import, contract, union, Runtime and schema leakage checks.

Not included:

- mass physical relocation;
- Agent routing or tool-policy changes;
- Retrieval replacement;
- Product State persistence;
- Candidate Runtime work;
- AgentEval case, grader or release-gate changes;
- Legacy deletion.

## Behavior and integrity

Current published Component definitions, IDs, versions, publication
metadata and content hashes remain unchanged:

```text
kp-from-equilibrium-moles@1.0.0       lfh1-a007587f
stoichiometric-product-mass@1.0.0    lfh1-65c2876d
```

The old `src/components/published.ts` import remains a compatibility
export. Standard Trainer still receives the same governed identity and
payload and remains the current deterministic Diagnosis Adapter.

## Leakage enforcement

Production scanning is deliberately scoped to:

```text
src/core/domain/**
src/core/application/**
src/core/ports/**
```

It checks import direction, required public fields, Core-owned literal
unions, Runtime dependencies and schema/config dependencies. String-like
domain-term detection supplements those structural checks. Pack code,
compatibility Adapters, tests, fixtures, documentation and AgentEval
metadata may contain domain terms.

`known-core-chemistry-leakages.json` is an exact, reviewed exception file.
Its current maximum and entry count are both zero. The count can shrink;
increasing its reviewed maximum is an explicit architecture disclosure.

## Canonical and derived records

- Task and Episode identity, status and linkage are canonical; Episode
  summary is derived.
- Conversation Event is append-only canonical interaction history.
- Attempt and human Review/Decision are canonical.
- Observation identity, provenance and correction chain are canonical;
  diagnosis payload is derived and versioned.
- Runtime, Retrieval and Agent Traces are derived operational Evidence.

This PR defines contracts only. Canonical persistence and environment
cutover remain the Product State vertical slice.

## Authority, limitations and rollback

Authority change: Core / Pack ownership is clarified. Learner behavior,
Runtime authority, Retrieval authority, AgentEval release gates and
publication authority are unchanged.

Remaining Chemistry coupling is recorded in
`docs/CHEMISTRY_REFERENCE_PACK_OWNERSHIP.md`; notably corpus shapes,
ingestion, Agent Attempt canonicalization, domain checks and renderers
remain in Legacy physical locations.

Rollback is a revert of this PR. There is no data migration, authority
cutover or destructive write. Compatibility exports retain the former
import paths.

Candidate authority: **NOT GRANTED**.

Release-gate authority: **NOT GRANTED**.

Legacy deletion authority: **NOT GRANTED**.

## Validation

Required automated validation:

```text
npm run core:leakage
npm test
npm run check
npm run build
npm run policy:audit
git diff --check
```

Recorded result at this branch head:

```text
npm run core:leakage  2/2 passed; zero Core violations; allowlist 0/0
npm test              38 files, 249 tests passed after PR 1 integration
npm run check         passed
npm run build         passed
npm run export:components  passed; immutable export files unchanged
npm run runtime:parity:fixture  EXACT_MATCH after PR 1 integration
git diff --check      passed
```

`npm run policy:audit` reports no new finding in this PR's production or
documentation files and exits successfully. The authority-sync base
already contains twelve reported terminology findings in historical
acceptance prose, the Wave contract and one existing AgentEval test. This
PR does not weaken the audit or rewrite unrelated historical records.

No live model run is required: this PR changes ownership and type/runtime
entrypoint wiring without changing Agent behavior. Fixture evidence is not
reported as live validation.
