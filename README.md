# Learning Foundry

Learning Foundry is a governed learning system where a real DeepSeek Agent uses explicit tools, deterministic diagnosis and human publication gates.

- **Learner Workspace** — real learner input, source-grounded Agent responses, Learner Diagnosis evidence, and user-confirmed Library or Schedule writes.
- **Foundry Studio** — a configurable repeated-diagnosis signal from PRODUCT runs, a teacher-operated governed Hint Editor, Component Contract Checks, Expert Review and publication.
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

## Governed 9701 corpus

Place the two school-internal source files at `private-sources/9701-2025-2027-syllabus.pdf` and `private-sources/Chem_Calculation_Book_Almost_Everything.pdf`. Both `private-sources/` and `.local-data/corpus/` are gitignored. Source authority, versions and distribution rules come from `corpus/02_SOURCE_MANIFEST.json`; source bytes never enter Git or retrieval traces.

```bash
npm run corpus:ingest
npm run corpus:inspect
```

Ingestion validates every chunk against `corpus/04_RETRIEVAL_CHUNK_SCHEMA.json`, then writes a content-addressed immutable lexical index. Gateway startup reports registered/missing sources, the index version, and chunk counts by source type and distribution scope. The public-safe export command includes only source metadata plus the original Teacher Notes and structured cases.

## Verification

```bash
npm run policy:audit
npm test
npm run check
npm run build
npm run agenteval:checkpoint
npm run agenteval:baseline
npm run agenteval:core-contract
npm run agenteval:reference-pack
npm run agenteval:generalization
npm run agenteval:adversarial
npm run agenteval:learning-loop
npm run agenteval:retrieval
npm run agenteval:live
npm run agenteval:report
npm run agenteval:compare -- --baseline <evalRunId> --candidate <evalRunId>
```

`agenteval:live` requires the real server-side DeepSeek configuration and returns non-zero if it is absent. The full `2.0.0` contract contains 73 cases across the formal suite layers; retrieval is an orthogonal evaluation dimension. Automated Tests validate the harness with controlled fixtures; they do not claim that a live AgentEval passed.

Product and AgentEval evidence have required `runPurpose` classification and separate physical stores. Diagnosis problem facts must be backed by exact quotes from the current user message before the Trainer API is called.

Current runtime infrastructure is reached through narrow contracts for Agent execution, corpus search, Learning Capability execution, AgentEval execution, trace storage and the local diagnostic Component Repository. The current DeepSeek, lexical corpus, Standard Trainer, file-store and local-showcase implementations remain authoritative Legacy adapters; no candidate framework has authority.

## Documentation

- [Real Agent architecture](docs/REAL_AGENT_ARCHITECTURE.md)
- [DeepSeek local setup](docs/DEEPSEEK_LOCAL_SETUP.md)
- [AgentEval](docs/AGENT_EVAL.md)
- [Runtime-boundary acceptance](docs/RUNTIME_BOUNDARY_ACCEPTANCE.md)
- [Data-origin policy](docs/DATA_ORIGIN_POLICY.md)
- [Terminology](docs/TERMINOLOGY.md)
- [Capability Registry](docs/CAPABILITY_REGISTRY.md)
- [Product surfaces](docs/PRODUCT_SURFACES.md)
