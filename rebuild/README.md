# Foundry Dify MVP salvage

This directory is the clean integration target for the Foundry rebuild. It deliberately does not import the old Agent/LangGraph orchestration stack.

Current demo boundary:

- one teacher (teacher and expert are the same actor for the MVP)
- multiple students
- Dify will own AI learning orchestration
- Foundry owns Product State, teacher decisions, the Capability Registry, and runtime sessions
- student-facing Components are independent Web apps launched in a sandboxed iframe
- Component communication uses Foundry Component Runtime Protocol v0.1
- n8n is not required for this MVP

What is salvaged here:

- domain-neutral Task / Episode / Attempt / diagnosis-proposal concepts from `main/src/core/domain/*`
- exact capability/component version identity and content hashing
- Context snapshot identity/provenance, without the old heavy Context Compiler
- Capability Resolution and ActivityPlan output contracts, without the old deterministic resolver/planner
- teacher assignment/intervention contracts, collapsed to one teacher/expert role
- Asset Runtime lifecycle semantics and explicit separation between runtime completion, diagnosis, and learning outcome
- the Component exact-version/hash invariants from CAP-07, but not its stateless declarative executor

What is intentionally not carried forward:

- LangGraph checkpoints/workflows
- custom DeepSeek Agent orchestration
- deterministic capability resolver/planner
- multi-tenant/RLS matrices and migration-rehearsal machinery
- Component Executor service
- Retry/Transfer/Retention implementation
- asset/routing optimization implementation
- Chemistry-specific execution logic in Foundry Core
- the old large AgentEval suite as a CI gate

Run the small salvage checks from repository root:

```bash
npx tsc -p rebuild/tsconfig.json
npx vitest run rebuild/tests
```

This is a migration boundary, not the final UI or database implementation.
