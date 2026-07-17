# AI SDK 7 Runtime Candidate acceptance

Docs authority: `learning-foundry-docs@260747722e8040972deceed3290bce237676f225`

Doc 17 sections: §§2, 8–9, 16B and 17–20.

Implementation lane: separately reviewed Candidate Experiment.

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

## Adapter boundary

The adapter uses the smallest required primitive, `generateText`; it does
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

Live checkpoint, repeated-run reliability, baseline and case-level parity:
`NOT EXECUTED`.

At implementation time, the process had no `DEEPSEEK_API_KEY`, no
`DEEPSEEK_MODEL` and no governed corpus index. The committed delivery
policy separately authorizes DeepSeek for `AGENT_EVAL`,
`SCHOOL_INTERNAL` and its listed source types. Authorization exists, but
the technical environment does not. No missing case is classified and no
parity conclusion is claimed before execution.

The committed manifest freezes `deepseek-chat`, disabled thinking,
provider-default unsent sampling fields, the 1,800-token output ceiling and
content hashes for the executable adapter boundary. When the environment is
available, it requires exactly three
checkpoint attempts and two baseline attempts. Every original attempt is
retained; only a classified infrastructure failure may receive one linked
replacement. The existing parity reporter preserves case-level behavior,
quality and operational classifications.

## Privacy, limitations and rollback

No API key, Authorization header, private corpus excerpt, hidden reasoning,
local data or absolute path is committed. Candidate records remain under
the existing purpose-and-role-separated runtime evidence namespace.

Known limitations:

- no live provider variance, latency, token, cost or parity evidence exists;
- structured final validation is Foundry-owned; provider-native strict JSON
  schema enforcement is neither used nor claimed;
- governed Diagnosis parity requires an explicitly isolated shadow Trainer
  service and evidence store;
- a configured candidate still does nothing unless the existing shadow
  switch is explicitly enabled;
- a future authority review must be based on retained live attempts and a
  case-level decision report, not this offline acceptance.

Rollback is a revert of this candidate PR. No Legacy path is deleted and no
canonical state requires migration. No PR #13 workflow, base, lockfile or
package assumption was reused.
