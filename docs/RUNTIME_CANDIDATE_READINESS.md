# Runtime candidate readiness memo

Docs authority: `learning-foundry-docs@e6ec2408d18fc6850e92c996b36712dbd5be9df5`

Assessment basis: parity implementation `c0de6fa8a4861c342d7060ce40be3e15035f9e8f` stacked on shadow foundation `808f0c0b1e4f0d4659b44a73f68f28fefccb35d4`.

## Decision

The Foundry-owned harness is ready to receive one candidate `RuntimeExecutor` adapter in a later, separately reviewed PR. The system is not ready to grant candidate authority because no candidate is installed or evaluated.

## Ready prerequisites

- Legacy remains the only authoritative executor and learner-facing result.
- Shadow mode is explicit, default-off and fail-closed.
- Authoritative and candidate receive the same normalized request, Execution Plan and versioned policy snapshot.
- Candidate failure, timeout and recorder failure are isolated from the product result.
- Runtime records preserve case/trace linkage, route, obligations, ordered tools, source/evidence references, Diagnosis outcome, final status, grader inputs, latency, usage, cost, completeness and terminal failure.
- AgentEval cases, selection and `gradeAgentCase` remain the source of grading policy.
- Case-level parity separately reports behavioral equivalence, directional governed quality and operational impact.
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

- No candidate executor or candidate framework dependency exists.
- Therefore candidate checkpoint and baseline parity are both unexecuted.
- The live Legacy baseline remains stochastic and currently has two quality failures; parity must not be used to conceal them.
- Corrected-head live evidence shows provider variance across two consecutive checkpoint runs (5/6, then 6/6); candidate reliability evidence must therefore use repeated runs rather than selecting a favorable sample.
- No candidate authority, release-gate authority or Legacy-deletion authority has been granted.

## Recommended next PR

Add exactly one default-off candidate adapter behind `RuntimeExecutor`, with no policy migration and no product authority. Run checkpoint first. Stop and report if candidate evidence is unavailable, if any case is missing, or if infrastructure failure prevents comparison. Baseline follows only after checkpoint evidence is reviewable.
