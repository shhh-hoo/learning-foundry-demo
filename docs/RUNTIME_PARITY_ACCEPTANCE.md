# Runtime parity acceptance

Docs authority: `learning-foundry-docs@e6ec2408d18fc6850e92c996b36712dbd5be9df5`

Corrected boundary base: `codex/runtime-boundary-program@df0aaa062128a2657e28c862b16b18a0247a4c68`

Shadow foundation base: `codex/runtime-shadow-foundation@e80d8e940a556719bed5c8efeb373ba3a445e2fb`

Parity implementation checkpoint: `b31e6bcc9b00af4729f8574ccdb03ec40f741b14`

## Scope and responsibility

This stacked milestone adds a Foundry-owned, case-level comparison harness above the default-off runtime shadow seam. It does not integrate or select a candidate framework. Legacy DeepSeek execution remains authoritative, and the existing AgentEval runner continues to own suite selection, cases, graders, eligibility, persistence and report semantics.

`evalCaseId` is optional transport metadata accepted only for `AGENT_EVAL` requests. It links an existing AgentEval case and Agent trace to its normalized runtime record without changing product requests or route/tool behavior.

## Versioned data model

`RuntimeParityPlan`, `RuntimeParityCase`, `RuntimeParityExecution`, `RuntimeParityDifference`, `RuntimeParityCaseResult` and `RuntimeParityReport` use schema `1.0.0`. `RuntimeExecutionRecord` remains schema `1.0.0` and now carries the observable final response, Agent trace reference and normalized Diagnosis result/failure evidence required to reuse the existing grader against a future shadow result.

The five classifications are:

- `EXACT_MATCH` — all behavior and operational evidence compared by the contract match;
- `ACCEPTABLE_DOCUMENTED_DIFFERENCE` — behavior matches, while latency, usage or cost differs and remains explicitly reported;
- `REGRESSION` — route, obligations, tool contract/order/status, source/evidence references, Diagnosis outcome, final status, grader map or completeness differs;
- `NOT_EXECUTED` — one side, including the candidate, has no execution evidence; this is never parity;
- `INFRASTRUCTURE_FAILURE` — authoritative or candidate execution failed, timed out or was not configured, separate from behavioral regression.

Trace IDs and Diagnosis trace IDs are execution-local: their presence and linkage are compared, not literal identifier equality. Provider/adapter identities are provenance, not behavioral equivalence fields.

## Selection, grading and coverage

Parity plans reuse `AgentEvalSelection` and the existing checkpoint/baseline case construction. The same plan contract also accepts `LAYER` and `DIMENSION`, preserving the existing explicit empty-selection failure before provider health checks.

Candidate records are graded by `gradeAgentCase`; no parity-specific relaxed grader exists. Reports preserve `UNPLANNED`, `NOT_RUN`, `PARTIAL` and `COMPLETE`. A checkpoint, baseline, layer or dimension subset cannot claim full-suite coverage. Missing candidate evidence produces `NOT_EXECUTED` and a non-zero command result.

## Commands and outcomes

```text
npm run runtime:parity:fixture
npm run runtime:parity:checkpoint -- --run <evalRunId>
npm run runtime:parity:baseline -- --run <evalRunId>
npm run runtime:parity:self-check -- --run <evalRunId>
RUNTIME_PARITY_SELECTION=BASELINE npm run runtime:parity:self-check -- --run <evalRunId>
```

The fixture is deterministic offline validation. Checkpoint and baseline consume role-separated records for an existing live AgentEval run. Self-check clones the observed Legacy record only inside the comparison harness and labels the report `LEGACY_SELF_COMPARISON`; it validates harness wiring and is not candidate parity.

Live commands distinguish outcomes with explicit messages and non-zero exits: candidate unavailable (`2`), authoritative evidence unavailable (`3`), infrastructure failure (`4`), regression/not-executed (`1`) and unexpected command failure (`5`). A passing candidate comparison exits `0` only when no regression, missing case or infrastructure failure remains.

Artifacts are written under gitignored `.runtime-parity-results/<reportId>/` as `plan.json`, `authoritative.json`, `candidate.json`, `differences.json` and `report.json`. Role evidence is separate, case order is deterministic, and hidden reasoning, credentials and private paths are removed before persistence.

## Automated validation

- `npm test` — 32 files, 204 tests passed;
- `npm run check` — passed;
- `npm run build` — passed;
- `git diff --check` — passed;
- `npm run runtime:parity:fixture` — `EXACT_MATCH`.

The parity matrix covers exact equivalence; route and obligation drift; missing required and present forbidden tools; tool order/status; source and evidence references; Diagnosis result; final status; timeout; candidate infrastructure failure; authoritative failure; missing usage/cost; partial/unplanned/not-run coverage; deterministic serialization; safe redaction; and candidate-failure isolation.

## Genuine live evidence

The configured server-side model, 934-chunk governed corpus, Component Registry and Standard Trainer Diagnosis API were used. No fake candidate was introduced.

- checkpoint `agenteval-2026-07-16T18-32-43-174Z-32a92733` — 6/6 AgentEval passed;
- checkpoint Legacy self-comparison `runtime-parity-2026-07-16T18-33-32-147Z-58b208aa` — complete 6/6, six `EXACT_MATCH`, no regression or infrastructure failure;
- candidate checkpoint `runtime-parity-2026-07-16T18-33-50-843Z-08d303b8` — `NOT_RUN`, 0/6, six `NOT_EXECUTED`, exit `2` with `CANDIDATE_RUNTIME_UNAVAILABLE`;
- baseline `agenteval-2026-07-16T18-34-49-750Z-422f2c0d` — 16/18 AgentEval passed; `gap-02` ended with `AGENT_UNSUPPORTED_CLAIM`, and `adversarial-02` failed the existing `unsupportedClaims` grader;
- baseline Legacy self-comparison `runtime-parity-2026-07-16T18-36-47-439Z-edbd1802` — complete 18/18 evidence, 17 `EXACT_MATCH`, one preserved authoritative infrastructure failure, exit `4`.

The baseline failure is not weakened or relabeled. Behavioral equivalence does not imply AgentEval quality: the self-comparison can match a grader-failing Legacy behavior, and an authoritative execution failure remains `INFRASTRUCTURE_FAILURE`.

## Non-claims, rollback and authority

No candidate runtime or framework dependency is present. No candidate has passed parity. No full 73-case live run is claimed. No Product State is written, Retrieval is not replaced, release gates are unchanged, and no Legacy code is deleted.

Rollback is a revert of this stacked parity PR. The shadow foundation and corrected runtime boundaries remain independently usable; all generated parity artifacts are disposable gitignored evidence.

Candidate runtime authority: **NOT GRANTED**.

Release-gate authority: **NOT GRANTED**.

Legacy deletion authority: **NOT GRANTED**.
