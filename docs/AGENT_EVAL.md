# AgentEval

AgentEval is the offline quality harness for whole-Agent behavior. Its cases are classified `AGENT_EVAL_CASE` or `ADVERSARIAL_CASE` and cannot enter Product state.

Run `npm run agenteval:checkpoint` first. It runs the six-case gate in this order: A course explanation, B incomplete working, C complete MgO diagnosis, D multi-stage evidence/capability handling, diagnosis-01 and diagnosis-02. Each receives its own conversation ID. Only after that gate should `npm run agenteval:live` run all 18 cases against the real local gateway, configured model and tools.

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

Suite version `1.1.0` persists eligibility per case. Aggregate metrics use only applicable cases:

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