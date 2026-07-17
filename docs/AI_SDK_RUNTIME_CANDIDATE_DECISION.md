# AI SDK 7 Candidate decision memo

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Doc 17 sections: §§2, 8–9, 16B and 17–20.

Decision date: 2026-07-18.

## Decision

Retain the AI SDK 7 DeepSeek adapter as a default-off shadow candidate.
Do not grant runtime authority.

```text
Candidate authority: NOT GRANTED
Release-gate authority: NOT GRANTED
Legacy deletion authority: NOT GRANTED
```

## Basis

The implementation provides a real `RuntimeExecutor`, uses the stable
Foundry request/Plan/tool/result contracts, preserves authoritative-first
execution and propagates cooperative cancellation through model, tool and
derived-write boundaries. Offline tests cover the installed official
provider integration and candidate failure isolation.

The required live environment was unavailable. Therefore checkpoint,
repeated-run reliability, baseline and case-level parity were not run. No
claim is made about behavioral equivalence, governed quality, operational
impact or provider reliability.

## Required evidence before any authority proposal

1. Execute the committed three-attempt checkpoint manifest without
   favorable resampling.
2. Preserve repeated-run variance and all classified infrastructure
   replacement lineage.
3. Execute the committed two-attempt versioned baseline manifest.
4. Produce case-level behavioral, directional quality and operational
   classifications with zero unexplained missing cases.
5. Complete privacy and operational review, then make a separate explicit
   authority decision.

This memo permits review of the experiment only. It does not change the
AgentEval release gate or authorize Legacy deletion.
