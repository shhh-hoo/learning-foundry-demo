# AgentEval

AgentEval is the offline quality harness for the whole Agent behavior. Its cases are tagged `AGENT_EVAL_CASE` or `ADVERSARIAL_CASE` and cannot enter product state.

Run `npm run agenteval:checkpoint` first. It runs the six-case gate in this order: A course explanation, B incomplete working, C complete MgO diagnosis, D multi-stage capability gap, diagnosis-01 and diagnosis-02. Each receives its own conversation ID. Only after that gate should `npm run agenteval:live` run all 18 cases against the real local gateway, DeepSeek and tools. Missing server-side configuration exits non-zero with `AgentEval live run not executed`. Every executed suite receives an immutable `evalRunId` under `.local-data/agent-eval-runs/<evalRunId>/`; `.agent-eval-results/latest.json` is only a pointer.

The harness creates a `RUNNING` manifest before the first case and atomically checkpoints each completed case. A normal finish becomes `COMPLETED`; a caught interruption becomes `INTERRUPTED` and retains completed case results. Offline reports expose run status, planned count, completed count and whether the suite is complete.

AgentEval Agent traces and diagnoses are classified `AGENT_EVAL` and stored under `.local-data/agent-eval-agent-runs/` and `.local-data/agent-eval-diagnoses/`. They are visible in Engineering Inspector but excluded from Product evidence queries.

Regenerate a report offline without calling DeepSeek:

```bash
npm run agenteval:report -- --run <evalRunId>
```

Compare two persisted runs:

```bash
npm run agenteval:compare -- --baseline <evalRunId> --candidate <evalRunId>
```

Reports include completeness, pass rate, required-tool accuracy, forbidden-tool rate, source-grounded diagnosis fidelity, latency, token use, estimated cost and every failed check.

The `WHY_EXPLANATION` case rejects answers that merely restate a rule. For the coefficient-to-mole-ratio question it requires the particle mechanism, fixed-particle meaning of a mole, Avogadro scaling that preserves the ratio, separation of balancing from ratio causation, causal priority over conservation-of-mass shorthand and a final `Therefore, X is true because Y.` sentence.

Automated Tests verify parsing, graders and failure behavior with `TEST_FIXTURE` data. They do not substitute for a live run.
