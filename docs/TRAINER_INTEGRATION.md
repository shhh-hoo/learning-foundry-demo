# Standard Trainer integration

Standard Trainer exposes `GET /health` and `POST /diagnose` on port 4177. The API and UI share the same registry merge, Runtime Validation, target adapter, diagnosis engine, support selection and version trace.

The Agent tool `run_learner_diagnosis` calls this API. Learning Foundry does not duplicate diagnosis logic and does not alter returned failure codes. The Component Registry remains on port 4175 and the Trainer UI on port 4174.

Kp artifacts remain for legacy regression, migration history and engineering inspection. MASS is the first learner-facing capability.
