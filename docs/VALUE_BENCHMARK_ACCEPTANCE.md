# Foundry Value Benchmark Acceptance

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Doc 17 sections: §§4–5, 11–12, 15 and 17–20.

Repository contract: `docs/WAVE_IMPLEMENTATION_CONTRACT.md`, PR 6.

## Purpose and authority

The Foundry Value Benchmark compares three arms using the same configured
provider and model:

1. bare same-model LLM;
2. Foundry policy without tools;
3. Full authoritative Foundry.

This benchmark produces benchmark Evidence only. It does not create canonical
Product State, TeacherReview, LearningOutcome or a published Component. It does
not change runtime authority, the AgentEval 73-case suite, AgentEval graders,
coverage semantics or the AgentEval release gate.

The benchmark can measure answer quality and product value under its frozen
review protocol. It cannot demonstrate learning effectiveness because it does
not observe a governed learner attempt, review, retry and outcome sequence.
Every report must therefore state:

`demonstratedLearningEffectiveness: NOT_MEASURED`

## Frozen experiment assets

| Asset | Purpose | Model-visible |
|---|---|---|
| `config/value-benchmark/cases.jsonl` | 24 byte-frozen cases, immutable conversation histories and Context metadata | Yes, according to the arm input policy |
| `config/value-benchmark/reviewer-criteria.jsonl` | Answer references, must-cover and must-avoid criteria, Context checks and Evidence expectations | Never |
| `config/value-benchmark/experiment.json` | Arm prompts, same-model controls, no-tool rules, schedule, attempt policy and review rubrics | Only the applicable frozen arm prompt and allowed plan/context input |

The JSONL files are UTF-8, use LF line endings, have one object per physical
line and end with one LF. For every case, `input` is byte-for-byte equal to the
content of the final user message. The committed run manifest must record the
whole-file SHA-256, byte length and each JSONL line SHA-256 including its final
LF. A live runner must fail closed if any byte differs from the committed
manifest.

Reviewer criteria are deliberately physical assets separate from cases and
prompts. They must not be joined into a provider request, prompt, retrieval
query or tool argument.

## Case contract

The case IDs are exactly `VB-S01-V1` through `VB-S08-V3`:

| Scenario | Cases | Primary behavior |
|---|---:|---|
| `OPEN_EXPLANATION` | 3 | causal explanation rather than rule repetition |
| `CURRICULUM_NAVIGATION` | 3 | current source authority, version and locator |
| `CONCRETE_CALCULATION` | 3 | direct calculation, boundary and generalization |
| `SHORT_FOLLOW_UP` | 3 | resolve or clarify a short active-context reference |
| `TOPIC_SWITCH_CONTAMINATION` | 3 | exclude stale, superseded and other-task context |
| `COMPLETE_DIAGNOSIS` | 3 | wrong ratio, arithmetic error and a correct attempt |
| `INCOMPLETE_EVIDENCE` | 3 | fail closed without problem or attempt Evidence |
| `UNSUPPORTED_CAPABILITY` | 3 | registry, capability and governance boundaries |

Each scenario has exactly three variants and no more than one `KNOWN_FIT`
case. Other cases are marked `NOVEL_GENERALIZATION` or
`CAPABILITY_BOUNDARY`. No case `input` may exactly duplicate an input in
`agent-eval/cases.jsonl`. Known-fit results, novel-generalization results and
capability-boundary results must be reported separately before any combined
summary so that existing Chemistry Reference Pack special cases do not appear
to prove generic Foundry value.

Conversation histories are immutable fixtures. Every arm receives a separate
copy and a fresh conversation ID. No generated message, response, trace, tool
result or review from one arm may become another arm's history.

## Arm contract

### A — Bare same-model LLM

Arm A receives the frozen case messages as provider-supported role and content
fields. It receives the minimal Arm A prompt, no Foundry Execution Plan, no
tools, no corpus material and no capability output. It makes one provider call.

### B — Foundry policy without tools

Arm B receives the Foundry-selected frozen Context and a deterministic plan
summary together with the frozen Arm B policy prompt. It receives no tools,
tool definitions, tool choice, corpus material, registry output or simulated
tool result. It must not call the authoritative Agent loop. It makes one
provider call.

### C — Full authoritative Foundry

Arm C uses the current Legacy authoritative runtime, Foundry Execution Plan,
route obligations, governed tools, delivery policy, Evidence sufficiency and
trace recording. Its run purpose is `AGENT_EVAL`, but its cases are not
added to the AgentEval suite and its result is not AgentEval release Evidence.
Foundry Context metadata remains in the plan and trace; only provider-supported
message fields may be sent to the provider.

All three arms must use the same provider, model, thinking setting, sampling
settings, maximum tokens and JSON response mode recorded in the committed run
manifest. The current provider API does not support a request seed. The frozen
configuration records `UNSUPPORTED_NOT_SENT`; the schedule seed is not a
provider seed. A live benchmark cannot claim full fixed-seed conformance until
that contract disposition is explicitly accepted.

The live preflight also binds Arm C to the committed prompt, response policy,
tool, capability, delivery-policy, gateway and runtime hashes. Gateway health
must prove the configured origin, JSON mode, token limit, Legacy authority,
governed corpus version and delivery authorization. The Trainer health check
must pass. Environment booleans alone are not readiness Evidence.

## Scheduling and attempt integrity

The deterministic seeded case shuffle uses the six orders `ABC`, `BCA`, `CAB`,
`ACB`, `CBA` and `BAC`, with four cases assigned to each. This produces exactly
72 first attempts and balances every arm across each order position.

All 72 execution IDs and fresh conversation IDs must be declared in the
committed run manifest. The runner records an attempt start before making a
network call and resumes only planned attempts that have not started. It never
silently reruns an unresolved attempt.

All first attempts, including failures, complete before a replacement is
considered. Wrong answers, refusals, malformed model output, policy failures,
tool-choice failures, no results, low relevance and partial coverage are not
resampled. Only a classified transport failure, timeout, HTTP 408, HTTP 429,
HTTP 5xx or required local-service outage may receive a replacement. The
original failure remains immutable and the replacement records a new execution
ID, conversation ID and explicit lineage.

## Locked review phases

Review follows two separately locked phases:

1. Blind pedagogy review hides arm identity, tools, sources and Evidence
   metadata. It scores correctness, clarity, pedagogy and Context fidelity.
2. Evidence audit begins only after the blind packet and all blind decisions
   are hash-locked. It reveals source metadata, tool trajectory, Evidence
   references and runtime provenance while arm identity remains hidden. It
   scores grounding, authority, provenance and integrity.

The Evidence packet and all Evidence decisions are hash-locked before the arm
mapping is revealed. Exact source and Evidence IDs and URLs in learner-facing
answers are replaced by neutral reference markers for the blind packet; both
the original and transformed answer hashes are retained.

Review custody is persisted under the ignored, restricted local result store.
The blind packet and sealed arm mapping are separate files. Reviewer decisions
are append-only, phase locks are exclusive-create artifacts, late decisions are
rejected, and the mapping reveal command remains unavailable until both locks
exist. The full report is local; its publication projection contains metrics,
hashes and case IDs only.

Each dimension uses the frozen 1–5 anchors in
`config/value-benchmark/experiment.json`. Reports preserve all eight raw scores
and reviewer reasons. Answer-quality, Evidence and combined product-value
winners are calculated using the frozen rules; exact ties remain ties.

## Evidence, rights and publication safety

`sourceRefs` and `evidenceRefs` remain separate throughout execution, review
and reporting. The revealed audit may contain excerpt-free retrieval metadata,
delivery-policy identity, tool trajectory, Execution Plan, Context selection,
Evidence sufficiency and trace IDs. It must never contain hidden reasoning,
Authorization values, API keys, local paths, raw private PDFs or generated
private corpus excerpts.

Approval to deliver `SCHOOL_INTERNAL` corpus excerpts to the configured model
for `AGENT_EVAL` does not authorize committing learner-facing answers or
sharing review packets with an external reviewer. Raw attempts, answer text,
blind mappings and review packets remain in the ignored local benchmark store
with restricted file permissions. Any repository report is metrics- and
hash-only unless separate rights and privacy authority exists.

## Explicit non-scope

PR 6 grants no authority for:

- an external assessment vendor;
- OpenTelemetry migration;
- retrieval replacement;
- Product State migration;
- runtime authority switching;
- changing the AgentEval release gate;
- deleting the Legacy runtime;
- claiming demonstrated learning effectiveness.

Failures found by the benchmark may become regression fixtures. They must not
become prompt-specific production routing or favorable-resampling rules.

## Acceptance checks

Before a live run, automated checks must establish:

- exactly 24 cases, eight scenarios and three variants per scenario;
- exact IDs `VB-S01-V1` through `VB-S08-V3` with no duplicates;
- no more than one `KNOWN_FIT` case per scenario;
- final-message and `input` byte equality;
- zero exact input duplicates against `agent-eval/cases.jsonl`;
- valid UTF-8, LF-only JSONL with a final LF;
- parseable JSON and unique reviewer criteria for all 24 cases;
- reviewer criteria are absent from every model request;
- exact committed hashes for cases, criteria, prompts and policy inputs;
- a balanced 72-attempt schedule and 72 unique initial conversation IDs;
- all environment, corpus-delivery and reviewer-authorization gates pass.

Without the required live provider, governed corpus, dependent services,
delivery authorization and accepted provider-seed disposition, live validation
is reported as:

`NOT RUN — required live environment or authority unavailable`
