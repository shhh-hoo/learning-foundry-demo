# AI SDK 7 DeepSeek Transport Candidate acceptance

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Doc 17 sections: §§2, 8–9, 16B and 17–20.

Implementation lane: separately reviewed Candidate Experiment.

## Candidate hypothesis

This PR tests exactly one hypothesis:

```text
Legacy DeepSeek model/provider transport
→ AI SDK generateText + official DeepSeek provider transport
```

It does **not** replace or evaluate ownership of the multi-round Agent tool
loop. The existing handwritten `runAgent` implementation still performs
model-call iteration, tool execution, per-step availability, budgets,
Evidence assessment, stopping and final-response correction. Therefore this
PR does not claim reduced custom orchestration or demonstrate an AI SDK-owned
loop.

## Authority status

```text
Candidate authority: NOT GRANTED
Release-gate authority: NOT GRANTED
Legacy deletion authority: NOT GRANTED
```

The Legacy DeepSeek executor remains the only authoritative learner-facing
runtime. The candidate is default-off, starts only after authoritative
success and returns no learner-facing result. It has no Product State or
authoritative trace writer. Candidate retrieval traces use a separate shadow
namespace. Candidate Diagnosis fails closed unless
`SHADOW_TRAINER_DIAGNOSIS_URL` names a separately persisted, non-authoritative
Trainer endpoint distinct from the authoritative endpoint.

## Installed implementation facts

The implementation and lockfile pin:

| Package | Version | Package metadata |
|---|---:|---|
| `ai` | `7.0.31` | ESM; Node `>=22`; provider `4.0.3`; provider-utils `5.0.11`; Zod peer `^3.25.76 || ^4.1.8` |
| `@ai-sdk/deepseek` | `3.0.12` | ESM; Node `>=22`; provider `4.0.3`; provider-utils `5.0.11`; Zod peer `^3.25.76 || ^4.1.8` |

The repository supplies Zod `4.3.6`. Installed DeepSeek types accept
`deepseek-chat`, `deepseek-reasoner` and forward-compatible string model
IDs. Installed provider options expose enabled, disabled and adaptive
thinking, reasoning-effort settings and strict-JSON controls. Provider
metadata exposes `promptCacheHitTokens` and `promptCacheMissTokens`.

Implementation-time sources:

- <https://vercel.com/changelog/ai-sdk-7>
- <https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text>
- <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>
- <https://ai-sdk.dev/providers/ai-sdk-providers/deepseek>
- installed package metadata and TypeScript declarations pinned by the
  lockfile

The provider documentation page still carries an AI SDK 6 label, so exact
v7 signatures and versions come from the installed v7 package metadata and
types rather than that label.

## Transport adapter boundary

The transport candidate uses the smallest required primitive, `generateText`; it does
not use `WorkflowAgent` or `ToolLoopAgent`. It translates only:

- the immutable Foundry `ExecutionPlan` and selected tool definitions;
- provider-safe messages reconstructed from role/content/tool fields;
- exact required-tool selection;
- raw provider final text for validation by the Foundry response contract;
- token and DeepSeek cache metadata.

Foundry still owns route classification, obligations, Context selection,
per-tool budgets, Evidence sufficiency, Diagnosis workflow, provenance,
delivery policy and terminal conditions. The existing `runAgent` governor
executes those contracts. The adapter cannot add a tool or increase a
Plan-owned budget.

AI SDK defaults to internal retries; this adapter explicitly uses
`maxRetries: 0` so infrastructure replacement remains an external,
recorded decision under the committed run manifest. It passes one
`AbortSignal` through model calls, tool execution, retrieval trace writes
and both Trainer request boundaries. Candidate timeout/failure remains
isolated by the existing shadow coordinator. The gateway keeps the SDK's
inner timeout later than the coordinator deadline so an elapsed shadow run
is recorded as `TIMED_OUT`, not as a generic candidate failure.

The adapter deliberately does not ask AI SDK to validate the final object.
AI SDK schema failure would otherwise throw before the application-owned
malformed-response correction loop. The Foundry loop parses, validates and,
once, corrects malformed final text under its own governed contract. The
structured `RuntimeExecutionResult` is produced only after that validation.

## Offline evidence

Focused tests exercise:

- default-off candidate configuration;
- real AI SDK v7 `generateText` with the installed official DeepSeek
  provider and an offline transport fixture;
- tool translation and Foundry-owned structured-result validation;
- cache-token mapping;
- an actual in-flight model abort and Trainer write abort;
- signal propagation into retrieval and both Trainer boundaries;
- shadow retrieval namespace and shadow Trainer endpoint isolation;
- candidate failure isolation from the authoritative result;
- provider-boundary removal of Context metadata.

The offline transport test observes DeepSeek `tool_choice`, thinking mode,
JSON-object response format and cache usage without contacting a provider.
Fixture evidence is not live Evidence.

## Live and parity evidence

Run manifest:
`agent-eval/run-manifests/ai-sdk7-candidate-pr5.json`.

The committed manifest froze `deepseek-chat`, disabled thinking,
provider-default unsent sampling fields, the 1,800-token output ceiling and
content hashes for the executable adapter boundary. Its three checkpoint
attempts and two baseline attempts were executed at implementation head
`f3641d2`. Every original attempt is retained and there were no replacements.

The technical gate used a configured DeepSeek key/model, governed corpus
index `v0.1-6f7e2a2945ca`, a healthy Registry and two Trainer endpoints with
separate authoritative and shadow persistence. The delivery gate used policy
`1.0.0`, authorizing `deepseek`, `AGENT_EVAL`, `SCHOOL_INTERNAL` and its four
listed source types. The gateway reported candidate authority `NOT GRANTED`
throughout execution.

| Attempt | AgentEval run ID | Authoritative result | Parity report | Candidate evidence |
| --- | --- | --- | --- | --- |
| checkpoint-01 | `agenteval-2026-07-18T09-02-39-891Z-0e8c7b6e` | 5/6 | `runtime-parity-2026-07-18T09-03-39-448Z-5f0b4665` | 3 completed, 3 failed; 1 behavioral regression |
| checkpoint-02 | `agenteval-2026-07-18T09-04-44-184Z-621c6aae` | 5/6 | `runtime-parity-2026-07-18T09-05-55-945Z-91e2e040` | 4 completed, 2 failed; 1 behavioral regression |
| checkpoint-03 | `agenteval-2026-07-18T09-06-09-930Z-873054e2` | 6/6 | `runtime-parity-2026-07-18T09-06-49-668Z-681183e5` | 5 completed, 1 failed; 2 candidate quality regressions |
| baseline-01 | `agenteval-2026-07-18T09-07-11-181Z-058293c0` | 15/18 | `runtime-parity-2026-07-18T09-09-08-573Z-b9a7e0e4` | 11 completed, 7 failed; 3 behavioral regressions |
| baseline-02 | `agenteval-2026-07-18T09-09-28-189Z-a533524a` | 14/18 | `runtime-parity-2026-07-18T09-11-36-010Z-8c435965` | 12 completed, 4 failed; 2 authoritative failures correctly prevented shadows |

All 54 authoritative case executions are present. Fifty-two authoritative
successes were eligible for a shadow; all 52 have candidate evidence: 35
completed and 17 failed. Candidate terminal failures comprise 16
`INVALID_AGENT_RESPONSE` structured-response failures and one
`AGENT_UNSUPPORTED_CLAIM`. There are no unexplained missing shadows or
coordinator timeouts.

Among the 35 completed candidate executions, behavioral comparison found 24
exact matches and 11 differences. Directional quality found 28 matches, five
candidate improvements and two candidate regressions. Every completed pair
has an operational difference requiring assessment; operational differences
are not auto-accepted.

Completed candidate executions recorded 161,874 tokens, including 94,336
prompt-cache-hit and 45,712 prompt-cache-miss tokens, with 240,076 ms aggregate
client latency. No approved pricing snapshot covered this model, so cost
remains unknown rather than estimated.

Live result: **REWORK TRANSPORT CANDIDATE**. AI SDK transport compatibility is
not reliable enough for acceptance because structured final responses fail
non-deterministically across both checkpoint and baseline cases, and completed
executions still contain behavioral and directional quality regressions. This
is a candidate-code decision only, not a runtime-authority decision.

## Privacy, limitations and rollback

No API key, Authorization header, private corpus excerpt, hidden reasoning,
local data or absolute path is committed. Candidate records remain under
the existing purpose-and-role-separated runtime evidence namespace.

Known limitations:

- live provider variance, latency, token/cache and parity evidence exists,
  but pricing coverage is unavailable and the candidate requires rework;
- structured final validation is Foundry-owned; provider-native strict JSON
  schema enforcement is neither used nor claimed;
- governed Diagnosis parity requires an explicitly isolated shadow Trainer
  service and evidence store;
- a configured candidate still does nothing unless the existing shadow
  switch is explicitly enabled;
- the handwritten `runAgent` loop remains in place, so this evidence cannot
  support a claim that AI SDK replaced commodity Agent orchestration;
- a future authority assessment requires a corrected adapter, a newly frozen
  run manifest and new retained first attempts. The failed attempts above are
  never replaced or removed.

Rollback is a revert of this candidate PR. No Legacy path is deleted and no
canonical state requires migration. No PR #13 workflow, base, lockfile or
package assumption was reused.
