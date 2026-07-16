# Architecture

The current architecture is documented in [REAL_AGENT_ARCHITECTURE.md](REAL_AGENT_ARCHITECTURE.md). The browser owns presentation and user-confirmed local product records. DeepSeek credentials and model calls remain in the server-side Agent Gateway. Deterministic learner diagnosis remains owned by Standard Trainer.

Runtime replacement work is layered: [runtime boundaries](RUNTIME_BOUNDARY_ACCEPTANCE.md) retain Legacy authority, the [shadow foundation](RUNTIME_SHADOW_FOUNDATION_ACCEPTANCE.md) isolates a future candidate, and the [case-level parity harness](RUNTIME_PARITY_ACCEPTANCE.md) compares observable evidence using existing AgentEval cases and graders. None of these layers grants candidate authority or changes release policy.
