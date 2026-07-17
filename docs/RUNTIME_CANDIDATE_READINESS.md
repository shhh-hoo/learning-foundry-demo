# Runtime candidate readiness memo

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Assessment basis: the current stable runtime boundary, shadow and parity
foundation plus the separately reviewed AI SDK 7 candidate described in
`AI_SDK_RUNTIME_CANDIDATE_ACCEPTANCE.md`.

## Decision

One real AI SDK 7 DeepSeek `RuntimeExecutor` candidate is installed behind
the default-off shadow boundary. The system is not ready to grant candidate
authority because live checkpoint, reliability, baseline and parity
evidence have not been executed.

## Ready prerequisites

- Legacy remains the only authoritative executor and learner-facing result.
- Shadow mode is explicit, default-off and fail-closed.
- Authoritative and candidate receive the same normalized request, Execution Plan and versioned policy snapshot.
- Candidate failure, timeout and recorder failure are isolated from the product result.
- Shadow lifecycle records and bounded polling distinguish absent, pending, timed-out and failed candidate evidence.
- Runtime records preserve case/trace linkage, route, obligations, ordered tools, source/evidence references, Diagnosis outcome, final status, grader inputs, latency, usage, cost, completeness and terminal failure.
- Runtime records are joined to the exact AgentEval-run conversation, so a failed case without an Agent trace cannot reuse stale successful evidence from an older run.
- AgentEval cases, selection and `gradeAgentCase` remain the source of grading policy.
- Case-level parity separately reports behavioral equivalence, directional governed quality and operational impact.
- Diagnosis Evidence must link to the declared trace; unresolved references fail integrity checks, while execution-local IDs are normalized through lineage.
- Operational differences, candidate improvements and shared quality failures require explicit review and cannot auto-pass.
- Role evidence and generated reports are physically separated, gitignored and redacted.
- Real Legacy checkpoint and baseline evidence can be ingested; self-comparison validates mapping without claiming candidate parity.

## Candidate adapter entry contract

A candidate PR may implement only `RuntimeExecutor` plus its provider/framework-specific translation. It must declare adapter/provider/model identity, consume `NormalizedRuntimeExecutionRequest`, return a complete observable `RuntimeExecutionResult`, and remain unable to write canonical Product State or the authoritative trace repository.

The candidate PR must not move route resolution, obligations, tool policy, corpus delivery policy, capability resolution, AgentEval selection, graders or release policy into the candidate adapter.

## Evidence required before any authority discussion

1. Offline adapter characterization, timeout and failure-isolation tests.
2. Genuine candidate checkpoint records for every selected case; zero `NOT_EXECUTED` cases.
3. Case-level report with no unreviewed regression or infrastructure failure.
4. Genuine candidate baseline evidence, with every difference documented per case.
5. Explicit latency, token and cost coverage; missing values must remain visible.
6. Repeated-run reliability evidence sufficient to separate candidate behavior from provider variance.
7. A later, separately authorized full-suite run if release policy requires it.
8. Human review of every `REVIEW_REQUIRED` result; the harness does not auto-authorize behavioral, quality or operational differences.

## Current blockers

- The implementation-time environment had no DeepSeek key/model or
  governed corpus index.
- Candidate checkpoint, repeated-run reliability and baseline parity are
  therefore unexecuted.
- The live Legacy baseline remains stochastic and currently has two quality failures; parity must not be used to conceal them.
- Corrected-head live evidence shows provider variance across two consecutive checkpoint runs (5/6, then 6/6); candidate reliability evidence must therefore use repeated runs rather than selecting a favorable sample.
- No candidate authority, release-gate authority or Legacy-deletion authority has been granted.

## Recommended next action

Run the committed candidate manifest in an authorized environment. Preserve
all three checkpoint and two baseline attempts, then produce the case-level
decision report. Stop and report if any case is unexplained or if an
infrastructure failure prevents comparison. Do not grant authority in the
evidence-collection change.
