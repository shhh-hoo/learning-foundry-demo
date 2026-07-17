# Architecture

The current architecture is documented in [REAL_AGENT_ARCHITECTURE.md](REAL_AGENT_ARCHITECTURE.md). The browser owns presentation and user-confirmed local product records. DeepSeek credentials and model calls remain in the server-side Agent Gateway. Deterministic learner diagnosis remains owned by Standard Trainer.

Runtime replacement work is layered: [runtime boundaries](RUNTIME_BOUNDARY_ACCEPTANCE.md) retain Legacy authority, the [shadow foundation](RUNTIME_SHADOW_FOUNDATION_ACCEPTANCE.md) isolates a candidate, and the [case-level parity harness](RUNTIME_PARITY_ACCEPTANCE.md) compares observable evidence using existing AgentEval cases and graders. The [AI SDK 7 candidate](AI_SDK_RUNTIME_CANDIDATE_ACCEPTANCE.md) is installed default-off and has offline evidence only. None of these layers grants candidate authority or changes release policy.

The current ownership model is:

```text
Foundry-owned Control Plane
+ replaceable Execution and Data Plane
+ domain-specific Reference Packs
```

Domain-neutral Core contracts live under `src/core/`. Chemistry CAIE 9701
assets are registered by `src/reference-packs/chemistry-caie-9701/` while
their current physical Legacy locations remain compatible. The dependency
direction is Pack to Core; Core production modules cannot import Pack,
Runtime, Agent, implementation schema or provider modules. Run
`npm run core:leakage` to enforce that rule.

See [Chemistry Pack ownership](CHEMISTRY_REFERENCE_PACK_OWNERSHIP.md) and
[Core / Pack acceptance](CORE_CHEMISTRY_PACK_ACCEPTANCE.md). This boundary
does not claim a full physical extraction or cross-disciplinary runtime
validation.
