# Standard Trainer integration

Standard Trainer exposes `GET /health`, `POST /diagnose`, `GET /diagnoses` and `GET /diagnoses/:traceId` on port 4177. The API and UI share the same registry merge, Runtime Validation, target adapter, diagnosis engine, support selection and version trace. Completed API diagnoses are immutable file-backed records separated into `.local-data/product-diagnoses/` and `.local-data/agent-eval-diagnoses/` by `runPurpose`.

The Agent tool `run_learner_diagnosis` calls this API only after Gateway validates a complete original problem context, learner working and exact quotes from the current user message. The request and persisted record retain those provenance quotes. Learning Foundry does not duplicate diagnosis logic and does not alter returned failure codes.

Kp artifacts remain for legacy regression, migration history and engineering inspection. MASS is the first learner-facing capability.
