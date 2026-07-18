# Foundry Master Implementation Contract — Two Waves

Authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

This repository contract implements Doc 17. If it conflicts with the
Current MVP Contract or an accepted ADR, the repository authority order in
`AGENTS.md` applies.

## 1. Program and orchestration

```text
Wave 1
├── PR 1 — Control Plane Execution
├── PR 2 — Core / Chemistry Pack
└── PR 3 — External Component Foundation

Wave 2
├── PR 4 — Canonical Product State
├── PR 5 — AI SDK Runtime Candidate
└── PR 6 — Foundry Value Benchmark
```

Wave 1 develops concurrently. PR 1 integrates before PR 2's final
integration because both touch Agent composition. PR 3 is independent.
Wave 2 starts from integrated Wave 1 main.

Draft PR #13 is closed immediately as superseded. Draft #11 is closed when
PR 1 opens, and draft #12 is closed when PR 3 opens. Their links remain
incident evidence; their workflow, base and lockfile are not reused.

## 2. Contract overrides and public interfaces

### Domain-neutral execution

```ts
type ExecutionMode =
  | "DIRECT_MODEL"
  | "BOUNDED_AGENT"
  | "GOVERNED_WORKFLOW"
  | "DETERMINISTIC_CAPABILITY"
  | "PRODUCT_ACTION";

interface GovernedWorkflowIdentity {
  id: string;
  version: string;
}

interface ExecutionPlanV1 {
  schemaVersion: "1.0.0";
  intent: ExecutionIntent;
  execution: ExecutionDirective;
  route: AgentRoute;
  obligations: AgentObligations;
  contextSelection: ContextSelectionDecision;
  toolPolicy: {
    permitted: readonly ToolId[];
    required: readonly ToolId[];
    forbidden: readonly ToolId[];
    maximumModelSteps: number;
    maximumCallsPerTool: Readonly<Record<ToolId, number>>;
  };
  terminalConditions: readonly TerminalCondition[];
  evidenceRequirements: readonly EvidenceRequirement[];
}
```

`GOVERNED_DIAGNOSIS` is not a Core execution mode. The current governed
workflow identity is `LEARNER_DIAGNOSIS`.

Default mapping:

```text
OPEN_EXPLANATION          → DIRECT_MODEL or BOUNDED_AGENT
CONCRETE_CALCULATION      → DETERMINISTIC_CAPABILITY or DIRECT_MODEL
COMPLETE_ATTEMPT_DIAGNOSIS→ GOVERNED_WORKFLOW / LEARNER_DIAGNOSIS
PRODUCT_ACTION            → PRODUCT_ACTION
```

`ContextCompiler`, `ExecutionPlanner` and
`EvidenceSufficiencyAssessor` are Foundry-owned Modules with one
Implementation. Do not create speculative Adapter Seams for them.

### Live evidence policy

Model perfection is not a merge gate. Commit a run manifest before live
execution specifying attempts, case IDs, model configuration and permitted
infrastructure replacements.

- Preserve every attempt.
- Never rerun a model-quality failure.
- Only a classified infrastructure failure may receive a replacement.
- Preserve the failure and replacement lineage.
- Automated policy, contract, provenance, reference and termination tests
  are hard gates.
- Model-quality differences receive case-level review.
- No favorable resampling.

For PR 1 and PR 5, checkpoint evidence has exactly three predeclared
attempts and baseline evidence exactly two. Hard live gates are zero
unexplained missing cases, zero new policy/provenance/Evidence-integrity
regressions, no tool-budget or termination violations, and classification
of all differences. Stochastic `6/6` or `18/18` thresholds are not required.

### Product State modes

```ts
type ProductStateMode = "LEGACY_SHOWCASE" | "POSTGRES_CANONICAL";
```

One environment uses one mode. CI integration and canonical sandbox use
`POSTGRES_CANONICAL`. The public showcase remains `LEGACY_SHOWCASE` until
cutover acceptance. Dual write and silent fallback are prohibited.

## 3. Wave 1

### PR 1 — Control Plane Execution

Doc 17 §§4.2–4.3, 5.1–5.2, 15–18 and 20.

Checkpoint commits:

1. regression fixtures, Context/Plan contracts and trace compatibility;
2. `ContextCompiler` and `ExecutionPlanner`;
3. Plan-owned active tools and per-tool budgets;
4. Evidence sufficiency, duplicate control and stopping reasons;
5. application-owned `DiagnosisWorkflow`;
6. gateway/runtime/parity wiring and acceptance evidence.

The default retrieval budget is:

```text
ExecutionPlan.maximumCallsPerTool.search_learning_resources = 2
```

A second search requires `LOW_RELEVANCE` or `PARTIAL_COVERAGE`, an explicit
missing aspect, a materially different normalized query and expected
coverage gain. This is a Plan default, not a global runtime rule.

Diagnosis order is fixed:

```text
inspect capability
→ resolve capability
→ validate problem provenance
→ validate Attempt
→ execute capability
→ validate persisted result
→ compose response
```

Any failure blocks later steps. Traces record a versioned immutable Plan
snapshot, selected/excluded Context indexes and reasons, budget consumption,
Evidence assessments, continue/stop reasons and governed workflow identity.
Existing trace/runtime schemas retain backward readers. Plan snapshots do
not copy message content.

PR 1 does not add CAIE/9701/AS/A2 production branches, move Chemistry rules
into the new Modules, change AgentEval semantics, add production
dependencies or change runtime authority.

### PR 2 — Core and Chemistry Pack

Doc 17 §§1, 3, 4.1, 6–7, 13, 16A, 17–18 and 20; ADR-002/004.

Checkpoint commits:

1. Chemistry ownership inventory;
2. `ReferencePackManifest` and Pack registration;
3. scoped dependency/leakage tests;
4. domain-neutral Core contracts;
5. Chemistry compatibility Adapters;
6. real registry/export/capability entrypoint wiring;
7. canonical/derived terminology and traceability.

Manifest state is truthful: `CURRENT_LEGACY`, `REGISTERED` and
`NOT_EXTRACTED`. Empty declarations must not imply completed extraction.

```text
Chemistry Pack → Foundry Core
Foundry Core ✕ Chemistry Pack imports
```

Production leakage checks apply only to `src/core/domain/**`,
`src/core/application/**` and `src/core/ports/**`. Primary checks inspect the
import graph, required public fields, Core-owned discriminated unions,
runtime dependencies and schema dependencies. String scanning is
supplemental. Reference Packs, compatibility Adapters, tests, fixtures,
documentation and AgentEval metadata may contain domain terminology.

Temporary exceptions live in `known-core-chemistry-leakages.json`. Each
records path, symbol, reason and removal target. The allowlist may shrink;
growth requires explicit review and PR disclosure.

Canonical/derived interpretation:

- Task/Episode identity, status and linkage are canonical; Episode summary
  is derived.
- `ConversationEvent` is an append-only canonical interaction record.
- Attempt and human Review/Decision are canonical.
- Observation envelope, provenance and correction chain are canonical;
  model/deterministic diagnosis payload is derived.
- Runtime, retrieval and Agent traces are derived operational Evidence.

PR 2 preserves current Component bytes, hashes, IDs, versions, Standard
Trainer behavior and the learner path. It performs no mass directory move.

### PR 3 — External Component Foundation

Doc 17 §§14–14.1, 16D, 17–18 and 20.

Wave 1 governance authority is Git-versioned configuration:

```text
config/external-learning-components/
├── resources.json
├── review-decisions.jsonl
└── schema.json
```

`resources.json` contains provider/resource snapshots.
`review-decisions.jsonl` is Git-reviewed, append-only configuration
Evidence. Browser launch telemetry is noncanonical operational Evidence.

Review records contain resource identity/version, reviewer/timestamp, terms
URL/Evidence reference/hash, deployment scope, rights/privacy/tracking/
accessibility decisions, approval/disable/revoke status and superseded
decision reference. Current state derives from the latest valid decision
without rewriting history.

PR 3 implements the complete `ExternalLearningComponent` contract,
`ExternalComponentService` authorization Module, disabled-by-default
registry, catalog UI, resource-specific attribution/accessibility,
approved-link request path and append-only browser telemetry.
`outcomeEligible` is always false.

Incomplete providers remain visible and disabled. Synthetic reviewed
fixtures test approved behavior; no provider is enabled merely to
demonstrate it.

```text
append LAUNCH_REQUESTED
→ window.open
→ append WINDOW_CREATED or POPUP_BLOCKED
```

These states do not prove load, engagement, completion or learning.
Telemetry is schema-validated, append-only, duplicate-rejecting and
fail-closed on corrupt history. It cannot own review decisions or write
ExperienceState, Review, Diagnosis, Outcome or native publication.

Git remains authoritative for external reviews throughout these Waves.
Postgres migration is a separate follow-up after PR 4.

## 4. Wave 2

### PR 4 — Canonical Product State Vertical Slice

Doc 17 §§4.1, 5.3, 6, 16A and 17–20; ADR-002/004.

```text
Task → Episode → ConversationEvent → Attempt → DiagnosticObservation
→ Teacher accept/correct → linked Retry → Retry result → LearningOutcome
```

Implement versioned Postgres migrations, an async
`ProductStateRepository`, append-only Events/Reviews/Decisions, explicit
permissions and transitions, a transactional outbox, one real application
or UI entrypoint and an explicit idempotent Legacy importer. ORM types do
not own the domain and runtime/checkpoint state is not Product State.

Merge is not cutover. `POSTGRES_CANONICAL` requires successful migrations,
health/readiness, explicit environment configuration, completed importer or
explicit no-import decision, no dual write and an environment acceptance
record. Once enabled, DB failure is explicit; an observable controlled
read-only mode may be used. localStorage fallback is prohibited and may
retain UI preferences only. Canonical history is never deleted to simulate
rollback.

### PR 5 — AI SDK Runtime Candidate

Doc 17 §§2, 8–9, 16B and 17–20.

At implementation time, record from official docs and installed package
metadata the exact `ai` and compatible `@ai-sdk/deepseek` versions, engines,
module and peer requirements, model IDs, tool/structured-output support,
thinking behavior and cache metadata fields.

Implement a real `RuntimeExecutor` Adapter, Foundry Plan/tool translation,
structured final result, AbortSignal and timeout propagation, failure
isolation, default-off authoritative-first shadow wiring, offline fake-model
tests, fixed live attempts, case-level parity and a candidate decision memo.
Use the smallest SDK primitive that executes the Foundry Plan. SDK workflow
state is not Product State.

Do not reuse draft #13 workflow, lockfile or package assumptions. Candidate,
release-gate and Legacy-deletion authority remain `NOT GRANTED`.

### PR 6 — Foundry Value Benchmark

Doc 17 §§4–5, 11–12, 15 and 17–20.

```text
A. Bare same-model LLM
B. Foundry policy without tools
C. Full authoritative Foundry
```

Freeze 24 cases: eight scenarios with three variants each. Do not change
AgentEval's 73-case suite.

The fairness manifest records exact case bytes/hash, each arm's system
prompt, provider/model/thinking/sampling settings, fixed seed, arm order,
fresh conversation ID per case and arm, cache-hit/miss tokens, provider
usage, raw latency and runtime/tool traces.

Use the seeded balanced schedule `ABC`, `BCA`, `CAB`, `ACB`, `CBA`, `BAC`,
assigning each permutation to four cases after deterministic seeded shuffle.
No arm shares history or outputs.

Run exactly 72 first attempts. Only infrastructure failures may be
replaced; preserve original failures and lineage.

Review has two locked phases:

1. blind pedagogy review hides arm identity, tools, sources and Evidence
   metadata and scores correctness, clarity, pedagogy and Context fidelity;
2. Evidence audit reveals sources, tool trajectory and Evidence refs and
   scores grounding, authority, provenance and integrity.

Reviewer decisions lock before unblinding. The report preserves every case
and arm, cache metrics, latency, tokens, cost, winner and reason, and
distinguishes answer quality, product value and demonstrated learning
effectiveness.

PR 6 adds no external assessment vendor, OTel migration, retrieval replacement or
AgentEval release-gate change.

## 5. Validation, authority and delivery defaults

Every implementation PR runs:

```text
npm test
npm run check
npm run build
npm run policy:audit
git diff --check
```

Runtime and trace changes also run `npm run runtime:parity:fixture`.

Defaults:

- draft PRs and testable checkpoint commits;
- latest main as the base;
- no auto-merge, force push or CI branch-writing workflow;
- no local absolute paths in repository documents or PR bodies;
- no secrets, private corpus or hidden reasoning artifacts;
- live environment and delivery authorization are separate gates;
- retain every live attempt and explicitly link infrastructure replacements;
- never describe fixture Evidence as live;
- no Legacy deletion.

| PR | Authority effect |
|---|---|
| PR 1 | Foundry Control Plane behavior changes; runtime authority unchanged |
| PR 2 | Core/Pack ownership clarified; learner behavior unchanged |
| PR 3 | Git-reviewed external governance only; no provider or Outcome authority |
| PR 4 | Code enables Product State; each environment cutover remains explicit |
| PR 5 | Candidate authority not granted |
| PR 6 | Product benchmark Evidence only; AgentEval gate unchanged |
