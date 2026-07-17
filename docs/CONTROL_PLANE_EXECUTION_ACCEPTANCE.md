# Control Plane Execution acceptance

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Doc 17 sections: §§4.2–4.3, 5.1–5.2, 15–18 and 20.

Implementation lane: Control Plane Execution / tool-routing repair.

## Authority effect

Foundry Control Plane behavior changes. Runtime authority remains the
Legacy DeepSeek authoritative path. Candidate authority, AgentEval
release-gate authority and Legacy deletion authority are all `NOT GRANTED`.

No Product State, retrieval-engine, Component-publication or framework
authority changes in this PR.

## Public Interfaces and deep Modules

- `ExecutionPlanV1` is the immutable, domain-neutral execution contract.
- `ContextCompiler` records selected and excluded message indexes and
  reasons without copying message content into the Plan.
- `ExecutionPlanner` owns intent, execution mode, Legacy route and
  obligation projections, tool availability, per-tool budgets, terminal
  conditions and Evidence requirements.
- `EvidenceSufficiencyAssessor` distinguishes execution failure, no result,
  low relevance, partial coverage and sufficient Evidence.
- `DiagnosisWorkflow` owns the fixed inspection, resolution, provenance,
  Attempt, capability, persisted-result and response order.

These Modules have one Implementation. No speculative Adapter Seam was
introduced. Their small Interfaces concentrate policy and provide
Leverage and Locality to the gateway, runtime evidence and tests.

## Governed behavior

- Search defaults to two calls in the Plan, not in the retrieval Adapter.
- A second search requires a matching `LOW_RELEVANCE` or
  `PARTIAL_COVERAGE` assessment, explicit missing aspect, materially
  different query and expected coverage gain.
- Exact and near-duplicate calls are rejected before execution.
- Every permitted tool has a Plan-owned call budget.
- Tool transport success is assessed separately from educational Evidence.
- Complete Diagnosis exposes only the next application-owned step; a
  governed execution failure blocks later steps.
- Context selection happens before model messages are assembled.
- The regression fixture contains observed failure shapes; production
  routing contains no exact fixture prompt or curriculum-example branch.

## Trace and compatibility

New Agent run records use schema `1.1.0`; `1.0.0` remains readable.
New runtime execution records use schema `1.2.0`; terminal `1.0.0` and
lifecycle `1.1.0` remain readable. New writes using older schemas are
rejected.

Agent and runtime evidence records include the immutable Plan, Context
indexes and reasons, budget consumption, Evidence assessments,
continue/stop reason and governed workflow identity. Plan snapshots do not
contain message content. Runtime parity compares Plan, budgets, Evidence
assessment outcomes and governed workflow status in addition to existing
behavior, quality and operational axes.

## Validation evidence

Automated validation is recorded at the final PR head in the PR body.
Required commands are:

```text
npm test
npm run check
npm run build
npm run policy:audit
npm run runtime:parity:fixture
git diff --check
```

Live manifest:
`agent-eval/run-manifests/control-plane-pr1.json`.

Live checks: `NOT RUN — required live environment unavailable`.

At implementation time the process environment had no configured
`DEEPSEEK_API_KEY` or `DEEPSEEK_MODEL`, and the governed corpus index was
absent. The committed delivery policy separately authorizes DeepSeek for
`AGENT_EVAL` with `SCHOOL_INTERNAL` source delivery; that authorization does
not make the technical environment available. No fixture execution is
described as live Evidence.

## Privacy and delivery impact

No secret, private corpus excerpt, hidden reasoning or local path is added.
Existing delivery-policy enforcement remains fail closed. The Plan stores
indexes and hashes/versions through existing runtime policy snapshots, not
message content or source bytes.

## Known limitations

- Existing clients do not yet send canonical Task/Episode metadata. Without
  it, Context history is treated as task-local for compatibility; explicit
  metadata activates stale, superseded and other-Task exclusion.
- Evidence sufficiency currently uses deterministic result metadata. It is
  not a semantic retrieval grader or retrieval-engine benchmark.
- The current Legacy tool descriptions and capability Adapter still contain
  Chemistry Reference Pack shapes; this PR does not claim Core/Pack
  extraction.
- No live provider evidence was collected and no real runtime candidate is
  installed.

## Rollback

Revert this PR. Existing trace readers continue to accept the older Agent
and runtime schemas. Runtime authority never changes, no canonical Product
State is written, and no Legacy code is deleted.
