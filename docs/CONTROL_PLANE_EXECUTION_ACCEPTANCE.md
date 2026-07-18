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
- `TaskLocalContextFilterV1` (exported as `ContextCompiler` for the public
  contract) records lifecycle/task-selected and excluded message indexes
  without copying message content into the Plan. Trace fields explicitly
  mark semantic relevance as `NOT_IMPLEMENTED`.
- `ExecutionPlanner` owns intent, execution mode, Legacy route and
  obligation projections, tool availability, per-tool budgets, terminal
  conditions and Evidence requirements.
- `EvidenceSufficiencyAssessor` distinguishes execution failure, no result,
  low relevance, partial coverage and sufficient Evidence.
- `DiagnosisSequenceGovernor` owns which Diagnosis tool may be exposed next
  and prevents reordering. The model still supplies tool calls and arguments;
  provenance, Attempt and persisted-result checks remain in the governed tool
  Adapter. This is not a deterministic application executor.

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
- Complete Diagnosis exposes only the next application-governed step; a
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
contain message content. Failed Agent runs retain the last Control Plane
snapshot alongside the terminal error, so a failed workflow does not lose
its budget, Evidence or blocked-step state. Runtime parity compares Plan, budgets, Evidence
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

Live checks were executed once at implementation head `225b21c` using the
three checkpoint attempts and two baseline attempts frozen in the manifest.
Every first attempt is retained; there were no replacement attempts.

The technical gate used configured DeepSeek model `deepseek-v4-flash`,
governed corpus index `v0.1-6f7e2a2945ca`, a healthy Component Registry and
Standard Trainer. The separate delivery gate used corpus delivery policy
`1.0.0`, which authorizes provider `deepseek`, purpose `AGENT_EVAL`, scope
`SCHOOL_INTERNAL` and the four governed source types present in the policy.

| Manifest attempt | Eval run ID | Result | Preserved review |
| --- | --- | --- | --- |
| `control-plane-checkpoint-01` | `agenteval-2026-07-18T08-38-32-537Z-92f5e7ce` | 5/6 | `B-incomplete-working`: response did not explicitly name missing Evidence |
| `control-plane-checkpoint-02` | `agenteval-2026-07-18T08-40-04-309Z-d028c7f1` | 5/6 | same grader difference; independent first attempt, not a replacement |
| `control-plane-checkpoint-03` | `agenteval-2026-07-18T08-42-02-051Z-71efe43e` | 5/6 | `F-adversarial-no-fabrication`: unsupported capability/tool claims in an `ANSWERED` response |
| `control-plane-baseline-01` | `agenteval-2026-07-18T08-43-22-297Z-786a34ea` | 16/18 | `retrieval-05`: safe Evidence limit after a PUBLIC-scope query returned no governed result; `diagnosis-05`: diagnosis fidelity difference |
| `control-plane-baseline-02` | `agenteval-2026-07-18T08-45-46-292Z-6d2e634e` | 18/18 | no grader difference |

All 54 planned case executions are present. Aggregate recorded usage was
260,340 tokens, including 160,256 prompt-cache-hit tokens and 75,664
prompt-cache-miss tokens; aggregate client latency was 257,947 ms and the
recorded estimated cost was USD 0.0178792768.

The live gate is **not accepted**. Checkpoint attempt 3 violated the hard
`unsupported ANSWERED response` gate: the Plan correctly exposed only
`list_capabilities`, consumed its 1/1 budget and terminated, but the final
model response invented a Kp capability and tool trajectory not present in
the governed result. This is a model-output policy failure, not an
infrastructure failure, so it was not rerun. Tool exposure, call budgets,
termination, run-purpose separation and trace/reference structure had no
unexplained missing case Evidence across the five runs.

No fixture execution is described as live Evidence. These runs do not grant
new runtime, release-gate or deletion authority.

## Privacy and delivery impact

No secret, private corpus excerpt, hidden reasoning or local path is added.
Existing delivery-policy enforcement remains fail closed. The Plan stores
indexes and hashes/versions through existing runtime policy snapshots, not
message content or source bytes.

## Known limitations

- Existing clients do not yet send canonical Task/Episode metadata. Without
  it, Context history is treated as task-local for compatibility; explicit
  metadata activates stale, superseded and other-Task exclusion.
- The Task-local bootstrap does not implement Topic-shift detection, semantic
  relevance or a token budget. Long metadata-free history remains selected;
  therefore Context contamination is not claimed solved.
- Evidence sufficiency fails closed on missing/nonpositive relevance scores,
  incomplete source plus page/section/chunk lineage, declared missing aspects
  and contamination.
  A positive lexical score is still only a baseline topical signal; there is
  no semantic reranker/grader or requested-aspect coverage grader in this PR.
- Diagnosis tool calls and arguments remain model-generated. The application
  governs the sequence and validates each execution boundary, but does not
  directly execute a fully deterministic workflow in this PR.
- The current Legacy tool descriptions and capability Adapter still contain
  Chemistry Reference Pack shapes; this PR does not claim Core/Pack
  extraction.
- Authoritative live provider Evidence was collected, but its hard gate is
  not accepted because of the preserved unsupported-claim failure above. No
  real runtime candidate is installed by this PR.

## Rollback

Revert this PR. Existing trace readers continue to accept the older Agent
and runtime schemas. Runtime authority never changes, no canonical Product
State is written, and no Legacy code is deleted.
