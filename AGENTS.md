# Learning Foundry Implementation Instructions

## Authoritative documentation

The architecture and product source of truth is:

`learning-foundry-docs@e6ec2408d18fc6850e92c996b36712dbd5be9df5`

Before architecture, runtime, Eval, Retrieval, Product State, Component
or governance work, read the following documents at that authority commit:

1. `docs/00-current-mvp-contract.md`
2. `docs/03-system-architecture.md`
3. `docs/09-eval-and-governance.md`
4. `docs/12-docs-demo-traceability.md`
5. `docs/13-design-debt-and-phasing.md`
6. `docs/14-runtime-adoption-and-migration-program.md`

The current implementation baseline is:

`learning-foundry-demo@107bd9335430a28aacfc856a76e54a17d11792e4`

When instructions conflict, follow:

`Current MVP Contract > accepted ADR > active domain document > implementation prose > task prompt > fixtures`

Do not allow implementation details or framework APIs to redefine the
Learning Foundry domain model.

## Current implementation milestone

The current milestone is an enabling substep of Cross-disciplinary Core
contracts:

`Establish replaceable runtime boundaries and Legacy adapters`

The objective is to make current commodity infrastructure replaceable
without changing current product behavior.

This milestone may include:

- current behavior characterization;
- minimal framework-neutral boundaries backed by real current code;
- explicit Legacy or local-showcase adapters;
- entrypoint wiring through those boundaries;
- focused contract and parity tests;
- correction of empty AgentEval selection behavior;
- distinction between `UNPLANNED`, `NOT_RUN`, `PARTIAL` and `COMPLETE`;
- implementation-specific documentation and acceptance evidence.

This milestone does not include:

- Mastra or another framework integration;
- runtime authority switching;
- Product State migration;
- full Chemistry Reference Pack physical extraction;
- retrieval-engine replacement;
- Eval release-gate replacement;
- Legacy implementation deletion.

## Learning Foundry authority

Learning Foundry owns:

- LearningTask, LearningEpisode and ConversationEvent semantics;
- Context scope, lifecycle, carryover and conflict policy;
- EvidenceUnit, source authority, provenance and rights;
- Concept, Task Type and Curriculum relationships;
- Capability contracts and capability-resolution policy;
- LearnerAttempt and DiagnosticObservation semantics;
- TeacherReview, RetryAttempt and LearningOutcome semantics;
- Component contracts, checks, versions and publication gates;
- route and orthogonal obligations;
- `sourceRefs` and `evidenceRefs` as separate reference classes;
- Eval cases, graders, eligibility and release gates;
- teacher and expert governance decisions.

A framework may execute, store or display these contracts. It must not
replace them with its own memory, workflow state, prompt format, trace
schema or evaluation ontology.

Agent memory, conversation history, summaries and runtime snapshots are
not canonical Product State.

Model output must not directly become canonical TeacherReview,
LearningOutcome or a published Component.

## Core and Reference Pack boundary

Cross-disciplinary Core contracts must not require:

- CAIE;
- syllabus 9701;
- Chemistry;
- MgO;
- Calculation Family;
- Standard Trainer;
- a specific model provider;
- a specific Agent or workflow framework;
- a specific retrieval or Eval platform;
- a fixed component or golden-case entity.

The following current behavior belongs conceptually to the Chemistry
CAIE 9701 Reference Pack:

- CAIE and 9701 metadata;
- Calculation Families;
- Chemistry corpus parsers and enrichers;
- stoichiometry and MgO canonicalization;
- Chemistry target and failure-code contracts;
- Standard Trainer adapters;
- Chemistry components and domain graders.

Do not claim domain neutrality merely by renaming Chemistry-specific
fields.

## Infrastructure adoption sequence

Every commodity infrastructure replacement follows:

`characterization → stable contract → Legacy adapter → candidate shadow
adapter → case-level parity → authority decision → separate Legacy
deletion`

Do not:

- introduce a candidate framework before the stable boundary exists;
- make a candidate authoritative in its first integration PR;
- delete the Legacy path in a candidate adapter PR;
- let candidate failure affect the authoritative path;
- let shadow execution write canonical Product State;
- weaken policy or graders to achieve parity.

## Boundary design rules

Do not create one universal platform interface.

A boundary is justified only when:

1. there is a current implementation behind it;
2. at least one real entrypoint is rewired to use it;
3. there is a credible candidate replacement;
4. focused tests define the contract;
5. it preserves route, obligation, provenance, permission and reference
   integrity;
6. it provides the evidence required for later case-level comparison.

Do not create empty interfaces for every item in the long-term
architecture map.

Do not force Agent Runtime and Workflow Runtime into separate interfaces
unless the current code and responsibility boundaries justify the split.

Name contracts after their actual responsibility rather than a desired
framework abstraction.

## Foundry policy must remain outside commodity adapters

Do not move these authorities into a provider or framework adapter:

- route classification;
- route obligations;
- required and forbidden tool rules;
- ordered capability resolution;
- source/evidence reference validation;
- problem-context provenance;
- corpus delivery policy;
- Component contract checks;
- Component publication rules;
- AgentEval cases and graders.

Adapters invoke these policies; adapters do not own them.

## Eval rules

The following are authoritative assets:

- `agent-eval/cases.jsonl`;
- versioned behavioral baselines;
- suite layers and dimensions;
- eligibility semantics;
- deterministic and domain graders.

Current recorded facts:

- checkpoint: 6/6 live validated;
- versioned 1.2.0 baseline: 18/18 live validated;
- AgentEval 2.0.0: 73 cases defined;
- full 73-case live suite: not validated;
- Learning Loop planned cases: 0;
- current implementation reports this as `NOT_RUN`;
- current explicit empty selection can exit successfully with `0/0`.

Required behavior:

- planned cases = 0 reports `UNPLANNED`;
- an explicitly selected empty layer or dimension fails with a non-zero
  exit;
- a subset run never reports complete full-suite coverage;
- a defined case is not represented as executed or passed.

Do not invent Learning Loop cases merely to remove the `UNPLANNED`
state.

## Evidence and privacy

Preserve:

- PRODUCT and AGENT_EVAL physical and semantic separation;
- exact provenance requirements;
- source/evidence reference separation;
- corpus delivery-policy enforcement;
- private-source protections;
- fail-closed behavior;
- content hashes and version integrity;
- append-only correction semantics.

Never commit:

- API keys;
- Authorization headers;
- raw private PDFs;
- generated private corpus excerpts;
- hidden model reasoning;
- `.local-data`;
- local absolute paths.

Do not weaken a safety, provenance or delivery check to make tests pass.

## Change discipline

Before behavior-bearing refactoring:

1. identify existing characterization tests;
2. add missing behavior tests;
3. make the smallest coherent change;
4. run focused tests;
5. run full automated validation;
6. inspect the complete diff;
7. remove dead exploratory code and accidental abstraction.

Do not rewrite unrelated modules.

Do not add a production dependency unless the task explicitly
authorizes it.

Do not reset, overwrite or delete unrelated user changes.

## Required validation

For implementation changes run:

```bash
npm test
npm run check
npm run build
git diff --check
```

Live AgentEval commands may be run only when the real DeepSeek
configuration, required services and governed corpus are available.

Otherwise report:

`NOT RUN — required live environment unavailable`

Do not substitute fixture tests and describe them as live validation.

## Git and pull requests

Work from the latest `main` on a dedicated branch.

Use focused checkpoint commits when the task has multiple phases.

Do not force push, rewrite `main` or auto-merge.

Every architecture-boundary PR must include:

`Docs authority: learning-foundry-docs@e6ec2408d18fc6850e92c996b36712dbd5be9df5`

Before opening a PR:

- inspect the complete diff;
- confirm no new framework dependency;
- confirm no Legacy path was deleted;
- confirm no current behavior was intentionally changed except explicitly
  authorized corrections;
- list automated checks actually run;
- list live checks actually run or not run;
- state remaining Chemistry coupling;
- state whether deletion authority exists.

## Review guidelines

Treat these as blocking issues:

- Core types require CAIE, 9701, Chemistry, MgO or Standard Trainer.
- A framework API becomes the de facto domain contract.
- Product State is delegated to Agent memory.
- `sourceRefs` and `evidenceRefs` are merged.
- provenance or delivery-policy validation is weakened.
- an empty Eval selection exits successfully.
- a subset Eval run is reported as complete coverage.
- a candidate runtime affects the authoritative product path.
- a Legacy implementation is deleted without accepted parity and
  deletion authority.
- model output directly creates TeacherReview, LearningOutcome or a
  published Component.
