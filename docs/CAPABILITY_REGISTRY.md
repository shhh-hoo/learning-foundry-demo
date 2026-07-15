# Capability Registry

`config/capabilities/registry.json` is the Agent's versioned capability source. MASS is listed first and is learner-facing. Each record declares purpose, required input, output contract, limitations, readiness and runtime endpoint.

Kp has `ENGINEERING_ONLY` visibility and is excluded from the Agent's default list. The Trainer may retain its published snapshot for regression and migration history.
