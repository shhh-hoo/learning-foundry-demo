# AI SDK 7 DeepSeek Transport Candidate decision memo

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Doc 17 sections: §§2, 8–9, 16B and 17–20.

Decision date: 2026-07-18.

## Decision

**REWORK TRANSPORT CANDIDATE.** Retain the evidence and the default-off Adapter
for correction, but do not accept the current transport implementation as a
completed candidate. Do not interpret it as an AI SDK-owned Agent-loop
candidate. Do not grant runtime authority.

```text
Candidate authority: NOT GRANTED
Release-gate authority: NOT GRANTED
Legacy deletion authority: NOT GRANTED
```

## Basis

The implementation provides a `RuntimeExecutor`-shaped shadow adapter, uses the stable
Foundry request/Plan/tool/result contracts, preserves authoritative-first
execution, keeps shadow retrieval and Diagnosis writes outside authoritative
evidence stores, and propagates cooperative cancellation through model, tool
and derived-write boundaries. Offline tests cover the installed official
provider integration, Foundry-owned malformed-result correction and candidate
failure isolation.

The existing handwritten `runAgent` continues to own multi-round tool-loop
orchestration. This candidate therefore evaluates provider transport,
message/tool translation, cancellation and usage metadata only; it provides
no evidence that custom Agent orchestration has been replaced or reduced.

The frozen live environment was available and authorized. Three checkpoint
and two baseline attempts executed with no favorable resampling or
replacement. All 54 authoritative cases are present. Of 52 shadow-eligible
cases, 35 candidates completed and 17 failed: 16
`INVALID_AGENT_RESPONSE` failures and one `AGENT_UNSUPPORTED_CLAIM`.

Completed candidate comparisons produced 24 behavioral matches and 11
behavioral differences. Directional governed quality produced 28 matches,
five improvements and two candidate regressions. All 35 completed pairs have
operational differences requiring assessment. No candidate record is missing
and the isolated shadow Trainer boundary remained separate.

The failure rate and cross-attempt variance show that the AI SDK transport's
message/tool/final-text translation is not yet reliably compatible with the
existing Foundry structured-response contract. The adapter must be reworked
before a new candidate experiment is frozen.

## Required work before another candidate decision

1. Diagnose and correct AI SDK message/tool/final-text translation without
   moving Foundry policy into the SDK Adapter.
2. Preserve all failed run and parity evidence listed in the acceptance
   record.
3. Freeze a new implementation snapshot and a new fixed-attempt manifest.
4. Re-execute checkpoint and baseline evidence without favorable resampling.
5. Produce a new case-level decision record, followed by a separate privacy,
   operational and authority assessment.

This memo permits review of the experiment only. It does not change the
AgentEval release gate or authorize Legacy deletion.
