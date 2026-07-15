# Learning Foundry

Learning Foundry is a governed learning system where a real DeepSeek Agent uses explicit tools, deterministic diagnosis and human publication gates.

- **Learner Workspace** — real learner input, source-grounded Agent responses, Learner Diagnosis evidence, and user-confirmed Library or Schedule writes.
- **Foundry Studio** — Learning Pattern Analysis from actual Agent runs, teacher-created candidates, Component Contract Checks, Expert Review and publication.
- **Engineering Inspector** — real Agent Traces, AgentEval reports, Learner Diagnosis, Runtime Validation, Component Registry and system boundaries.
- **Demo Shell** — an event-driven observer around the product surfaces; it is not the product and cannot create evidence.

No key means no model answer, tool result, Trace, pattern, candidate, Library artifact or Schedule item. Presets only fill learner input and are recorded as `PRESET_INPUT`.

## Local services

```text
4173  Learning Foundry UI
4174  Standard Trainer UI
4175  Component Registry
4176  DeepSeek Agent Gateway
4177  Trainer Diagnosis API
```

Export the values shown in `docs/DEEPSEEK_LOCAL_SETUP.md`, or copy `.env.local.example` to the gitignored `.env.local`. `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL` are both required for Agent runs. Never expose the key through Vite variables or browser storage.

```bash
npm install
npm run demo:local
```

Open `http://127.0.0.1:4173/`. Standard Trainer must exist at `../standard-trainer-demo` unless `TRAINER_REPO` points elsewhere.

## Verification

```bash
npm run policy:audit
npm test
npm run check
npm run build
npm run agenteval:live
npm run agenteval:report
npm run agenteval:compare -- --baseline <evalRunId> --candidate <evalRunId>
```

`agenteval:live` requires the real server-side DeepSeek configuration and returns non-zero if it is absent. Automated Tests validate the harness with controlled fixtures; they do not claim that a live AgentEval passed.

## Documentation

- [Real Agent architecture](docs/REAL_AGENT_ARCHITECTURE.md)
- [DeepSeek local setup](docs/DEEPSEEK_LOCAL_SETUP.md)
- [AgentEval](docs/AGENT_EVAL.md)
- [Data-origin policy](docs/DATA_ORIGIN_POLICY.md)
- [Terminology](docs/TERMINOLOGY.md)
- [Capability Registry](docs/CAPABILITY_REGISTRY.md)
- [Product surfaces](docs/PRODUCT_SURFACES.md)
