# Real Agent architecture

The server-side DeepSeek Agent Gateway on port 4176 receives a conversation, calls DeepSeek, validates requested tools locally, executes them, appends real tool results by `tool_call_id`, and continues for at most six rounds. It validates the final JSON response and stores an `AgentTrace` only after success.

The browser never receives the API key. The gateway health response exposes only configuration status, provider, model and thinking-mode status. Missing key or model produces `AGENT_NOT_CONFIGURED` and no Trace.

Tools are explicit and bounded: local resource search, capability inspection, Trainer diagnosis, capability-gap recording, and proposal-only Library or Schedule actions. Human confirmation is required for product writes.

Thinking mode defaults to disabled. When enabled, the client passes DeepSeek's thinking toggle and preserves required intermediate provider context during tool rounds, but chain-of-thought is never written to `AgentTrace` or product state.
