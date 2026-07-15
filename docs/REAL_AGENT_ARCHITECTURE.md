# Real Agent architecture

The server-side DeepSeek Agent Gateway on port 4176 receives a conversation, creates a file-backed `RUNNING` AgentTrace, calls DeepSeek, validates requested tools locally, executes them, appends real tool results by `tool_call_id`, and continues for at most six rounds. Each model response and tool execution is atomically persisted. The terminal record is `COMPLETED` or `FAILED`, and survives service restart.

The browser never receives the API key. The gateway health response exposes only configuration status, provider, model and thinking-mode status. Missing key or model produces `AGENT_NOT_CONFIGURED` and no Trace.

Tools are explicit and bounded: local resource search, capability inspection, Trainer diagnosis, capability-gap recording, and proposal-only Library or Schedule actions. Human confirmation is required for product writes.

Thinking mode defaults to disabled. When enabled, the client passes DeepSeek's thinking toggle and preserves required intermediate provider context during tool rounds, but chain-of-thought is never written to `AgentTrace` or product state.

`GET /agent/runs/:traceId` and filtered `GET /agent/runs` read the file-backed repository, not browser storage. Trainer owns a separate file-backed Learner Diagnosis repository and exposes `GET /diagnoses/:traceId`. API keys, Authorization headers and hidden reasoning are excluded from both stores.

Every request has a required `runPurpose`: `PRODUCT` from Learner Workspace or `AGENT_EVAL` from the live harness. Gateway and Trainer preserve it in traces and select separate physical namespaces. Product evidence uses `.local-data/product-agent-runs/` and `.local-data/product-diagnoses/`; AgentEval evidence uses `.local-data/agent-eval-agent-runs/` and `.local-data/agent-eval-diagnoses/`. Product queries explicitly request `runPurpose=PRODUCT`.

Diagnosis also requires `problemContextEvidence`. Every quote must occur exactly in the latest user message; the structured equation, numeric values, units, target and answer requirement must agree with their quotes. Gateway performs this check before calling port 4177. Capability metadata cannot supply omitted problem facts.
