# Learning Foundry Implementation Instructions

## Authoritative documentation

The architecture and product source of truth is:

`learning-foundry-docs@89c7c21dfb09ecd042070e823b2505f3a73f8169`

Before architecture, runtime, Eval, Retrieval, Product State, Component,
Reference Pack or governance work, read the following documents at that
authority commit:

1. `docs/00-current-mvp-contract.md`
2. `docs/15-human-development-handoff.md`
3. `docs/03-system-architecture.md`
4. `docs/12-docs-demo-traceability.md`
5. `docs/14-runtime-adoption-and-migration-program.md`
6. `docs/16-engineering-history-and-decision-rationale.md`
7. `docs/09-eval-and-governance.md`
8. `docs/13-design-debt-and-phasing.md`

The current implementation baseline is:

`learning-foundry-demo@8af1ce29e2024ae0d1b45591a570141bb709044f`

That baseline includes:

- stable current-code-backed runtime boundaries and Legacy adapters;
- a default-off, authoritative-first, candidate-neutral shadow foundation;
- purpose-and-role-separated runtime evidence;
- a case-level runtime parity foundation;
- corrected AgentEval empty-selection and coverage semantics.

When instructions conflict, follow:

`Current MVP Contract > accepted ADR > active domain document > implementation repository prose > task prompt > fixtures`

Historical PR descriptions explain the evidence and scope that existed at
the time. They do not override the current merged documentation.

Do not allow implementation details, a framework API, an Agent memory
format or a candidate trace schema to redefine the Learning Foundry domain
model.

## Current implementation status

The following foundations are merged:

```text
stable boundaries and Legacy adapters                 MERGED
candidate-neutral shadow execution                    MERGED / default-off
case-level runtime parity                             MERGED / harness validated
real candidate RuntimeExecutor                        ABSENT
candidate checkpoint or baseline parity               NOT EXECUTED
candidate runtime authority                           NOT GRANTED
AgentEval release-gate authority change               NOT GRANTED
Legacy deletion authority                             NOT GRANTED
canonical Product State migration                     NOT STARTED
full AgentEval 2.0.0 73-case live validation          NOT VALIDATED
```

Legacy DeepSeek execution remains the only authoritative learner-facing
runtime.

`runtime:parity:self-check` validates evidence mapping and comparison
plumbing. It is not candidate parity and it is not a quality pass for a
failed authoritative case.

## Current development program

### Product-critical lane

The current product-critical milestone is the remaining part of
Cross-disciplinary Core contracts:

`Define domain-neutral Core contracts and the Chemistry CAIE 9701 Reference Pack boundary.`

This lane may include:

- a concrete inventory of Chemistry-specific coupling;
- a type-checkable or loadable Chemistry Reference Pack manifest;
- explicit mapping of current Chemistry parsers, schemas, capabilities,
  components and graders into the Pack;
- domain-neutral Core relationships for Task, Evidence, Capability,
  Component, Review, Retry and Outcome;
- dependency and contract tests that prevent new Chemistry leakage into
  Core;
- compatibility adapters that preserve the current Chemistry reference
  path;
- implementation and docs traceability updates.

Prefer a manifest, ownership map, adapter contract and leakage tests before
large-scale physical file movement.

Do not claim generalization merely because Chemistry-specific names were
renamed.

The product-critical lane must not be blocked by a candidate framework
experiment.

After the Core / Reference Pack boundary, the next product milestone is
canonical persistent Product State and a real Learning Loop.

### Candidate-experiment lane

One separately reviewed, default-off candidate `RuntimeExecutor` adapter
may be developed in parallel.

A candidate experiment must:

- implement only the stable runtime contract plus provider/framework
  translation;
- consume the existing Foundry-owned request, Execution Plan, obligations,
  tools, policy snapshot and response contract;
- remain disabled by default;
- run only after authoritative execution succeeds;
- return no learner-facing result;
- write no canonical Product State;
- use no authoritative trace writer;
- propagate `AbortSignal` through model, tool and write boundaries;
- emit provider-neutral runtime records for case-level comparison;
- remain independently revertible.

The candidate-experiment lane must not:

- move Foundry policy into framework prompts or workflow state;
- add a candidate-authoritative mode;
- weaken cases, graders, provenance, delivery policy or reference
  integrity;
- switch runtime authority;
- change the AgentEval release gate;
- delete Legacy implementations;
- bundle Product State or Retrieval migration.

Mastra, LangGraph, AI SDK or another framework may be evaluated as a
candidate. None is preselected by repository popularity or feature lists.

## Current milestone non-scope

Unless a task is explicitly authorized as a separate architecture change,
do not include:

- runtime authority switching;
- AgentEval release-gate switching;
- Legacy deletion;
- Product State migration inside a runtime candidate PR;
- retrieval-engine replacement;
- full Chemistry Reference Pack physical relocation;
- automated TeacherReview, LearningOutcome or Component publication;
- a claim that the full 73-case suite has passed;
- a universal platform interface or speculative empty boundaries.

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

The following current behavior belongs conceptually to the Chemistry CAIE
9701 Reference Pack:

- CAIE and 9701 metadata;
- Calculation Families;
- Chemistry corpus parsers and enrichers;
- stoichiometry and MgO canonicalization;
- Chemistry target and failure-code contracts;
- Standard Trainer adapters;
- Chemistry components and domain graders.

Core defines shared product objects and lifecycle. The Pack supplies
domain assets, mappings, adapters and domain-specific evaluators.

Do not create a separate product state machine for each Pack.

## Infrastructure adoption sequence

Every commodity infrastructure replacement follows:

`characterization → stable Foundry-owned contract → Legacy adapter → candidate shadow adapter → case-level parity → operational and privacy review → explicit authority decision → separate Legacy deletion`

The stable-boundary, Legacy-adapter, shadow-foundation and parity-foundation
steps now exist for Agent / Workflow execution.

Their existence does not grant authority to a future candidate.

Do not:

- make a candidate authoritative in its first integration PR;
- delete the Legacy path in a candidate adapter PR;
- let candidate failure affect the authoritative path;
- start a shadow before authoritative success;
- let shadow execution write canonical Product State;
- mix PRODUCT and AGENT_EVAL runtime evidence physically;
- weaken policy or graders to achieve parity;
- interpret CI success alone as an authority decision.

## Boundary design rules

Do not create one universal platform interface.

A boundary is justified only when:

1. there is a real implementation behind it;
2. at least one real entrypoint is wired to it;
3. there is a credible replacement candidate;
4. focused tests define the contract;
5. it preserves route, obligation, provenance, permission and reference
   integrity;
6. it provides evidence required for later case-level comparison.

Do not create empty interfaces for every item in the long-term architecture
map.

Do not force Agent Runtime and Workflow Runtime into separate interfaces
unless independent lifecycle, persistence or permission boundaries justify
the split.

Name contracts after their actual responsibility rather than a desired
framework abstraction.

Remote-capable repository contracts must not be made synchronously
in-memory-only.

Persisted record shapes must receive a schema-version change when their
lifecycle or required semantics change. Current runtime records write
schema `1.1.0`; terminal-only `1.0.0` records remain a read-compatibility
format.

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
- AgentEval cases, graders, eligibility or release gates.

Adapters invoke these policies; adapters do not own them.

Capability identity is authoritative at the Learning Capability contract.
An adapter must not execute a payload whose embedded component identity or
version conflicts with the requested capability identity.

## Runtime shadow and evidence rules

Authoritative execution must complete successfully before a shadow starts.
This is a governance and delivery gate, not only a scheduling choice.

Authoritative and shadow executors receive separately cloned, recursively
immutable normalized requests.

Runtime evidence is physically separated as:

```text
runtime-executions/
├── product/
│   ├── authoritative/
│   └── shadow/
└── agent-eval/
    ├── authoritative/
    └── shadow/
```

Recorder reads and waits must specify both `runPurpose` and execution role.

Shadow lifecycle evidence distinguishes:

- `RUNNING`;
- `COMPLETED`;
- `FAILED`;
- `TIMED_OUT`;
- `NOT_CONFIGURED`;
- genuinely absent candidate evidence.

Only completed authoritative execution IDs are eligible for shadow polling.
An authoritative infrastructure failure takes precedence over candidate
absence.

Execution-local result IDs, trace IDs and diagnosis IDs must be normalized
through governed lineage before cross-runtime comparison.

## Eval and parity rules

The following remain authoritative assets:

- `agent-eval/cases.jsonl`;
- versioned behavioral baselines;
- suite layers and dimensions;
- eligibility semantics;
- deterministic and domain graders.

Current recorded facts:

- the historical checkpoint at the PR #5 migration baseline passed 6/6;
- the versioned 1.2.0 baseline at that migration baseline passed 18/18;
- AgentEval 2.0.0 defines 73 cases;
- the complete 73-case live suite has not been validated;
- Learning Loop has zero planned cases;
- the current implementation reports zero planned cases as `UNPLANNED`;
- an explicitly selected empty layer or dimension fails non-zero;
- subset execution cannot claim complete full-suite coverage;
- the final immutable post-foundation checkpoint evidence was 5/6, with
  one `INVALID_AGENT_RESPONSE` infrastructure failure;
- its Legacy self-comparison preserved five exact cases plus one
  authoritative infrastructure failure and exited `4`.

Do not invent Learning Loop cases merely to remove `UNPLANNED`.

A defined case is not an executed or passed case.

A parity report separates:

- behavioral equivalence;
- directional governed quality;
- operational impact.

Direction matters:

```text
Legacy pass   → Candidate fail = CANDIDATE_REGRESSION
Legacy fail   → Candidate pass = CANDIDATE_IMPROVEMENT / REVIEW_REQUIRED
Legacy fail   → Candidate fail = SHARED_QUALITY_FAILURE / REVIEW_REQUIRED
both pass                       = QUALITY_MATCH
```

The same directional rule applies to required tools, forbidden tools and
evidence integrity.

Latency, token or cost differences are `REVIEW_REQUIRED` unless explicit
thresholds and approval say otherwise. They must not be automatically
called acceptable.

Do not reduce parity to one aggregate pass rate. Preserve exact case-level
differences and eligible denominators.

## Evidence, privacy and delivery authorization

Preserve:

- PRODUCT and AGENT_EVAL physical and semantic separation;
- exact provenance requirements;
- source/evidence reference separation;
- corpus delivery-policy enforcement;
- private-source protections;
- fail-closed behavior;
- content hashes and version integrity;
- append-only correction semantics.

Technical environment availability and data-delivery authorization are
separate gates.

Before a live external-model run, confirm both:

1. the key, model, governed corpus, Registry and Trainer services are
   technically available;
2. the configured provider, purpose, distribution scope and source type
   are explicitly approved by delivery policy.

Do not report an authorization block as an unavailable environment.

Never commit:

- API keys;
- Authorization headers;
- raw private PDFs;
- generated private corpus excerpts;
- hidden model reasoning;
- `.local-data`;
- `.runtime-parity-results`;
- local absolute paths.

Do not weaken a safety, provenance or delivery check to make tests pass.

## Change discipline

Before behavior-bearing work:

1. inspect current docs authority and the relevant acceptance records;
2. identify existing characterization tests;
3. add missing tests before changing a governed behavior;
4. make the smallest coherent change;
5. run focused tests;
6. run full automated validation;
7. inspect the complete diff;
8. remove dead exploratory code and accidental abstraction;
9. update implementation and docs traceability when status changes.

Do not rewrite unrelated modules.

Do not add a production dependency unless the task explicitly authorizes
it.

Do not reset, overwrite or delete unrelated user changes.

When an implementation changes architecture authority, canonical state,
release gates or deletion policy, update `learning-foundry-docs` first and
reference its merged commit.

## Required validation

For implementation changes run:

```bash
npm test
npm run check
npm run build
git diff --check
```

For runtime shadow or parity changes also run:

```bash
npm run runtime:parity:fixture
```

For a real candidate adapter, run the smallest sequence that preserves
failure evidence:

```text
offline adapter tests
→ live checkpoint
→ repeated-run reliability evidence
→ live versioned baseline
→ case-level decision report
```

Live AgentEval or candidate comparison may run only when both the genuine
environment and required delivery authorization exist.

Record every attempt. Do not resample until a favorable pass appears and
then hide earlier failures.

When live work cannot run, state the exact unavailable environment or
missing authorization. Do not replace live validation with fixtures and
call it live.

Do not claim a full 73-case validation unless all 73 selected cases were
actually executed and the report preserves their case-level outcomes.

## Git and pull requests

Work from the latest `main` on a dedicated branch.

Use focused checkpoint commits when a task has multiple phases.

Do not force push or rewrite `main`.

Do not auto-merge:

- authority-switch PRs;
- canonical domain-schema or Product State migrations;
- AgentEval release-gate changes;
- Legacy deletion;
- automated Component publication;
- TeacherReview or LearningOutcome automation.

Every architecture-boundary or candidate-runtime PR must include:

`Docs authority: learning-foundry-docs@89c7c21dfb09ecd042070e823b2505f3a73f8169`

A candidate PR must also state:

```text
Candidate authority: NOT GRANTED
Release-gate authority: NOT GRANTED
Legacy deletion authority: NOT GRANTED
```

Keep product-critical Core / Reference Pack work and a candidate runtime
experiment in separate PRs.

Before opening a PR:

- inspect the complete diff;
- confirm the branch is based on current `main`;
- confirm no unrelated framework or storage migration was added;
- confirm no Legacy path was deleted without authority;
- list automated checks actually run;
- list live checks actually run or not run;
- state remaining Chemistry coupling;
- state privacy and delivery-policy impact;
- state rollback;
- state every authority status.

## Definition of done: Core / Reference Pack boundary

A Core / Chemistry Pack boundary PR is complete only when:

- Core contracts do not require CAIE, 9701, Chemistry, MgO, Calculation
  Family or Standard Trainer;
- current Chemistry assets have an explicit ownership inventory;
- the Pack has a type-checkable or loadable manifest and adapter boundary;
- current Chemistry behavior remains executable;
- leakage tests prevent new Pack-specific requirements entering Core;
- no domain-neutral claim relies only on renamed fields;
- large physical movement is either unnecessary or supported by focused
  compatibility tests;
- docs and implementation traceability are updated;
- all required validation passes.

## Definition of done: candidate experiment

A candidate-runtime PR is complete only when:

- one real candidate implements `RuntimeExecutor` without redefining
  Foundry contracts;
- default configuration remains Legacy-only;
- authoritative-first execution and failure isolation remain tested;
- cancellation reaches model, tool and write boundaries;
- candidate records are purpose-and-role separated and redacted;
- checkpoint evidence has zero unexplained missing cases;
- every behavioral, quality and operational difference is classified;
- repeated-run evidence exposes provider variance;
- no authority switch or Legacy deletion is included;
- rollback is a revert of the candidate PR.

Passing these conditions permits review of the experiment. It does not
automatically grant runtime authority.

## Review guidelines

Treat these as blocking issues:

- Core types require CAIE, 9701, Chemistry, MgO or Standard Trainer.
- Chemistry-specific code is declared domain-neutral only through naming.
- A framework API becomes the de facto domain contract.
- Product State is delegated to Agent memory or workflow state.
- `sourceRefs` and `evidenceRefs` are merged or compared as raw
  execution-local IDs.
- provenance or delivery-policy validation is weakened.
- an empty Eval selection exits successfully.
- a subset Eval run is reported as complete coverage.
- PRODUCT and AGENT_EVAL evidence share one physical namespace.
- a persisted record changes shape without a schema-version or explicit
  compatibility path.
- a candidate starts before authoritative success.
- a candidate timeout does not propagate cooperative cancellation.
- a candidate runtime affects the authoritative product response.
- candidate absence hides an authoritative infrastructure failure.
- operational differences are automatically accepted.
- a candidate improvement is mislabeled as regression solely because it
  differs from a failing Legacy run.
- a Legacy implementation is deleted without accepted parity, an
  authority decision and deletion authority.
- model output directly creates TeacherReview, LearningOutcome or a
  published Component.
- a PR claims candidate parity, full-suite validation, pilot validation or
  production readiness without corresponding evidence.
