# AgentEval

AgentEval is the offline quality harness for whole-Agent behavior. Its cases are classified `AGENT_EVAL_CASE` or `ADVERSARIAL_CASE` and cannot enter Product state.

Suite `2.0.0` contains 73 cases. The earlier 18-case suite remains useful as a bounded contract baseline, but its historical `18/18` result is not evidence of paraphrase, bilingual, cross-reaction or capability-boundary generalisation.

Run `npm run agenteval:checkpoint` first. The checkpoint now clones six independent source cases, preserves every source obligation and assigns a fresh conversation ID to each execution:

| Checkpoint case | Source case | Contract |
|---|---|---|
| A course explanation | `retrieval-01` | grounded retrieval |
| B incomplete working | `diagnosis-missing-context-01` | request evidence; do not diagnose |
| C complete registered diagnosis | `diagnosis-01` | governed wrong-ratio Diagnosis |
| D multi-stage capability gap | `gap-01` | retain `list_capabilities`; do not diagnose |
| E correct registered diagnosis | `diagnosis-02` | governed solved Diagnosis |
| F adversarial no-fabrication | `adversarial-02` | inspect capability; do not invent a trace |

The prior checkpoint executed `diagnosis-01` twice and overwrote D's `requiredTools`. Those defects are fixed; `sourceCaseId` is now retained in the result so independence is auditable.

## Suite layers

Cases can belong to more than one layer. Layer counts therefore overlap.

| Layer | Cases | Purpose | Command |
|---|---:|---|---|
| `SMOKE` | 6 | fast independent checkpoint | `npm run agenteval:checkpoint` |
| `CORE_CONTRACT` | 16 | bounded original product contracts | `npm run agenteval:core-contract` |
| `REFERENCE_PACK` | 0 | governed reference-pack acceptance | `npm run agenteval:reference-pack` |
| `GENERALIZATION` | 55 | supported-input variation and explicit capability boundaries | `npm run agenteval:generalization` |
| `ADVERSARIAL` | 3 | no fabrication and safety boundaries | `npm run agenteval:adversarial` |
| `LEARNING_LOOP` | 0 | linked correction and retry evidence | `npm run agenteval:learning-loop` |

Evaluation dimensions are orthogonal to suite layers: `CONTEXT`, `RETRIEVAL`, `INTERPRETATION`, `PEDAGOGY`, `COMPONENT`, `OUTCOME` and `CAPABILITY_BOUNDARY`. `npm run agenteval:retrieval` selects the `RETRIEVAL` dimension; it does not define another top-level suite layer.

`npm run agenteval:live` runs all 73 cases. Layer, dimension, retrieval-variant, Diagnosis-dimension and capability-resolution taxonomy is validated before the first model call. Duplicate IDs, missing or unknown taxonomy and inconsistent contracts fail closed.

Agent retrieval grounding generalisation includes 10 English paraphrases, 10 Chinese queries, 10 bilingual queries, 5 implicit-concept queries and 5 near-neighbour distractors. These cases verify route/tool selection and required source grounding. They are not a retrieval-engine benchmark and do not report Recall@K, MRR, nDCG, source rank, irrelevant top-three results, lexical/dense contribution or reranker delta.

The current governed Trainer implements a registered single-problem contract. Inputs outside that contract are labelled `NO_MATCH`: success means registry inspection plus `CAPABILITY_GAP`, not Trainer generalisation. Supported variations are labelled `FULL_MATCH` and still require the governed Diagnosis path. Reports therefore expose separate `supportedInputGeneralizationMetric` and `capabilityBoundaryComplianceMetric` values; boundary compliance cannot raise the supported-input score.

## Baseline and report completeness

The original suite `1.2.0` behavior contract is versioned at `agent-eval/baselines/1.2.0-contract.jsonl`. CI compares the current cases against its `caseId`, input and behavioral expectation fields. Taxonomy metadata is intentionally outside that baseline. Any behavioral change must update the versioned contract explicitly.

Run only those eighteen regression cases with:

```bash
npm run agenteval:baseline
```

Every new run persists its selection mode (`FULL`, `CHECKPOINT`, `BASELINE`, `LAYER` or `DIMENSION`) and the complete suite plan. Layer and dimension reports use these states:

| Status | Meaning | Rate |
|---|---|---|
| `UNPLANNED` | the category has zero planned cases | `null` |
| `NOT_RUN` | the category has planned cases but none were executed | `null` |
| `PARTIAL` | only part of the complete category plan was executed | `null` |
| `COMPLETE` | every planned case in that category was executed | passed/planned |

Completion is selection-aware. A full run or an explicitly selected complete layer/dimension may report `COMPLETE`; checkpoint and baseline subsets cannot present their intersections as complete full-suite coverage. `fullSuiteCoverageComplete` is true only for a completed `FULL` selection. An empty `LEARNING_LOOP` is represented as `plannedCases=0`, `status=UNPLANNED`, `rate=null` during a full run.

An explicitly selected empty layer or dimension is an invalid run request and exits non-zero before provider health is checked. This currently applies to `LEARNING_LOOP`, `REFERENCE_PACK` and `PEDAGOGY`; no placeholder cases are added to avoid `UNPLANNED`.

No full-suite live `2.0.0` pass is claimed by this document. Automated tests verify suite integrity and harness behavior; a live result must come from the configured gateway, provider and real tools.

The PR #5 readiness runs are recorded in [PR5_EVAL_CONTRACT_HARDENING_ACCEPTANCE.md](PR5_EVAL_CONTRACT_HARDENING_ACCEPTANCE.md). They establish checkpoint 6/6 and versioned baseline 18/18 only, not a full 73-case pass.

The gateway classifies an initial application route before the provider call. Each Agent trace records `initialRoute` and the validated final `route`; the route-specific instruction is included in the persisted prompt hash.

Missing server-side configuration exits non-zero with `AgentEval live run not executed`. Every executed suite receives an immutable `evalRunId` under `.local-data/agent-eval-runs/<evalRunId>/`; `.agent-eval-results/latest.json` is only a pointer.

The harness creates a `RUNNING` manifest before the first case and atomically checkpoints each completed case. A normal finish becomes `COMPLETED`; a caught interruption becomes `INTERRUPTED` and retains completed case results. Offline reports expose run status, planned count, completed count and whether the suite is complete.

AgentEval Agent traces and diagnoses are classified `AGENT_EVAL` and stored under `.local-data/agent-eval-agent-runs/` and `.local-data/agent-eval-diagnoses/`. They are visible in Engineering Inspector but excluded from Product evidence queries.

Regenerate a report offline without calling the model:

```bash
npm run agenteval:report -- --run <evalRunId>
```

Compare two persisted runs:

```bash
npm run agenteval:compare -- --baseline <evalRunId> --candidate <evalRunId>
```

## Metric eligibility

Since suite version `1.1.0`, eligibility is persisted per case. Aggregate metrics use only applicable cases. Suite `2.0.0` additionally persists per-layer metrics and the case taxonomy needed to audit them:

```text
required-tool accuracy
→ cases with at least one required tool

forbidden-tool rate
→ cases with at least one forbidden tool

diagnosis fidelity
→ cases with an expected governed Diagnosis result

source grounding
→ cases with required source IDs
```

Reports include each metric's `eligibleCases`, `passedCases` and `rate`. Cases marked not applicable do not automatically improve a metric.

Cost reporting preserves partial evidence:

```text
knownEstimatedCostUsd
pricedCases
unpricedCases
costCoverage
estimatedCostUsd  // non-null only with complete pricing coverage
```

## Causal explanation grading

The `WHY_EXPLANATION` case rejects answers that merely restate a rule. For the coefficient-to-mole-ratio question it checks:

- coefficients as a particle ratio;
- the fixed-particle meaning of a mole;
- Avogadro scaling that preserves the ratio;
- separation of balancing from particle-to-mole causation;
- causal priority over conservation-of-mass shorthand;
- an explicit natural-language causal closure.

It does not require one fixed final sentence or an exact `Therefore, X is true because Y.` template.

Automated Tests verify parsing, route obligations, graders, eligible metrics and failure behavior with controlled fixtures. They do not substitute for a live run.

## School-internal corpus boundary

The checkpoint must not send school-internal source excerpts to an external model unless an approved delivery policy explicitly allows it. A blocked run is a policy result, not an AgentEval failure. Public-safe Teacher Notes or an approved internal model deployment can be used for live delivery without weakening the corpus rights boundary.
