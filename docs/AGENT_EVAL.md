# AgentEval

AgentEval is the offline quality harness for the whole Agent behavior. Its cases are tagged `AGENT_EVAL_CASE` or `ADVERSARIAL_CASE` and cannot enter product state.

`npm run agenteval:live` runs cases against the real local gateway, DeepSeek and tools. Missing server-side configuration exits non-zero with `AgentEval live run not executed`. `npm run agenteval:report` summarizes provider/model/thinking configuration, prompt and registry versions, tool use, diagnosis fidelity, latency, token use and estimated cost.

Automated Tests verify parsing, graders and failure behavior with `TEST_FIXTURE` data. They do not substitute for a live run.
