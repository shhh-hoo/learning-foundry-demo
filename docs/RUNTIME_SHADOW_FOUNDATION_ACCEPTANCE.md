# Runtime shadow foundation acceptance

Docs authority: `learning-foundry-docs@e6ec2408d18fc6850e92c996b36712dbd5be9df5`

Stacked base: `codex/runtime-boundary-program@df0aaa062128a2657e28c862b16b18a0247a4c68`

Shadow implementation checkpoint: `2e20731d58019ac05928975ff5452bd9742c1dc3`

## Problem addressed

PR #7 establishes replaceable current-runtime boundaries, but it intentionally has no mechanism for running a future candidate without affecting the authoritative product path. This stacked change adds the smallest candidate-neutral, default-off shadow coordinator and comparison record needed for a later adapter.

No candidate framework or candidate runtime is included.

## Contracts and current entrypoint

`NormalizedRuntimeExecutionRequest` carries one Foundry-owned request, Execution Plan and versioned policy snapshot. `RuntimeExecutor` consumes that normalized input and emits an Agent trace plus ordered tool results. `RuntimeExecutionRecord` schema `1.0.0` preserves comparison-relevant observable evidence without provider-specific types.

The Agent Gateway is the real caller. It resolves route and obligations once, builds one policy snapshot, invokes `legacy-deepseek-agent@1.0.0` as the authoritative executor, and returns only that result. The current product path therefore remains Legacy authoritative by construction.

`RUNTIME_SHADOW_MODE=enabled` is the only configuration that enables shadow execution. Missing or invalid values fail closed to Legacy-only. `RUNTIME_SHADOW_TIMEOUT_MS` is bounded to a positive value and otherwise defaults to 5000 ms. Because no candidate executor exists in this milestone, explicitly enabling shadow records `SHADOW_EXECUTOR_UNAVAILABLE`; it does not simulate a candidate.

## Isolation and evidence

The coordinator guarantees:

- authoritative execution determines the learner-facing result;
- candidate success cannot replace that result;
- candidate failure and timeout are recorded but isolated;
- authoritative failure remains authoritative;
- both executors receive the same route, obligations and policy snapshot;
- candidate input exposes no canonical Product State or authoritative trace writer;
- normalized tool order, source references, internal evidence references and Diagnosis trace references remain distinct;
- comparison-recorder failure cannot change the authoritative result.

`RoleSeparatedFileRuntimeExecutionRecorder` writes `AUTHORITATIVE` and `SHADOW` records to physically separate namespaces under the gitignored runtime-execution store. It removes hidden reasoning, credentials and private local paths before persistence. Existing Product and AgentEval trace stores remain unchanged and authoritative.

## Normalized record

The provider-neutral record includes execution and parent IDs, explicit execution role, run purpose, conversation/case identity, adapter/provider/model identity, route, obligations, ordered tool calls, `sourceRefs`, `evidenceRefs`, Diagnosis trace reference, final status, latency, usage, optional cost, timestamps, terminal error, failure stage and trace-completeness flags.

It does not include model hidden reasoning, authorization headers, secrets, private corpus paths or raw corpus bytes.

## Automated validation

- `npm test` — 30 files, 172 tests passed;
- `npm run check` — passed;
- `npm run build` — passed;
- `git diff --check` — passed;
- focused shadow coordinator and role-separated recorder tests — 11 passed.

## Live validation

No live candidate execution was run because this milestone intentionally contains no candidate implementation. The corrected base PR's genuine Legacy runs remain recorded in `RUNTIME_BOUNDARY_ACCEPTANCE.md`; they are not candidate parity evidence.

## Remaining Chemistry coupling and non-claims

The authoritative executor still uses the DeepSeek provider, current Chemistry corpus, capability registry and Standard Trainer adapter. The normalized shadow contracts do not claim those Reference Pack records are cross-disciplinary Core.

This change does not grant candidate runtime authority, change AgentEval release gates, write canonical Product State, replace Retrieval, migrate storage, add a framework dependency or delete Legacy code.

## Rollback and authority

Rollback is a revert of this stacked branch. The PR #7 boundaries and Legacy entrypoint remain independently usable.

Candidate authority: **NOT GRANTED**.

Release-gate authority: **NOT GRANTED**.

Legacy deletion authority: **NOT GRANTED**.
